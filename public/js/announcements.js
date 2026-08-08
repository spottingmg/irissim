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
  let soundIndex = new Map(); // "ordner/basisname" (lowercase, ohne Endung) -> echter Pfad mit Endung
  let tripState = new Map(); // tripId -> { einfahrt, abfahrtbereit, delay, cancelled, gleiswechsel }
  let queue = [];
  let playing = false;

  function stripExt(rel) {
    return rel.replace(/\.(mp3|wav|ogg)$/i, '');
  }

  async function loadManifest() {
    try {
      const res = await fetch('/api/sounds');
      const list = await res.json();
      availableSounds = new Set(list);
      soundIndex = new Map();
      for (const rel of list) {
        soundIndex.set(stripExt(rel).toLowerCase(), rel);
      }
    } catch (e) {
      availableSounds = new Set();
      soundIndex = new Map();
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

  // Loest einen Ordner/Basisname-Schluessel (ohne Dateiendung) unabhaengig von
  // Gross-/Kleinschreibung und tatsaechlicher Endung (.mp3/.wav/.ogg) auf.
  function resolve(baseKey) {
    return soundIndex.get(baseKey.toLowerCase()) || null;
  }

  function segmentsFor(row, eventType) {
    const platform = row.platform || '';
    const category = (row.category || '').toLowerCase();
    const destSlug = slugify(row.destination);
    const keys = [];

    switch (eventType) {
      case 'einfahrt':
        keys.push('chime/2ton', 'phrasen/einfahrt_auf_gleis', `zahlen/${platform}`,
          'phrasen/faehrt_ein', `linien/${category}`, 'phrasen/nach',
          `orte/${destSlug}`, 'phrasen/bitte_abstand');
        break;
      case 'abfahrtbereit':
        keys.push('chime/3ton', `zahlen/${platform}`, 'phrasen/tueren_schliessen',
          'phrasen/zurueckbleiben');
        break;
      case 'verspaetung':
        keys.push('chime/3ton', `linien/${category}`, 'phrasen/nach', `orte/${destSlug}`,
          'phrasen/verspaetung_heute', `zahlen/${row.delayMin}`, 'phrasen/minuten_verspaetung');
        break;
      case 'ausfall':
        keys.push('chime/3ton', `linien/${category}`, 'phrasen/nach', `orte/${destSlug}`,
          'phrasen/faellt_aus');
        break;
      case 'gleiswechsel':
        keys.push('chime/3ton', 'phrasen/gleiswechsel_hinweis', `linien/${category}`,
          'phrasen/nach', `orte/${destSlug}`, 'phrasen/gleiswechsel_statt',
          `zahlen/${row.plannedPlatform}`, 'phrasen/gleiswechsel_sondern', `zahlen/${platform}`);
        break;
    }
    // jeden Basis-Key gegen den tatsaechlichen Dateinamen (Endung+Case) aufloesen,
    // nicht aufloesbare Keys (Datei fehlt) werden einfach uebersprungen
    return keys.map(resolve).filter(Boolean);
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
    if (!window.irisSimState?.announceEnabled) return;
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

  window.addEventListener('board-update', (ev) => handleUpdate(ev.detail));
})();
