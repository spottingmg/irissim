// server/index.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const stations = require('./stations.json');
const { getBoard } = require('./iris');
const { detectEvent, buildAnnouncementText } = require('./announcement-logic');
const { synthesize } = require('./fish-audio');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));

// In-Memory Zustand pro Zug-ID, um Ansagen nicht mehrfach auszuloesen
// (analog zur Ereigniserkennung des IRIS+ Simulators).
const trainState = {};

function stationLookup(query) {
  const q = (query || '').trim().toLowerCase();
  return stations.find(
    s => s.ril100.toLowerCase() === q || s.name.toLowerCase().includes(q)
  );
}

app.get('/api/stations', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const results = q
    ? stations.filter(s => s.ril100.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
    : stations;
  res.json(results);
});

app.get('/api/board', async (req, res) => {
  try {
    const station = stationLookup(req.query.bahnhof);
    if (!station) {
      return res.status(404).json({ error: 'Bahnhof nicht gefunden. Bitte RIL100-Code oder Namen prüfen.' });
    }
    const board = await getBoard(station.eva, req.query.gleis);

    // Ereignisse pro Zug erkennen und im trainState vermerken (fuer /api/announcement)
    const boardWithEvents = board.map(stop => {
      const prev = trainState[stop.id] || null;
      const event = detectEvent(stop, prev);

      trainState[stop.id] = {
        platform: stop.platform,
        delayMin: stop.delayMin,
        einfahrtAnnounced: prev?.einfahrtAnnounced || event === 'einfahrt',
        abfahrtbereitAnnounced: prev?.abfahrtbereitAnnounced || event === 'abfahrtbereit',
        cancelledAnnounced: prev?.cancelledAnnounced || event === 'ausfall'
      };

      return { ...stop, event };
    });

    res.json({ station, board: boardWithEvents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Erzeugt (bzw. liefert aus dem Cache) die Audiodatei fuer eine konkrete
// Zug-ID + Ereignis. Das Frontend ruft dies auf, sobald /api/board ein
// 'event' fuer einen Zug meldet.
app.get('/api/announcement', async (req, res) => {
  try {
    const { trainId, event, gleis } = req.query;
    if (!trainId || !event) {
      return res.status(400).json({ error: 'trainId und event erforderlich' });
    }

    // Wir bauen den Stop erneut aus dem letzten bekannten Board-Aufruf.
    // Einfachheit halber übergibt das Frontend die noetigen Felder direkt.
    const stop = {
      category: req.query.category || '',
      trainNumber: req.query.trainNumber || '',
      destination: req.query.destination || '',
      viaStops: (req.query.via || '').split('|').filter(Boolean),
      delayMin: parseInt(req.query.delayMin || '0', 10)
    };

    const text = buildAnnouncementText(stop, event, gleis || '?');
    const audio = await synthesize(text);

    res.set('Content-Type', 'audio/mpeg');
    res.set('X-Announcement-Text', encodeURIComponent(text));
    res.send(audio);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`IRIS-TTS-App läuft auf http://localhost:${PORT}`);
});
