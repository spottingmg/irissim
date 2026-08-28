// server/iris.js
// Holt Fahrplan- (plan) und Echtzeitdaten (fchg) von der oeffentlichen,
// schluessellosen IRIS-TTS-Schnittstelle der DB (iris.noncd.db.de) und
// baut daraus ein Abfahrtsboard fuer einen Bahnhof (per EVA-Nummer) + Gleis.

const fetch = require('node-fetch');
const xml2js = require('xml2js');

const IRIS_BASE = 'https://iris.noncd.db.de/iris-tts/v1';

function berlinParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  return {
    yy: parts.year.slice(2),
    mm: parts.month,
    dd: parts.day,
    hh: parts.hour === '24' ? '00' : parts.hour
  };
}

async function fetchXml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'iris-tts-app/1.0' } });
  if (!res.ok) throw new Error(`IRIS-TTS Anfrage fehlgeschlagen (${res.status}) fuer ${url}`);
  const text = await res.text();
  return xml2js.parseStringPromise(text, { explicitArray: true });
}

async function fetchPlan(eva) {
  const { yy, mm, dd, hh } = berlinParts();
  const url = `${IRIS_BASE}/plan/${eva}/${yy}${mm}${dd}/${hh}`;
  return fetchXml(url);
}

async function fetchFchg(eva) {
  const url = `${IRIS_BASE}/fchg/${eva}`;
  return fetchXml(url);
}

// Baut aus einer <s>-Node (Timetable Stop) einen normalisierten Eintrag.
function normalizeStop(s) {
  const attrs = s.$ || {};
  const tl = s.tl && s.tl[0] ? s.tl[0].$ : {};
  const ar = s.ar && s.ar[0] ? s.ar[0].$ : null;
  const dp = s.dp && s.dp[0] ? s.dp[0].$ : null;

  const line = (dp && dp.l) || (ar && ar.l) || tl.n || '';
  const category = tl.c || '';
  const trainNumber = tl.n || '';
  const plannedPath = (dp && dp.ppth) || '';
  const destination = plannedPath ? plannedPath.split('|').pop() : '';
  const plannedTime = dp ? dp.pt : (ar ? ar.pt : null);
  const changedTime = dp ? dp.ct : (ar ? ar.ct : null);
  const plannedPlatform = (dp && dp.pp) || (ar && ar.pp) || '';
  const changedPlatform = (dp && dp.cp) || (ar && ar.cp) || '';
  const status = dp ? (dp.cs || 'p') : (ar ? (ar.cs || 'p') : 'p');

  return {
    id: attrs.id,
    category,
    line: category && trainNumber ? `${category} ${line}`.trim() : line,
    trainNumber,
    destination,
    viaStops: plannedPath ? plannedPath.split('|').slice(0, -1) : [],
    plannedTime: parseIrisTime(plannedTime),
    changedTime: changedTime ? parseIrisTime(changedTime) : null,
    plannedPlatform,
    platform: changedPlatform || plannedPlatform,
    platformChanged: !!(changedPlatform && changedPlatform !== plannedPlatform),
    cancelled: status === 'c'
  };
}

function parseIrisTime(t) {
  // Format: YYMMDDHHmm
  if (!t || t.length < 10) return null;
  const yy = t.slice(0, 2), mm = t.slice(2, 4), dd = t.slice(4, 6);
  const hh = t.slice(6, 8), mi = t.slice(8, 10);
  return new Date(`20${yy}-${mm}-${dd}T${hh}:${mi}:00+02:00`);
}

function delayMinutes(stop) {
  if (!stop.changedTime || !stop.plannedTime) return 0;
  return Math.round((stop.changedTime - stop.plannedTime) / 60000);
}

// Holt und merged plan + fchg fuer einen Bahnhof, gefiltert auf ein Gleis (optional)
async function getBoard(eva, gleis) {
  const [planXml, fchgXml] = await Promise.all([
    fetchPlan(eva).catch(() => ({ timetable: { s: [] } })),
    fetchFchg(eva).catch(() => ({ timetable: { s: [] } }))
  ]);

  const planStops = (planXml.timetable && planXml.timetable.s) || [];
  const fchgById = {};
  ((fchgXml.timetable && fchgXml.timetable.s) || []).forEach(s => {
    if (s.$ && s.$.id) fchgById[s.$.id] = s;
  });

  const merged = planStops.map(s => {
    const id = s.$ && s.$.id;
    const fchg = id && fchgById[id];
    if (fchg) {
      // Echtzeit-Felder aus fchg in den plan-Stop mergen (dp/ar cp, ct, cs)
      ['dp', 'ar'].forEach((tag, idx) => {
        if (fchg[tag] && fchg[tag][0] && s[tag] && s[tag][0]) {
          s[tag][0].$ = { ...s[tag][0].$, ...fchg[tag][0].$ };
        }
      });
    }
    return normalizeStop(s);
  });

  const now = new Date();
  let board = merged
    .filter(s => s.destination && s.plannedTime)
    .filter(s => (s.changedTime || s.plannedTime) >= new Date(now.getTime() - 2 * 60000))
    .sort((a, b) => (a.changedTime || a.plannedTime) - (b.changedTime || b.plannedTime));

  if (gleis) {
    board = board.filter(s => s.platform === String(gleis));
  }

  return board.map(s => ({
    ...s,
    delayMin: delayMinutes(s),
    minutesUntil: Math.round(((s.changedTime || s.plannedTime) - now) / 60000)
  }));
}

module.exports = { getBoard, berlinParts };
