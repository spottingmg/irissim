const setupEl = document.getElementById('setup');
const boardEl = document.getElementById('board');
const errorEl = document.getElementById('setup-error');
const audioEl = document.getElementById('announcement-audio');

let currentBahnhof = null;
let currentGleis = null;
let pollTimer = null;
let announcementQueue = [];
let playingAnnouncement = false;

document.getElementById('btn-start').addEventListener('click', () => {
  const bahnhof = document.getElementById('input-bahnhof').value.trim();
  const gleis = document.getElementById('input-gleis').value.trim();
  if (!bahnhof) {
    errorEl.textContent = 'Bitte einen Bahnhof eingeben.';
    return;
  }
  currentBahnhof = bahnhof;
  currentGleis = gleis;
  errorEl.textContent = '';
  setupEl.classList.add('hidden');
  boardEl.classList.remove('hidden');
  pollBoard();
  pollTimer = setInterval(pollBoard, 25000);
});

async function pollBoard() {
  try {
    const params = new URLSearchParams({ bahnhof: currentBahnhof });
    if (currentGleis) params.set('gleis', currentGleis);
    const res = await fetch(`/api/board?${params}`);
    const data = await res.json();

    if (!res.ok) {
      showSetupAgain(data.error || 'Fehler beim Laden des Boards.');
      return;
    }

    renderBoard(data.board);
    queueAnnouncements(data.board);
  } catch (err) {
    console.error('Board-Fehler:', err);
  }
}

function showSetupAgain(message) {
  clearInterval(pollTimer);
  boardEl.classList.add('hidden');
  setupEl.classList.remove('hidden');
  errorEl.textContent = message;
}

function renderBoard(board) {
  const next = board[0];
  const upcoming = board.slice(1, 3);

  if (!next) {
    document.getElementById('focus-dest').textContent = 'Keine Züge';
    document.getElementById('focus-time').textContent = '--:--';
    document.getElementById('focus-line').textContent = '';
    document.getElementById('focus-gleis').textContent = '';
    document.getElementById('focus-via').textContent = '';
    document.getElementById('focus-status').textContent = '';
    document.getElementById('wagenstand').innerHTML = '<span class="wagenstand-empty">Keine Wagenstandsdaten</span>';
    document.getElementById('mini-list').innerHTML = '';
    return;
  }

  const time = next.changedTime || next.plannedTime;
  document.getElementById('focus-time').textContent = time
    ? new Date(time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : '--:--';
  document.getElementById('focus-line').textContent = next.line || '';
  document.getElementById('focus-dest').textContent = next.destination || '';
  document.getElementById('focus-gleis').textContent = `Gl. ${next.platform || '-'}`;
  document.getElementById('focus-via').textContent = next.viaStops?.length
    ? `über ${next.viaStops.slice(0, 3).join(', ')}`
    : '';

  const statusEl = document.getElementById('focus-status');
  statusEl.className = 'focus-status';
  if (next.cancelled) {
    statusEl.textContent = 'Fällt heute aus';
    statusEl.classList.add('cancelled');
  } else if (next.delayMin >= 1) {
    statusEl.textContent = `heute ca. ${next.delayMin} Min. später`;
    statusEl.classList.add('delay');
  } else {
    statusEl.textContent = '';
  }

  // Wagenstand: hier nur Platzhalter-Sektoren A-D, da die inoffizielle
  // Wagenreihungs-API separat angebunden werden müsste (siehe IRIS+ Simulator-Projekt).
  const wagenEl = document.getElementById('wagenstand');
  wagenEl.innerHTML = '';
  ['A', 'B', 'C', 'D'].forEach(sector => {
    const c = document.createElement('div');
    c.className = 'wagen-circle';
    c.textContent = sector;
    wagenEl.appendChild(c);
  });

  const miniEl = document.getElementById('mini-list');
  miniEl.innerHTML = '';
  upcoming.forEach(stop => {
    const row = document.createElement('div');
    row.className = 'mini-list-row';
    const t = stop.changedTime || stop.plannedTime;
    row.innerHTML = `
      <span class="mtime">${t ? new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '--:--'}</span>
      <span class="mline">${stop.line || ''}</span>
      <span class="mdest">${stop.destination || ''}${stop.viaStops?.length ? ' via ' + stop.viaStops[0] : ''}</span>
    `;
    miniEl.appendChild(row);
  });
}

function queueAnnouncements(board) {
  board.forEach(stop => {
    if (stop.event) {
      announcementQueue.push(stop);
    }
  });
  processAnnouncementQueue();
}

async function processAnnouncementQueue() {
  if (playingAnnouncement || announcementQueue.length === 0) return;
  playingAnnouncement = true;
  const stop = announcementQueue.shift();

  try {
    const params = new URLSearchParams({
      trainId: stop.id,
      event: stop.event,
      gleis: stop.platform || '',
      category: stop.category || '',
      trainNumber: stop.trainNumber || '',
      destination: stop.destination || '',
      via: (stop.viaStops || []).join('|'),
      delayMin: String(stop.delayMin || 0)
    });
    const res = await fetch(`/api/announcement?${params}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Ansage-Fehler:', err.error || res.status);
      playingAnnouncement = false;
      processAnnouncementQueue();
      return;
    }
    const blob = await res.blob();
    audioEl.src = URL.createObjectURL(blob);
    audioEl.onended = () => {
      playingAnnouncement = false;
      processAnnouncementQueue();
    };
    audioEl.play().catch(() => {
      // Autoplay evtl. durch Browser blockiert, bis Nutzer interagiert hat
      playingAnnouncement = false;
    });
  } catch (err) {
    console.error('Ansage-Fehler:', err);
    playingAnnouncement = false;
    processAnnouncementQueue();
  }
}
