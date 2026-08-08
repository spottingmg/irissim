/**
 * Inoffizielle DB-Wagenreihungs-API (RFID-basierte Wagenstandanzeige).
 * Laut mehrfach reverse-engineerten Projekten (Travel::Status::DE::DBWagenreihung,
 * db-wagenreihung-php, juliuste/db-wagenreihung) unter:
 *   https://ist-wr.noncd.db.de/wagenreihung/1.0/<Zugnummer>/<PlanabfahrtszeitYYYYMMDDHHmm>
 *
 * Laut DB-eigener FAQ nur für den aktuellen Tag und zuverlässig nur für den
 * Fernverkehr (ICE/IC/EC) verfügbar - für Nahverkehr oft "keine Wagenreihung
 * verfügbar". Diese Datei ist bewusst defensiv geschrieben: unbekannte/fehlende
 * Felder führen nicht zum Absturz, sondern zu einer leeren Wagenliste.
 */

const BASE = 'https://ist-wr.noncd.db.de/wagenreihung/1.0';

function expandPlannedTime(pt10) {
  // IRIS-Format YYMMDDHHmm -> von der Wagenreihungs-API erwartetes YYYYMMDDHHmm
  if (!pt10 || pt10.length !== 10) return null;
  return `20${pt10}`;
}

async function fetchRaw(trainNumber, plannedTimeIris) {
  const t = expandPlannedTime(plannedTimeIris);
  if (!t || !trainNumber) return null;
  const url = `${BASE}/${trainNumber}/${t}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'iris-plus-simulator/0.1 (+https://github.com/spottingmg)' } });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Zuggattungen, fuer die die API laut DB-FAQ zuverlässig Daten liefert
const FERNVERKEHR = new Set(['ICE', 'IC', 'EC', 'TGV', 'RJ', 'RJX', 'NJ', 'ECE']);

function isFernverkehr(category) {
  return FERNVERKEHR.has((category || '').toUpperCase());
}

/**
 * Normalisiert die (undokumentierte, variierende) Rohantwort in ein festes Schema.
 * Sucht Fahrzeuggruppen/Wagen an mehreren bekannten Feldnamen, damit kleine
 * API-Abweichungen nicht gleich zu "keine Daten" fuehren.
 */
function normalize(raw) {
  if (!raw) return null;
  const groups = raw.allFahrzeuggruppe || raw.fahrzeuggruppe || raw.vehicleGroups || [];
  const wagons = [];
  const list = Array.isArray(groups) ? groups : [];

  for (const group of list) {
    const fahrzeuge = group.allFahrzeug || group.fahrzeug || group.vehicles || [];
    for (const f of Array.isArray(fahrzeuge) ? fahrzeuge : []) {
      const sektorRaw =
        f.positionAmBahnsteig?.sektor ||
        f.positionAmBahnsteig?.abschnitt ||
        f.sektor ||
        f.abschnitt ||
        null;
      wagons.push({
        wagonNumber: f.wagenordnungsnummer ?? f.wagonNumber ?? f.orderNumber ?? null,
        type: f.kategorie || f.type || f.fahrzeugtyp || null,
        wagonClass: f.klasse || f.wagonClass || null,
        sector: sektorRaw,
        offset: f.positionAmBahnsteig?.startPosition ?? f.startPosition ?? null,
        length: f.positionAmBahnsteig?.endPosition && f.positionAmBahnsteig?.startPosition
          ? f.positionAmBahnsteig.endPosition - f.positionAmBahnsteig.startPosition
          : null,
      });
    }
  }

  // Fallback: manche Antworten liefern Wagen direkt unter raw.wagons (aelteres/anderes Schema)
  if (!wagons.length && Array.isArray(raw.wagons)) {
    for (const w of raw.wagons) {
      wagons.push({
        wagonNumber: w.wagonNumber ?? null,
        type: w.type || null,
        wagonClass: null,
        sector: w.sector || null,
        offset: null,
        length: null,
      });
    }
  }

  if (!wagons.length) return null;

  return {
    product: raw.zuggattung || raw.product || null,
    trainNumber: raw.zugnummer || raw.trainNumber || null,
    wagons,
  };
}

/**
 * @param {string} trainNumber reine Zugnummer (ohne Gattung), z.B. "623"
 * @param {string} plannedTimeIris IRIS-Zeitformat YYMMDDHHmm der Planabfahrt an DIESER Station
 * @param {string} category Zuggattung (ICE/IC/RE/...) - nur fuer die isFernverkehr-Einschaetzung
 */
async function getWagenreihung(trainNumber, plannedTimeIris, category) {
  if (!isFernverkehr(category)) {
    return { available: false, reason: 'nur Fernverkehr (ICE/IC/EC) unterstuetzt', wagons: [] };
  }
  try {
    const raw = await fetchRaw(trainNumber, plannedTimeIris);
    const norm = normalize(raw);
    if (!norm) return { available: false, reason: 'keine Wagenreihung verfuegbar', wagons: [] };
    return { available: true, ...norm };
  } catch (e) {
    console.error('[wagenreihung]', e.message);
    return { available: false, reason: 'API nicht erreichbar', wagons: [] };
  }
}

module.exports = { getWagenreihung, isFernverkehr };
