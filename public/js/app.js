(function () {
  const stationInput = document.getElementById('station-input');
  const suggestionsBox = document.getElementById('station-suggestions');
  const platformInput = document.getElementById('platform-input');
  const typeSelect = document.getElementById('type-select');
  const announceToggle = document.getElementById('announce-toggle');
  const startBtn = document.getElementById('start-btn');
  const exitBtn = document.getElementById('exit-btn');

  const setupSection = document.getElementById('setup');
  const boardSection = document.getElementById('board');
  const boardStationName = document.getElementById('board-station-name');
  const boardPlatformBadge = document.getElementById('board-platform-badge');
  const boardClock = document.getElementById('board-clock');
  const boardRows = document.getElementById('board-rows');
  const boardStatus = document.getElementById('board-status');

  let selectedStation = null; // { ril100, eva, name }
  let pollTimer = null;
  const POLL_MS = 25000;

  window.dilaeitLive = { announceEnabled: true };

  // ---------- Stationssuche ----------

  let searchAbort = null;
  stationInput.addEventListener('input', async () => {
    const q = stationInput.value;
    selectedStation = null;
    if (q.trim().length < 2) {
      suggestionsBox.innerHTML = '';
      return;
    }
    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();
    try {
      const res = await fetch(`/api/stations?q=${encodeURIComponent(q)}`, { signal: searchAbort.signal });
      const list = await res.json();
      suggestionsBox.innerHTML = '';
      list.forEach((s) => {
        const div = document.createElement('div');
        div.textContent = `${s.name} (${s.ril100})`;
        div.addEventListener('click', () => {
          selectedStation = s;
          stationInput.value = s.name;
          suggestionsBox.innerHTML = '';
        });
        suggestionsBox.appendChild(div);
      });
    } catch (e) {
      /* Suche abgebrochen oder Netzwerkfehler - ignorieren */
    }
  });

  // ---------- Start / Exit ----------

  startBtn.addEventListener('click', () => {
    const raw = stationInput.value.trim();
    if (!raw) return;
    const stationQuery = selectedStation ? selectedStation.ril100 : raw;
    const platform = platformInput.value.trim();
    const type = typeSelect.value;
    window.dilaeitLive.announceEnabled = announceToggle.checked;

    openBoard(stationQuery, platform, type, selectedStation ? selectedStation.name : raw);
  });

  exitBtn.addEventListener('click', () => {
    clearInterval(pollTimer);
    boardSection.classList.add('hidden');
    setupSection.classList.remove('hidden');
  });

  function openBoard(stationQuery, platform, type, displayName) {
    setupSection.classList.add('hidden');
    boardSection.classList.remove('hidden');
    boardStationName.textContent = displayName;
    boardPlatformBadge.textContent = platform ? `Gleis ${platform}` : 'alle Gleise';
    boardStatus.textContent = 'Verbinde mit IRIS-TTS …';
    boardRows.innerHTML = '';

    fetchBoard(stationQuery, platform, type);
    clearInterval(pollTimer);
    pollTimer = setInterval(() => fetchBoard(stationQuery, platform, type), POLL_MS);
  }

  async function fetchBoard(stationQuery, platform, type) {
    try {
      const params = new URLSearchParams({ station: stationQuery, type });
      if (platform) params.set('platform', platform);
      const res = await fetch(`/api/board?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        boardStatus.textContent = `Fehler: ${data.error || res.status}`;
        return;
      }
      boardStatus.textContent = `Zuletzt aktualisiert: ${new Date(data.generatedAt).toLocaleTimeString('de-DE')}`;
      renderBoard(data);
      window.dispatchEvent(new CustomEvent('dilaeit-board-update', { detail: data }));
    } catch (e) {
      boardStatus.textContent = 'Verbindung zum Server verloren – versuche erneut …';
    }
  }

  function renderBoard(data) {
    boardRows.innerHTML = '';
    if (!data.rows.length) {
      const empty = document.createElement('div');
      empty.className = 'row empty';
      empty.innerHTML = '<div class="line-guide"></div>';
      boardRows.appendChild(empty);
      boardRows.appendChild(empty.cloneNode(true));
      boardStatus.textContent += ' · keine Fahrten im Zeitfenster gefunden';
      return;
    }
    data.rows.slice(0, 6).forEach((row) => {
      boardRows.appendChild(buildRow(row));
    });
  }

  function buildRow(row) {
    const el = document.createElement('div');
    el.className = 'row';

    const timeCell = document.createElement('div');
    timeCell.className = 'cell-time';
    const showPlanned = row.delayMin > 0 || row.cancelled;
    timeCell.innerHTML = `
      <div class="planned">${showPlanned ? row.plannedTime || '' : ''}</div>
      <div class="actual ${row.cancelled ? 'cancelled' : row.delayMin > 0 ? 'delayed' : ''}">${row.time || row.plannedTime || '--:--'}</div>
    `;

    const routeCell = document.createElement('div');
    routeCell.className = 'cell-route';
    const via = (row.path || []).slice(0, -1).join(' - ');
    routeCell.innerHTML = `
      <div class="line">${row.line || ''}${via ? ' &nbsp;' + via : ''}</div>
      <div class="destination">${row.cancelled ? 'Fahrt fällt aus' : row.destination || ''}</div>
    `;

    const platformCell = document.createElement('div');
    platformCell.className = 'cell-platform' + (row.platformChanged ? ' changed' : '');
    platformCell.textContent = row.platform || '–';

    const statusCell = document.createElement('div');
    statusCell.className = 'cell-status';
    if (row.cancelled) {
      statusCell.innerHTML = '<span class="cancel-tag">Fällt aus</span>';
    } else if (row.delayMin > 0) {
      statusCell.innerHTML = `<span class="delay-tag">ca. +${row.delayMin} Min.</span>`;
    } else {
      statusCell.innerHTML = '<span class="ontime-tag">pünktlich</span>';
    }
    if (row.platformChanged) {
      statusCell.innerHTML += `<span>Gleisänderung (statt ${row.plannedPlatform})</span>`;
    }

    el.appendChild(timeCell);
    el.appendChild(routeCell);
    el.appendChild(platformCell);
    el.appendChild(statusCell);
    return el;
  }

  // ---------- Uhr ----------
  setInterval(() => {
    boardClock.textContent = new Date().toLocaleTimeString('de-DE');
  }, 1000);
})();
