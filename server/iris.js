const { XMLParser } = require('fast-xml-parser');
const stations = require('./stations.json');

const BASE = 'https://iris.noncd.db.de/iris-tts/timetable';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: (name) => ['s', 'm', 'ar', 'dp'].includes(name),
});

// ---------- Stationslookup (RIL100/DS100 -> EVA) ----------

function findStation(query) {
  if (!query) return null;
  const q = query.trim().toUpperCase();
  // 1) exakter RIL100/DS100-Treffer
  if (stations[q]) return { ril100: q, ...stations[q] };
  // 2) Namenssuche (Teilstring, case-insensitive)
  const lower = query.trim().toLowerCase();
  for (const [ril100, s] of Object.entries(stations)) {
    if (s.name.toLowerCase() === lower) return { ril100, ...s };
  }
  return null;
}

function searchStations(query, limit = 8) {
  if (!query || query.trim().length < 2) return [];
  const lower = query.trim().toLowerCase();
  const upper = query.trim().toUpperCase();
  const results = [];
  for (const [ril100, s] of Object.entries(stations)) {
    if (ril100 === upper || s.name.toLowerCase().includes(lower)) {
      results.push({ ril100, ...s });
      if (results.length >= limit) break;
    }
  }
  return results;
}

// ---------- Zeit-Hilfsfunktionen (IRIS-Zeitformat: YYMMDDHHmm, Berliner Ortszeit) ----------

// Wandelt einen beliebigen Zeitpunkt in seine Berlin-Ortszeit-Bestandteile um
// (beruecksichtigt automatisch Sommer-/Winterzeit) - notwendig, weil IRIS-TTS
// durchgehend in Berliner Ortszeit rechnet, nicht in UTC.
function berlinParts(date) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
  const get = (t) => fmt.formatToParts(date).find((p) => p.type === t).value;
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0; // manche ICU-Implementierungen geben Mitternacht als '24' aus
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hour,
    minute: parseInt(get('minute'), 10),
  };
}

function parseIrisTime(str) {
  if (!str || str.length !== 10) return null;
  const yy = parseInt(str.slice(0, 2), 10);
  const mo = parseInt(str.slice(2, 4), 10);
  const dd = parseInt(str.slice(4, 6), 10);
  const hh = parseInt(str.slice(6, 8), 10);
  const mi = parseInt(str.slice(8, 10), 10);
  const year = 2000 + yy;
  // Referenzpunkt nur für Minutendifferenzen - keine echte Zeitzonenumrechnung noetig,
  // da beide verglichenen Werte im selben (Berlin-)Bezug stehen.
  const minutes = Date.UTC(year, mo - 1, dd, hh, mi) / 60000;
  return { minutes, hh, mi, label: `${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}` };
}

async function fetchXml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'iris-plus-simulator/0.1 (+https://github.com/spottingmg)' } });
  if (!res.ok) {
    if (res.status === 404) return null; // z.B. Stunden-Bucket ohne Zuege
    throw new Error(`IRIS-TTS ${url} -> HTTP ${res.status}`);
  }
  const text = await res.text();
  if (!text || !text.trim()) return null;
  return parser.parse(text);
}

function pad2(n) { return String(n).padStart(2, '0'); }

function planUrl(eva, date) {
  const p = berlinParts(date);
  const yy = pad2(p.year % 100);
  const mm = pad2(p.month);
  const dd = pad2(p.day);
  const hh = pad2(p.hour);
  return `${BASE}/plan/${eva}/${yy}${mm}${dd}/${hh}`;
}

function fchgUrl(eva) {
  return `${BASE}/fchg/${eva}`;
}

// ---------- Plan- und Change-Daten holen ----------

async function fetchPlanBuckets(eva, hours = 3) {
  const now = new Date();
  const all = [];
  for (let i = 0; i < hours; i++) {
    const t = new Date(now.getTime() + i * 3600000);
    try {
      const doc = await fetchXml(planUrl(eva, t));
      const list = doc?.timetable?.s;
      if (Array.isArray(list)) all.push(...list);
    } catch (e) {
      // einzelner Stunden-Bucket darf fehlschlagen, ohne den ganzen Board-Aufruf zu killen
      console.error('[iris] plan bucket fehlgeschlagen', e.message);
    }
  }
  return all;
}

async function fetchChanges(eva) {
  try {
    const doc = await fetchXml(fchgUrl(eva));
    const list = doc?.timetable?.s;
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.error('[iris] fchg fehlgeschlagen', e.message);
    return [];
  }
}

function indexById(list) {
  const map = new Map();
  for (const s of list) if (s?.id) map.set(s.id, s);
  return map;
}

