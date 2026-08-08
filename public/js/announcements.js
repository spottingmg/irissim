/**
 * Ansage-Engine im Stil des echten IRIS+ Ansagesystems.
 *
 * Ansagen werden aus einzelnen Audio-Schnipseln zusammengesetzt (wie beim
 * echten System: Klang + feste Textbausteine + Variable wie Gleis/Ziel/Linie).
 * Welche Schnipsel es gibt, entscheidet allein der Inhalt von /public/sounds/ –
 * fehlende Dateien werden einfach uebersprungen, es gibt also nie einen Fehler,
 * nur eine luecken­haftere Ansage. Das genaue Namensschema steht im README.
 */
(function () {
  const player = document.getElementById('audio-player');
  const EINFAHRT_SCHWELLE_MIN = 2; // ab wann "faehrt jetzt ein" ausgeloest wird
  const ABFAHRT_SCHWELLE_MIN = 0; // ab wann "Zurueckbleiben" ausgeloest wird

  let availableSounds = new Set();
  let tripState = new Map(); // tripId -> { einfahrt, abfahrtbereit, delay, cancelled, gleiswechsel }
  let queue = [];
  let playing = false;

  async function loadManifest() {
    try {
      const res = await fetch('/api/sounds');
      const list = await res.json();
      availableSounds = new Set(list);
    } catch (e) {
      availableSounds = new Set();
    }
  }
  loadManifest();
  setInterval(loadManifest, 60000); // neu hinzugefuegte Dateien alle 60s erkennen

  function slugify(str) {
    return (str || '')
      .toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function has(rel) { return availableSounds.has(rel); }

  function segmentsFor(row, eventType) {
    const platform = row.platform || '';
    const category = (row.category || '').toLowerCase();
    const destSlug = slugify(row.destination);
    const s = [];

    switch (eventType) {
      case 'einfahrt':
        s.push('chime/2ton.mp3', 'phrasen/einfahrt_auf_gleis.mp3', `zahlen/${platform}.mp3`,
          'phrasen/faehrt_ein.mp3', `linien/${category}.mp3`, 'phrasen/nach.mp3',
          `orte/${destSlug}.mp3`, 'phrasen/bitte_abstand.mp3');
        break;
      case 'abfahrtbereit':
        s.push('chime/3ton.mp3', `zahlen/${platform}.mp3`, 'phrasen/tueren_schliessen.mp3',
          'phrasen/zurueckbleiben.mp3');
        break;
      case 'verspaetung':
        s.push('chime/3ton.mp3', `linien/${category}.mp3`, 'phrasen/nach.mp3', `orte/${destSlug}.mp3`,
          'phrasen/verspaetung_heute.mp3', `zahlen/${row.delayMin}.mp3`, 'phrasen/minuten_verspaetung.mp3');
        break;
      case 'ausfall':
        s.push('chime/3ton.mp3', `linien/${category}.mp3`, 'phrasen/nach.mp3', `orte/${destSlug}.mp3`,
          'phrasen/faellt_aus.mp3');
        break;
      case 'gleiswechsel':
        s.push('chime/3ton.mp3', 'phrasen/gleiswechsel_hinweis.mp3', `linien/${category}.mp3`,
          'phrasen/nach.mp3', `orte/${destSlug}.mp3`, 'phrasen/gleiswechsel_statt.mp3',
          `zahlen/${row.plannedPlatform}.mp3`, 'phrasen/gleiswechsel_sondern.mp3', `zahlen/${platform}.mp3`);
        break;
    }
    return s.filter(has);
  }

  function enqueue(segments) {
    if (!segments.length) return;
    queue.push(segments);
    processQueue();
  }

  function processQueue() {
    if (playing || !queue.length) return;
    playing = true;
    const segments = queue.shift();
    playSequence(segments, 0);
  }

  function playSequence(segments, i) {
    if (i >= segments.length) {
      playing = false;
      processQueue();
      return;
    }
    player.src = `/sounds/${segments[i]}`;
    const next = () => playSequence(segments, i + 1);
    player.onended = next;
    player.onerror = next; // fehlende/kaputte Datei -> einfach weiter
    player.play().catch(next);
  }

  function getState(tripId) {
    if (!tripState.has(tripId)) {
      tripState.set(tripId, { einfahrt: false, abfahrtbereit: false, delay: 0, cancelled: false, gleiswechsel: false });
    }
    return tripState.get(tripId);
  }

  function handleUpdate(board) {
    if (!window.dilaeitLive?.announceEnabled) return;
    const seenIds = new Set();
    for (const row of board.rows) {
      seenIds.add(row.tripId);
      const st = getState(row.tripId);

      if (row.cancelled && !st.cancelled) {
        st.cancelled = true;
        enqueue(segmentsFor(row, 'ausfall'));
        continue;
      }
      if (row.cancelled) continue;

      if (row.platformChanged && !st.gleiswechsel) {
        st.gleiswechsel = true;
        enqueue(segmentsFor(row, 'gleiswechsel'));
      }

      if (row.delayMin > 0 && row.delayMin !== st.delay) {
        st.delay = row.delayMin;
        enqueue(segmentsFor(row, 'verspaetung'));
      }

      if (!st.einfahrt && row.minutesFromNow <= EINFAHRT_SCHWELLE_MIN && row.minutesFromNow > ABFAHRT_SCHWELLE_MIN) {
        st.einfahrt = true;
        enqueue(segmentsFor(row, 'einfahrt'));
      }

      if (board.type === 'departure' && !st.abfahrtbereit && row.minutesFromNow <= ABFAHRT_SCHWELLE_MIN) {
        st.abfahrtbereit = true;
        enqueue(segmentsFor(row, 'abfahrtbereit'));
      }
    }
    // Alten Zustand fuer Fahrten aufraeumen, die aus dem Board gefallen sind
    for (const id of tripState.keys()) if (!seenIds.has(id)) tripState.delete(id);
  }

  window.addEventListener('dilaeit-board-update', (ev) => handleUpdate(ev.detail));
})();
