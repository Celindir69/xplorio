# Xplorio auf dem Player einrichten

Xplorio ist ein Volumio-Plugin. Es legt nichts unter `/volumio` ab, Volumios Prüfung vor einem System-Update bleibt also
intakt. Das Plugin liefert die Oberfläche über einen eigenen Webserver auf Port 4040 aus. Webserver, Tag-Dienst und
Rotel-Bridge laufen als eigene systemd-Dienste (`xplorio-web`, `xplorio-tags`, `xplorio-rotel`), wie Volumio es für Plugins
vorgibt: `install.sh` richtet sie ein, das Plugin startet sie beim Einschalten und stoppt sie beim Ausschalten. Was unter
Volumio 2 anders ist, steht unter [Volumio 2](#volumio-2).

## Installieren
Anmerkung: Derzeit noch nicht im Plugin-Store verfügbar. 

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
Gibt es kein passendes Cover, zeichnet „Cover erzeugen“ ein Ersatzbild: ruhige Zufallsfarbe, Albumtitel groß,
Interpret darunter (1000 × 1000, aus denselben Feldern). Jeder Tipp ergibt eine neue Farbe; gespeichert wird es wie ein
gewähltes Bild, „als folder.jpg“ ist dabei schon angehakt. Es braucht kein Internet und nichts Zusätzliches auf dem Player.

### Eingebettete Bilder entfernen
„Bilder entfernen“ im Cover-Bereich des Album-Editors nimmt alle eingebetteten Bilder aus den angezeigten Dateien. Vorher
landet jedes Bild als Datei im Ordner: das Cover als `folder.jpg` (gibt es die schon mit anderem Inhalt, als `cover.jpg`),
dazu `back.jpg`, `booklet.jpg`, `cd.jpg` oder `image.jpg`. Ein Bild, das schon genauso im Ordner liegt, wird nicht noch
einmal gespeichert; eine vorhandene Datei wird nie überschrieben (dann mit „ (2)“). Rückgängig setzt die Bilder wieder ein
und löscht die dabei gespeicherten Dateien. Wichtig bei **DSF**: Das MPD von Volumio 2 (0.20) liest bei DSF gar keine
Tags, wenn der Tag-Block größer als 1 MB ist. Ein großes eingebettetes Cover reicht dafür; solche Alben erscheinen dann
ohne Künstler, Album und Genre. Nach dem Entfernen liest MPD die Tags beim Neueinlesen.

### Compilations
Zeigt der Album-Editor mehrere Titel, gibt es unter den gemeinsamen Feldern den Haken **„Compilation“**. Er ist gesetzt,
wenn ein Titel schon das Compilation-Tag hat (m4a `cpil`, MP3/DSF `TCMP`, FLAC `COMPILATION`) oder die Titel verschiedene
Künstler haben. Mit Haken zeigt die Titelliste pro Titel **Nr. · Titel · Künstler** mit eigenem Aa-Menü für die
Künstlerspalte; das gemeinsame Feld „Künstler“ entfällt. Wird der Haken gesetzt und ist „Album-Künstler“ leer, steht dort
„Various Artists“. Speichern schreibt das Compilation-Tag so, wie der Haken steht, in alle Titel (mit Rückgängig).
MPD 0.20 wertet das Tag nicht aus; andere Player wie die Musik-App oder Roon schon.

### Bibliothek prüfen
Im Menü (Zahnrad oben rechts, nur wenn der Tag-Dienst läuft): findet Alben ohne Cover, Compilations ohne
einheitlichen Album-Künstler, Künstler in mehreren (Vorschlag: die häufigste Schreibweise,
bereinigt um doppelte oder geschützte Leerzeichen und unsichtbare Zeichen; eine andere lässt sich stattdessen wählen) oder nicht üblicher Schreibweise, uneinheitliche Albumnamen (Vorschlag: Schreibweise
bei MusicBrainz, sonst der häufigste Name ohne CD-Zusatz; „Übernehmen“ trägt bei „Album (Disc 2)“ auch die fehlende CD-Nummer ein),
uneinheitliche oder von MusicBrainz abweichende Jahre (Vorschlag: erstes Erscheinen laut MusicBrainz, sonst das häufigste Jahr;
nachgeschlagen im Hintergrund wie für die Geburtstage, Vorschläge können sich also noch ändern; „Übernehmen“ schreibt das Datum in alle
Titel, mit Rückgängig, „Behalten“ legt den Eintrag zugeklappt ans Ende), Titel ohne Tracknummer, Titel ohne Titel-, Künstler- oder Album-Tag, unvollständige Alben (Lücken in den Tracknummern, je CD), doppelte Titel im Album, Alben mit gemischter Qualität (verlustfreie und verlustbehaftete Titel, etwa FLAC und MP3; die schlechteren stehen einzeln darunter mit ▶ und „Verschieben“ nach „Xplorio Trash“, „Behalten“ blendet das Album aus, solange die Formate gleich bleiben); der Stift öffnet den passenden Editor. Die Prüfung liest die MPD-Datenbank (`MPD_HOST`, `MPD_PORT`, Standard
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
- *Genre widerspricht der Audio-Analyse:* Alben mit eindeutigem Genre-Tag (z. B. „Hard Rock“), bei denen mindestens drei
  Titel analysiert sind und die Analyse der Kategorie des Tags höchstens 20 %, einer anderen mindestens 60 % zuordnet
  (z. B. „Tag: Hard Rock → Electronic (80 % laut Audio, Rock 10 %)“). Eine Zeile je Album; solche Alben stehen nicht
  zusätzlich unter „Genres zusammenfassen“.

In allen drei Genre-Listen stehen unter jeder Zeile zwei Knöpfe (bei „Genre fehlt“ „Übernehmen“ nur mit Vorschlag;
„Behalten“ heißt dort: bleibt ohne Genre): „Übernehmen“ schreibt den Vorschlag sofort in die Dateien
(danach „Rückgängig“; gescannt wird beim Schließen der Prüfung), „Behalten“ lässt das bisherige Tag und schlägt die
Änderung nicht mehr vor (`genre-ok.json` im Datenordner; bei Widersprüchen je Album, solange es dieses Tag hat, beim
Zusammenfassen je Änderung, z. B. „Hard Rock → Rock“). Behaltene stehen zugeklappt am Ende der Liste und lassen sich dort
mit „Wieder vorschlagen“ zurückholen.

Zeilen mit mehreren Alben haben einen Aufklapper „▸ n Alben“ mit allen betroffenen Alben (Album · Künstler, Zahl der Titel).
In der Vorschau der Mehrfachbearbeitung lässt sich jede Änderung ebenso aufklappen: jedes Album hat dort ein Häkchen
(abgewählte bleiben unverändert), ein Tipp auf den Albumnamen zeigt seine Titel.
Aus dem Album-Editor geöffnet, bietet die Mehrfachbearbeitung zusätzlich das Feld „Tracknummer“ mit der Aktion „Durchnummerieren“:
alle Titel bekommen in der Reihenfolge des Album-Editors fortlaufende Nummern 01, 02 … (ohne Gesamtzahl).
„Durchnummerieren zufällig“ vergibt dieselben Nummern 01 bis zur Anzahl der Titel in zufälliger Reihenfolge, z. B. für
einen Ordner mit gesammelten Einzeltiteln, der sonst immer alphabetisch spielt. Jede Vorschau würfelt neu.
„Aufteilen nach Muster“ zerlegt außer einem Tag auch den **Dateinamen** oder **Pfad und Dateinamen** (jeweils ohne
Endung), z. B. `%TRACK% - %ARTIST% - %TITLE%`. Beim Pfad zählen nur so viele Ordner von hinten, wie das Muster „/“
enthält: `%ARTIST%/%ALBUM%/%TRACK% %TITLE%` nimmt Künstler- und Albumordner, davor liegende Ordner brauchen kein %DUMMY%.
Muster, mit denen gespeichert wurde, merkt sich der Player (`patterns.json` im Datenordner, die letzten 20); die Auswahl
„Gespeichert“ neben dem Musterfeld setzt eines davon ein. Eigene Muster lassen sich immer eintippen. Unter den Textfunktionen
(Aa) machen „_ zu Leerzeichen“ und „- zu Leerzeichen“ aus `Tears_For_Fears` oder `Tears-For-Fears` wieder „Tears For
Fears“, etwa nach dem Aufteilen eines Dateinamens; doppelte Leerzeichen werden dabei bereinigt.

Der Stift öffnet die Mehrfachbearbeitung mit dem Vorschlag; geschrieben wird erst mit Speichern, Rückgängig geht wie
gewohnt. Neben jedem Genre-Feld im Tag-Editor steht eine Auswahl „Hauptgenre“ mit den 15 Oberkategorien; eigene Werte
lassen sich weiter eintippen. Die Unterstile („Trip Hop“, „Downtempo“) kommen nicht in die Dateien, sondern bleiben im Tag-Dienst:
`GET /genres?dir=<Ordner>` liefert Oberkategorie und Unterstile eines Albums (Stand des letzten Checks), ohne `dir` alle.
Klassik, Soundtracks und Hörspiele erkennt das Modell schwächer.

**Doppelte Alben:** Ordner mit gleichem Album-Künstler und gleichem Albumnamen. Groß-/Kleinschreibung, Akzente, „The“
und Satzzeichen zählen nicht, Zusätze wie „(Remastered)“, „[Deluxe Edition]“, „- 2009 Remaster“, „[HD]“, „(SACD)“ oder „[24-96]“ auch nicht;
Zusammenstellungen werden nur nach dem Albumnamen verglichen. Ordner eines Albums, die nach CDs getrennt nebeneinander
liegen (CD1, CD2 oder verschiedene Disc-Nummern), zählen als eine Fassung. Je Fassung stehen Format, Auflösung, Zahl der
Titel, Spielzeit und Pfad da; die beste ist markiert (verlustfrei vor verlustbehaftet, dann mehr Bit, höhere
Abtastrate, mehr Titel; bei verlustbehafteten Fassungen zuerst die höhere Datenrate, aus Dateigröße und Spielzeit
berechnet und als „MP3 320 kbps“ angezeigt, wobei AAC bei gleicher Datenrate leicht vorne liegt). ▶ spielt eine Fassung ab (ersetzt die Warteschlange), die Liste bleibt dabei offen. Tippen
auf eine Fassung öffnet sie im Album-Editor, um vorher hineinzuschauen; dort lässt sie sich ebenfalls verschieben.
„Behalten“ neben dem Albumnamen lässt alle Fassungen, wie sie sind: Die Gruppe steht dann eingeklappt am Ende der
Kategorie („Wieder vorschlagen“ holt sie zurück); kommt eine weitere Fassung dazu, erscheint sie wieder.

„Verschieben“ legt die Ordner einer Fassung in den Ordner `Xplorio Trash` auf demselben Laufwerk, mit dem
übrigen Pfad (aus `/mnt/INTERNAL/mp3/Nena/Nena` wird `/mnt/INTERNAL/Xplorio Trash/mp3/Nena/Nena`). Das geht auch bei
großen Alben sofort, und der Ordner ist über die Netzwerkfreigabe sichtbar. Damit MPD ihn nicht mit einliest, trägt
Xplorio ihn in die Datei `.mpdignore` des Laufwerks ein (z. B. `/mnt/INTERNAL/.mpdignore`); das Album verschwindet beim
nächsten Einlesen aus der Bibliothek. Xplorios eigene Albenliste (Begrüßung, Zufallsalbum, Bibliothek prüfen) lässt den
Ordner immer aus. Frühere Versionen nannten ihn `.duplicates` bzw. `Xplorio Duplicates`; der Tag-Dienst benennt ihn beim Start einmal um. Waren
verschobene Alben schon in der Bibliothek, einmal „Bibliothek aktualisieren“ in Volumio („Aktualisieren“, nicht „Neu
einlesen“), dann sind sie weg. Ist ein Passwort für die Dienste gesetzt, muss das Gerät einmal unter System bei den
Diensten angemeldet sein. Der Tag-Dienst braucht dafür Schreibrecht auf die Musikordner, wie beim Tag-Editor.

**Papierkorb** (Menü → Papierkorb, vor „Hilfe“): zeigt je Laufwerk alles in `Xplorio Trash`, mit dem
Ordner, aus dem es kam, wann und warum es verschoben wurde (doppeltes Album, doppelter Titel, schlechtere Qualität, aus
dem Album-Editor) und der Größe; der Menüeintrag zeigt Anzahl und Platz. Das Filterfeld über der Liste grenzt sie ein: jedes Wort muss im Namen, im alten Ort, im Grund oder im
Datum vorkommen; das x leert es. „Zurücklegen“ bringt ein Album oder einen Titel
an den alten Ort, und MPD liest genau diesen Ordner neu ein. Liegt dort inzwischen etwas mit gleichem Namen, wird nichts
überschrieben; ein Album, dessen Ordner wieder da ist, bekommt seine Dateien dazu. Ein Tipp auf einen
Ordner klappt seine einzelnen Dateien auf, jede lässt sich für sich zurücklegen oder löschen. Der Mülleimer löscht einen Eintrag
endgültig, „Leeren“ den ganzen Papierkorb eines Laufwerks, jeweils nach Rückfrage. Gelöscht wird nur innerhalb von
`Xplorio Trash`, das Passwort gilt wie beim Verschieben. Grund und Zeit merkt sich der Tag-Dienst ab dieser Version
(`trash.json` im Datenordner); was schon vorher im Papierkorb lag, erscheint ohne Grund, je Ordner ein Eintrag, mit dem
Pfad ohne `Xplorio Trash` als altem Ort. Unter „Doppelte Alben“ führt „Papierkorb öffnen“ direkt hierher. Per ssh geht es auch von Hand, z. B.
`sudo rm -rf '/mnt/INTERNAL/Xplorio Trash'`.

**Fehlende Titel ergänzen:** Hat eine andere Fassung Titel, die in der besten nicht vorkommen (gleicher Künstler und
Titel, verglichen wie bei den doppelten Titeln; ein abgeschnittener Titel wie „The More You Live, The More Yo“ zählt als
derselbe, ein Zusatz wie „(Remix)“ nicht), steht unter der besten Fassung „n Titel fehlen“ mit einer Liste zum Anhaken:
Titel, Format und Herkunft, schlechtere Qualität (z. B. MP3 für ein FLAC-Album) ist markiert. Vorab angehakt sind nur
Titel, deren Track- und CD-Nummer in der besten Fassung frei ist; ist sie belegt, steht der dortige Titel dabei
(„Nr. 3 vorhanden: …“), denn oft ist es derselbe Titel in anderer Schreibweise. „Ausgewählte ergänzen“ kopiert die
angehakten in den Ordner der besten Fassung, bei CD-Ordnern in den mit derselben CD-Nummer (fehlt eine ganze CD, in einen
neuen Ordner wie `CD3`). Album, Albumkünstler, Jahr und Genre der Kopien kommen von der besten Fassung, Titel, Künstler,
Track- und CD-Nummer bleiben. Die Originale bleiben, wo sie sind, und vorhandene Dateien werden nie überschrieben.
„Rückgängig“ löscht die Kopien wieder, solange sie seitdem nicht geändert wurden. Danach lässt sich die andere Fassung wie
oben in `Xplorio Trash` verschieben.

**Album verschieben im Album-Editor:** Zeigt der Album-Editor ein ganzes Album (Stift auf der Albumseite, in Albumlisten,
in der Suche oder in der Bibliotheksprüfung), steht unter den Titeln „Album verschieben“. Das legt den ganzen Albumordner
(mit CD-Unterordnern) genauso in `Xplorio Trash`, auch wenn es keine Dublette ist. Verschieben lassen sich nur
Albumordner, die der Tag-Dienst aus der Bibliothek kennt.

**Album auf mehrere Ordner verteilt:** Gleicher Album-Künstler und Albumname in mehreren Ordnern, die aber keine Kopien
sind, sondern Teile eines Albums: Jeder Ordner enthält nur Titel dieses Albums (Sammelordner mit anderen Alben zählen nicht),
alle haben dasselbe Format, und kein Titel und keine Titelnummer kommt in zwei Ordnern vor. Solche Fälle stehen hier und
nicht mehr unter „Doppelte Alben“. Der Ordner mit den meisten Titeln ist das Ziel. „Dateimanager“ neben einem anderen
Ordner öffnet den Dateimanager (Passwort der Dienste) mit diesem Ordner links und dem Ziel rechts; dort die Dateien
hinüberziehen. Der Pfeil zurück führt wieder in die Bibliotheksprüfung, beim nächsten Prüflauf ist der Eintrag weg.
„Behalten“ lässt gewollt getrennte Ordner in Ruhe.

**Doppelte Titel im Album:** Titel, die in einem Album (mit CD-Unterordnern) mehrfach vorkommen. Sicher doppelt: Kopie-Namen
wie `01 Song (1).flac` oder `01 Song Kopie.flac` neben `01 Song.flac`, derselbe Titel in zwei Formaten (`01.flac` und
`01.mp3`) und gleicher Künstler und Titel mit gleicher Spielzeit (±2 s). Gedämpft als Hinweis: gleicher Titel mit anderer
Spielzeit und gleiche CD- und Tracknummer mit anderem Titel. Groß-/Kleinschreibung, Satzzeichen, führende Nummern und
Remaster-Zusätze zählen nicht, andere Zusätze wie „(Live)“ schon; gleiche Titel verschiedener Künstler (Compilations)
werden nicht gemeldet. Je Gruppe steht die beste Datei oben (verlustfrei vor verlustbehaftet, bei verlustbehafteten
die höhere Datenrate, dann ohne Kopie-Namen, dann die ältere). ▶ spielt eine Datei, „Verschieben“ legt sie mit dem übrigen Pfad in `Xplorio Trash`, „Behalten“ blendet
die Gruppe dauerhaft aus.

**Künstler nicht in üblicher Schreibweise:** Der Tag-Dienst gleicht im Hintergrund jeden Künstler und Albumkünstler einmal
mit MusicBrainz ab (höchstens eine Anfrage alle 1,5 s, langsamer solange die Erscheinungsdaten geholt werden); findet
MusicBrainz nichts Passendes, fragt er Last.fm (nur mit Last.fm-Schlüssel). Vorgeschlagen wird nur eine andere
Schreibweise desselben Namens (Groß-/Kleinschreibung, Akzente, Umlaute, „The“, Satzzeichen, & / und) oder ein bei
MusicBrainz bekannter anderer Name dieses Künstlers, nie ein anderer Name. Kombinationen wie „A feat. B“ oder „A vs. B“
werden erst als Ganzes gesucht, ohne Treffer jeder Name einzeln, und der Vorschlag setzt sie wieder zusammen. Je Vorschlag
stehen die vorhandenen Schreibweisen mit Anzahl Titel; „Übernehmen“ schreibt die übliche Schreibweise in Künstler und
Albumkünstler aller betroffenen Titel (mit Rückgängig), „Ignorieren“ behält die vorhandene Schreibweise. Was hier steht,
erscheint nicht noch einmal unter „Künstler in mehreren Schreibweisen“. Ergebnisse liegen in `artistnames.jsonl`; Namen
ohne Treffer werden nach 90 Tagen erneut gesucht. Abschalten mit `ARTISTNAMES: false` in `config.local.js`.

### Dateimanager

Menü → Dateimanager: zwei Spalten mit den Ordnern unter INTERNAL, USB und NAS, um zur Not in die Ablage einzugreifen,
z. B. einzelne Titel aus verschiedenen Alben in eigene Ordner zu sortieren. Er ist mit dem Passwort für die Dienste
geschützt (siehe System → Dienste); ohne gesetztes Passwort öffnet er sich nicht, und der Tag-Dienst lehnt jeden Zugriff ab.
Ein Gerät, das schon unter System angemeldet ist, kommt direkt hinein, sonst fragt der Dateimanager einmal nach dem Passwort.

- **Auswählen:** Häkchen vor Dateien und Ordnern; ein Tipp auf eine Datei hakt sie an, ein Tipp auf einen Ordner öffnet ihn.
  Ausgewählt wird immer nur in einer Spalte, die andere ist das Ziel. Das Kästchen oben links in der Spalte hakt alles
  im offenen Ordner an oder ab. Ist der Pfad zu lang, werden die vorderen Abschnitte auf drei Zeichen gekürzt
  (der volle Name erscheint beim Darüberfahren).
- **Kopieren, Verschieben:** Die Knöpfe unten wirken auf den Ordner, der in der anderen Spalte offen ist. Am Computer geht es
  auch per Drag & Drop, auf einen Ordner oder in die freie Fläche einer Spalte: Loslassen verschiebt, mit gedrückter
  ⌥-Taste (Windows: Alt oder Strg) wird kopiert. Vor dem Ausführen kommt immer eine Rückfrage.
- **Neuer Ordner:** das Ordnersymbol mit Plus oben in jeder Spalte.
- **Umbenennen:** erscheint unten, wenn genau ein Eintrag angehakt ist. Ein Name, den es im Ordner schon gibt, wird
  abgelehnt; nur Groß- und Kleinschreibung zu ändern geht auch auf USB-Platten und NAS. Bewertungen, NoMix und der
  Verlauf ziehen mit.
- **Tags:** Der Stift neben einer Audiodatei öffnet den Tag-Editor für sie, der Dateimanager bleibt dahinter offen
  und liest beide Spalten neu ein, wenn der Editor schließt. Sind nur Audiodateien angehakt, bearbeitet „Tags bearbeiten“
  unten alle zusammen.
- **Album und Album-Künstler** stehen klein unter dem Namen einer Audiodatei. Sie kommen aus der Datenbank von MPD,
  es wird also keine Datei geöffnet; Dateien, die MPD noch nicht eingelesen hat, haben die Zeile nicht.
- **Bilder:** JPG, PNG, GIF, WebP und BMP (z. B. `folder.jpg`) zeigen statt des Symbols eine kleine Vorschau; ein Tipp
  darauf zeigt das Bild groß mit Größe in Pixeln, ein Tipp daneben oder Esc schließt es.
- **Lange Listen:** Passt eine Liste nicht in die Spalte, erscheint am äußeren Rand (links in der linken, rechts in der
  rechten Spalte) eine Leiste #, 0–9, A–Z. Ein Tipp springt zum ersten Eintrag mit diesem Anfang (Umlaute wie der
  Grundbuchstabe, # für Sonderzeichen); Wischen über die Leiste geht auch.
- **Papierkorb, leere Ordner:** Der Mülleimer legt die Auswahl in `Xplorio Trash` ihres Laufwerks (zurücklegen über den
  Papierkorb). „Leere Ordner löschen“ erscheint, wenn nur Ordner ausgewählt sind. Gelöscht wird ein Ordner samt Unterordnern
  nur, wenn darin auf keiner Ebene eine Datei liegt; Reste von Mac und Windows (`.DS_Store`, `._`-Dateien, `Thumbs.db`,
  `desktop.ini`) zählen nicht und gehen mit. Jede andere Datei, auch eine versteckte wie `.mpdignore`, verhindert das
  Löschen, und die Meldung nennt sie.

Regeln: Es wird nichts überschrieben; gibt es einen Namen im Ziel schon, bekommt die Kopie „(2)“, „(3)“ usw. Verschieben
innerhalb eines Laufwerks ist ein Umbenennen und sofort fertig. Zwischen Laufwerken (z. B. USB → NAS) wird zuerst kopiert,
jede Datei auf ihre Größe geprüft, und erst danach kommt das Original in den Papierkorb seines Laufwerks; bricht die
Verbindung ab, fehlt also nichts. Kopiert wird im Hintergrund mit niedriger Festplatten-Priorität (`ionice`), immer nur ein
Auftrag zugleich, mit Fortschritt und „Abbrechen“ (hält nach der aktuellen Datei an). `Xplorio Trash` und versteckte Dateien
zeigt der Dateimanager nicht, Verknüpfungen, die aus dem Laufwerk herausführen, auch nicht.

Danach liest MPD genau die betroffenen Ordner neu ein. Beim Verschieben ziehen Bewertungen, NoMix-Markierungen, die
„Behalten“-Markierungen der Bibliotheksprüfung und der Verlauf mit an den neuen Ort. Volumio-Playlisten und
Favoriten merken sich dagegen den alten Pfad: Verschobene Titel fehlen dort und müssen neu hinzugefügt werden.

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
`/proc`, `/sys` und `df`; er misst alle 10 Sekunden und nur bei offener Seite alle 2 Sekunden (eine kleine Datei, ohne spürbare Last) und sichert den Verlauf alle
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
und Smart Playlists (`/data/smart_playlists_data/smart_playlists.debug.log`), sobald es sie gibt. Stürzt der Tag-Dienst einmal ab, steht der Fehler mit Uhrzeit zusätzlich unter „Abstürze Tag-Dienst“ (`/data/xplorio/data/crash.log`, nur die letzten 32 KB); das Journal ist nach einem Neustart des Players leer, diese Datei nicht. Die Karte zeigt zuerst nur die Quellen; ein Tipp lädt das Protokoll, ein zweiter klappt es wieder zu. Das Suchfeld darüber zeigt nur Zeilen mit dem eingegebenen Text (z. B. `error`, Groß-/Kleinschreibung egal), auch bei „Live“. „Live“ holt alle 3 Sekunden
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
Im Menü unter „Wiedergabe“: **Crossfade** an, aus oder automatisch, mit einer Dauer von 1 bis 60 Sekunden, und **Lautstärke angleichen**
(ReplayGain) mit Aus, Titel, Album oder Automatisch. Beides stellt der Tag-Dienst direkt in MPD um, ohne Neustart;
ReplayGain wirkt nur bei Dateien mit ReplayGain-Tags. **Crossfade automatisch** blendet innerhalb eines Albums nicht über, beim Wechsel zu einem anderen Album und in Mixen schon
(auch bei Zufallswiedergabe, maßgeblich ist der tatsächlich nächste Titel). **ReplayGain automatisch** entscheidet bei jedem Titel neu: Stammt der Titel davor
oder danach in der Warteschlange vom selben Album, gilt der Album-Wert, sonst (Mixe, einzelne Titel, Zufallswiedergabe) der
Titel-Wert. MPDs eigenes „auto“ schaut nur auf den Zufallsschalter und spielt Mixe in normaler Reihenfolge mit Album-Wert.
Steht Volumio auf „auto“, übernimmt Xplorio das ebenfalls; stellt jemand anderes (etwa AutoDJ) einen festen Modus ein,
endet die Automatik. Volumios eigene
Normalisierung (`volume_normalization`, gleicht auch ohne Tags an, verändert aber die Dynamik) zeigt die Seite nur an;
umgestellt wird sie in Volumio unter Einstellungen → Wiedergabe-Optionen. Ist das AutoDJ-Plugin installiert, zeigt die Seite,
ob dessen Automatik für Crossfade und Angleichen an ist: Wer beides hier einstellt, sollte sie im Plugin ausschalten, sonst
stellt AutoDJ die Werte beim nächsten neuen Mix um. Ob Volumio Crossfade und ReplayGain-Modus nach einem Neustart
zurücksetzt, ist noch nicht geprüft.

Ist ReplayGain an, zeigt der Player neben dem Dateiformat den Wert, den MPD gerade auf den Titel anwendet (etwa „−6.5 dB“);
der Tooltip sagt, ob es der Titel- oder der Album-Wert ist. Ohne ReplayGain-Tags in der Datei bleibt die Anzeige leer.

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

**Beste Treffer (MyVolumio Premium).** Ist MyVolumio Premium aktiv (Volumio 4), zeigt die Suche oben bis zu acht Titel
aus Volumios SuperSearch: eine nach Relevanz sortierte Auswahl aus allen Quellen, mit der Quelle neben dem Interpreten.
Darunter folgen die Ergebnisse wie bisher. Die Häkchen für Lokal und die Streamingdienste gelten auch hier.

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
Warteschlange, in der Titelliste eines Albums und in den Mix-Listen (Mood-Mix, „Mehr wie dieser Titel“, „Passt zusammen“;
dort außerdem Stift, ✕ zum Herausnehmen, und ein Tipp spielt ab diesem Titel); ein Tipp schaltet weiter von neutral (Umriss) über
„mag ich“ (Daumen hoch) zu „mag ich nicht“ (Daumen runter) und zurück. „Mag ich“ ist dasselbe wie ein Favorit in Volumio:
Der Daumen legt den Titel in die Volumio-Favoriten, und vorhandene Favoriten zeigen den Daumen hoch. Herzen, Sterne und
„mag ich nicht“ speichert der Tag-Dienst in `/data/xplorio/data/ratings.json`. Titel mit „mag ich nicht“ lassen
Würfel, Mood Mix und die Titel-Reihen beim Entdecken aus.

**NoMix** (nur mit Tag-Dienst): Steht `NoMix` irgendwo im Kommentar eines Titels (Groß-/Kleinschreibung egal), kommt er in
keinen Mix (Würfel, Mood Mix, ähnliche Titel, „Passt zusammen“; nicht in die Titel von AutoDJ), unabhängig von der Bewertung; beim Entdecken und in
Alben bleibt er. Am einfachsten setzt es der Knopf „NoMix“ rechts neben dem Kommentarfeld im Tag-Editor: Er hängt „--NoMix“ an
(nach einem Leerzeichen, falls schon ein Kommentar dasteht), noch einmal getippt nimmt er es wieder heraus. Für ein
ganzes Album mit unterschiedlichen Kommentaren hängt er es beim Speichern an jeden einzelnen an, die Kommentare bleiben
erhalten. In der Massenbearbeitung (Feld „Kommentar“) ersetzt „Setzen“ dagegen den bisherigen Kommentar. MPD liefert den Kommentar nicht mit, deshalb erfährt der
Tag-Dienst davon auf zwei Wegen: Was über Xplorio geschrieben wird, merkt er sich sofort (`nomix.json`); Kommentare aus
anderen Programmen liest die [Audio-Analyse](#audio-analyse-mit-essentia-optional-auf-mac-oder-windows-pc) beim nächsten
Lauf mit (die geänderte Datei wird dabei neu analysiert).

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
Stimmungs-Tags, verglichen mit den übrigen Künstlern der Sammlung). Dasselbe Obergenre allein genügt nicht: Die Künstler
müssen einen Stil gemeinsam haben (etwa „Trip Hop“, nicht nur „Electronic“), oder Last.fm nennt sie als ähnlich. Die Ähnlichkeit
wird in Teilen bewertet: Stile 45 %, Stimmungen 25 %, Tempo und Energie 20 %, Genre 10 %. Mittleres Tempo (halbes oder
doppeltes zählt als gleich) darf höchstens rund 15 % auseinanderliegen, die mittlere Energie höchstens eine Stufe. Nennt Last.fm einen davon als ähnlichen Künstler,
zählt das mit (nur mit Last.fm-Key), seltener Gehörte bekommen einen kleinen Vorsprung. Jede Kachel zeigt die Fotos der
Künstler und was sie verbindet. Ein Tipp öffnet die Vorschau: etwa 25 Titel, rund 40 % Lieblingstitel (oft gehört,
Favorit oder Album mit 4–5 Sternen) und der Rest selten oder nie gehört (nie Gehörtes ist mit „neu“ markiert); die Künstler wechseln sich ab,
Energie und Tempo gehen sanft ineinander über. „Mix abspielen“ ersetzt die Warteschlange, der Würfel zieht einen neuen
Mix, + hängt ihn an. Die Mixe bleiben den ganzen Tag gleich, ↻ würfelt neue. Der Tag-Dienst merkt sich die gezeigten
Paarungen sieben Tage in `/data/xplorio/data/together.json`, damit sie sich nicht gleich wiederholen; reichen die neuen
Paarungen nicht für sechs Kacheln, füllt er mit Paarungen der letzten Tage auf. Nicht dabei:
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

**Albumversionen** (Tag-Dienst): Liegt ein Album in mehreren Ordnern (z. B. FLAC 24/96, CD-Rip und MP3), öffnet die
Albumseite zuerst eine Zwischenebene: statt „Abspielen“ steht dort „Beste abspielen“ (die Version in bester Qualität),
statt „Titel“ der Reiter „Versionen“; „Entdecken“ und „Hintergrund“ bleiben. Jede Version zeigt ihren Albumnamen, das
Qualitätsabzeichen wie im Player (Hi-Res, Lossless, DSD, Lossy) mit Abtastrate, Bittiefe und Dateiart, Zahl der Titel,
Spielzeit und Pfad; die beste ist markiert. Antippen öffnet die Version mit ihren Titeln, der Pfeil zurück führt wieder zur
Auswahl. Zusammengefasst wird wie bei den [doppelten Alben](#bibliothek-prüfen) (gleicher Album-Künstler und Albumname,
Zusätze wie „(Deluxe Edition)“ zählen nicht). Bewertungen und Verlauf gelten weiter je Version. In Albenlisten (Künstlerseite,
Suche, Genre, Jahr, Jahrzehnt) steht ein solches Album nur einmal, unter dem Namen ohne Zusätze (aus „Abbey Road [HD]“ wird
„Abbey Road“), mit einem Stapel-Symbol und der Zahl der Versionen hinter dem Titel; gezeigt wird die beste Version, die in der Liste vorkommt. In Mixen (Würfel, Ähnliche, Stimmungsmix,
„Zusammen“) spielt je Album nur eine Version: die mit den meisten Sternen, ohne Sterne die in bester Qualität. Titel, die
es nur in einer anderen Version gibt (Bonustitel), bleiben im Mix.

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
Passen nicht alle Genres auf den Bildschirm (und sind es mehr als zwölf), steht darüber die Reihe „Zufällige Genres“;
↻ zieht sie neu.
Ein Tipp öffnet die Genre-Seite: Gibt es [Audio-Analysen](#audio-analyse-mit-essentia-optional-auf-mac-oder-windows-pc), zuerst Kacheln
der Stilrichtungen (Discogs-Unterstile, z. B. „Trip Hop“ unter Electronic) mit „Alle“ davor, sonst gleich alle Alben des
Genres, nach Künstler sortiert. Je Album zählen bis zu drei Unterstile seines Genres, gemittelt über die analysierten Titel (der stärkste immer,
weitere ab 15 %); die Albenliste zeigt sie mit ihrem Anteil, z. B. „Hard Rock 78 % · Heavy Metal 22 %“.
Alben ohne Analyse stehen nur unter „Alle“. Die Suche findet auch Unterstile. Als Genre eines Albums gilt sein
häufigstes Genre-Tag (aus der Albenliste). Auf der Albumseite stehen Künstler, Album und Genre untereinander; Künstler und
Genre öffnen ihre Seite. Stammen die Titel von verschiedenen Künstlern (Compilation) oder weicht ein Titel-Künstler vom
Album-Künstler ab (z. B. „feat.“), steht der Künstler klein unter jedem Titel. Nennt Volumio
eine solche Compilation nach einem ihrer Künstler (meist fehlt der Album-Künstler), steht oben „Various Artists“. In Albumlisten steht das Genre klein vor dem Stift, in der Player-Ansicht klein unter der
Qualitätsangabe, mit dem stärksten Stil des Albums in Klammern, z. B. „Rock (Hard Rock)“ (ein Tipp öffnet die
Genre-Seite, auf den Stil die Alben dieses Stils). Genre-Tags vereinheitlichen und ergänzen hilft
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
- Einträge unter Pfaden, die nicht mehr angegeben sind (anderer Laufwerksname, alte Ordner), bleiben in `essentia.jsonl`
  stehen, damit ein gerade nicht verbundenes Laufwerk seine Ergebnisse behält. Der Player lädt sie trotzdem in den
  Speicher. `--prune` entfernt beim Lauf alles außerhalb der angegebenen Ordner; vorher legt es `essentia.jsonl.bak` an.
  Dafür alle Musikordner angeben, sonst fallen die Ergebnisse der fehlenden weg.
- Neue Musik vorab auf dem Mac analysieren: in einem Import-Ordner ablegen, mit
  `python3 analyse.py --keep-missing --upload http://<player>:8766 ~/Music/<Import-Ordner>` analysieren und danach auf
  den Player kopieren (z. B. `rsync -av ~/Music/<Import-Ordner>/ volumio@<player>:/mnt/USB/<Ordner>/`). Ohne
  `--keep-missing` hält der nächste Lauf die inzwischen weggeräumten Dateien für gelöscht und entfernt ihre Ergebnisse.
  Ein späterer Lauf über die ganze Bibliothek erkennt sie an Dateiname und Größe wieder und analysiert sie nicht erneut.
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
des Stifts ein Icon (Tippen öffnet die Fernbedienung). An Stelle des Covers steht groß das Icon des Eingangs und als Titel sein Name; Zeitleiste und Tasten sind gesperrt (die Lautstärke nicht). Wählt man in dieser Zeit in Xplorio ein Album oder einen Titel zum Abspielen, legt Xplorio es nur in die Warteschlange, ohne zu starten (ein Start ins Leere ließe Volumio ungehört durch das Album springen), und zeigt die Player-Ansicht das Album mit Cover, Künstler und Albumtitel (Titel, Titelinfo und Liedtext erst am Eingang des Players, denn am anderen Eingang läuft gerade etwas anderes), auch bei Streamingdiensten. In der Bühnenansicht steht an Stelle der Lyrics die Titelliste des Albums. Nach dem Umschalten auf den Eingang des Players startet ein Tipp auf Abspielen den ersten Titel. Ein Tipp auf einen Titel der Warteschlange spielt in dieser Zeit nicht, sondern nennt nur den Eingang. Die Icons folgen dem Eingang: `phono`, `cd`, `tuner`,
`bluetooth`, `usb`, `digital` (Opt/Coax), `aux` (auch XLR), `pc` (PC-USB) und `tv`. Name und Icon einzelner Eingänge
ändern, ohne die ganze Liste neu zu schreiben (gilt auch für die Fernbedienung): auf der Einstellungsseite unter
„Rotel-Verstärker“, z. B. `aux=Plattenspieler/phono, opt1=Fernseher/tv`.

## Streamingdienste (TIDAL, Qobuz, HIGHRESAUDIO, Spotify)
Die Teile für Streamingdienste (Kästchen in der Suche, ähnliche Künstler beim Dienst in den Infos, Künstler- und
Albumseiten des Dienstes) erscheinen nur, wenn das jeweilige Plugin in Volumio aktiv ist. Fest ein- oder ausschalten
auf der Einstellungsseite unter „Funktionen“ (automatisch, immer oder nie). Sind
mehrere Dienste aktiv, zeigt die Suche ihre Treffer in eigenen Abschnitten. Spotify braucht Volumios Spotify-Plugin
mit Suche (Premium-Konto); Spotify Connect allein bringt keine Suche mit. Der TIDAL-Wächter unten gilt nur für TIDAL.

In der Albumansicht eines eigenen Albums sucht Xplorio kurz nach dem Öffnen bei den aktiven Diensten nach demselben
Album. Hat ein Dienst es mit mehr Titeln (etwa weil hier Titel fehlen), erscheint unter „Abspielen“ eine zweite Zeile
„Vollständig bei Qobuz“, die das Album beim Dienst spielt. Gesucht wird einmal je Album und Sitzung; auch eine
Deluxe-Ausgabe mit Bonustiteln kann so erscheinen, wenn der Dienst nur sie anbietet.

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

## Endlos-Wiedergabe (AutoDJ oder Continuous Play)
Mit dem Plugin [autodj-plugin](https://github.com/Celindir69/autodj-plugin) (ab Version 1.1) bekommt der
Wiederholen-Knopf einen vierten Zustand: aus → alle → einer → ∞. Bei ∞ ist Wiederholen aus und AutoDJ an; es hängt
ähnliche Titel an, sobald die Warteschlange zur Neige geht. Der nächste Tipp schaltet AutoDJ wieder aus. Auch in
Volumio umgeschaltet zeigt der Knopf den Zustand (spätestens nach 30 s). Ohne Plugin oder ohne Last.fm-Key in den
Plugin-Einstellungen bleibt es bei drei Zuständen. AutoDJ ist bewusst ein eigenes Plugin und nicht in Xplorio
eingebaut; Xplorio spricht es nur über dessen REST-Schnittstelle an. Fehlt es, weist die Einstellungsseite von Xplorio
unter „Funktionen“ darauf hin. Die Anzeige der AutoDJ-Automatik auf der Seite „Wiedergabe“ braucht eine
AutoDJ-Version, die sie über die Schnittstelle meldet.

Ohne AutoDJ schaltet ∞ das Continuous Play von MyVolumio Premium (Volumio 4), falls vorhanden. Sind beide da, hat
AutoDJ Vorrang, und beim Einschalten von ∞ schaltet Xplorio Continuous Play aus, damit nicht beide Titel anhängen.
Wer stattdessen Continuous Play über ∞ nutzen will, deaktiviert das AutoDJ-Plugin in Volumio unter „Installierte
Plugins“.

## Smart-Playlisten
Mit dem Plugin [Smart Playlists](https://github.com/Celindir69/smart-playlist-plugin) (ab Version 1.1) lassen sich
dessen Regeln in Xplorio bearbeiten. Im Reiter „Playlisten“ tragen die vom Plugin erstellten Playlisten ein eigenes
Symbol vor dem Namen und rechts einen Stift; oben rechts öffnet ein Plus mit Sternen eine neue Smart-Playlist. Ohne Plugin erscheint nichts davon.

Im Editor:
- **Name**: Pflicht. Xplorio schlägt ihn aus den gewählten Künstlern vor (bei „Alle Künstler“ aus Genre und Jahren),
  bis er von Hand geändert wird.
- **Künstler**: Suche in der eigenen Bibliothek; ein Tipp auf einen Treffer nimmt ihn in die Liste, der Mülleimer
  nimmt ihn wieder heraus. „Alle Künstler“ für Listen wie „70er Rock“ oder „Neu hinzugefügt“.
- **Filter**: Jahre von–bis (wahlweise das ursprüngliche Erscheinungsjahr), Genre (mehrere mit `;`, eines genügt),
  „Albumtitel enthält nicht“ (z. B. Live), hinzugefügt in den letzten Tagen, Titel auf Compilations, doppelte Titel
  entfernen, Reihenfolge und Höchstzahl der Titel. „Gemischt“ (ab Plugin-Version 1.3) ist Zufall mit Regeln wie beim
  Würfel: jeder Künstler etwa gleich oft, auch wenn die Höchstzahl kürzt, nie zweimal derselbe hintereinander, seine
  Alben im Wechsel. „Zufällig“ mischt rein zufällig.
- **Regel**: zeigt die erzeugte Zeile und lässt sich direkt bearbeiten, mit der Syntax des Plugins darunter. Nutzt
  eine Regel Filter, die die Felder nicht darstellen können (z. B. `title~Love`), bleiben die Felder grau und nur die
  Zeile ist bearbeitbar.
- **Vorschau**: lässt das Plugin nur diese Regel probeweise durchrechnen und zeigt, wie viele Titel passen. Die
  echten Playlisten bleiben dabei unberührt.

„Speichern“ schreibt die Regel ins Plugin und startet einen Lauf, erst der erstellt die Playlist. „Löschen“ entfernt
Regel und Playlist. Die Regeln bleiben im Plugin; dessen Einstellungsseite in Volumio zeigt dieselben Zeilen. Von Hand
geänderte Inhalte einer Smart-Playlist überschreibt der nächste Lauf.

## Wiedergabe auf dem Handy (Stream-Ausgang)
Hat MPD einen Stream-Ausgang (`httpd`), erscheint oben rechts ein Kopfhörer-Knopf. Ein Tipp schaltet zwischen
**Anlage** und **nur dieses Gerät** um: Der Verstärker-Ausgang geht aus, und die Musik kommt aus dem Handy, Tablet oder
Rechner, auf dem Xplorio gerade offen ist. Der nächste Tipp schaltet zurück auf die Anlage. Bedient wird wie gewohnt:
Warteschlange, Abspielen, Pause und Lautstärke am Gerät. Die Einstellung gehört zum Player; jedes offene Xplorio zeigt
sie an (spätestens nach 10 s). Ton gibt es aber nur auf Geräten, die es selbst gewählt haben; auf den anderen ist der
Knopf gedimmt, und ein Tipp dort hört mit, ohne etwas umzuschalten. Auf iPhone und iPad startet der Ton erst nach einem
Tipp irgendwo in Xplorio. Hört eine Minute lang niemand zu, schaltet der Player von selbst zurück auf die Anlage, damit
er nie stumm bleibt. Startet Volumio MPD neu (etwa beim Speichern im Plugin), sind danach Anlage und Stream beide an; auch
dann schaltet Xplorio den Stream nach einer Minute ohne Zuhörer wieder ab. Solange ein Gerät mithört, zeigt die Qualitätsanzeige dort
„Stream“ und das Format des Streams (z. B. MP3 · 192 kbps) statt der Werte der Datei. Steht der Rotel dabei auf einem
anderen Eingang (jemand daheim hört etwa Phono), sind Lautstärke und Ein/Aus im Player gesperrt; ein Tipp sagt nur, warum.

**Einrichten unter Volumio 4:** das Plugin „MPD HTTP & Icecast output“ ([mpd-output](https://github.com/foonerd/mpd-output))
aus dem Plugin-Store installieren und in seinen Einstellungen den HTTP-Stream einschalten, am besten mit Encoder MP3
(spielt auf allen Geräten, auch in Safari). Xplorio findet den Stream in `/etc/mpd.conf` von selbst; den internen
Zubringer, den das Plugin für Icecast anlegt, lässt es aus. Derselbe Stream ist auch ohne Xplorio unter
`http://<Player>:<Port>/` zu hören, etwa in VLC, solange er eingeschaltet ist; dauerhaft an bleibt er mit „Anlage und
dieses Gerät“ (Aufruf mit `?player=both`).

**Unter Volumio 2** (MX-Stream) gibt es das Plugin nicht im Store. `tools/mpdoutput-volumio2.sh` lädt es von GitHub,
passt zwei Stellen für Node 8 an und installiert es über Volumio (braucht ein installiertes Xplorio):
```
curl -fsSLO https://raw.githubusercontent.com/Celindir69/xplorio/main/tools/mpdoutput-volumio2.sh
sudo bash mpdoutput-volumio2.sh
```
Danach weiter wie unter Volumio 4. Ohne Plugin den Ausgang von Hand in Volumios Vorlage
`/volumio/app/plugins/music_service/mpd/mpd.conf.tmpl` eintragen (nicht in `/etc/mpd.conf`, die Volumio neu schreibt)
und Volumio neu starten:
```
audio_output {
  type      "httpd"
  name      "Mobile"
  encoder   "lame"
  port      "8000"
  bitrate   "192"
  format    "44100:16:2"
  always_on "yes"
  tags      "yes"
}
```
Ein Volumio-Update überschreibt die Vorlage; dann den Block erneut eintragen.

Gut zu wissen:
- Der Ton kommt einige Sekunden später als auf der Anlage (Puffer im Browser).
- Im Stream ist alles, was über MPD läuft: Bibliothek, Webradio, Qobuz und TIDAL über Volumio. Spotify Connect,
  AirPlay und Bluetooth laufen an MPD vorbei und fehlen.
- Der Knopf schaltet MPDs Ausgänge, nicht das Plugin; dessen Einstellungen bleiben unverändert.

## Volumio 2
Der Plugin-Store für Volumio 4 nimmt nur Plugins für Debian bookworm an. Auf Volumio 2 (z. B. MX-Stream) läuft das Plugin
ebenfalls; installiert und aktualisiert wird es dort mit [`xplorio-deploy`](#installieren). Unterschiede:

- **Python:** Volumio 2 hat Python 2.7, Volumio 4 Python 3; `tags.py` läuft mit beiden, mutagen bringt der Tag-Dienst mit.
- **Infotexte:** Volumio 4 liefert Künstler- und Albumtexte nur mit Abo; die App holt sie dann bei Last.fm und Wikipedia
  (siehe [Künstler- und Albumtexte](#künstler--und-albumtexte)). Mit Last.fm-Key gibt es auch Albumtexte.
- **Nicht erprobt unter Volumio 4:** Rotel-Bridge und TIDAL-Wächter.