function trainLabel(s) {
  const tl = s.tl;
  if (!tl) return '';
  const c = tl.c || '';
  const n = tl.n || '';
  return `${c}${c && n ? ' ' : ''}${n}`;
}

function pathArray(pth) {
  if (!pth) return [];
  return String(pth).split('|').filter(Boolean);
}

function mergeEvent(planEvent, chgEvent) {
  const e = { ...(planEvent || {}), ...(chgEvent || {}) };
  const ptRaw = planEvent?.pt;
  const ctRaw = chgEvent?.ct || planEvent?.ct;
  const pt = parseIrisTime(ptRaw);
  const ct = ctRaw ? parseIrisTime(ctRaw) : null;
  const plannedPlatform = planEvent?.pp || null;
  const changedPlatform = chgEvent?.cp || planEvent?.cp || null;
  const cancelled = (chgEvent?.cs || planEvent?.cs) === 'c';
  const delayMin = pt && ct ? ct.minutes - pt.minutes : 0;
  const plannedPath = pathArray(planEvent?.ppth || planEvent?.pth);
  const changedPath = pathArray(chgEvent?.ppth || chgEvent?.cpth);
  const path = changedPath.length ? changedPath : plannedPath;
  const destination = path.length ? path[path.length - 1] : null;
  return {
    plannedTime: pt?.label || null,
    time: ct?.label || pt?.label || null,
    absMinutes: (ct || pt)?.minutes ?? null,
    delayMin,
    plannedPlatform,
    platform: changedPlatform || plannedPlatform,
    platformChanged: !!(changedPlatform && plannedPlatform && changedPlatform !== plannedPlatform),
    cancelled,
    destination,
    path,
    line: planEvent?.l || chgEvent?.l || null,
    messages: [
      ...(Array.isArray(planEvent?.m) ? planEvent.m : []),
      ...(Array.isArray(chgEvent?.m) ? chgEvent.m : []),
    ].map((m) => ({ type: m.t, code: m.c })),
  };
}

/**
 * Baut das Echtzeit-Board fuer eine Station.
 * @param {string} ril100Or Name RIL100-Code oder Bahnhofsname
 * @param {object} opts { platform, type: 'departure'|'arrival', lookaheadMin }
 */
async function getBoard(stationQuery, opts = {}) {
  const station = findStation(stationQuery);
  if (!station) {
    const err = new Error(`Unbekannter Bahnhof: ${stationQuery}`);
    err.code = 'STATION_NOT_FOUND';
    throw err;
  }
  const type = opts.type === 'arrival' ? 'arrival' : 'departure';
  const lookaheadMin = opts.lookaheadMin || 90;

  const [plan, changes] = await Promise.all([
    fetchPlanBuckets(station.eva, 3),
    fetchChanges(station.eva),
  ]);
  const changeMap = indexById(changes);

  const now = parseIrisTime(
    (() => {
      const p = berlinParts(new Date());
      return `${pad2(p.year % 100)}${pad2(p.month)}${pad2(p.day)}${pad2(p.hour)}${pad2(p.minute)}`;
    })()
  );

  const rows = [];
  for (const s of plan) {
    const evKey = type === 'arrival' ? 'ar' : 'dp';
    const planEvent = Array.isArray(s[evKey]) ? s[evKey][0] : s[evKey];
    if (!planEvent) continue;
    const chg = changeMap.get(s.id);
    const chgEvent = chg ? (Array.isArray(chg[evKey]) ? chg[evKey][0] : chg[evKey]) : null;
    const merged = mergeEvent(planEvent, chgEvent);
    if (!merged.time || merged.absMinutes === null) continue;

    const minutesFromNow = merged.absMinutes - now.minutes;
    if (minutesFromNow < -5 || minutesFromNow > lookaheadMin) continue;

    if (opts.platform && String(merged.platform) !== String(opts.platform)) continue;

    rows.push({
      tripId: s.id,
      line: merged.line || trainLabel(s),
      category: s.tl?.c || null,
      trainNumber: s.tl?.n || null,
      destination: merged.destination,
      path: merged.path,
      plannedTime: merged.plannedTime,
      time: merged.time,
      plannedTimeRaw: planEvent?.pt || null,
      delayMin: merged.delayMin,
      minutesFromNow,
      plannedPlatform: merged.plannedPlatform,
      platform: merged.platform,
      platformChanged: merged.platformChanged,
      cancelled: merged.cancelled,
      messages: merged.messages,
    });
  }

  rows.sort((a, b) => (a.minutesFromNow ?? 9999) - (b.minutesFromNow ?? 9999));

  return {
    station: { ril100: station.ril100, eva: station.eva, name: station.name },
    type,
    platform: opts.platform || null,
    generatedAt: new Date().toISOString(),
    rows,
  };
}

module.exports = { findStation, searchStations, getBoard };
