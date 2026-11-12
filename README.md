# Xplorio

**Explorer für Volumio**: die eigene Musiksammlung (wieder) entdecken.

[English version](README_EN.md) · [Was ist Xplorio?](docs/xplorio.md)

Xplorio ist eine eigene Weboberfläche für Volumio, als Volumio-Plugin, und läuft ohne Build-Schritt direkt im Browser.
Gebaut für einen Musical Fidelity MX-Stream (Volumio 2, Raspberry-Pi-CM3), erprobt auch auf Volumio 4 (Unterschiede siehe
[Einrichtung](docs/einrichten.md#volumio-2)). Auf Volumio 3 vermutlich auch, wurde aber nicht getestet.
Zusätzlich zu den Dateien, die auf dem Player laufen, enthält dieses Repository nur Tests (`tests/`) und die Einrichtungs-Doku.

<p align="center">
  <img src="docs/bilder/display-ipad.jpg" width="820" alt="Display-Layout auf dem iPad: Cover, Albuminfos und mitlaufende Lyrics">
</p>

Alle Bilder in dieser Datei zeigen eine erfundene Beispiel-Bibliothek (Künstler, Cover und Texte sind ausgedacht). Sie zeigen nicht immer den aktuellen Stand der Entwicklung. Manche Features wurden zwischenzeitlich verschoben oder erweitert.

Entwickelt mit KI (Claude code https://claude.ai)

Hinweis: Manche Funktionalitäten wurden speziell für mein 
individuelles Setup entwickelt (RotelVerstärker, iPad, iPhone). 
Diese Funktionalitäten sind in anderen Setups nicht nutzbar. 

## Funktionen

### Wiedergabe, Lyrics und Infos
Großes Cover, Titel und Album, Abzeichen für die Klangqualität (Hi-Res, Abtastrate, Bittiefe, Format), Fortschritt,
Lautstärke und die üblichen Knöpfe. Die Hintergrundfarbe und der Akzent kommen aus dem Cover (nur bei Covern vom Player selbst; bei Streamingdiensten bleibt die Standardfarbe, weil der Browser deren Cover nicht auslesen darf). Lyrics laufen synchron mit
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
weiter. Umschalten oben rechts oder mit `?layout=stage`. Unten rechts wählt man Liedtext oder Titelliste und schaltet
das VU-Meter dazu (zwei hinterleuchtete Zeigerinstrumente; den nötigen FIFO-Ausgang in MPD legt das Plugin an, siehe
[VU-Meter](docs/einrichten.md#vu-meter)). In der klassischen Ansicht und auf dem Handy blendet ein Tipp aufs Cover die
Instrumente ein.

<p>
  <img src="docs/bilder/display-desktop.jpg" width="49%" alt="Display-Layout am Desktop">
</p>

### Auf dem Handy hören
Mit einem Stream-Ausgang in MPD (unter Volumio 4 das Plugin „MPD HTTP & Icecast output“) schaltet der Kopfhörer-Knopf
oben rechts die Wiedergabe von der Anlage auf das Gerät, auf dem Xplorio offen ist, und zurück. Einrichtung:
[docs/einrichten.md](docs/einrichten.md#wiedergabe-auf-dem-handy-stream-ausgang).

### Suchen & Entdecken
Die Suche findet Künstler, Alben, Titel und Genres (je Genre die Stilrichtungen aus der Audio-Analyse und alle Alben) in der eigenen Bibliothek und bei den Streamingdiensten, die in Volumio
eingerichtet sind (TIDAL, Qobuz, HIGHRESAUDIO, Spotify (bisher ungetestet)), jeweils in eigenen Abschnitten mit Kästchen zum Ein- und Ausblenden. Solange nichts
eingegeben ist, zeigt sie passend zum Reiter Reihen zum Entdecken: zufällige Entdeckungen, versteckte Perlen (kaum Gehörtes, das zu den eigenen Bewertungen passt), im Reiter Künstler „Passt zusammen“ (Mixe aus zwei, drei Künstlern, die zusammen klingen), vor einem Jahr gehört, lange
nicht gehört, noch nie gehört und früher oft gehört. Darunter führen Knöpfe nach Stimmung, Energie, Stil und Jahrzehnt weiter. Neben „Alle abspielen“ und an jeder Entdecken-Reihe startet ein Würfel einen Zufallsmix aus 25 Titeln. Auf jeder Künstlerseite führt der Reiter „Entdecken“ zu ähnlichen Künstlern (mit Zufallsmix aus ihnen und dem Künstler selbst), seinen Stimmungen, Stilen und Jahrzehnten; auf jeder Albumseite zu ähnlichen Alben, Stimmung, Stil, Jahr und weiteren Alben des Künstlers. Der Reiter „Hintergrund“ zeigt dort Künstler- bzw. Albumtext und Mitwirkende. Ein Tipp auf den laufenden Titel zeigt ähnliche Titel nach Stimmung, Energie und Tempo. Hinter jedem Albumtitel steht das Erscheinungsjahr; ein Tipp darauf öffnet die Alben dieses Jahres mit Empfehlungen aus dem Jahrzehnt.
Bewertungen: Herz für Künstler, ein bis fünf Sterne für Alben, Daumen hoch oder runter für Titel (Daumen hoch ist der Volumio-Favorit). Bei Webradio holt die App ein Cover
zum laufenden Titel und zeigt Senderlogos in der Senderliste.

<p>
  <img src="docs/bilder/entdecken.jpg" width="200" alt="Entdecken in der Suche">
  <img src="docs/bilder/album.jpg" width="200" alt="Albumseite mit Sternen und Daumen">
  <img src="docs/bilder/album-entdecken.jpg" width="200" alt="Albumseite: Entdecken">
</p>

### Mood Mix
Eigener erster Reiter neben Playlisten und Radio (Playlisten-Taste). Stimmung wählen (mehrere möglich), Energie von ruhig bis energiegeladen eingrenzen, auf Genres beschränken und unter „Feinabstimmung“ Stile, Länge
und Entdeckungsgrad festlegen: Favoriten, ausgewogen oder versteckte Perlen, je nach eigenem Verlauf. „Mix erstellen“
zeigt erst eine Vorschau mit der Begründung je Titel; einzelne Titel lassen sich herausnehmen oder neu mischen. Erst
„Mix abspielen“ ersetzt die Warteschlange. Grundlage sind Last.fm-Tags je Titel, die der Tag-Dienst sammelt, solange
nichts spielt; die Musikdateien bleiben dabei unverändert. Optional hört Essentia auf Mac oder PC jeden Titel an
(`tools/essentia/`): Dann kommen Energie und Stimmung aus dem Audio, und ein Tempo-Regler (BPM) kommt dazu.

<p>
  <img src="docs/bilder/mix-auswahl.jpg" width="200" alt="Mood Mix: Auswahl">
  <img src="docs/bilder/mix-vorschau.jpg" width="200" alt="Mood Mix: Vorschau">
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
Tags einzelner Titel, ganzer Alben oder aller Titel eines Künstlers bearbeiten (auch den Kommentar), mit Textfunktionen wie Groß-/Kleinschreibung,
Rückgängig und Cover (Datei wählen, online suchen, eingebettetes Cover als `folder.jpg`, eingebettete Bilder ausspeichern und entfernen), Compilations mit Künstler pro Titel. „Bibliothek prüfen“ im Menü findet
Alben ohne Cover, fehlende oder uneinheitliche Album-Künstler, Künstler in mehreren oder nicht üblicher Schreibweise (Abgleich mit MusicBrainz/Last.fm), uneinheitliche
Albumnamen und uneinheitliche oder von MusicBrainz abweichende Jahre (je mit Vorschlag zum Übernehmen), doppelte Alben (mit Qualität und Pfad, zum Ergänzen fehlender Titel und zum Verschieben in einen versteckten Ordner), auf mehrere Ordner verteilte Alben (mit Absprung in den Dateimanager), Titel ohne Tracknummer, Album-Künstler oder Datum unter einem Tag-Namen, den MPD nicht liest (zum Übernehmen), Tags mit kaputten Umlauten (zum Reparieren), Platzhaltern oder seltsamen Track- und Datumswerten, unvollständige Alben, doppelte Titel im Album, DSF-Dateien, deren Tags MPD nicht liest, zu kleine oder zu große Cover-Bilder (zu kleine mit einem größeren Cover aus dem Netz zum Übernehmen), Ordnernamen, die nicht zum Album passen, und schlägt je Album ein Genre vor (Discogs-Oberkategorien, aus
vorhandenen Genre-Tags und der Audio-Analyse). Unveränderte Dateien liest die nächste Prüfung nicht noch einmal; jeder Eintrag öffnet direkt den passenden Editor und bleibt danach bis zur nächsten Prüfung ausgegraut. Dort steht auch der
Fortschritt der Stimmungs-Tags.

<p>
  <img src="docs/bilder/tag-editor.jpg" width="200" alt="Tag-Editor">
  <img src="docs/bilder/check.jpg" width="200" alt="Bibliothek prüfen">
  <img src="docs/bilder/stimmungs-tags.jpg" width="200" alt="Stimmungs-Tags unter „Bibliothek prüfen“">
</p>

### Weiteres
- Begrüßung beim Öffnen: Album des Tages, Album-Geburtstage (runde und Jubiläen hervorgehoben), zuletzt gehörte und neue
  Alben, Zufallsmix; Geburtstage, zuletzt gehört und neu auch unter Entdecken.
- Menü hinter dem Zahnrad oben rechts: Begrüßungsschirm, Verlauf und Statistik, Bibliothek prüfen, Papierkorb (verschobene Alben und Titel zurücklegen oder endgültig löschen), Dateimanager (Dateien und Ordner kopieren, verschieben, neue Ordner, mit Passwort), Wiedergabe (Crossfade, Lautstärke angleichen, Rotel-Fernbedienung), System (Warnungen bei Laufwerksfehlern, vollem Speicher oder Laufwerk, auch als Einblendung; Prozessorlast, Temperatur, Speicher, Laufwerke, Dienste mit Neustart, Player neu starten oder ausschalten, Protokolle), Bibliothek aktualisieren und die
  originale Volumio-Oberfläche (Hauptseite, Durchsuchen, Warteschlange, Plugins, System = Volumios Seite /dev) und eine Hilfe zur Bedienung; unten Logo, eingespielter Stand und Lizenz.
- Smart-Playlisten bearbeiten: Mit dem Plugin [Smart Playlists](https://github.com/Celindir69/smart-playlist-plugin) (ab 1.1) tragen dessen Playlisten im Reiter „Playlisten“ ein eigenes Symbol und einen Stift. Der Editor wählt Künstler aus der Bibliothek, bietet Filter für Jahre, Genre, Album, neu Hinzugefügtes und Reihenfolge, zeigt die Regel zum direkten Bearbeiten und vorab, wie viele Titel passen (siehe [Einrichten](docs/einrichten.md#smart-playlisten)).
- Solange die Bibliothek eingelesen oder die Albenliste neu aufgebaut wird, dreht sich oben links (rechts neben dem Rotel-Ein/Aus) ein kleines Symbol, auch bei geöffneten Fenstern; ein Tipp darauf sagt, was gerade läuft (der Player reagiert dann oft langsamer).
- Hell und dunkel, nach der Einstellung des Geräts oder fest eingestellt.
- Deutsch, Englisch, Französisch, Spanisch und Italienisch, wie in Volumio eingestellt oder fest eingestellt; weitere Sprachen als Datei in `web/lang/`
  (siehe [Einrichten](docs/einrichten.md#sprache)).
- Optional: Rotel-Verstärker im Netz (Ein/Aus, Lautstärke, Eingang, Klang, Balance, Lautsprecher A/B als Fernbedienung) über `rotel/rotel-bridge.js` (RA-1572, RA-1592, RC-1592, RSP-1582); andere Verstärker über das Volumio-Plugin SerialAmpControl, Xplorio regelt dann Lautstärke und Ein/Aus darüber; ein anderer Eingang als der Player steht mit Icon in der Player-Ansicht.
- TIDAL-Wächter: verbindet TIDAL neu bzw. startet Volumio neu, wenn das TIDAL-Plugin hängt. 
  (Was auf meinem MX-Stream, aufgrund eines Session-Timeouts, etwa nach 4 Stunden ohne Tidal-Nutzung auftritt.)
- Alle Einstellungen auf der Einstellungsseite des Plugins in Volumio, ohne ssh.

## Aufbau

| Datei / Ordner | Inhalt | Ort auf dem Player |
|---|---|---|
| `plugin/` | das Volumio-Plugin: startet Webserver, Tag-Dienst und Rotel-Bridge als systemd-Dienste, Einstellungsseite | `/data/plugins/user_interface/xplorio/` |
| `xplorio.html` + `web/` | Oberfläche für Handy, iPad, Desktop (Wiedergabe, Queue, Suche lokal und bei Streamingdiensten, Lyrics, Infos, Tag-Editor, Mood Mix, Verlauf, Display-Layout für große Bildschirme) | im Plugin unter `app/` |
| `server/xplorio-server.js` | eigener Webserver (Port 4040): liefert die Oberfläche aus und reicht alles andere an Volumio durch, damit nichts unter `/volumio` liegen muss | im Plugin unter `app/` |
| `tags/` | Tag-Dienst (Port 8766): Tag-Editor, Bibliothek prüfen, Verlauf, Stimmungs-Tags, Cover; nimmt nur Aufträge der Oberfläche an; Python 2.7 oder 3 mit mitgelieferter mutagen-Bibliothek (GPLv2, siehe `tags/vendor/mutagen/COPYING`) | im Plugin unter `app/` (Daten: `/data/xplorio/data/`) |
| `rotel/rotel-bridge.js` | optional: HTTP-Dienst (Port 8765) für einen Rotel-Verstärker im Netz (Lautstärke, Ein/Aus, Eingang), nur für die Oberfläche | im Plugin unter `app/` |
| `tools/make-plugin.sh`, `tools/xplorio-deploy.sh`, `tools/plugin-install.js` | stellt das Plugin zusammen; installiert und aktualisiert es ohne Plugin-Store (Volumio 2, Test-Branches) | `xplorio-deploy` in `/usr/local/bin/` |
| `tools/tidal-watchdog.sh`, `tools/tidal-reconnect.js` | optional, nicht Teil des Plugins: startet Volumio neu bzw. verbindet TIDAL neu, wenn das TIDAL-Plugin hängt (nur unter Volumio 2 erprobt) | `/data/xplorio/tools/` |
| `tools/essentia/` | optionale Audio-Analyse auf Mac oder Windows-PC, Ergebnis wird zum Tag-Dienst hochgeladen | nicht auf dem Player |

Voraussetzungen: Volumio 2 (Node 8, Python 2.7, `mpc`) oder Volumio 4 (Node und Python 3 sind dabei). Installieren über den
Plugin-Store von Volumio oder mit `sudo xplorio-deploy`, siehe [docs/einrichten.md](docs/einrichten.md#installieren).

Rotel-Verstärker und TIDAL-Wächter sind optional (siehe Einrichtung). 
Einstellungen (Sprache, Rotel, Dienste ein/aus) stehen auf der Einstellungsseite des Plugins; was dort fehlt, gehört nach
`/data/xplorio/config.local.js` (Vorlage `web/config.local.js.example`). Der Last.fm-Zugang (für ähnliche Künstler,
Stimmungs-Tags, Infotexte und Scrobbeln) liegt in `/data/xplorio/data/keys.json` und wird nur vom Tag-Dienst gelesen.

## Tests
`node tests/run-all.js` (Node 18 oder neuer, keine Abhängigkeiten; der Tag-Dienst-Test braucht zusätzlich Python).

Lizenz: MIT (siehe `LICENSE`), ausgenommen die mitgelieferte Bibliothek in `tags/vendor/mutagen/` (GPLv2 oder neuer, eigene `COPYING`).
Nicht enthalten, aber genutzt: Volumio (GPL-3.0) mit socket.io (MIT) auf dem Player, Essentia (AGPL-3.0) und dessen Modelle
(CC BY-NC-SA 4.0, nur nicht-kommerziell) im Analyse-Werkzeug auf dem Mac. Daten, Cover, Lyrics und Senderlogos kommen von
Last.fm, MusicBrainz, Cover Art Archive, Deezer, iTunes, LRCLIB und radio-browser.info und unterliegen deren Bedingungen.
Das Menü zeigt das unter „Fremde Bestandteile und Lizenzen“.
