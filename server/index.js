const express = require('express');
const path = require('path');
const fs = require('fs');
const { searchStations, getBoard } = require('./iris');

const SOUNDS_DIR = path.join(__dirname, '..', 'public', 'sounds');

function listSoundFiles(dir, base = '') {
  let out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out = out.concat(listSoundFiles(path.join(dir, entry.name), rel));
    else if (/\.(mp3|wav|ogg)$/i.test(entry.name)) out.push(rel);
  }
  return out;
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));

// Stationssuche nach RIL100 oder Name, fuer das Autocomplete im Frontend
app.get('/api/stations', (req, res) => {
  const q = req.query.q || '';
  res.json(searchStations(q));
});

// Echtzeit-Board: /api/board?station=KM&platform=1&type=departure
app.get('/api/board', async (req, res) => {
  const { station, platform, type, lookahead } = req.query;
  if (!station) return res.status(400).json({ error: 'station fehlt (RIL100 oder Name)' });
  try {
    const board = await getBoard(station, {
      platform: platform || null,
      type: type === 'arrival' ? 'arrival' : 'departure',
      lookaheadMin: lookahead ? parseInt(lookahead, 10) : 90,
    });
    res.json(board);
  } catch (e) {
    if (e.code === 'STATION_NOT_FOUND') return res.status(404).json({ error: e.message });
    console.error('[board]', e);
    res.status(502).json({ error: 'IRIS-TTS nicht erreichbar', detail: e.message });
  }
});

// Liste aller vom Nutzer abgelegten Sounddateien, damit das Frontend weiss,
// welche Ansagen-Bausteine tatsaechlich vorhanden sind
app.get('/api/sounds', (req, res) => {
  res.json(listSoundFiles(SOUNDS_DIR));
});

app.listen(PORT, () => {
  console.log(`dilaeit-live läuft auf Port ${PORT}`);
});

// Self-Ping gegen Render-Sleep, wie bei dilaeit
if (process.env.APP_URL) {
  setInterval(() => {
    import('https').then(({ default: https }) => {
      https.get(process.env.APP_URL).on('error', () => {});
    });
  }, 14 * 60 * 1000);
}
