# Xplorio auf dem Player einrichten

Xplorio ist ein Volumio-Plugin. Es legt nichts unter `/volumio` ab, Volumios Prüfung vor einem System-Update bleibt also
intakt. Das Plugin liefert die Oberfläche über einen eigenen Webserver auf Port 4040 aus. Webserver, Tag-Dienst und
Rotel-Bridge laufen als eigene systemd-Dienste (`xplorio-web`, `xplorio-tags`, `xplorio-rotel`), wie Volumio es für Plugins
vorgibt: `install.sh` richtet sie ein, das Plugin startet sie beim Einschalten und stoppt sie beim Ausschalten. Was unter
Volumio 2 anders ist, steht unter [Volumio 2](#volumio-2).

## Installieren
Im Plugin-Store von Volumio: Plugins > Plugins suchen > Xplorio > Installieren, danach unter Installierte Plugins
einschalten. Xplorio ist dann unter `http://<player>:4040/` erreichbar; der Knopf „Xplorio öffnen“ auf der
Einstellungsseite führt dorthin.

**Ohne Plugin-Store** (Volumio 2 oder zum Testen eines Branches) mit `xplorio-deploy` per ssh:
```bash
curl -fsSL https://raw.githubusercontent.com/Celindir69/xplorio/main/tools/xplorio-deploy.sh | sudo tee /usr/local/bin/xplorio-deploy >/dev/null
sudo chmod +x /usr/local/bin/xplorio-deploy
sudo xplorio-deploy                  # main installieren oder aktualisieren; mit Branch: sudo xplorio-deploy <branch>
```
| Aufruf | Wirkung |
|---|---|
| `sudo xplorio-deploy` | Plugin aus `main` installieren oder aktualisieren |
| `sudo xplorio-deploy <branch>` | einen anderen Branch, z. B. zum Testen vor dem Merge |
| `sudo xplorio-deploy -n <branch>` | nur sagen, was passieren würde |
| `sudo xplorio-deploy --password` | Passwort für die Seite „System“ neu setzen, falls es vergessen ist |

`xplorio-deploy` stellt das Plugin mit `tools/make-plugin.sh` zusammen (Plugin-Dateien aus `plugin/`, Oberfläche und
Dienste in `app/`) und installiert es über Volumios eigene Schnittstelle, wie die Plugin-Seite in Volumio. `volumio plugin
install` bleibt auf manchen Volumio-2-Geräten (z. B. MX-Stream) hängen. Beim ersten Mal das Plugin danach in Volumio
einschalten; nach einem Update startet `xplorio-deploy` Volumio neu, damit die neue Version gleich wirkt (die Wiedergabe
stoppt dabei kurz). Das Menü zeigt unten unter Logo und Namen den installierten Stand (Branch, Commit und Datum).

Xplorio liegt ganz auf dem Player: Ist er nicht erreichbar (etwa unterwegs außerhalb des Heimnetzes), zeigt der Browser
seine Fehlerseite und die Web-App auf dem Home-Bildschirm bleibt einfach schwarz. Von unterwegs geht es nur über ein VPN
ins Heimnetz. Nach einem Update lädt der Browser die neuen Dateien von selbst.

## Einstellungen
Alles Nötige steht auf der Einstellungsseite des Plugins (Plugins > Installierte Plugins > Xplorio), ssh und Konsole
braucht es dafür nicht:
- **Grundeinstellungen:** Port, Tag-Dienst ein/aus, Sprache, hell/dunkel; dazu ein Knopf, der Xplorio öffnet.
- **Funktionen:** Verlauf, Erscheinungstage, Stimmungs-Tags, Farbstimmung, m4a-Codec und m4a als verlustfrei, TIDAL, Qobuz,
  HIGHRESAUDIO und Spotify (automatisch, immer oder nie) und weitere Namen des Players (`ALLOWED_HOSTS`).
- **Rotel-Verstärker:** Rotel-Bridge ein/aus, Adresse des Verstärkers und auf Wunsch eigene Namen der Eingänge, z. B.
  `aux=Plattenspieler/phono, opt1=TV` (Symbol hinter dem Schrägstrich, optional).
- **Last.fm:** [Last.fm-Zugang](#lastfm-zugang) (API-Key und Shared Secret). Das Plugin schreibt beides nach
  `/data/xplorio/data/keys.json`; die Seite zeigt danach nur „Gespeichert“, ein leeres Feld behält den gespeicherten Wert,
  „Last.fm-Zugang löschen“ entfernt beide.
- **Passwort:** Passwort für die Seite „System“ (mindestens 4 Zeichen, leer lassen behält es; ist eines gesetzt, geht
  Ändern nur mit dem bisherigen, vergessen: `sudo xplorio-deploy --password`).

Musikordner, in die Volumio nicht schreiben darf, nennt die Seite beim Tag-Dienst; dort scheitert der Tag-Editor.

Das Plugin schreibt aus diesen Werten `app/web/config.local.js`, die Oberfläche und Dienste lesen. Wer mehr einstellen will
(z. B. `ROTEL_PROFILE` für einen anderen Verstärker), legt das in `/data/xplorio/config.local.js` ab, Vorlage
[`web/config.local.js.example`](../web/config.local.js.example): Das Plugin übernimmt die Datei vor den Werten der
Einstellungsseite, die Seite hat also Vorrang. Eine fehlerhafte Datei lässt es weg und sagt das auf der Einstellungsseite.
Nach einer Änderung das Plugin einmal aus- und wieder einschalten. Die Einstellungen der Dienste (Port, Pfade) schreibt das
Plugin nach `/tmp/xplorio/`. Daten, Verlauf, Passwort und Last.fm-Zugang bleiben in `/data/xplorio/data/`, auch wenn das
Plugin aktualisiert oder entfernt wird. Beim Deinstallieren löscht das Plugin nur Logs, Caches und Laufzeitdateien (Bilder,
Bibliothekslisten, Prüfergebnis), die es bei Bedarf neu anlegt. Wer alles entfernen will, löscht danach `/data/xplorio` von Hand.

### Hell und dunkel
Die Oberfläche folgt der Einstellung des Geräts (hell oder dunkel) und wechselt mit, wenn das Gerät umschaltet.
Fest einstellen auf der Einstellungsseite; zum Ausprobieren `?theme=light` in der Adresse.
Das gilt auch für die Bühnenansicht auf großen Bildschirmen.

### Sprache
Die Oberfläche gibt es auf Deutsch, Englisch, Französisch, Spanisch und Italienisch. Sie übernimmt die Sprache, die in Volumio unter Einstellungen eingestellt
ist; so passen auch die Künstler- und Albumtexte von Volumio dazu. Beim allerersten Aufruf kennt die App diese Sprache noch
nicht, zeigt kurz die Sprache des Geräts (Browser) und lädt einmal neu. Ist die Volumio-Sprache nicht vorhanden, gilt die
Gerätesprache, sonst Englisch. Fest einstellen auf der Einstellungsseite. Zum Ausprobieren geht
auch `http://<player>:4040/?lang=en`.

Weitere Sprache: `web/lang/en.js` kopieren, z. B. als `web/lang/nl.js`, in der letzten Zeile Code, Namen und Locale
anpassen (`langRegister('nl', 'Nederlands', {…}, 'nl-NL')`) und die Texte übersetzen; `{name}` sind Platzhalter und bleiben
stehen, `{one: …, other: …}` sind Einzahl und Mehrzahl. Die Sprache dann in `web/config.js` unter `LANGUAGES` eintragen.
Weil ein Update den Plugin-Ordner ersetzt, gehört eine neue Sprache ins Repo (Pull Request), nicht nur auf den Player.
Fehlt in der Datei ein Text, erscheint er englisch. Datum, Zahlen, Monats- und Wochentagsnamen kommen vom Browser in der
gewählten Sprache.

Nicht übersetzt werden Texte, die Volumio selbst liefert (z. B. Menünamen beim Durchsuchen), und Fehlermeldungen des
Tag-Dienstes; die bleiben deutsch.

### Hinweise zum Ausgabegerät
Kann Volumio das Ausgabegerät nicht öffnen (z. B. Verstärker oder DAC aus), zeigt die App kurz „Audioziel nicht
erreichbar“ bzw. „Audioziel ist belegt“; der Fortschrittsbalken bleibt dann am Anfang. Meldet Volumio ein getrenntes
Gerät, erscheint „Audioziel getrennt“ statt Volumios Fenster mit Bestätigung; „Audioziel verbunden“ gibt es nur, wenn
Volumio die Rückkehr meldet (USB-DAC). Erkannt werden Volumios Meldungen auf Deutsch, Englisch, Französisch, Spanisch und Italienisch.

## Tag-Dienst (für den Tag-Editor)
Der Tag-Dienst (`xplorio-tags`, Port 8766) schreibt Tags und Cover, prüft die Bibliothek, führt den Verlauf und liefert
Entdecken, Mix und die Seite „System“. Er läuft als Benutzer `volumio`, wie Volumio selbst, und schreibt damit nur in
Musikordner, die `volumio` beschreiben darf; die Einstellungsseite nennt die übrigen. Ein- und ausschalten auf der
Einstellungsseite. Log: `journalctl -u xplorio-tags -e`.

**Über die Netzwerkfreigabe kopierte Musik:** Volumios Freigabe („Internal Storage“, vom Mac oder PC aus)
speichert neue Dateien als Gast (`nobody:nogroup`). `volumio` darf sie dann nicht ändern, und der Tag-Editor meldet
fehlende Schreibrechte. Nach dem Kopieren einmal per ssh:
```bash
sudo chown -R volumio:volumio /mnt/INTERNAL
```
Die Einstellungsseite prüft nur die Musikordner selbst, nicht jede Datei darin. Bei einem NAS die Freigabe mit
Schreibrechten verbinden.

Der Dienst startet mit `--max-old-space-size=384`, also mit mehr Speicher als Nodes Standard (auf 32-Bit-ARM etwa 256 MB).
Große Sammlungen mit Audio-Analyse brauchen das, sonst bricht er mit `JavaScript heap out of memory` ab.

**Zugriffsschutz:** Tag-Dienst und Rotel-Bridge nehmen Aufträge nur von der Oberfläche auf demselben Gerät an.
Eine andere Webseite, die gerade im Browser offen ist, kann dort weder Tags schreiben noch den Verstärker schalten
oder den Verlauf lesen. Die Dienste antworten nur, wenn der Player über seine IP-Adresse, einen Namen ohne Punkt
(`volumio`) oder einen Namen auf `.local`, `.lan`, `.home`, `.internal`, `.home.arpa` oder `.fritz.box` aufgerufen wird.
Weitere Namen auf der Einstellungsseite unter „Funktionen“ eintragen.
Eigene Skripte, die ohne Browser schreiben (etwa mit `curl`), schicken den Kopf `X-Xplorio: 1` mit;
`curl -s localhost:8766/health` und andere Abfragen gehen wie bisher.

**Datenordner:** Alles, was der Dienst anlegt (Verlauf, Last.fm-Sitzung, Check-Ergebnis, Cover, Analyse …), liegt in
`/data/xplorio/data/`. Der Ordner ist nur für `volumio` lesbar und liegt weder im Plugin-Ordner noch in `/data/INTERNAL`,
das Volumio im Netzwerk freigeben kann. Vor einer Neuinstallation von Volumio genügt es, `/data/xplorio` zu sichern.

### Last.fm-Zugang
API-Key und „Shared secret“ von https://www.last.fm/api/accounts auf der Einstellungsseite unter „Last.fm“ eintragen. Das
Plugin legt sie in `/data/xplorio/data/keys.json` ab; nur der Tag-Dienst liest sie, die App fragt Last.fm über den Dienst.
Der Key reicht für ähnliche Künstler, Texte, Cover-Suche und Stimmungs-Tags; das Secret braucht nur das Scrobbeln.
`tags.py` läuft mit Python 2.7 und 3 und bringt mutagen selbst mit; gibt es kein `python`, nimmt der Dienst `python3`.

Hinweise: Erlaubt sind nur Dateien unter `/mnt/INTERNAL`, `/mnt/USB`, `/mnt/NAS`. Alte Werte für „Rückgängig“ stehen in
`/data/xplorio/data/changes.jsonl` (die letzten 200 Änderungen; ältere Einträge und ihre Cover-Sicherungen räumt der Dienst selbst auf). Werden die Musikdateien von einem anderen Rechner gespiegelt, überschreibt die nächste
Spiegelung die Änderungen am Player. Nach Änderungen liest MPD die betroffenen Ordner neu ein, gesammelt 15 Sekunden
nach der letzten Änderung und nie, solange MPD noch einliest; bei mehr als drei Ordnern ein Scan des gemeinsamen
Elternordners. Solange „Bibliothek prüfen“ offen ist, wird nur gesammelt und beim Schließen einmal eingelesen
(spätestens 10 Minuten nach der letzten Änderung). Das wirkt nur, wenn MPD nicht selbst mitliest: Steht in
`/etc/mpd.conf` `auto_update "yes"`, scannt MPD jede geänderte Datei sofort, und Volumio baut danach jedes Mal seine
Albumliste neu auf (rund eine Minute Last je Album, bei vielen Alben hintereinander bis zum Hänger). Empfehlung:
`auto_update "no"` (auch in der Vorlage unter `/volumio/app/plugins/music_service/mpd/`, falls dort vorhanden) und
`sudo systemctl restart mpd`; neue Musik dann wie gewohnt mit „Bibliothek aktualisieren“ einlesen (im Volumio-Menü „Aktualisieren“, nicht „Neu
einlesen“, oder mit dem Knopf oben in „Bibliothek prüfen“ bzw. dem Eintrag „Bibliothek aktualisieren“ im Zahnradmenü; dabei gehen auch noch gesammelte Änderungen mit auf). Der Dienst ist ohne Anmeldung im lokalen Netz erreichbar.

### Cover online suchen
Im Album-Editor sucht „Online suchen“ bei iTunes, Last.fm (mit dem Last.fm-Key aus `keys.json`) und im
Cover Art Archive (MusicBrainz) nach Album-Künstler (sonst Künstler) und Album, wie sie gerade in den Feldern stehen
(zum Suchen kurz ändern, ohne zu speichern). Die Vorschläge erscheinen
nebeneinander; ein Tipp übernimmt das Bild wie ein gewähltes (einbetten und/oder folder.jpg, mit Rückgängig).
Die Abfragen macht der Tag-Dienst; der Player braucht dafür Internetzugang.

### Bibliothek prüfen
Im Menü (Zahnrad oben rechts, nur wenn der Tag-Dienst läuft): findet Alben ohne Cover, Compilations ohne
einheitlichen Album-Künstler, Künstler in mehreren Schreibweisen, uneinheitliche Albumnamen/Jahre, Alben, deren
Date-Tag vom ersten Erscheinen laut MusicBrainz abweicht (aus dem Nachschlagen für die Geburtstage; der Stift schlägt
das MusicBrainz-Datum vor), und Titel ohne Tracknummer; der Stift öffnet den passenden Editor. Die Prüfung liest die MPD-Datenbank (`MPD_HOST`, `MPD_PORT`, Standard
`localhost:6600`) und die Ordner, ändert nichts an den Dateien und läuft nur auf Knopfdruck (Ausnahme: „Verschieben“ bei den doppelten Alben, siehe unten). Ergebnis:
`/data/xplorio/data/check.json`, bis neu geprüft wird. Einträge, deren Stift benutzt wurde, bleiben dort vermerkt und
ausgegraut, auch nach dem Schließen, bis zur nächsten Prüfung.

**Genres:** Zwei weitere Kategorien schlagen je Album genau ein Genre aus den 15 Discogs-Oberkategorien vor (Electronic,
Rock, Jazz, Classical, Pop, Hip Hop, Funk / Soul, Folk, World, & Country, Latin, Reggae, Blues, Stage & Screen,
Non-Music, Children's, Brass & Military).
- *Alben ohne Genre:* Vorschlag aus der Audio-Analyse ([Essentia](#audio-analyse-mit-essentia-optional-auf-mac-oder-windows-pc)), gemittelt über alle Titel
  des Albums. Ohne Audio-Analyse gibt es keinen Vorschlag.
- *Genres zusammenfassen:* Vorhandene Genre-Tags (z. B. „Trip-Hop“, „TripHop“, „Klassik“, „Hörspiel“) ordnet eine Tabelle
  in `tags/genres.js` einer Oberkategorie zu, ebenso die Discogs-Unterstile aus der Audio-Analyse. Bei mehrdeutigen Namen
  („Indie“: Rock oder Pop) entscheidet die Audio-Analyse. Gleiche Änderungen stehen in einer Zeile.

Der Stift öffnet die Mehrfachbearbeitung mit dem Vorschlag; geschrieben wird erst mit Speichern, Rückgängig geht wie
gewohnt. Neben jedem Genre-Feld im Tag-Editor steht eine Auswahl „Hauptgenre“ mit den 15 Oberkategorien; eigene Werte
lassen sich weiter eintippen. Die Unterstile („Trip Hop“, „Downtempo“) kommen nicht in die Dateien, sondern bleiben im Tag-Dienst:
`GET /genres?dir=<Ordner>` liefert Oberkategorie und Unterstile eines Albums (Stand des letzten Checks), ohne `dir` alle.
Klassik, Soundtracks und Hörspiele erkennt das Modell schwächer.

**Doppelte Alben:** Ordner mit gleichem Album-Künstler und gleichem Albumnamen. Groß-/Kleinschreibung, Akzente, „The“
und Satzzeichen zählen nicht, Zusätze wie „(Remastered)“, „[Deluxe Edition]“ oder „- 2009 Remaster“ auch nicht;
Zusammenstellungen werden nur nach dem Albumnamen verglichen. Ordner eines Albums, die nach CDs getrennt nebeneinander
liegen (CD1, CD2 oder verschiedene Disc-Nummern), zählen als eine Fassung. Je Fassung stehen Format, Auflösung, Zahl der
Titel, Spielzeit und Pfad da; die beste ist markiert (verlustfrei vor verlustbehaftet, dann mehr Bit, höhere
Abtastrate, mehr Titel). ▶ spielt eine Fassung ab (ersetzt die Warteschlange), die Liste bleibt dabei offen.

„Verschieben“ legt die Ordner einer Fassung in den versteckten Ordner `.duplicates` auf demselben Laufwerk, mit dem
übrigen Pfad (aus `/mnt/INTERNAL/mp3/Nena/Nena` wird `/mnt/INTERNAL/.duplicates/mp3/Nena/Nena`). Das geht auch bei
großen Alben sofort, und MPD liest Ordner mit Punkt am Anfang nicht ein, das Album verschwindet also beim nächsten
Einlesen aus der Bibliothek. Zurückschieben per `mv` stellt es wieder her. Ist ein Passwort für die Dienste gesetzt, muss
das Gerät einmal unter System bei den Diensten angemeldet sein. Gelöscht wird in Xplorio nichts; endgültig löschen geht per ssh mit
dem Befehl, den die Kategorie zum Kopieren anbietet, z. B.:
```bash
sudo rm -rf '/mnt/INTERNAL/.duplicates'
```
Der Tag-Dienst braucht dafür Schreibrecht auf die Musikordner, wie beim Tag-Editor.

### Webradio: Cover und Senderlogos
Sendet ein Webradio „Künstler - Titel“, sucht der Tag-Dienst das Cover dazu bei iTunes (sonst Deezer) und zeigt es in der
App; ohne Titel oder ohne Treffer bleibt das Senderlogo. Die Radio-Liste zeigt die Senderlogos
(Adresse aus Volumio, sonst über den Sendernamen von radio-browser.info). Beides speichert der Tag-Dienst unter
`/data/xplorio/data/radio-covers/` und `/data/xplorio/data/stations/`.

### Begrüßung
Beim Öffnen der Seite (nur mit Tag-Dienst) erscheint in der Mitte eine Karte mit Gruß nach Tageszeit (im Querformat mit
breitem Rand): das **Album des Tages**
(zufällig, bevorzugt lange nicht oder nie gehört; bleibt den ganzen Tag dasselbe) mit „Abspielen“ und Albumtext (wie im
Info-Overlay, scrollbar), **Passt zusammen** (siehe unten), **Zuletzt gehört**
(Alben, von denen zuletzt mindestens zwei Titel liefen), **Um diese Zeit vor X Jahren** (Alben, die vor einem
Jahr oder länger um dieses Datum herum liefen, ± 3 Tage), **Neu in der Sammlung** (Alben, deren Dateien in den letzten
180 Tagen dazukamen oder sich änderten, nach dem Änderungsdatum aus MPD) und ein Zufallsmix. Tippen daneben schließt es.
Es kommt höchstens alle 30 Minuten von selbst und nicht in der Bühnenansicht; „Beim Öffnen zeigen“ unten schaltet es
für dieses Gerät ab, im Menü unter „Begrüßungsschirm“ ist es jederzeit erreichbar. Mit `?welcome=0` in der Adresse bleibt es beim Öffnen aus (z. B. für ein Lesezeichen). Nach dem Update liest der Tag-Dienst die
Albenliste einmal neu, bis dahin fehlt „Neu in der Sammlung“.

**Geburtstage:** Alben, die heute, in dieser Woche (Montag bis Sonntag) oder in diesem Monat Erscheinungstag haben. Die
Begrüßung zeigt heute und diese Woche (sonst den Monat), Suchen & Entdecken im Reiter Alben alle drei, dazu „Zuletzt
gehört“ und „Neu in der Sammlung“. Runde Geburtstage (10, 20, 30 … Jahre) tragen die Jahre als Abzeichen, Jubiläen
(25, 50, 75 Jahre) zusätzlich einen goldenen Rand; sie stehen vorn. Das Datum kommt aus einem vollständigen Date-Tag
(JJJJ-MM-TT, passend zum Jahr des Albums); fehlt es, schlägt der Tag-Dienst es einmal bei MusicBrainz nach (erstes
Erscheinen der Release-Group, eine Anfrage je 1,5 Sekunden, Sampler ausgenommen) und merkt es sich in
`/data/xplorio/data/releasedates.jsonl`; nicht Gefundenes fragt er nach 90 Tagen erneut. Bei einer großen Sammlung dauert
das beim ersten Mal einige Stunden; solange kaum Daten da sind und noch kein Geburtstag gefunden ist, zeigt Entdecken den Stand. Ausschalten auf der
Einstellungsseite unter „Funktionen“ (Erscheinungstage).

### System
Im Menü unter „System“: die aktuelle Prozessorlast (alle 2 Sekunden neu, mit den letzten 3 Minuten und je Kern), ein Verlauf
der letzten 24 Stunden (Last, Temperatur oder Arbeitsspeicher, je Minute gemittelt), Temperatur, Arbeitsspeicher, die Belegung
jedes Laufwerks (interne Karte, USB und jede Verbindung unter `/mnt/NAS/` einzeln; eine nicht erreichbare Verbindung steht als
„nicht erreichbar“ da), Volumio-Version, Kernel, Laufzeit und die gerade gespielte Datei. Die Werte liest der Tag-Dienst aus
`/proc`, `/sys` und `df`; er misst alle 2 Sekunden (eine kleine Datei, ohne spürbare Last) und sichert den Verlauf alle
10 Minuten in `/data/xplorio/data/sysinfo.json`.

#### Dienste
Darunter die Karte „Dienste“: Volumio, MPD, Xplorio-Webserver, Tag-Dienst und Rotel-Steuerung mit Zustand (läuft seit …,
gestoppt, Fehler) und einem Knopf „Neustart“. Vor einem Neustart fragt die Seite nach. Dienste, die auf dem Player nicht
laufen, fehlen in der Liste. Der Tag-Dienst startet die Dienste über `sudo systemctl` neu, das Volumio dem Benutzer
`volumio` erlaubt; eine eigene sudo-Regel legt das Plugin nicht an. Lässt der Player das nicht zu, zeigt die Karte den
Zustand und einen Hinweis.

Unter den Diensten stehen „Neustart“ und „Ausschalten“ für den ganzen Player, jeweils mit Rückfrage. Ist ein Passwort
festgelegt (siehe unten), fragen auch sie danach; sonst nicht, denn Volumio selbst bietet beides ohne Passwort an. Sie nutzen
`/sbin/reboot` und `/sbin/poweroff` wie Volumio.

Die Knöpfe der Dienste sind außerdem durch ein Passwort geschützt und bleiben gesperrt, bis eines auf der
Einstellungsseite des Plugins festgelegt ist. Gespeichert wird nur ein Hash (PBKDF2 mit Salt) in
`/data/xplorio/data/admin.json`; ein neues Passwort meldet alle Geräte ab. Beim ersten Tipp auf einen Knopf fragt die Seite nach dem Passwort, danach bleibt das Gerät (der Browser)
30 Tage angemeldet. Nach 5 falschen Versuchen wartet der Dienst, bei jedem weiteren doppelt so lange (höchstens 15 Minuten).
Die Verbindung ist unverschlüsselt (http): Das Passwort hält Gäste fern, schützt aber nicht vor Mitlesen im eigenen Netz,
also keines nehmen, das anderswo verwendet wird. Hinweis: Volumio selbst lässt sich im Heimnetz ohne Passwort neu starten
und ausschalten.

#### Protokolle
Unter den Diensten die Karte „Protokolle“: die letzten 50, 100 oder 300 Zeilen von Volumio, MPD und dem Tag-Dienst (aus dem
Journal, wie `journalctl -u volumio`), dazu die Protokolle der Plugins AutoDJ (`/data/volumio_autodj_data/autodj.debug.log`)
und Smart Playlists (`/data/smart_playlists_data/smart_playlists.debug.log`), sobald es sie gibt. Die Karte zeigt zuerst nur die Quellen; ein Tipp lädt das Protokoll, ein zweiter klappt es wieder zu. Das Suchfeld darüber zeigt nur Zeilen mit dem eingegebenen Text (z. B. `error`, Groß-/Kleinschreibung egal), auch bei „Live“. „Live“ holt alle 3 Sekunden
nach (wie `-f`), solange die Seite offen ist. Ist ein Passwort festgelegt (siehe oben), sind auch die Protokolle damit
geschützt, denn sie enthalten Pfade, Titel und Adressen im Netz.

Das Journal darf der Benutzer `volumio` nur lesen, wenn er in der Gruppe `systemd-journal` ist; ohne sie zeigt die Karte
für Volumio, MPD und den Tag-Dienst einen Hinweis, die Plugin-Protokolle gehen trotzdem. Auf vielen Playern ist das schon
so: `id volumio` zeigt die Gruppen, steht dort `systemd-journal` oder `adm`, ist nichts zu tun. Sonst einmalig:

```
sudo usermod -a -G systemd-journal volumio
sudo systemctl restart xplorio-tags
```

Die Gruppe erlaubt nur das Lesen des Journals.

### Wiedergabe
Im Menü unter „Wiedergabe“: **Crossfade** an oder aus, mit einer Dauer von 1 bis 30 Sekunden, und **Lautstärke angleichen**
(ReplayGain) mit Aus, Titel, Album oder Automatisch (bei Zufallswiedergabe wie Titel, sonst wie Album). Beides stellt der
Tag-Dienst direkt in MPD um, ohne Neustart; ReplayGain wirkt nur bei Dateien mit ReplayGain-Tags. Volumios eigene
Normalisierung (`volume_normalization`, gleicht auch ohne Tags an, verändert aber die Dynamik) zeigt die Seite nur an;
umgestellt wird sie in Volumio unter Einstellungen → Wiedergabe-Optionen. Ist das AutoDJ-Plugin installiert, zeigt die Seite,
ob dessen Automatik für Crossfade und Angleichen an ist: Wer beides hier einstellt, sollte sie im Plugin ausschalten, sonst
stellt AutoDJ die Werte beim nächsten neuen Mix um. Ob Volumio Crossfade und ReplayGain-Modus nach einem Neustart
zurücksetzt, ist noch nicht geprüft.

**ReplayGain-Tags mit rsgain (optional):** Fehlen die Tags, schreibt sie [rsgain](https://github.com/complexlogic/rsgain)
nachträglich in die Dateien; der Ton selbst bleibt unverändert. Wie die Audio-Analyse läuft es auf dem Mac oder PC, nicht
auf dem Player. Liegt die Musik auf dem Player, die Freigabe mit Schreibrechten verbinden.
```bash
brew install rsgain                                        # Mac; Ubuntu/WSL: sudo apt install rsgain
rsgain easy -m MAX /Volumes/<Freigabe>/<Musikordner>      # alles, mit allen Prozessorkernen
rsgain easy -S -m MAX /Volumes/<Freigabe>/<Musikordner>   # später: nur Alben ohne Tags (z. B. neu dazugekommene)
```
Unter Windows die ZIP-Datei von der [Release-Seite](https://github.com/complexlogic/rsgain/releases) entpacken und z. B.
`rsgain.exe easy -m MAX "Z:\Musik"` aufrufen.
- `easy` geht davon aus, dass jedes Album in einem eigenen Ordner liegt, und berechnet daraus die Album-Werte. Ist die
  Sammlung anders sortiert, mit `-p no_album` nur Titel-Werte schreiben und unter „Wiedergabe“ „Titel“ wählen.
- rsgain ändert die Dateien. Wer auch die [Audio-Analyse](#audio-analyse-mit-essentia-optional-auf-mac-oder-windows-pc)
  nutzt, lässt rsgain am besten vorher laufen; sonst analysiert `analyse.py` die geänderten Dateien beim nächsten Lauf neu.

### Verlauf und Statistik
Im Menü (Zahnrad oben rechts) unter „Verlauf und Statistik“: **Zuletzt** gespielt (nach Tagen), **Meistgespielt** (Titel, Alben, Künstler oder Genres;
30 Tage, 12 Monate oder gesamt), **Statistik** (Wiedergaben, Hörzeit, Verlauf, Tageszeit, Wochentag, Top-8-Genres; ein Genre antippen öffnet seine Alben) und **Rückblick**
(ein Jahr: Summen mit Vergleich zum Vorjahr, Monate und zum Aufklappen Top-Titel, -Alben, -Künstler, -Genres (antippbar) und neu entdeckte Künstler; Tipp auf einen Monatsbalken zeigt die Ranglisten für diesen Monat; Genres aus der Albenliste unten). Antippen spielt
den Titel ab bzw. öffnet Album oder Künstler.

**Meintest du …?** Findet die Suche in der eigenen Sammlung nichts (Volumio sucht dort nur exakte Teilstücke), schlägt
der Tag-Dienst bis zu drei ähnliche Künstler- oder Albumnamen vor, z. B. „Motörhead“ für „Motorhead“ oder „Metallica“
für „Metalica“. Akzente, Groß- und Kleinschreibung, ein „The“ am Anfang, „&“/„and“ und Satzzeichen spielen dabei keine
Rolle, kleine Tippfehler werden verziehen. Ein Tipp auf den Vorschlag sucht danach. Titelnamen werden nicht verglichen;
die Streamingdienste haben ihre eigene, fehlertolerante Suche.

**Entdecken:** Solange in „Suchen & Entdecken“ nichts eingegeben ist, zeigt die Seite passend zum Reiter Künstler, Alben
oder Titel mehrere Reihen zum Wischen: **Zufällige Entdeckungen** (bevorzugt, was lange nicht oder nie lief; ↻ zieht
neu), **Vor einem Jahr gehört** (um dieses Datum vor einem Jahr, sonst vor 2, 3 … Jahren), **Lange nicht gehört**
(über ein halbes Jahr her), **Noch nie gehört** und **Früher oft gehört** (oft gehört, aber seit einem halben Jahr nicht
mehr). Leere Reihen fallen weg. Künstler und Album tippen öffnet, Titel tippen spielt ab. Grundlage ist der Verlauf
(siehe oben). Der Würfel rechts an jeder Reihe spielt 25 Titel aus der ganzen Reihe (nicht nur den sichtbaren
Kacheln), passend zum Reiter: im Reiter Titel die Titel der Reihe, im Reiter Künstler Titel der Künstler dieser Reihe,
im Reiter Alben Titel der Alben dieser Reihe (bei „Noch nie gehört“ im Reiter Künstler also nur Künstler, von denen nie
etwas lief). „Zufällige Entdeckungen“ und „Vor X Jahren gehört“ mischen in jedem Reiter Titel. Es
gelten die Würfel-Regeln (siehe Zufallsmix), ohne „mag ich nicht“.

**Nach Stimmung, Energie, Stil und Jahrzehnt:** Unter den Reihen stehen Auswahlknöpfe. Stimmung (Entspannt, Verträumt,
Melancholisch, Düster, Fröhlich, Intensiv, Episch; dieselben Namen wie im Mood Mix), Energie (Ruhig, Mittlere Energie, Energiegeladen) und Stil (Acoustic, Ambient,
Electronic, Funky, Soulful, Experimental) öffnen wie ein Genre die passenden Alben mit „Alle abspielen“ und Würfel; der Würfel nimmt dort nur Titel, die selbst
diese Stimmung, diesen Stil bzw. diese Energie tragen.
Ein Album passt, wenn mindestens die Hälfte seiner eingeordneten Titel diese Stimmung bzw. diesen Stil trägt (ein
Stil-Knopf fasst verwandte Stile zusammen, z. B. Electronic auch Downtempo, House und Trip-Hop) oder wenn die mittlere
Energie im Bereich liegt (Ruhig 1–2, Mittlere Energie 3, Energiegeladen 4–5); es braucht mindestens zwei eingeordnete
Titel. Wie viele Alben passen, hängt von den Stimmungs-Tags ab. Der Mood Mix bleibt davon getrennt.
Ein Jahrzehnt öffnet seine Alben, nach Jahr sortiert, mit „Alle abspielen“ und Würfel. Das Jahr ist das häufigste
Date-Tag im Albumordner (aus MPD, also der Wert im Tag-Editor); Alben ohne Jahr fehlen dort. Nach dem Update liest
der Tag-Dienst die Albenliste einmal neu, bis dahin fehlen die Jahrzehnte.

**Erscheinungsjahr:** Hinter dem Albumtitel steht das Jahr in Klammern, in der Player-Ansicht, im Albumkopf, in den
Albenlisten der Künstlerseite, bei Genre, Jahrzehnt und Stimmung und bei Alben in der Suche. Ein Tipp auf das Jahr
öffnet die Alben dieses Jahres. Jahres- und Jahrzehntseite haben zwei Reiter: „Alben“ und „Entdecken“. „Entdecken“ zeigt
Künstler mit Alben aus dem Jahrzehnt, die dort häufigsten Stimmungen und Stile und die angrenzenden Jahrzehnte.
Stimmung und Stil zeigen dort nur Alben dieses Jahrzehnts (z. B. „Melancholisch · 1980er“); „Alle Jahrzehnte“ hebt das auf.

**Bewertungen** (nur mit Tag-Dienst): Auf der Künstlerseite markiert ein Herz Lieblingskünstler, im Albumkopf gibt es
ein bis fünf Sterne (den gleichen Stern noch einmal tippen nimmt die Bewertung zurück). Titel haben einen Daumen, in der
Warteschlange und in der Titelliste eines Albums; ein Tipp schaltet weiter von neutral (Umriss) über
„mag ich“ (Daumen hoch) zu „mag ich nicht“ (Daumen runter) und zurück. „Mag ich“ ist dasselbe wie ein Favorit in Volumio:
Der Daumen legt den Titel in die Volumio-Favoriten, und vorhandene Favoriten zeigen den Daumen hoch. Herzen, Sterne und
„mag ich nicht“ speichert der Tag-Dienst in `/data/xplorio/data/ratings.json`. Titel mit „mag ich nicht“ lassen
Würfel, Mood Mix und die Titel-Reihen beim Entdecken aus.

**Versteckte Perlen** (nur mit Tag-Dienst): Beim Entdecken zeigt die Reihe unter den Zufälligen Entdeckungen Künstler,
Alben oder Titel aus der Mediathek, die nie oder kaum gelaufen sind (Künstler und Alben höchstens zweimal, Titel
höchstens einmal) und zum eigenen Geschmack passen. Den Geschmack bilden Künstler mit Herz, Alben mit 4 oder 5 Sternen,
die Volumio-Favoriten (der Tag-Dienst fragt sie höchstens einmal je Minute bei Volumio ab) und, schwächer, der Verlauf.
Verglichen werden Genre, Stimmung, Stil und Energie aus den Stimmungs-Tags; Titel ohne Stimmungs-Tags kommen in der
Titel-Reihe nicht vor. Ungehörte Alben und Titel von Lieblingskünstlern sind immer dabei. Unter jeder Kachel steht der
Grund: „♥ Ungehört“ (Lieblingskünstler), „Wie …“ (klingt wie ein Lieblingskünstler) oder Stimmung · Genre. Nicht
dabei: Titel mit „mag ich nicht“, Alben, deren Titel überwiegend „mag ich nicht“ tragen, schon bewertete Alben,
Künstler mit Herz und Favoriten. ↻ zieht neu. Ohne Bewertungen zählt nur der Verlauf; gibt es auch keinen,
fehlt die Reihe.

**Passt zusammen** (nur mit Tag-Dienst): Im Reiter „Künstler“ beim Entdecken und auf der Begrüßung stehen Mixe aus zwei
oder drei Künstlern der eigenen Sammlung, die musikalisch zusammenpassen. Ausgangspunkt ist ein Künstler, den man oft
hört oder mit Herz markiert hat; dazu kommen Künstler mit ähnlichem Klang (Genre, Stimmung, Stil und Energie aus den
Stimmungs-Tags, verglichen mit den übrigen Künstlern der Sammlung). Nennt Last.fm einen davon als ähnlichen Künstler,
zählt das mit (nur mit Last.fm-Key), seltener Gehörte bekommen einen kleinen Vorsprung. Jede Kachel zeigt die Fotos der
Künstler und was sie verbindet. Ein Tipp öffnet die Vorschau: etwa 25 Titel, rund 40 % Lieblingstitel (oft gehört,
Favorit oder Album mit 4–5 Sternen) und der Rest selten oder nie gehört (nie Gehörtes ist mit „neu“ markiert); die Künstler wechseln sich ab,
Energie und Tempo gehen sanft ineinander über. „Mix abspielen“ ersetzt die Warteschlange, der Würfel zieht einen neuen
Mix, + hängt ihn an. Die Mixe bleiben den ganzen Tag gleich, ↻ würfelt neue. Der Tag-Dienst merkt sich die gezeigten
Paarungen sieben Tage in `/data/xplorio/data/together.json`, damit sie sich nicht gleich wiederholen. Nicht dabei:
„Verschiedene“, Künstler mit weniger als sechs Titeln, Titel mit „mag ich nicht“ und Alben mit 1–2 Sternen.

**Entdecken auf der Künstlerseite:** Die Künstlerseite hat drei Reiter: „Alben & Titel“, „Entdecken“ und „Hintergrund“
(der zuletzt gewählte bleibt beim Zurück offen). „Hintergrund“ zeigt den Künstlertext wie die Info-Seite im Player. Im Reiter „Entdecken“ führen Knöpfe weiter: ähnliche Künstler aus der
Sammlung (Last.fm), die Stimmungen und Stile, die mindestens ein Fünftel seiner eingeordneten Titel tragen, seine mittlere
Energie und die Jahrzehnte seiner Alben. Jeder Knopf öffnet wie beim Entdecken den Künstler bzw. die passenden Alben; der
bisherige Weg zählt dabei nicht als Filter. Der Würfel vor den ähnlichen Künstlern startet einen Zufallsmix aus dem
Künstler selbst und den ähnlichen Künstlern, jeder etwa gleich oft, egal wie viel von ihm in der Sammlung liegt.

**Wie oft gehört** (Tag-Dienst): In der Abspielzeile der Albumseite steht mittig, wie oft das Album gehört wurde und
wann zuletzt (aus dem Verlauf; Titel ohne Pause über drei Stunden zählen als ein Hören).

**Entdecken auf der Albumseite** (Tag-Dienst): Die Albumseite hat die Reiter „Titel“, „Entdecken“ und „Hintergrund“.
„Entdecken“ zeigt ähnliche Alben aus der Sammlung (Stimmungen, Stile und Energie der eingeordneten Titel im Vergleich, je
Künstler höchstens eins, mit Würfel für einen Zufallsmix daraus und aus dem Album selbst), Stimmung, Energie und Stile des Albums, Jahr, Jahrzehnt
und Genre sowie weitere Alben des Künstlers. „Hintergrund“ zeigt den Albumtext und darunter die Mitwirkenden.

Bei Künstlern und Alben vom Streamingdienst heißt der Reiter „Lokal entdecken“ und sucht in der eigenen Sammlung: ähnliche
Künstler über Last.fm, beim Album das gleichnamige Album in der Sammlung oder, falls es dort fehlt, das Profil des Künstlers.

**Mehr wie dieser Titel:** Ein Tipp auf den Titel in der Wiedergabe (eigene Datei) öffnet bis zu 25 Titel der Sammlung
mit ähnlicher Stimmung und Energie und, mit Audio-Analyse, ähnlichem Tempo (halbes oder doppeltes Tempo zählt als gleich);
Stil und Genre zählen etwas mit. Mindestens eine Stimmung muss übereinstimmen, je Künstler höchstens zwei Titel,
„mag ich nicht“ fällt weg. Jeder Titel zeigt die gemeinsamen Stimmungen, sein Tempo und seine Energie. „Alle abspielen“
spielt die Liste. Der Würfel lässt den laufenden Titel zu Ende spielen und ersetzt alles, was danach in der Warteschlange
stand, durch 25 andere ähnliche Titel. Ohne Stimmungsdaten zum Titel erscheint ein Hinweis.

**Zufallsmix:** Neben „Alle abspielen“ (Künstlerseite, Genre-Listen) startet der Würfel 25 zufällige Titel daraus.
Würfel-Regeln: höchstens drei Titel je Künstler und zwei je Album (auf der Künstlerseite keine Künstlergrenze, drei je
Album), was in den letzten 14 Tagen lief, nur, wenn sonst zu wenig da ist; reicht die Auswahl nicht, wird über die
Grenzen hinaus aufgefüllt. Nie derselbe Künstler direkt hintereinander; „mag ich nicht“ nie. Die Albenliste liest der Tag-Dienst aus MPD und speichert sie in
`/data/xplorio/data/albums.json`; sie wird neu gelesen, wenn sich MPDs Datenbank ändert
(Prüfung höchstens einmal pro Minute; nach Tag-Änderungen gut eine Minute nach dem Scan von selbst).

**Genres:** Der vierte Suchreiter (nur mit Tag-Dienst) zeigt ohne Eingabe Kacheln aller Genres, mit Eingabe die passenden.
Bei mehr als zwölf Genres steht darüber die Reihe „Zufällige Genres“; ↻ zieht sie neu.
Ein Tipp öffnet die Genre-Seite: Gibt es [Audio-Analysen](#audio-analyse-mit-essentia-optional-auf-mac-oder-windows-pc), zuerst Kacheln
der Stilrichtungen (Discogs-Unterstile, z. B. „Trip Hop“ unter Electronic) mit „Alle“ davor, sonst gleich alle Alben des
Genres, nach Künstler sortiert. Je Album zählen bis zu drei Unterstile seines Genres, gemittelt über die analysierten Titel;
Alben ohne Analyse stehen nur unter „Alle“. Die Suche findet auch Unterstile. Als Genre eines Albums gilt sein
häufigstes Genre-Tag (aus der Albenliste). Auf der Albumseite stehen Künstler, Album und Genre untereinander; Künstler und
Genre öffnen ihre Seite. In Albumlisten steht das Genre klein vor dem Stift, in der Player-Ansicht klein unter der
Qualitätsangabe (ein Tipp öffnet die Genre-Seite). Genre-Tags vereinheitlichen und ergänzen hilft
[Bibliothek prüfen](#bibliothek-prüfen).
Künstlerfotos holt der Tag-Dienst einmal von Deezer und speichert sie unter `/data/xplorio/data/artists/`
(Last.fm liefert keine mehr); ohne Foto erscheint Volumios Künstler-Symbol.

Der Tag-Dienst fragt Volumio alle 5 s (bei Pause/Stopp alle 15 s) nach dem Wiedergabestand (`VOLUMIO_URL`, Standard
`http://localhost:3000`). Ein Titel zählt, wenn er länger als 30 s ist und zur Hälfte oder 4 Minuten lief; Webradio zählt
nicht. Jede Wiedergabe ist eine Zeile in `/data/xplorio/data/plays.jsonl`. Ausschalten auf der
Einstellungsseite unter „Funktionen“ (Verlauf).

**Last.fm:** Zum Scrobbeln braucht der Dienst neben `LASTFM_KEY` auch `LASTFM_SECRET` in `/data/xplorio/data/keys.json`
(siehe [Last.fm-Zugang](#lastfm-zugang)). Dann unter Statistik „Mit Last.fm verbinden“, bei Last.fm
„Zulassen“ und zurück in der App „Fertig“. Danach:
- neue Wiedergaben werden gescrobbelt („läuft gerade“ inklusive); ohne Internet warten sie in einer Warteschlange
  (Last.fm nimmt sie bis zu 14 Tage später noch an),
- der bisherige Last.fm-Verlauf wird einmal eingelesen; „Mit Last.fm abgleichen“ holt später nur Neues. Was schon im
  Verlauf steht (gleicher Titel innerhalb von 5 Minuten), wird nicht doppelt eingetragen.

Der Sitzungsschlüssel liegt in `/data/xplorio/data/lastfm.json` und bleibt auf dem Player. Falls ein anderes
Last.fm-Plugin in Volumio scrobbelt, eines davon abschalten, sonst kommt jeder Titel doppelt bei Last.fm an.

### Stimmungs-Tags
Mit `LASTFM_KEY` holt der Tag-Dienst für jeden Titel der Bibliothek die Last.fm-Tags (`track.getTopTags`, ohne
brauchbare Titel-Tags ersatzweise die Tags des Künstlers) und rechnet sie nach `tags/mood/lastfm_mapping.json` und
`tags/mood/classification_rules.json` in Stimmung, Energie (1–5) und Stil um. Abgefragt wird nur, solange nichts spielt
(Stopp oder Pause; geprüft alle 5 s), mit etwa 4 Anfragen je Sekunde. Die Musikdateien bleiben unverändert; die Rohtags
liegen in `/data/xplorio/data/moodtags/`, die Titelliste dazu in `/data/xplorio/data/library-tracks.json` (entsteht
zusammen mit der Albenliste). Fortschritt und Verteilung zeigt „Bibliothek prüfen“ unter „Stimmungs-Tags (Last.fm)“.
Ausschalten auf der Einstellungsseite unter „Funktionen“ (Stimmungs-Tags).

**Mood Mix:** Playlisten-Taste, Reiter „Mood Mix“ (erscheint, sobald der Tag-Dienst läuft). Dort lassen sich
mehrere Stimmungen, ein Energie-Bereich, ein oder mehrere Genres (Genre-Tag des Albums, nie gelockert) und unter „Feinabstimmung“ Stile, Tempo (mit Audio-Analyse), Jahre (Erscheinungsjahr des Albums aus dem Date-Tag; mit Grenze fallen Alben ohne Jahr weg, nie gelockert), Länge, Höchstlänge je Titel (Vorgabe 20 min, hält DJ-Mixe draußen) und Entdeckungsgrad (nach dem Verlauf:
Favoriten, ausgewogen, versteckte Perlen) wählen. „Mix erstellen“ zeigt nur eine Vorschau; erst „Mix abspielen“ ersetzt
die Warteschlange (das Listensymbol daneben hängt den Mix an). Gibt es weniger als 20 genaue Treffer, nimmt der Mix
Ähnliches dazu (Energie ±1, dann ohne Stil) und sagt das. Derselbe Künstler kommt nie direkt hintereinander.

### Audio-Analyse mit Essentia (optional, auf Mac oder Windows-PC)
[Essentia](https://essentia.upf.edu) hört jeden Titel selbst an und liefert je Titel Tempo (BPM), Tonart, Stimmung
(fröhlich, traurig, entspannt, aggressiv, Party), Tanzbarkeit, Gesang/instrumental, Valenz und Erregung sowie
Discogs-Stile. Für den Player ist das zu viel Rechenarbeit, deshalb läuft `tools/essentia/analyse.py` auf dem Mac (oder einem Windows-PC, siehe unten) und
lädt eine Ergebnisdatei hoch. Der Tag-Dienst nimmt dann Energie, Tempo und Stimmung dieser Titel aus dem Audio,
Last.fm ergänzt weitere Stimmungen und Stile; der Mood Mix bekommt unter „Feinabstimmung“ einen Tempo-Regler.

Einmalig (macOS 15 oder neuer; Python 3.14 von python.org oder `brew install python@3.14`):
```bash
python3.14 -m venv ~/mx-essentia && source ~/mx-essentia/bin/activate
python -m pip install essentia-tensorflow mutagen
```
Meldet pip „from versions: none“, gibt es für diesen Mac kein aktuelles Paket. Intel-Mac mit macOS 14: die letzte
Fassung dafür braucht Python 3.13 (`brew install python@3.13`):
```bash
python3.13 -m venv ~/mx-essentia && source ~/mx-essentia/bin/activate
python -m pip install "essentia-tensorflow==2.1b6.dev1389" mutagen
```
Die vortrainierten Modelle (rund 100 MB, Lizenz CC BY-NC-SA 4.0, nur nicht-kommerziell) gehören nicht zum pip-Paket;
das Skript lädt sie beim ersten Lauf nach `~/.cache/mx-essentia`.

**Unter Windows:** Für Windows gibt es kein Essentia-Paket, wohl aber für Linux, und das läuft unter Windows 10 und 11
im Linux-Teilsystem WSL. Einmalig in der Eingabeaufforderung als Administrator `wsl --install` (richtet Ubuntu ein; danach
neu starten und Benutzername und Passwort für Ubuntu festlegen). Dann im Fenster „Ubuntu“:
```bash
sudo apt update && sudo apt install -y python3-venv ffmpeg
python3 -m venv ~/mx-essentia && source ~/mx-essentia/bin/activate
python -m pip install "essentia-tensorflow==2.1b6.dev1389" mutagen
curl -fsSLO https://raw.githubusercontent.com/Celindir69/xplorio/main/tools/essentia/analyse.py
```
Meldet pip „from versions: none“, hat Ubuntu ein neueres Python; dann ohne `==…` installieren. Danach wie unten, nur mit anderen Pfaden und ohne `caffeinate`:
- Windows-Laufwerke liegen unter `/mnt/c/`, `/mnt/d/` usw., also z. B. `python3 analyse.py /mnt/d/Musik`.
- Liegt die Musik auf dem Player, die Freigabe im Explorer als Netzlaufwerk verbinden (z. B. `Z:` für
  `\\<IP des Players>\<Freigabe>`) und in Ubuntu einhängen: `sudo mkdir -p /mnt/z && sudo mount -t drvfs Z: /mnt/z`
  (nach jedem Neustart von Windows wieder). Dann `python3 analyse.py --player http://<IP des Players> /mnt/z/<Musikordner>`.
- Für den Player die IP-Adresse nehmen: Namen mit `.local` findet Ubuntu unter WSL oft nicht.
- Das Ubuntu-Fenster muss offen bleiben, und Windows darf nicht in den Ruhezustand gehen (Einstellungen > System >
  Energie, für die Dauer der Analyse auf „Nie“).

Analysieren (erst ein kurzer Probelauf, dann alles; `caffeinate -i` hält den Mac wach):
```bash
source ~/mx-essentia/bin/activate
python3 analyse.py --limit 20 /Volumes/<Platte>/<Musikordner>
caffeinate -i python3 analyse.py /Volumes/<Platte>/<Ordner 1> /Volumes/<Platte>/<Ordner 2>
python3 analyse.py --upload http://<player>:8766
```
- Zugeordnet wird über Künstler und Titel (wie bei den Last.fm-Tags), nicht über den Pfad: Ordnerstruktur und Laufwerk
  auf dem Mac sind egal. Titel, die es auf dem Player nicht gibt, werden dort einfach nicht verwendet.
- Mehrere Ordner lassen sich angeben, Symlinks werden verfolgt; `--exclude "*/Hörbücher/*"` lässt Pfade aus.
- Ist in den Xplorio-Einstellungen ein Passwort für die Dienste gesetzt, nimmt der Player das Ergebnis nur damit an:
  Das Skript fragt beim Start einmal danach (oder nimmt es aus der Umgebungsvariable `XPLORIO_PASSWORD`).
- Unveränderte Dateien werden beim nächsten Lauf übersprungen; Ctrl-C bricht ab, der nächste Aufruf macht weiter.
  Mit `--upload` oder `--player` lädt es beim Abbrechen den bisherigen Stand hoch (ein zweites Ctrl-C bricht auch das ab;
  spielt der Player gerade, holt das der nächste Lauf nach).
  Liegt die Sammlung inzwischen woanders (anderes Laufwerk, Freigabe, andere Ordnerstruktur), erkennt das Skript bereits
  analysierte Dateien an Dateiname und Größe wieder und analysiert sie nicht noch einmal.
- **Musik auf dem Player selbst:** Liegen die Dateien auf dem Player (USB-Platte oder interner Speicher), die Freigabe im
  Finder verbinden (⌘K, `smb://<player>`, nur Lesen genügt) und mit `--player` analysieren:
  `caffeinate -i python3 analyse.py --player http://<player> /Volumes/<Freigabe>/<Musikordner>`.
  Das Skript fängt dann nur eine neue Datei an, solange der Player erreichbar ist und nicht spielt; startet die
  Wiedergabe, wird Laufendes noch fertig, danach fragt es alle 10 Minuten nach (`--player-wait 20` für 20 Minuten).
  Am Ende lädt es das Ergebnis selbst zum Tag-Dienst hoch (`--upload` ist dann nicht nötig), zwischendurch alle 2 Stunden
  den bisherigen Stand, wenn der Player gerade nicht spielt (`--upload-every 60` für jede Stunde, `0` nur am Ende). Ist die Freigabe beim
  Start nicht verbunden, bricht es ab, statt die bisherigen Ergebnisse dieses Ordners zu verwerfen.
- `--seconds 120` (Standard) hört nur die mittleren zwei Minuten an (Valenz/Erregung davon die mittleren 45 s), `--jobs` legt die Zahl paralleler Prozesse fest.
- Dauer: auf einem älteren Intel-Mac rund 9 s je Datei, also etwa 5 Tage für 50.000 Titel; Apple-Silicon-Macs
  sind deutlich schneller. `--profile` zeigt die Zeit je Analyseschritt. Mehr Prozesse als Kerne bringen nichts.
- Ein Hochladen zwischendurch geht jederzeit; der Tag-Dienst nimmt dann den bisherigen Stand.
- Stürzt die Analyse bei einer Datei ab (macOS meldet dann „Python wurde unerwartet beendet“), läuft das Skript weiter
  und trägt die Datei als Fehler ein; `--retry-errors` versucht solche Dateien später erneut. Dateien über 30 Minuten
  (Mitschnitte, DJ-Mixe) lässt es aus, weil sie ganz in den Speicher geladen werden (`--max-minutes`, 0 = alle); sie zählen in der Ausgabe als „skipped“, nicht als Fehler.
- Mit ffmpeg (`brew install ffmpeg`) liest das Skript Dateien, an denen Essentia scheitert: bei einem Lesefehler, bei
  fast leerem Ergebnis und nach einem Absturz (dann die Datei noch einmal einzeln, gleich mit ffmpeg). Es sucht ffmpeg
  selbst (PATH, `/opt/homebrew/bin`, `/usr/local/bin`) und zeigt beim Start, welches es nimmt; `--ffmpeg <pfad>` wählt
  ein anderes, `--ffmpeg aus` schaltet es ab. Bisher fehlgeschlagene Dateien holt `--retry-errors` nach. Mit ffmpeg
  gelesene Titel tragen `"dec":"ffmpeg"` in `essentia.jsonl`.
- Die Ergebnisdatei `essentia.jsonl` liegt auf dem Player unter `/data/xplorio/data/` (ersetzt bei jedem Hochladen die
  vorige; alternativ per `scp` dorthin kopieren). „Bibliothek prüfen“ zeigt unter „Stimmungs-Tags“, wie viele Titel
  zugeordnet sind.

### Künstler- und Albumtexte
Die Info-Seite fragt zuerst Volumio. Kommt dort nichts (Volumio 4 gibt die Texte nur mit Abo heraus, oder Volumio antwortet
nicht binnen 6 s), holt die App den Text selbst: Album bei Last.fm (in der Sprache der Oberfläche, sonst englisch; braucht `LASTFM_KEY`),
Künstler bei Last.fm und Wikipedia, erst beide in der Sprache der Oberfläche, dann beide englisch (bei Wikipedia nur Artikel, die nach Musik aussehen). Die Quelle
steht unter dem Text. Für die Mitwirkenden gibt es keinen Ersatz.

Mitwirkende, die Volumio mit einer MusicBrainz-Kennung liefert, lassen sich antippen (ohne eigene Markierung). Das klappt darunter ihren Text
auf; nochmal Antippen des Namens oder ein Tipp auf den Text klappt ihn zu. Bei Personen gilt dieselbe Reihenfolge wie bei Künstlern (Volumio, dann Last.fm und
Wikipedia), Studios und Labels kommen nur von Volumio.

Zum laufenden Titel sucht die App in derselben Reihenfolge einen eigenen Text (Last.fm `track.getInfo`, dann ein
Wikipedia-Artikel, dessen Name der Liedname ist, der sich als Lied, Single oder Song beschreibt und den Interpreten nennt).
Zusätze wie „(Remastered 2011)“ werden dafür weggelassen. Nur wenn etwas gefunden wird, erscheint der Reiter „Titel“
hinter „Album“, beim Webradio als erster Reiter. Das Ergebnis, auch „nichts gefunden“, merkt sich der Browser je Titel (die letzten 400).
Ist die App über `LANGUAGE` oder `?lang=` auf eine andere Sprache gestellt als Volumio, holt sie die Texte zuerst selbst und fragt Volumio
nur, wenn dabei nichts herauskommt (Volumio liefert seine Texte in der eigenen Sprache).

**Gleiche Namen:** Texte, Fotos, Cover, Lyrics und Mitwirkende werden über den Namen gesucht. Gibt es einen anderen
Künstler, ein anderes Album oder einen anderen Titel mit demselben Namen, kann deshalb auch einmal die Information zum
falschen erscheinen. Ein eindeutiges MusicBrainz-Tag in den Dateien hilft Volumio; bei den eigenen Quellen (Last.fm,
Wikipedia, Deezer, LRCLIB) bleibt es beim Namen.

In der Bühnenansicht werden lange Lyrics ohne Zeitmarken etwas kleiner gesetzt; passen sie dann nicht ganz, scrollt man
selbst (sie blättern nicht von allein weiter).

### Lyrics-Versatz
Laufen synchrone Lyrics konstant zu früh oder zu spät (andere Fassung des Titels), verschieben „−“ und „+“ neben der
Überschrift „Lyrics“ (Bühnenansicht: runde Knöpfe oben rechts) den Text um je 0,5 s. Der Wert gilt für diesen Titel auf
allen Geräten (`/data/xplorio/data/lyrics-offsets.json`); Tippen auf den Wert setzt ihn auf 0 zurück.

## Rotel-Bridge (optional)
Steuert einen Rotel-Verstärker im Netz: Ein/Aus, Lautstärke und die Fernbedienung (siehe unten). Die Bridge ist ein
kleiner Dienst auf dem Player (`xplorio-rotel`, Port 8765), der die Verbindung zum Verstärker hält (TCP, Port 9590); die
Oberfläche spricht nur mit der Bridge.

**Vorbereitung am Verstärker:** Netzwerkkabel anschließen, im Menü des Verstärkers die IP-Adresse ablesen (am besten
im Router fest vergeben) und den Power Mode auf „Quick“ stellen, damit er sich aus dem Standby per Netz einschalten lässt.

**Einschalten:** Auf der Einstellungsseite des Plugins unter „Rotel-Verstärker“ die Rotel-Bridge einschalten und die
Adresse des Verstärkers eintragen, z. B. `192.168.1.50`. Das Plugin startet die Bridge beim Speichern neu. Ohne
Rotel-Bridge regelt die Oberfläche die Lautstärke von Volumio (falls dort eingeschaltet).

**Prüfen** (per ssh):
```bash
curl -s localhost:8765/state
```
Steht dort `"connected":true`, hat die Bridge den Verstärker erreicht; `"power"` und `"volume"` zeigen seinen Stand.
Bei `"connected":false` zeigt das Log den Grund (falsche Adresse, Verstärker ohne Netz):
```bash
journalctl -u xplorio-rotel -n 30 --no-pager
```
Die Oberfläche einmal neu laden; das Fernbedienungs-Symbol erscheint oben rechts in der Player-Ansicht.

### Fernbedienung
Mit `ROTEL: true` erscheint in der Player-Ansicht oben rechts ein Fernbedienungs-Symbol. Es öffnet die Seite
„Wiedergabe“ (Zahnrad-Menü) an der Karte „Verstärker“: Ein/Standby, Lautstärke und Stumm, Eingang, Klang umgehen
(Bypass), Bass, Höhen, Balance sowie Lautsprecher A und B. Die Werte kommen vom Verstärker und folgen auch der echten
Fernbedienung.

Die Befehle sind für den Rotel RA-1572 / RA-1572MKII voreingestellt (ASCII-Protokoll V2, Port 9590). Andere Modelle
in `/data/xplorio/config.local.js` (siehe [Einstellungen](#einstellungen)); was fehlt, bleibt beim Standard:
```js
window.APP_CONFIG.ROTEL_PROFILE = {
  model: 'Mein Verstärker',
  sources: [{cmd: 'pcusb', name: 'Player'}, {cmd: 'opt1', name: 'Fernseher'}, {cmd: 'phono', name: 'Plattenspieler'}],
  speakerB: false,             // false blendet ein Element aus (bypass, bass, treble, balance, speakerA, speakerB)
  powerOnSource: 'pcusb'       // Eingang nach dem Einschalten, '' = nicht umschalten
};
```
Weitere Felder: `bypass: ['bypass_on', 'bypass_off']`, `speakerA`/`speakerB` je `[an, aus]`, `bass`/`treble`
je `[höher, tiefer, Mitte]`, `balance: [rechts, links, Mitte]`, `toneMax` (Standard 10) und `balanceMax` (15).
Dasselbe ASCII-Protokoll nutzen auch andere Rotel-Geräte und die Michi-Serie von Rotel (X3, X5, P5, S5, M8); Befehle und Port (`ROTEL_AMP_PORT`) stehen im Protokoll-PDF des Geräts auf rotel.com (der P5 etwa nutzt Port 9596 statt 9590). Befehle ohne das abschließende `!`; die Bridge nimmt nur Befehle aus dem Profil an. Nach einer Änderung das Plugin
einmal aus- und wieder einschalten.

**Aktiver Eingang in der Player-Ansicht:** Ist am Verstärker ein anderer Eingang gewählt als der des Players
(`powerOnSource`, ohne Angabe `pcusb`), steht unter dem Titel statt Format und Qualität der Name des Eingangs, und statt
des Stifts ein Icon (Tippen öffnet die Fernbedienung). An Stelle des Covers steht groß das Icon des Eingangs und als Titel sein Name; Zeitleiste und Tasten sind gesperrt (die Lautstärke nicht). Wählt man in dieser Zeit in Xplorio ein Album oder einen Titel zum Abspielen, legt Xplorio es nur in die Warteschlange, ohne zu starten (ein Start ins Leere ließe Volumio ungehört durch das Album springen), und zeigt die Player-Ansicht das Album mit Cover, Künstler und Albumtitel (Titel, Titelinfo und Liedtext erst am Eingang des Players, denn am anderen Eingang läuft gerade etwas anderes), auch bei Streamingdiensten. Nach dem Umschalten auf den Eingang des Players startet ein Tipp auf Abspielen den ersten Titel. Ein Tipp auf einen Titel der Warteschlange spielt in dieser Zeit nicht, sondern nennt nur den Eingang. Die Icons folgen dem Eingang: `phono`, `cd`, `tuner`,
`bluetooth`, `usb`, `digital` (Opt/Coax), `aux` (auch XLR), `pc` (PC-USB) und `tv`. Name und Icon einzelner Eingänge
ändern, ohne die ganze Liste neu zu schreiben (gilt auch für die Fernbedienung): auf der Einstellungsseite unter
„Rotel-Verstärker“, z. B. `aux=Plattenspieler/phono, opt1=Fernseher/tv`.

## Streamingdienste (TIDAL, Qobuz, HIGHRESAUDIO, Spotify)
Die Teile für Streamingdienste (Kästchen in der Suche, ähnliche Künstler beim Dienst in den Infos, Künstler- und
Albumseiten des Dienstes) erscheinen nur, wenn das jeweilige Plugin in Volumio aktiv ist. Fest ein- oder ausschalten
auf der Einstellungsseite unter „Funktionen“ (automatisch, immer oder nie). Sind
mehrere Dienste aktiv, zeigt die Suche ihre Treffer in eigenen Abschnitten. Spotify braucht Volumios Spotify-Plugin
mit Suche (Premium-Konto); Spotify Connect allein bringt keine Suche mit. Der TIDAL-Wächter unten gilt nur für TIDAL.

## TIDAL-Wächter (optional)
Gehört nicht zum Plugin, sondern wird bei Bedarf per ssh eingerichtet (aus dem Ordner des Repos):
```bash
sudo mkdir -p /data/xplorio/tools && sudo cp tools/tidal-watchdog.sh /data/xplorio/tools/
sudo chmod +x /data/xplorio/tools/tidal-watchdog.sh
sudo /data/xplorio/tools/tidal-watchdog.sh --check      # nur prüfen
echo '*/10 * * * * root /data/xplorio/tools/tidal-watchdog.sh' | sudo tee /etc/cron.d/tidal-watchdog
```
Prüft alle 10 Minuten, ob TIDAL antwortet, und startet Volumio sonst neu (höchstens einmal je Stunde). Protokoll:
`/var/log/tidal-watchdog.log`. Ist TIDAL nicht angemeldet, den Wächter nicht einrichten.

## Endlos-Wiedergabe (AutoDJ)
Mit dem Plugin [autodj-plugin](https://github.com/Celindir69/autodj-plugin) (ab Version 1.1) bekommt der
Wiederholen-Knopf einen vierten Zustand: aus → alle → einer → ∞. Bei ∞ ist Wiederholen aus und AutoDJ an; es hängt
ähnliche Titel an, sobald die Warteschlange zur Neige geht. Der nächste Tipp schaltet AutoDJ wieder aus. Auch in
Volumio umgeschaltet zeigt der Knopf den Zustand (spätestens nach 30 s). Ohne Plugin oder ohne Last.fm-Key in den
Plugin-Einstellungen bleibt es bei drei Zuständen. AutoDJ ist bewusst ein eigenes Plugin und nicht in Xplorio
eingebaut; Xplorio spricht es nur über dessen REST-Schnittstelle an. Fehlt es, weist die Einstellungsseite von Xplorio
unter „Funktionen“ darauf hin. Die Anzeige der AutoDJ-Automatik auf der Seite „Wiedergabe“ braucht eine
AutoDJ-Version, die sie über die Schnittstelle meldet.

## Volumio 2
Der Plugin-Store für Volumio 4 nimmt nur Plugins für Debian bookworm an. Auf Volumio 2 (z. B. MX-Stream) läuft das Plugin
ebenfalls; installiert und aktualisiert wird es dort mit [`xplorio-deploy`](#installieren). Unterschiede:

- **Python:** Volumio 2 hat Python 2.7, Volumio 4 Python 3; `tags.py` läuft mit beiden, mutagen bringt der Tag-Dienst mit.
- **Infotexte:** Volumio 4 liefert Künstler- und Albumtexte nur mit Abo; die App holt sie dann bei Last.fm und Wikipedia
  (siehe [Künstler- und Albumtexte](#künstler--und-albumtexte)). Mit Last.fm-Key gibt es auch Albumtexte.
- **Nicht erprobt unter Volumio 4:** Rotel-Bridge und TIDAL-Wächter.
