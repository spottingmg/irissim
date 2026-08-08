# dilaeit live

Echtzeit-Zugzielanzeiger für einen einzelnen Bahnhof/Gleis, ausschließlich auf
Basis der **DB IRIS-TTS-Schnittstelle** (`iris.noncd.db.de`) – keine
Drittanbieter-APIs wie VRR/Transitous/marudor. Dazu ein modulares
Ansage-System im Stil von IRIS+, das aus einzelnen Sound-Dateien
zusammengesetzt wird.

## Warum IRIS-TTS und nicht marudor.de?

marudor.de/bahn.expert hat die öffentliche API-Unterstützung eingestellt und
die Dokumentation offline genommen (siehe `railboard-api`-Projekt); zudem hat
die Bahn Anfang 2025 eine der zugrunde liegenden HAFAS-Schnittstellen
abgeschaltet. Genau deswegen läuft z. B. auch die Echtzeitfunktion von
zudis.de aktuell nicht mehr ("Aufgrund externer technischer Einschränkungen
steht bis auf Weiteres leider nur noch der frei beschriftbare
Zugzielanzeiger zur Verfügung"). **IRIS-TTS** ist die offizielle,
schlüssellose Schnittstelle, auf der marudor selbst ursprünglich aufbaute,
und die z. B. auch `Travel::Status::DE::IRIS` (dbf.finalrewind.org) bis heute
verwendet – deutlich stabiler als eine abhängige Drittanbieter-API.

## Funktionsweise

- `server/stations.json` – RIL100/DS100 → EVA-Nummer + Name (6.500+ Stationen,
  aus dem offiziellen DB-Haltestellendatensatz generiert)
- `server/iris.js` – holt `plan` (geplanter Fahrplan) + `fchg` (alle
  aktuellen Änderungen) von IRIS-TTS, merged beides zu einem Echtzeit-Board
  und filtert optional nach Gleis
- `server/index.js` – Express-Server, Endpunkte `/api/stations`,
  `/api/board`, `/api/sounds`, liefert `public/` aus
- `public/` – Frontend (Split-Flap-Optik) + Ansage-Engine

## Ansagen (IRIS+-Logik)

Die Engine (`public/js/announcements.js`) erkennt automatisch:

| Ereignis | Auslöser |
|---|---|
| Einfahrt | Zug ist ≤ 2 Min. entfernt |
| Zurückbleiben/Türen schließen | Abfahrtszeit erreicht |
| Verspätungsansage | neue/geänderte Verspätung |
| Ausfallansage | Zug als storniert gemeldet |
| Gleiswechsel | Ist-Gleis ≠ Plan-Gleis |

Jede Ansage wird aus mehreren kleinen Audiodateien zusammengesetzt (Klang +
feste Textbausteine + Variablen wie Gleisnummer/Ziel/Zuggattung) – genau wie
beim echten System. **Fehlt eine Datei, wird sie einfach übersprungen**, es
gibt also nie einen Fehler, nur eine kürzere Ansage. So kannst du
schrittweise Sounds ergänzen.

### Benötigtes Dateischema unter `public/sounds/`

```
sounds/
  chime/
    2ton.mp3              # normaler Ansage-Gong
    3ton.mp3              # wichtige Ansage (Verspätung/Ausfall/Gleiswechsel)
  phrasen/
    einfahrt_auf_gleis.mp3   "Auf Gleis"
    faehrt_ein.mp3            "fährt ein:"
    nach.mp3                  "nach"
    bitte_abstand.mp3         "Bitte beachten Sie den Sicherheitsabstand..."
    tueren_schliessen.mp3     "Bitte einsteigen und die Türen schließen"
    zurueckbleiben.mp3        "Zurückbleiben, bitte!"
    verspaetung_heute.mp3     "...hat heute voraussichtlich"
    minuten_verspaetung.mp3   "Minuten Verspätung"
    faellt_aus.mp3            "...fällt heute leider aus"
    gleiswechsel_hinweis.mp3  "Bitte beachten Sie:"
    gleiswechsel_statt.mp3    "fährt heute nicht wie gewohnt auf Gleis"
    gleiswechsel_sondern.mp3  "sondern auf Gleis"
  zahlen/
    1.mp3 2.mp3 3.mp3 ...     Gleisnummern & Verspätungsminuten als Zahl
  linien/
    ice.mp3 ic.mp3 ec.mp3 re.mp3 rb.mp3 s.mp3   Zuggattungen
  orte/
    aachen_hbf.mp3 koeln_hbf.mp3 ...   optional, Zielbahnhöfe (Slug: Kleinbuchstaben,
                                        Umlaute -> ae/oe/ue/ss, Leerzeichen -> _)
```

`/api/sounds` listet zur Laufzeit alle vorhandenen Dateien auf – neue Dateien
werden von der Engine spätestens nach 60 Sekunden automatisch erkannt, ohne
Code-Änderung. Die Zuordnung der Dateinamen zu den Ereignissen steht in
`segmentsFor()` in `public/js/announcements.js`, falls du das Schema
anpassen willst.

## Lokal starten

```bash
npm install
npm start
# http://localhost:3000
```

## Auf GitHub veröffentlichen

```bash
cd dilaeit-live
git init
git add .
git commit -m "Initial commit: dilaeit live"
gh repo create dilaeit-live --public --source=. --push
# oder manuell: git remote add origin https://github.com/<user>/dilaeit-live.git && git push -u origin main
```

## Auf Render deployen

1. Neuen **Web Service** auf render.com anlegen, Repo verbinden
2. Build Command: `npm install`
3. Start Command: `npm start`
4. Environment-Variable `APP_URL` = `https://<dein-service>.onrender.com`
   setzen, damit der Self-Ping (wie bei dilaeit) den Free-Tier-Sleep verhindert

## Hinweis zu den Sounddateien

`.mp3`/`.wav`/`.ogg` unter `public/sounds/` sind bewusst in `.gitignore`
eingetragen und werden **nicht** ins (öffentliche) GitHub-Repo committet –
falls du echte Original-Ansagen splicest, bleiben die Audiodateien so lokal
bzw. nur auf Render, ohne rechtliche Fragen im Repo selbst aufzuwerfen. Auf
Render einfach über die Shell/ein eigenes Deploy-Skript hochladen, oder den
`.gitignore`-Eintrag entfernen, wenn du selbst eingesprochene/lizenzfreie
Sounds nutzt.

## Bekannte Grenzen (Stand jetzt)

- IRIS-TTS liefert nur Daten für Betriebsstellen der DB InfraGO (also keine
  reinen NE-Bahnhöfe ohne DB-Anbindung)
- Zielbahnhof wird aus dem Laufweg (`ppth`/`pth`) übernommen; bei sehr kurzen
  Restlaufwegen kann das vom "offiziellen" Endziel abweichen
- Verspätungsgründe/Freitext-Meldungen werden aktuell nur gezählt, nicht im
  Klartext angezeigt (eigener IRIS-`himsearch`-Aufruf nötig, TODO)
- In der Sandbox konnte der Live-Aufruf gegen `iris.noncd.db.de` nicht
  getestet werden (Netzwerk-Whitelist), Format ist aber gegen die
  dokumentierte IRIS-TTS-Struktur (`Travel::Status::DE::IRIS`, `klegul/db-iris`)
  geprüft – bitte nach dem ersten Deploy kurz gegenchecken
