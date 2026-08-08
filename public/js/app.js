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
  const focusPanel = document.getElementById('focus-panel');
  const wagonPanel = document.getElementById('wagon-panel');
  const nextList = document.getElementById('next-list');
  const boardStatus = document.getElementById('board-status');

  let selectedStation = null; // { ril100, eva, name }
  let pollTimer = null;
  const POLL_MS = 25000;

  window.irisSimState = { announceEnabled: true };

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
    window.irisSimState.announceEnabled = announceToggle.checked;

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
    focusPanel.innerHTML = '';
    wagonPanel.classList.add('hidden');
    nextList.innerHTML = '';

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
      window.dispatchEvent(new CustomEvent('board-update', { detail: data }));
    } catch (e) {
      boardStatus.textContent = 'Verbindung zum Server verloren – versuche erneut …';
    }
  }

  let lastWagonKey = null;

  function renderBoard(data) {
    const rows = data.rows || [];
    const focusRow = rows[0] || null;
    const upcoming = rows.slice(1, 3);

    renderFocus(focusRow, data.type);
    renderNextList(upcoming);

    if (!focusRow) {
      boardStatus.textContent += ' · keine Fahrten im Zeitfenster gefunden';
      wagonPanel.classList.add('hidden');
      return;
    }
    maybeLoadWagon(focusRow);
  }

  function renderFocus(row, type) {
    if (!row) {
      focusPanel.innerHTML = '<div class="focus-empty">Keine Fahrt im Anzeigefenster.</div>';
      return;
    }
    const showPlanned = row.delayMin > 0 || row.cancelled;
    const via = (row.path || []).slice(0, -1).slice(0, 3).join(' - ');

    let metaHtml = '';
    if (row.cancelled) metaHtml += '<span class="cancel-tag">Fällt aus</span>';
    else if (row.delayMin > 0) metaHtml += `<span class="delay-tag">ca. +${row.delayMin} Min.</span>`;
    if (row.platformChanged) metaHtml += `<span class="platform-change-tag">Gleisänderung (statt Gleis ${row.plannedPlatform})</span>`;

    focusPanel.innerHTML = `
      <div class="focus-time">
        <div class="planned">${showPlanned ? row.plannedTime || '' : ''}</div>
        <div class="actual ${row.cancelled ? 'cancelled' : row.delayMin > 0 ? 'delayed' : ''}">${row.time || row.plannedTime || '--:--'}</div>
      </div>
      <div class="focus-main">
        <div class="focus-line-row">
          <span>${row.line || ''}${row.trainNumber ? ' / ' + row.trainNumber : ''}</span>
          <span class="via">${via}</span>
        </div>
        <div class="focus-destination">${row.cancelled ? 'Fahrt fällt aus' : row.destination || ''}</div>
        ${metaHtml ? `<div class="focus-meta">${metaHtml}</div>` : ''}
      </div>
    `;
  }

  function renderNextList(rows) {
    nextList.innerHTML = '';
    if (!rows.length) return;
    rows.forEach((row) => {
      const el = document.createElement('div');
      el.className = 'next-row' + (row.delayMin > 0 ? ' delayed' : '');
      const via = (row.path || []).slice(0, -1).slice(0, 1)[0]; // nur der naechste Zwischenhalt, wie im Original
      el.innerHTML = `
        <span class="time">${row.time || row.plannedTime || '--:--'}</span>
        <span>${row.line || ''}</span>
        <span class="dest">${row.destination || ''}${via ? ` <span class="via-suffix">via ${via}</span>` : ''}</span>
      `;
      nextList.appendChild(el);
    });
  }

  async function maybeLoadWagon(row) {
    if (row.cancelled || !row.trainNumber || !row.plannedTimeRaw) {
      wagonPanel.classList.add('hidden');
      return;
    }
    const key = `${row.tripId}`;
    if (key === lastWagonKey) return; // schon geladen, nicht bei jedem Poll neu anfragen
    lastWagonKey = key;
    try {
      const params = new URLSearchParams({
        trainNumber: row.trainNumber,
        plannedTime: row.plannedTimeRaw,
        category: row.category || '',
      });
      const res = await fetch(`/api/wagenreihung?${params.toString()}`);
      const data = await res.json();
      renderWagonPanel(data, row);
    } catch (e) {
      wagonPanel.classList.add('hidden');
    }
  }

  function renderWagonPanel(data, row) {
    if (!data.available || !data.wagons.length) {
      wagonPanel.classList.add('hidden');
      return;
    }
    wagonPanel.classList.remove('hidden');

    // Sektorbuchstaben in Fahrtreihenfolge, doppelte/leere raus, wie auf dem Vorbild (z.B. D C B A)
    const sectors = [];
    for (const w of data.wagons) {
      const s = (w.sector || '').toString().trim();
      if (s && sectors[sectors.length - 1] !== s) sectors.push(s);
    }

    const doors = data.wagons
      .map((w) => `<div class="door${w.wagonClass === '1' || w.wagonClass === 1 ? ' first-class' : ''}"></div>`)
      .join('<div class="rail"></div>');

    wagonPanel.innerHTML = `
      ${sectors.length ? `<div class="sector-labels">${sectors.map((s) => `<span>${s}</span>`).join('')}</div>` : ''}
      <div class="door-track">
        <div class="rail"></div>${doors}<div class="rail"></div>
        <span class="arrow">➜</span>
      </div>
      <div class="wagon-note">Wagenreihung ${row.line || ''}${row.trainNumber ? ' ' + row.trainNumber : ''} · Quelle: DB-Wagenreihungs-API (inoffiziell, nur Fernverkehr)</div>
    `;
  }

  // ---------- Uhr ----------
  setInterval(() => {
    boardClock.textContent = new Date().toLocaleTimeString('de-DE');
  }, 1000);
})();
