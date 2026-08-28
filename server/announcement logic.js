// server/announcement-logic.js
// Enthaelt die IRIS+-artige Ereignislogik: WANN wird welche Ansage ausgeloest,
// und WELCHER Text wird dafuer formuliert. Der Text geht anschliessend an
// Fish Audio TTS statt an vorab gesplicete Sound-Bausteine.

// Ereignistypen, absteigend nach Prioritaet:
// 'ausfall', 'gleiswechsel', 'einfahrt', 'abfahrtbereit', 'verspaetung'

function trainLabel(stop) {
  return `${stop.category || 'Zug'} ${stop.trainNumber || ''}`.trim();
}

function destinationPhrase(stop) {
  if (stop.viaStops && stop.viaStops.length) {
    const via = stop.viaStops.slice(0, 2).join(', ');
    return `nach ${stop.destination} über ${via}`;
  }
  return `nach ${stop.destination}`;
}

// Bestimmt, welches Ereignis (falls ueberhaupt) fuer einen Stop gerade relevant ist.
// previousState: der zuletzt bekannte Zustand desselben Zuges (fuer Zustandsuebergaenge),
// oder null wenn er noch nie beobachtet wurde.
function detectEvent(stop, previousState) {
  if (stop.cancelled && (!previousState || !previousState.cancelledAnnounced)) {
    return 'ausfall';
  }
  if (
    stop.platformChanged &&
    (!previousState || previousState.platform !== stop.platform) &&
    !stop.cancelled
  ) {
    return 'gleiswechsel';
  }
  if (stop.cancelled) return null;

  if (stop.minutesUntil <= 0 && stop.minutesUntil > -1 && (!previousState || !previousState.abfahrtbereitAnnounced)) {
    return 'abfahrtbereit';
  }
  if (stop.minutesUntil <= 2 && stop.minutesUntil > 0 && (!previousState || !previousState.einfahrtAnnounced)) {
    return 'einfahrt';
  }
  if (
    stop.delayMin >= 5 &&
    (!previousState || previousState.delayMin !== stop.delayMin) &&
    stop.minutesUntil > 2
  ) {
    return 'verspaetung';
  }
  return null;
}

// Formuliert den Ansagetext im IRIS+-Stil fuer ein gegebenes Ereignis.
function buildAnnouncementText(stop, event, platform) {
  const zug = trainLabel(stop);
  const ziel = destinationPhrase(stop);

  switch (event) {
    case 'einfahrt':
      return `Auf Gleis ${platform}, Einfahrt des ${zug} ${ziel}. Bitte treten Sie von der Bahnsteigkante zurück.`;

    case 'abfahrtbereit':
      return `Der ${zug} ${ziel} auf Gleis ${platform} ist abfahrbereit. Zurückbleiben, bitte.`;

    case 'verspaetung':
      return `Der ${zug} ${ziel} auf Gleis ${platform} hat heute eine Verspätung von etwa ${stop.delayMin} Minuten.`;

    case 'ausfall':
      return `Der ${zug} ${ziel}, heute auf Gleis ${platform}, fällt heute leider aus. Wir bitten um Beachtung der Anschlussmöglichkeiten.`;

    case 'gleiswechsel':
      return `Achtung, Gleiswechsel: Der ${zug} ${ziel} fährt heute nicht wie gewohnt, sondern von Gleis ${platform} ab.`;

    default:
      return `Ansage für ${zug} ${ziel}.`;
  }
}

module.exports = { detectEvent, buildAnnouncementText };
