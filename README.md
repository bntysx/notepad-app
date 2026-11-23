# Notepad

Notizen im Stil des Windows-Editors, für PC und iPhone. Die Notizen liegen als `.md`-Dateien im privaten Repo `bntysx/notizen`. Dieses Repo enthält nur den Programmcode der App, keine Notizen und keine Schlüssel.

App-Adresse: https://bntysx.github.io/notepad-app/

## Einmalig einrichten

### 1. GitHub Pages einschalten

1. In diesem Repo auf **Settings → Pages** gehen.
2. Bei **Source** „Deploy from a branch“ wählen.
3. Branch `main`, Ordner `/ (root)`, dann **Save**.
4. Nach ein bis zwei Minuten ist die App unter der Adresse oben erreichbar.

### 2. Am PC installieren

1. Die App-Adresse in Edge oder Chrome öffnen.
2. GitHub-Konto (`bntysx`), Repo (`notizen`) und den Token eintragen, dann **Verbinden**.
3. In der Adressleiste rechts auf das Symbol „App installieren“ klicken (Edge: „Diese Website als App installieren“).
4. Die App läuft danach im eigenen Fenster und lässt sich an die Taskleiste anheften.

### 3. Am iPhone installieren

1. Die App-Adresse in **Safari** öffnen.
2. Teilen-Symbol → **Zum Home-Bildschirm**.
3. Die App vom Home-Bildschirm aus starten und dort den Token eintragen. Die installierte App hat ihren eigenen Speicher, ein Token aus Safari wird nicht übernommen.

## Token

- Fine-grained Token, nur für das Repo `notizen`, Recht **Contents: Read and write**.
- Er wird nur auf dem jeweiligen Gerät gespeichert und nirgends sonst.
- Fine-grained Tokens laufen ab. Wenn die App „Der Token ist ungültig oder abgelaufen“ meldet, auf GitHub einen neuen erstellen und in der App eintragen.
- Zum Entfernen: **Datei → Verbindung trennen** (am iPhone über •••).
- Unter `bntysx.github.io` sollte keine fremde Seite laufen, da alle Seiten dieser Adresse denselben Speicher im Browser teilen.

## Bedienung

| Taste | Funktion |
|---|---|
| Strg+S | Sofort speichern (sonst automatisch nach kurzer Tipp-Pause) |
| Strg+Alt+N | Neue Notiz |
| F2 | Notiz umbenennen |
| F5 | Uhrzeit und Datum einfügen |
| Strg+Umschalt+F | In allen Notizen suchen |
| Strg+B | Ordnerleiste ein/aus |
| Strg+Plus / Strg+Minus / Strg+0 | Schrift größer / kleiner / normal |

- Rechtsklick auf Ordner oder Notiz öffnet weitere Aktionen.
- Notizen lassen sich mit der Maus auf einen anderen Ordner ziehen.
- Jede Änderung ist ein Commit im Repo `notizen`. In der Commit-Nachricht steht, ob sie vom PC oder vom iPhone kam. Alte Stände lassen sich auf GitHub über den Verlauf der Datei zurückholen.

## Wenn zwei Geräte dieselbe Notiz ändern

Die App überschreibt nie still. Wurde eine Notiz woanders geändert, während du hier geschrieben hast, erscheint oben ein Hinweis mit drei Möglichkeiten:

- **Meine Version behalten**: dein Text ersetzt den anderen.
- **Andere Version laden**: dein Text wird verworfen.
- **Beide speichern**: dein Text landet als eigene Notiz mit Gerät und Uhrzeit im Namen, die andere Version wird geladen.

Hast du an der offenen Notiz nichts geändert, lädt die App den neuen Stand einfach nach.

## Ohne Internet

Was du ohne Verbindung tippst, bleibt auf dem Gerät gespeichert. Sobald wieder Internet da ist, speichert die App nach. Neue Notizen anlegen, umbenennen oder verschieben geht ohne Verbindung noch nicht (geplant für Version 2).

## Aussehen ändern

Alle Farben und Schriften stehen in `css/theme.css`, getrennt für hell und dunkel. Für einen anderen Look reicht es, dort die Werte zu ändern.

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html` | Grundgerüst der Seite |
| `css/theme.css` | Farben und Schriften |
| `css/app.css` | Anordnung für PC und iPhone |
| `js/app.js` | Bedienung, Speichern, Konflikte, Suche |
| `js/github.js` | Zugriff auf das Repo `notizen` über die GitHub-API |
| `sw.js` | Hält die App-Dateien für schnellen Start bereit |
| `manifest.webmanifest`, `icons/` | Name und Symbol für die Installation |
