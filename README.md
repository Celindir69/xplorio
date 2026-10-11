# Xplorio

**Explorer für Volumio**: die eigene Musiksammlung (wieder) entdecken.

[English version](README_EN.md) · [Was ist Xplorio?](docs/xplorio.md)

Xplorio ist eine eigene Weboberfläche für Volumio 2 (gebaut für einen Musical Fidelity MX-Stream, Raspberry-Pi-CM3), läuft ohne Build-Schritt
direkt im Browser. Auf Volumio 4 läuft sie ebenfalls (Unterschiede siehe [Einrichtung](docs/einrichten.md#volumio-4)). Auf Volumio 3 vermutlich auch, wurde aber nicht getestet. 
Zusätzlich zu den Dateien, die auf dem Player laufen, enthält diese Repository nur Tests (`tests/`) und die Einrichtungs-Doku;
`xplorio-deploy` spielt nur die Laufzeitdateien ein.

<p align="center">
  <img src="docs/bilder/display-ipad.jpg" width="820" alt="Display-Layout auf dem iPad: Cover, Albuminfos und mitlaufende Lyrics">
</p>

Alle Bilder in dieser Datei zeigen eine erfundene Beispiel-Bibliothek (Künstler, Cover und Texte sind ausgedacht). Sie zeigen nicht immer den aktuellen Stand der Entwicklung. Manche Features wurden zwischenzeitlich verschoben oder erweitert.

Entwickelt mit KI (Claude code https://claude.ai)

## Funktionen

### Wiedergabe, Lyrics und Infos
Großes Cover, Titel und Album, Abzeichen für die Klangqualität (Hi-Res, Abtastrate, Bittiefe, Format), Fortschritt,
Lautstärke und die üblichen Knöpfe. Die Hintergrundfarbe und der Akzent kommen aus dem Cover. Lyrics laufen synchron mit
(lrclib.net); passt der Text nicht genau zur Aufnahme, verschieben „−“ und „+“ ihn in Schritten von 0,5 s, und der Wert
gilt dann für diesen Titel auf allen Geräten. Die Info-Seite zeigt Album, Künstler, Mitwirkende und was von diesem
Künstler in der Sammlung liegt. Verlinkte Mitwirkende (Personen, Studios, Labels) klappen beim Antippen ihre eigenen
Infos direkt darunter auf. Liefert Volumio keinen Album- oder Künstlertext (Volumio 4 nur mit Abo), holt die App
ihn bei Last.fm bzw. Wikipedia. Gibt es dort einen Text zum laufenden Titel (meist bei Singles), erscheint zusätzlich
ein Reiter „Titel“.

<p>
  <img src="docs/bilder/wiedergabe.jpg" width="200" alt="Wiedergabe">
  <img src="docs/bilder/lyrics.jpg" width="200" alt="Synchrone Lyrics">
  <img src="docs/bilder/info.jpg" width="200" alt="Albuminfos">
  <img src="docs/bilder/warteschlange.jpg" width="200" alt="Warteschlange">
</p>

### Display-Layout für iPad, Desktop und Fernseher
Auf großen Bildschirmen stehen Cover, Infos und Steuerung links und die Lyrics rechts; die Infos blättern von selbst
weiter. Umschalten oben rechts oder mit `?layout=stage`. `kioskTV.html` ist eine reine Anzeige für einen Fernseher an
der Anlage, ohne Bedienung.

<p>
  <img src="docs/bilder/display-desktop.jpg" width="49%" alt="Display-Layout am Desktop">
  <img src="docs/bilder/kiosk.jpg" width="49%" alt="kioskTV.html">
</p>

### Suchen & Entdecken
Die Suche findet Künstler, Alben, Titel und Genres (je Genre die Stilrichtungen aus der Audio-Analyse und alle Alben) in der eigenen Bibliothek und bei den Streamingdiensten, die in Volumio
eingerichtet sind (TIDAL, Qobuz, HIGHRESAUDIO, Spotify (bisher ungetestet)), jeweils in eigenen Abschnitten mit Kästchen zum Ein- und Ausblenden. Solange nichts
eingegeben ist, zeigt sie passend zum Reiter Reihen zum Entdecken: zufällige Entdeckungen, versteckte Perlen (kaum Gehörtes, das zu den eigenen Bewertungen passt), vor einem Jahr gehört, lange
nicht gehört, noch nie gehört und früher oft gehört. Darunter führen Knöpfe nach Stimmung, Energie, Stil und Jahrzehnt weiter. Neben „Alle abspielen“ und an jeder Entdecken-Reihe startet ein Würfel einen Zufallsmix aus 25 Titeln. Auf jeder Künstlerseite führt der Reiter „Entdecken“ zu ähnlichen Künstlern (mit Zufallsmix daraus), seinen Stimmungen, Stilen und Jahrzehnten; auf jeder Albumseite zu ähnlichen Alben, Stimmung, Stil, Jahr und weiteren Alben des Künstlers. Der Reiter „Hintergrund“ zeigt dort Künstler- bzw. Albumtext und Mitwirkende. Ein Tipp auf den laufenden Titel zeigt ähnliche Titel nach Stimmung, Energie und Tempo. Hinter jedem Albumtitel steht das Erscheinungsjahr; ein Tipp darauf öffnet die Alben dieses Jahres mit Empfehlungen aus dem Jahrzehnt.
Bewertungen: Herz für Künstler, ein bis fünf Sterne für Alben, Daumen hoch oder runter für Titel (Daumen hoch ist der Volumio-Favorit). Bei Webradio holt die App ein Cover
zum laufenden Titel und zeigt Senderlogos in der Senderliste.

<p>
  <img src="docs/bilder/entdecken.jpg" width="200" alt="Entdecken in der Suche">
  <img src="docs/bilder/album.jpg" width="200" alt="Albumseite mit Sternen und Daumen">
  <img src="docs/bilder/album-entdecken.jpg" width="200" alt="Albumseite: Entdecken">
</p>

### Stimmungs-Mix
Eigener erster Reiter neben Playlisten und Radio (Playlisten-Taste). Stimmung wählen (mehrere möglich), Energie von ruhig bis energiegeladen eingrenzen, auf Genres beschränken und unter „Feinabstimmung“ Stile, Länge
und Entdeckungsgrad festlegen: Favoriten, ausgewogen oder versteckte Perlen, je nach eigenem Verlauf. „Mix erstellen“
zeigt erst eine Vorschau mit der Begründung je Titel; einzelne Titel lassen sich herausnehmen oder neu mischen. Erst
„Mix abspielen“ ersetzt die Warteschlange. Grundlage sind Last.fm-Tags je Titel, die der Tag-Dienst sammelt, solange
nichts spielt; die Musikdateien bleiben dabei unverändert. Optional hört Essentia auf dem Mac jeden Titel an
(`tools/essentia/`): Dann kommen Energie und Stimmung aus dem Audio, und ein Tempo-Regler (BPM) kommt dazu.

<p>
  <img src="docs/bilder/mix-auswahl.jpg" width="200" alt="Stimmungs-Mix: Auswahl">
  <img src="docs/bilder/mix-vorschau.jpg" width="200" alt="Stimmungs-Mix: Vorschau">
</p>

### Verlauf, Statistik und Rückblick
Der Tag-Dienst schreibt mit, was läuft, und kann zu Last.fm scrobbeln sowie den bisherigen Last.fm-Verlauf einlesen.
Daraus entstehen „Zuletzt gehört“, Ranglisten (Titel, Alben, Künstler, Genres), Statistiken nach Tag, Tageszeit, Wochentag und Genre
und ein Jahresrückblick mit Vergleich zum Vorjahr, Top-Genres und neu entdeckten Künstlern. Tippen auf einen Monat zeigt
die Ranglisten für diesen Monat.

<p>
  <img src="docs/bilder/begruessung.jpg" width="200" alt="Begrüßung">
  <img src="docs/bilder/menue.jpg" width="200" alt="Menü hinter dem Zahnrad">
  <img src="docs/bilder/verlauf.jpg" width="200" alt="Zuletzt gehört">
  <img src="docs/bilder/statistik.jpg" width="200" alt="Statistik">
  <img src="docs/bilder/rueckblick.jpg" width="200" alt="Jahresrückblick">
</p>

### Tag-Editor und „Bibliothek prüfen“
Tags einzelner Titel, ganzer Alben oder aller Titel eines Künstlers bearbeiten, mit Textfunktionen wie Groß-/Kleinschreibung,
Rückgängig und Cover (Datei wählen, online suchen, eingebettetes Cover als `folder.jpg`). „Bibliothek prüfen“ im Menü findet
Alben ohne Cover, fehlende oder uneinheitliche Album-Künstler, Künstler in mehreren Schreibweisen, uneinheitliche
Albumnamen oder Jahre, Titel ohne Tracknummer und Erscheinungsdaten, die von MusicBrainz abweichen, und schlägt je Album ein Genre vor (Discogs-Oberkategorien, aus
vorhandenen Genre-Tags und der Audio-Analyse); jeder Eintrag öffnet direkt den passenden Editor und bleibt danach bis zur nächsten Prüfung ausgegraut. Dort steht auch der
Fortschritt der Stimmungs-Tags.

<p>
  <img src="docs/bilder/tag-editor.jpg" width="200" alt="Tag-Editor">
  <img src="docs/bilder/check.jpg" width="200" alt="Bibliothek prüfen">
  <img src="docs/bilder/stimmungs-tags.jpg" width="200" alt="Stimmungs-Tags unter „Bibliothek prüfen“">
</p>

### Weiteres
- Begrüßung beim Öffnen: Album des Tages, Album-Geburtstage (runde und Jubiläen hervorgehoben), zuletzt gehörte und neue
  Alben, Zufallsmix; Geburtstage, zuletzt gehört und neu auch unter Entdecken.
- Menü hinter dem Zahnrad oben rechts: Begrüßungsschirm, Verlauf und Statistik, Bibliothek prüfen, System (Prozessorlast, Temperatur, Speicher, Laufwerke, Dienste mit Neustart), Bibliothek aktualisieren und die
  originale Volumio-Oberfläche (Durchsuchen, Warteschlange, Einstellungen, Plugins, System = Volumios Seite /dev) und eine Hilfe zur Bedienung; unten Logo, eingespielter Stand und Lizenz.
- Hell und dunkel, nach der Einstellung des Geräts oder fest eingestellt.
- Deutsch und Englisch, wie in Volumio eingestellt oder fest eingestellt; weitere Sprachen als Datei in `web/lang/`
  (siehe [Einrichten](docs/einrichten.md#sprache)).
- Optional: Rotel-Verstärker im Netz (Ein/Aus, Lautstärke, Eingang) über `rotel/rotel-bridge.js`.
- TIDAL-Wächter: verbindet TIDAL neu bzw. startet Volumio neu, wenn das TIDAL-Plugin hängt. 
  (Was auf meinem MX-Stream, aufgrund eines Session-Timeouts, etwa nach 4 Stunden ohne Tidal-Nutzung auftritt.)
- `xplorio-deploy`: aktualisiert direkt auf dem Player aus diesem Repository, mit Sicherung und `--rollback`; gleich auf
  Volumio 3 und 4.

## Aufbau

| Datei / Ordner | Inhalt | Ort auf dem Player |
|---|---|---|
| `xplorio.html` + `web/` | Oberfläche für Handy, iPad, Desktop (Wiedergabe, Queue, Suche lokal und bei Streamingdiensten, Lyrics, Infos, Tag-Editor, Stimmungs-Mix, Verlauf, Display-Layout für große Bildschirme) | `/volumio/http/www3/` (Volumio 4: `www4/`) |
| `kioskTV.html` | Seite für einen Kiosk-Bildschirm (Cover, Titel, Lyrics) | `/volumio/http/www*/` |
| `tags/` | Tag-Dienst (Port 8766): Tag-Editor, Bibliothek prüfen, Verlauf, Stimmungs-Tags, Cover; nimmt nur Aufträge der Oberfläche an; Python 2.7 oder 3 mit mitgelieferter mutagen-Bibliothek (GPLv2, siehe `tags/vendor/mutagen/COPYING`) | `/data/xplorio/tags/` (Daten: `/data/xplorio/data/`) |
| `rotel/rotel-bridge.js` | optional: HTTP-Dienst (Port 8765) für einen Rotel-Verstärker im Netz (Lautstärke, Ein/Aus, Eingang), nur für die Oberfläche | `/data/xplorio/rotel/` |
| `tools/tidal-watchdog.sh`, `tools/tidal-reconnect.js` | startet Volumio neu bzw. verbindet TIDAL neu, wenn das TIDAL-Plugin hängt (nur unter Volumio 2 erprobt) | `/volumio/http/www3/tools/` |
| `tools/xplorio-deploy.sh` | aktualisiert den Player aus diesem Repository (`xplorio-deploy`) | `/usr/local/bin/` |
| `tools/essentia/` | optionale Audio-Analyse auf dem Mac, Ergebnis wird zum Tag-Dienst hochgeladen | nicht auf dem Player |

Voraussetzungen: Volumio 2 (Node 8, Python 2.7, `mpc`) oder Volumio 4 (Node und Python 3 sind dabei). Einrichtung:
[docs/einrichten.md](docs/einrichten.md). Aktualisieren direkt auf dem Player: `sudo xplorio-deploy`
(`tools/xplorio-deploy.sh`, siehe dort).

Rotel-Verstärker und TIDAL-Wächter sind optional (siehe Einrichtung). 
Eigene Einstellungen (Sprache, Rotel, Dienste ein/aus) gehören in `web/config.local.js`
(Vorlage `web/config.local.js.example`); diese Datei ist nicht im Repository. Der Last.fm-Zugang (für ähnliche Künstler,
Stimmungs-Tags, Infotexte und Scrobbeln) liegt in `/data/xplorio/data/keys.json` und wird nur vom Tag-Dienst gelesen.

## Tests
`node tests/run-all.js` (Node 18 oder neuer, keine Abhängigkeiten; der Tag-Dienst-Test braucht zusätzlich Python).

Lizenz: MIT (siehe `LICENSE`), ausgenommen die mitgelieferte Bibliothek in `tags/vendor/mutagen/` (GPLv2 oder neuer, eigene `COPYING`).
Nicht enthalten, aber genutzt: Volumio (GPL-3.0) mit socket.io (MIT) auf dem Player, Essentia (AGPL-3.0) und dessen Modelle
(CC BY-NC-SA 4.0, nur nicht-kommerziell) im Analyse-Werkzeug auf dem Mac. Daten, Cover, Lyrics und Senderlogos kommen von
Last.fm, MusicBrainz, Cover Art Archive, Deezer, iTunes, LRCLIB und radio-browser.info und unterliegen deren Bedingungen.
Das Menü zeigt das unter „Fremde Bestandteile und Lizenzen“.
