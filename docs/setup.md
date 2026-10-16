# Setting Up Xplorio on the Player

All commands are run on the player (via SSH), as a user with `sudo` privileges. Written for Volumio 2; everything that differs under Volumio 4 is collected under [Volumio 4](#volumio-4).

## Interface

Copy `xplorio.html`, `app.html` and `web/` to `/volumio/http/www3/`, then open `http://<player>/xplorio.html` (`app.html` is the former name and only redirects, so old bookmarks and home-screen shortcuts keep working).

Copy `kioskTV.html` next to `xplorio.html` (the kiosk loads `http://localhost:3000/kioskTV.html`, i.e. from the folder Volumio serves).

After an update with `xplorio-deploy`, the browser loads the new files by itself (the script writes `web/build.js` for this); after copying by hand, do a hard reload once. An existing `web/config.local.js` is preserved.

Custom settings (Rotel, enabling/disabling services, language) go into `web/config.local.js`; use `web/config.local.js.example` as the template. The Last.fm credentials do not belong there but in `/data/xplorio/data/keys.json` (see [Last.fm credentials](#lastfm-credentials)).

### Light and Dark

The interface follows the device setting (light or dark) and switches along when the device does. To fix it, set
`THEME: 'light'` or `'dark'` in `web/config.local.js`; for a quick test, add `?theme=light` to the address.
This also applies to the stage layout for large screens; only `kioskTV.html` always stays dark.

### Language

The interface is available in German, English, French, Spanish and Italian. It uses the language set in Volumio's settings, so the artist and
album information from Volumio matches it. On the very first visit the app does not know that language yet; it briefly
shows the device (browser) language and reloads once. If the Volumio language is not available, the device language
applies, otherwise English. To fix the language, set e.g. `LANGUAGE: 'en'` (or `'de'`, `'fr'`, `'es'`, `'it'`) in `web/config.local.js`. For a quick test,
`http://<player>/xplorio.html?lang=en` also works.

Adding a language: copy `web/lang/en.js`, e.g. to `web/lang/nl.js`, adjust code, name and locale in the last line
(`langRegister('nl', 'Nederlands', {…}, 'nl-NL')`) and translate the texts; `{name}` are placeholders and stay as they are,
`{one: …, other: …}` are singular and plural. Then add it in `web/config.local.js`: `LANGUAGES: ['de', 'en', 'fr', 'es', 'it', 'nl']`.
Texts missing from the file are shown in English. `xplorio-deploy` leaves your own language files in `web/lang/` in place.
Dates, numbers, month and weekday names come from the browser in the selected language.

Not translated: texts that Volumio itself delivers (e.g. menu names when browsing) and error messages from the tag
service; these stay German.

### Output device notices

If Volumio cannot open the output device (e.g. amplifier or DAC switched off), the app briefly shows "Audio output not
reachable" or "Audio output is busy"; the progress bar then stays at the start. When Volumio reports a disconnected
device, "Audio output disconnected" appears instead of Volumio's confirmation window; "Audio output connected" only
appears when Volumio reports the device coming back (USB DAC). Volumio's messages are recognised in German, English, French, Spanish and Italian.

## Updating with xplorio-deploy

Set it up once:

```bash
curl -fsSL https://raw.githubusercontent.com/Celindir69/xplorio/main/tools/xplorio-deploy.sh | sudo tee /usr/local/bin/xplorio-deploy >/dev/null
sudo chmod +x /usr/local/bin/xplorio-deploy
```

Then on the player:

| Command | Effect |
|---|---|
| `sudo xplorio-deploy` | fetch `main` from xplorio, show changed and new files, and deploy them after confirmation |
| `sudo xplorio-deploy <branch>` | use a different branch, e.g. for testing before merging |
| `sudo xplorio-deploy -n <branch>` | only show what would change |
| `sudo xplorio-deploy -y <branch>` | deploy without confirmation |
| `sudo xplorio-deploy --rollback` | restore the latest backup (repeat to go back step by step) |
| `sudo xplorio-deploy --password` | set or change the password for the services on the "System" page |
| `sudo xplorio-deploy --tag-service` | set up the Tag Service: unit file, data folder, start and check (see [Tag Service](#tag-service-for-the-tag-editor)) |
| `sudo xplorio-deploy --rotel <IP>` | set up the Rotel bridge: amplifier address in `config.local.js`, unit file, start and check; with `--force` also a different address (see [Rotel Bridge](#rotel-bridge-optional)) |

Targets: `xplorio.html`, `app.html` (redirect), `kioskTV.html`, `web/`, and `tools/` go to every existing `/volumio/http/www*/` folder, and `tags/` plus `rotel/rotel-bridge.js` go to `/data/xplorio/`; the script also updates itself. Which of the folders Volumio serves depends on the version and the selected interface (e.g. classic `www`, Volumio 3 `www3`, Volumio 4 `www4`), so every existing one gets the interface. The script does not create new folders and stops if there is none; `DEPLOY_WWW=<folder>` selects a specific one. `web/config.local.js` is per folder: if you switch interfaces, copy it as well. The script also writes `web/version.json` (branch, commit and its date); the menu shows this version at the bottom below the logo and name, and "Development version" without the file.

`tag-service` and `rotel-bridge` are restarted only if their files have changed. Before each deployment, the script backs up the affected files to `/data/xplorio/backup/` (the latest 5 backups). Nothing is deleted; custom files such as `web/config.local.js` are preserved.

The German option names of earlier versions (`--passwort`, `--zurueck`) keep working, and the confirmation also accepts `j`.

Everything except the interface lives in `/data/xplorio/`: `tags/` (Tag Service), `rotel/` (Rotel bridge), `data/` (Tag Service data), and `backup/` (backups). The folder survives Volumio updates; before a fresh installation, backing it up is enough. Earlier installations had the services under `/data/INTERNAL/`: the script then switches `tag-service.service` and `rotel-bridge.service` to the new paths once (with a backup) and restarts the services; the Tag Service moves its data itself. The old folders `/data/INTERNAL/tags` and `/data/INTERNAL/rotel` stay in place and can be deleted after a test.

**Switching from web-app-deploy (until October 2026 the repository and command were called `volumio-web-app` and `web-app-deploy`):** set up `xplorio-deploy` as above, then run `sudo xplorio-deploy -n` (among other things it shows "move: /data/web-app to /data/xplorio") and `sudo xplorio-deploy`. The script moves `/data/web-app` with its data, Last.fm credentials and backups to `/data/xplorio`, leaves `/data/web-app` behind as a symlink, updates the systemd files and restarts the services. `web-app-deploy` and the even older names `mx-deploy` and `volumio4-deploy` keep working and call `xplorio-deploy` (on first use they set it up themselves).

## Tag Service (for the Tag Editor)

The easiest way is [xplorio-deploy](#updating-with-xplorio-deploy):

```bash
sudo xplorio-deploy --tag-service
```

If needed it first deploys `main`, then creates `/data/xplorio/data` and `/etc/systemd/system/tag-service.service`, starts the service and checks it (`tag-service is running: {"ok":true,…}`). If the service is already set up, the command changes nothing and says so; `--force` rewrites the unit file (the old one goes into the backup, restore it with `--rollback`).

By hand, in the repository folder:

```bash
sudo mkdir -p /data/xplorio/tags && sudo cp -r tags/. /data/xplorio/tags/
sudo chown -R volumio:volumio /data/xplorio/tags
sudo mkdir -p /data/xplorio && sudo mkdir -m 700 -p /data/xplorio/data && sudo chown volumio:volumio /data/xplorio/data
sudo tee /etc/systemd/system/tag-service.service > /dev/null << 'UNIT'
[Unit]
Description=Tag-Dienst fuer Xplorio
After=network-online.target

[Service]
ExecStart=/usr/bin/env node /data/xplorio/tags/tag-service.js
WorkingDirectory=/data/xplorio/tags
Restart=always
User=volumio
# Environment=USE_SUDO=1

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload && sudo systemctl enable tag-service && sudo systemctl start tag-service
curl -s localhost:8766/health
```

The service writes to music files as the `volumio` user. To check whether this works:

`sudo -u volumio touch /mnt/USB/<MusicFolder>/.test && sudo rm /mnt/USB/<MusicFolder>/.test && echo writable`.

If it does not work, uncomment `Environment=USE_SUDO=1` (then only `tags.py` runs as root).

After an update: `sudo systemctl restart tag-service`. Log: `journalctl -u tag-service -e`.

Additional variables: `HTTP_PORT`, `MUSIC_ROOT` (`/mnt`), `PYTHON`, `MPC`, `TAGS_DATA` (data folder, default `/data/xplorio/data`).

**Access protection:** The Tag Service and the Rotel bridge only accept commands from the interface on the same device.
Another website open in the browser can neither write tags, switch the amplifier, nor read the history.
The services only answer when the player is addressed by its IP address, a name without a dot (`volumio`),
or a name ending in `.local`, `.lan`, `.home`, `.internal`, `.home.arpa`, or `.fritz.box`.
Add other names in `web/config.local.js` and restart both services:
`window.APP_CONFIG.ALLOWED_HOSTS = ['player.example.net'];` (or the environment variable `XPLORIO_HOSTS`, comma-separated).
Your own scripts that write without a browser (for example with `curl`) send the header `X-Xplorio: 1`;
`curl -s localhost:8766/health` and other queries work as before.

**Data folder:** The program lives in `/data/xplorio/tags/`; everything the service creates (history, Last.fm session, check result, covers, analysis …) lives in `/data/xplorio/data/`. That folder is readable only by `volumio` and is neither inside the web folder nor inside `/data/INTERNAL`, which Volumio may share on the network. Older installations kept the data next to the program; the service moves it on its first start. If the folder is missing and the service is not allowed to create it, it keeps using the old folder; in that case run once:
`sudo mkdir -p /data/xplorio && sudo mkdir -m 700 -p /data/xplorio/data && sudo chown volumio:volumio /data/xplorio/data && sudo systemctl restart tag-service`.

### Last.fm credentials

The API key and "Shared secret" from https://www.last.fm/api/accounts are stored in `/data/xplorio/data/keys.json`; only the Tag Service reads them, and the app queries Last.fm through the service:

```bash
sudo -u volumio tee /data/xplorio/data/keys.json > /dev/null << 'KEYS'
{ "LASTFM_KEY": "YOUR_LASTFM_KEY", "LASTFM_SECRET": "YOUR_SHARED_SECRET" }
KEYS
sudo chmod 600 /data/xplorio/data/keys.json && sudo systemctl restart tag-service
```

The key is enough for similar artists, information texts, cover search, and mood tags; the secret is only needed for scrobbling. If `LASTFM_KEY`/`LASTFM_SECRET` are still in `web/config.local.js` (earlier versions), the service copies them to `keys.json` on start; afterwards delete those two lines from `web/config.local.js`, because any browser on the network can load that file. `curl -s localhost:8766/health` shows `"keysInWeb":true` as long as they are still there.

`tags.py` runs with Python 2.7 and 3 and includes mutagen itself; if there is no `python` command, the service uses `python3`.

Notes: Only files under `/mnt/INTERNAL`, `/mnt/USB`, and `/mnt/NAS` are allowed. Previous values for "Undo" are stored in `/data/xplorio/data/changes.jsonl`. If the music files are mirrored from another computer, the next synchronization will overwrite the changes made on the player. After changes MPD re-reads the affected folders, collected 15 seconds after the last change and never while MPD is still updating; with more than three folders, one scan of their common parent folder. While “Check library” is open, changes are only collected and read in once when it is closed (at the latest 10 minutes after the last change). This only works if MPD does not watch the files itself: with `auto_update "yes"` in `/etc/mpd.conf`, MPD scans every changed file immediately, and Volumio then rebuilds its album list each time (about a minute of load per album, up to a hang when editing many albums in a row). Recommendation: `auto_update "no"` (also in the template under `/volumio/app/plugins/music_service/mpd/`, if present) and `sudo systemctl restart mpd`; read in new music as usual with "Update library" (in the Volumio menu "Update", not "Rescan", or with the button at the top of “Check library”, which also covers changes still being collected, or with "Update library" in the gear menu). The service is accessible on the local network without authentication.

### Search for Cover Art Online

In the Album Editor, "Search online" searches iTunes, Last.fm (using the Last.fm key from `keys.json`), and the Cover Art Archive (MusicBrainz) for the album artist (otherwise the artist) and album currently entered in the fields. You can temporarily change the fields for searching without saving them.

Suggestions appear side by side; tapping one applies the image just like a manually selected image (embed and/or `folder.jpg`, with Undo support).

The Tag Service performs the queries; the player therefore needs internet access.

### Check Library

In the menu (gear at the top right, only available while the Tag Service is running): finds albums without cover art, compilations without a consistent album artist, artists with multiple spellings, inconsistent album names/years, albums whose Date tag differs from the first release according to MusicBrainz (from the birthday lookup; the pencil suggests the MusicBrainz date), and tracks without track numbers; the pencil icon opens the appropriate editor.

The check reads the MPD database (`MPD_HOST`, `MPD_PORT`, default `localhost:6600`) and the folders, does not modify any files, and only runs when triggered manually. Result: `/data/xplorio/data/check.json`, retained until the next check. Entries whose pencil was used are recorded there and stay greyed out, also after closing, until the next check.

**Genres:** Two further categories suggest exactly one genre per album from the 15 Discogs top categories (Electronic,
Rock, Jazz, Classical, Pop, Hip Hop, Funk / Soul, Folk, World, & Country, Latin, Reggae, Blues, Stage & Screen,
Non-Music, Children's, Brass & Military).
- *Albums without genre:* suggestion from the audio analysis ([Essentia](#audio-analysis-with-essentia-optional-on-the-mac)), averaged over all
  tracks of the album. Without audio analysis there is no suggestion.
- *Merge genres:* a table in `tags/genres.js` maps existing genre tags (e.g. "Trip-Hop", "TripHop", "Klassik", "Hörspiel")
  to a top category, as well as the Discogs sub-styles from the audio analysis. For ambiguous names ("Indie": Rock or Pop)
  the audio analysis decides. Identical changes are shown in one row.

The pencil opens the batch editor with the suggestion; nothing is written until you save, and Undo works as usual. Next to every genre field in the Tag Editor a "Main genre" menu offers the 15 top categories; custom values can still be typed. The
sub-styles ("Trip Hop", "Downtempo") are not written to the files but stay in the Tag Service: `GET /genres?dir=<folder>`
returns the top category and sub-styles of an album (as of the last check), without `dir` all albums.
The model is weaker at recognising classical music, soundtracks and radio plays.

### Web Radio: Cover Art and Station Logos

If a web radio station broadcasts "Artist - Title", the Tag Service searches iTunes for the corresponding cover art (falling back to Deezer) and displays it in the app and on the kiosk TV; if no title is available or no match is found, the station logo remains.

The radio list displays the station logos using the address provided by Volumio, otherwise by looking up the station name via radio-browser.info. The Tag Service stores both under `/data/xplorio/data/radio-covers/` and `/data/xplorio/data/stations/`.

### Welcome screen

When the page opens (only with the Tag Service), a card in the middle of the window (with a wide margin in landscape) greets you by time of day: the **album of the day** (random, preferring albums not played for a long time or never; it stays the same all day) with "Play" and the album text (as in the info overlay, scrollable), **Recently played** (albums with at least two tracks played recently), **Around this time X years ago** (albums played around this date a year or more ago, ± 3 days), **New in the collection** (albums whose files were added or changed in the last 180 days, by MPD's modification date) and a random mix. Tapping beside it closes it. It appears on its own at most every 30 minutes and not in the stage layout; "Show on opening" at the bottom turns it off for this device, and the menu entry "Welcome screen" opens it any time. With `?welcome=0` in the address it stays closed on opening (e.g. for a bookmark). After the update the Tag Service re-reads the album list once; until then "New in the collection" is missing.

**Birthdays:** albums whose release day is today, this week (Monday to Sunday) or this month. The welcome screen shows today and this week (otherwise the month); Search & Discover shows all three in the Albums tab, plus "Recently played" and "New in the collection". Round birthdays (10, 20, 30 … years) carry the years as a badge, anniversaries (25, 50, 75 years) also a gold frame; they come first. The date comes from a complete Date tag (YYYY-MM-DD, matching the album's year); without one, the Tag Service looks it up once at MusicBrainz (first release of the release group, one request every 1.5 seconds, compilations excluded) and keeps it in `/data/xplorio/data/releasedates.jsonl`; albums not found are tried again after 90 days. For a large collection the first pass takes a few hours; while there is hardly any data and no birthday has been found yet, Discover shows the progress. To disable it: set `RELEASEDATES: false` in `web/config.local.js`, then restart the Tag Service.

### System

In the menu under "System": the current CPU load (refreshed every 2 seconds, with the last 3 minutes and per core), a history of the last 24 hours (load, temperature or memory, averaged per minute), temperature, memory, the usage of each drive (internal card, USB and each connection under `/mnt/NAS/` separately; an unreachable connection is shown as "not reachable"), Volumio version, kernel, uptime and the file currently playing. The Tag Service reads the values from `/proc`, `/sys` and `df`; it samples every 2 seconds (one small file, no noticeable load) and saves the history every 10 minutes to `/data/xplorio/data/sysinfo.json`.

#### Services
Below that, the "Services" card: Volumio, MPD, Tag Service, Rotel control and kiosk with their state (running for …, stopped,
error) and a "Restart" button, plus "Start" and "Stop" for the kiosk (for example, so it only runs while the TV is
connected). The page asks before restarting. Services that are not set up on the player are not listed. The Tag Service runs
as user `volumio` and may run exactly these commands only with a sudo rule; without it, the card shows the state and a hint.
Set it up once (`visudo` checks the rule before saving):

```
sudo visudo -f /etc/sudoers.d/xplorio-dienste
```

and add this single line:

```
volumio ALL=(root) NOPASSWD: /bin/systemctl --no-block restart volumio, /bin/systemctl --no-block restart mpd, /bin/systemctl --no-block restart tag-service, /bin/systemctl --no-block restart rotel-bridge, /bin/systemctl --no-block start volumio-kiosk, /bin/systemctl --no-block stop volumio-kiosk, /bin/systemctl --no-block restart volumio-kiosk, /sbin/reboot, /sbin/poweroff
```

The rule allows only these commands, nothing else.

Below the services are "Restart" and "Shut down" for the whole player, each with a confirmation. If a password is set (see
below), they ask for it too; otherwise not, since Volumio itself offers both without a password. They use `/sbin/reboot`
and `/sbin/poweroff` like Volumio; the sudo rule above includes both.

The service buttons are also protected by a password and stay locked until one is set:

```
sudo xplorio-deploy --password
```

Only a hash (PBKDF2 with salt) is stored, in `/data/xplorio/data/admin.json`; the same command changes it and signs out all
devices. On the first tap on a button the page asks for the password; the device (the browser) then stays signed in for
30 days. After 5 wrong attempts the service waits, twice as long after each further one (at most 15 minutes). The
connection is unencrypted (http): the password keeps guests out but does not protect against eavesdropping on your own
network, so don't use one you use elsewhere. Note: Volumio itself can be restarted and shut down on the home network
without a password.

#### Logs
Below the services, the "Logs" card: the last 50, 100 or 300 lines from Volumio, MPD and the Tag Service (from the journal, like
`journalctl -u volumio`), plus the logs of the AutoDJ (`/data/volumio_autodj_data/autodj.debug.log`) and Smart Playlists
(`/data/smart_playlists_data/smart_playlists.debug.log`) plugins once they exist. The card first shows only the sources; a tap loads that log, a second tap collapses it. The search field above it shows only lines containing the text you type (e.g. `error`, case-insensitive), also while "Live" is on. "Live" fetches new lines every 3 seconds
(like `-f`) while the page is open. If a password is set (see above), the logs are protected by it as well, since they
contain paths, track titles and network addresses.

The user `volumio` can only read the journal as a member of the `systemd-journal` group; without it, the card shows a hint
for Volumio, MPD and the Tag Service, and the plugin logs still work. On many players this is already the case:
`id volumio` lists the groups; if it shows `systemd-journal` or `adm`, there is nothing to do. Otherwise, once:

```
sudo usermod -a -G systemd-journal volumio
sudo systemctl restart tag-service
```

The group only allows reading the journal.

### Playback
In the menu under "Playback": **crossfade** on or off, with a duration of 1 to 30 seconds, and **volume levelling**
(ReplayGain) with Off, Track, Album or Automatic (like Track in shuffle, otherwise like Album). The Tag Service switches both
directly in MPD, without a restart; ReplayGain only affects files with ReplayGain tags. Volumio's own normalization
(`volume_normalization`, levels even without tags but changes the dynamics) is only shown; change it in Volumio under
Settings → Playback options. If the AutoDJ plugin is installed, the page shows whether its automation for crossfade and
levelling is on: if you set both here, switch it off in the plugin, otherwise AutoDJ changes the values at the next fresh
mix. Whether Volumio resets crossfade and the ReplayGain mode after a restart has not been checked yet.

### History and Statistics

In the menu (gear at the top right) under "History and stats": **Recent** (by day), **Most played** (tracks, albums, artists, or genres; 30 days, 12 months, or all time), **Stats** (plays, listening time, history, time of day, weekday, top 8 genres; tapping a genre opens its albums), and **Year in review** (one year: totals compared with the previous year, months, plus expandable top tracks, albums, artists, genres, and newly discovered artists; tapping a monthly bar displays the rankings for that month; genres are taken from the album list below).

Tapping plays the track or opens the album or artist.

**Discover:** As long as nothing has been entered in "Search & Discover", the page shows several swipeable rows of artists, albums, or tracks matching the selected tab: **Random Discoveries** (preferring music not played for a long time or never; ↻ draws again), **Played a Year Ago** (around this date one year ago, otherwise 2, 3, etc. years ago), **Not Heard in a While** (more than six months ago), **Never Heard**, and **Once Played a Lot** (played often, but not in the last six months). Empty rows are hidden. Tap an artist or album to open it, tap a track to play it. All of this is based on the playback history (see above). The dice at the right of each row plays 25 tracks from the whole row (not just the visible tiles), always at track level whatever tab is open: for "Never Heard", for example, tracks never played. The dice rules apply (see Random mix), without "dislike" tracks.

**By mood, energy, style and decade:** Below the rows there are selection buttons. Mood (Relaxed, Dreamy, Melancholic, Dark, Happy, Intense, Epic; the same names as in the mood mix), energy (Calm, Medium energy, High energy) and style (Acoustic, Ambient, Electronic, Funky, Soulful, Experimental) open the matching albums with "Play all" and the dice, just like a genre. An album matches when at least half of its classified tracks carry that mood or style (a style button groups related styles, e.g. Electronic also covers downtempo, house and trip-hop), or when its average energy lies in the range (Calm 1–2, Medium energy 3, High energy 4–5); it needs at least two classified tracks. How many albums match depends on the mood tags. The mood mix stays separate. A decade opens its albums, sorted by year, with "Play all" and the dice. The year is the most frequent Date tag in the album folder (from MPD, i.e. the value shown in the tag editor); albums without a year are left out. After the update the Tag Service re-reads the album list once; until then the decades are missing.

**Release year:** The album title is followed by its year in parentheses: in the player view, the album header, the album lists of the artist page, genre, decade and mood pages, and album results in search. Tapping the year opens the albums of that year. Year and decade pages have two tabs, "Albums" and "Discover". "Discover" shows artists with albums from the decade, the decade's most frequent moods and styles, and the neighbouring decades. Mood and style there show only albums of that decade (e.g. "Melancholic · 1980s"); "All decades" lifts that filter.

**Ratings** (Tag Service only): on the artist page a heart marks favourite artists; the album header has one to five stars (tap the same star again to clear the rating). Tracks have a thumb, in the queue and in an album's track list; each tap moves on from neutral (outline) to "like" (thumb up) to "dislike" (thumb down) and back. "Like" is the same as a Volumio favourite: the thumb adds the track to the Volumio favourites, and existing favourites show the thumb up. Hearts, stars and dislikes are stored by the Tag Service in `/data/xplorio/data/ratings.json`. Disliked tracks are left out of the dice, the mood mix and the track rows in Discover.

**Hidden Gems** (Tag Service only): in Discover, the row below Random Discoveries shows artists, albums or tracks from the library that have never or hardly been played (artists and albums at most twice, tracks at most once) and match your taste. Your taste is built from hearted artists, albums with 4 or 5 stars, the Volumio favourites (the Tag Service asks Volumio for them at most once a minute) and, with less weight, the playback history. Genre, mood, style and energy from the mood tags are compared; tracks without mood tags do not appear in the track row. Unheard albums and tracks by favourite artists are always included. Each tile shows the reason: "♥ Unheard" (favourite artist), "Like …" (sounds like a favourite artist) or mood · genre. Left out: disliked tracks, albums whose tracks are mostly disliked, albums you have already rated, hearted artists and favourites. ↻ draws again. Without ratings only the history counts; without history the row is hidden.

**Discover on the artist page:** The artist page has three tabs: "Albums & tracks", "Discover" and "Background" (the last chosen one stays open when going back). "Background" shows the artist text like the information page in the player. In the "Discover" tab, buttons lead on: similar artists from the collection (Last.fm), the moods and styles carried by at least a fifth of the artist's classified tracks, their average energy and the decades of their albums. Each button opens the artist or the matching albums, just like in Discover; the path so far does not act as a filter. The dice in front of the similar artists starts a random mix in which each of these artists appears about equally often, however much of them is in the collection.

**Play count** (Tag Service): The album page's play row shows in the middle how often the album was played and when last (from the history; tracks without a break of more than three hours count as one listen).

**Discover on the album page** (Tag Service): The album page has the tabs "Tracks", "Discover" and "Background". "Discover" shows similar albums from the collection (comparing moods, styles and energy of the classified tracks, at most one per artist, with a dice for a random mix from them), the album's mood, energy and styles, year, decade and genre, and more albums by the artist. "Background" shows the album text with the credits below.

For artists and albums from a streaming service the tab is called "Discover locally" and searches your own collection: similar artists via Last.fm, for an album the album of the same name in the collection or, if it is missing there, the artist's profile.

**More like this track:** Tapping the title in the player (own file) opens up to 25 tracks from the collection with a similar mood and energy and, with audio analysis, a similar tempo (half or double tempo counts as the same); style and genre count a little. At least one mood must match, at most two tracks per artist, and "dislike" tracks are left out. Each track shows the shared moods, its tempo and its energy. "Play all" plays the list, the dice 25 other similar tracks. Without mood data for the track, a note is shown.

**Random mix:** Next to "Play all" (artist page, genre lists), the dice starts 25 random tracks from that selection. Dice rules: at most three tracks per artist and two per album (on the artist page no artist limit, three per album); tracks played in the last 14 days only when there is not enough else; if the selection is too small, it is filled up beyond the limits. Never the same artist twice in a row; "dislike" tracks never.

The Tag Service reads the album list from MPD and stores it in `/data/xplorio/data/albums.json`; it is re-read when the MPD database changes (checked at most once a minute; after tag changes automatically about a minute after the scan).

**Genres:** The fourth search tab (only with the Tag Service) shows tiles of all genres when nothing is entered, and the matching genres otherwise. With more than twelve genres, a "Random genres" row sits above them; ↻ draws it again. Tapping one opens the genre page: if there are [audio analyses](#audio-analysis-with-essentia-optional-on-the-mac), it first shows tiles of the styles (Discogs sub-styles, e.g. "Trip Hop" under Electronic) with "All" in front, otherwise all albums of the genre right away, sorted by artist. Each album counts up to three sub-styles of its genre, averaged over the analysed tracks; albums without an analysis appear only under "All". Search also finds sub-styles. An album's genre is its most frequent genre tag (from the album list). The album page shows artist, album and genre one below the other; artist and genre open their pages. In album lists the genre is shown small before the pencil, in the player view small below the quality line (tapping it opens the genre page). [Check library](#check-library) helps to unify and fill in genre tags.

The Tag Service fetches artist images once from Deezer and stores them under `/data/xplorio/data/artists/` (Last.fm no longer provides them); if no image is available, Volumio's artist icon is shown.

The Tag Service checks Volumio every 5 seconds (every 15 seconds while paused/stopped) for playback status (`VOLUMIO_URL`, default `http://localhost:3000`). A track counts if it is longer than 30 seconds and has been played either halfway through or for 4 minutes; web radio does not count.

Each play is stored as one line in `/data/xplorio/data/plays.jsonl`. To disable it: set `HISTORY: false` in `web/config.local.js`, then restart the Tag Service.

**Last.fm:** For scrobbling, the service needs not only `LASTFM_KEY` but also `LASTFM_SECRET` in `/data/xplorio/data/keys.json` (see [Last.fm credentials](#lastfm-credentials)). Then, under Statistics, select "Connect to Last.fm", choose "Allow" on Last.fm, and then return to the app and select "Done". After that:

- new plays are scrobbled (including "now playing"); without an internet connection, they wait in a queue (Last.fm still accepts them up to 14 days later),
- the existing Last.fm history is imported once; "Sync with Last.fm" only fetches new entries later. Anything already in the history (same track within 5 minutes) is not added twice.

The session key is stored in `/data/xplorio/data/lastfm.json` and remains on the player. If another Last.fm plugin in Volumio is also scrobbling, disable one of them, otherwise every track will be submitted to Last.fm twice.

### Mood Tags

With `LASTFM_KEY`, the Tag Service retrieves the Last.fm tags for every track in the library (`track.getTopTags`, falling back to the artist's tags if no useful track tags are available) and maps them to mood, energy (1–5), and style according to `tags/mood/lastfm_mapping.json` and `tags/mood/classification_rules.json`.

Queries are only made while nothing is playing (stopped or paused; checked every 5 seconds), at around 4 requests per second. The music files remain unchanged; the raw tags are stored in `/data/xplorio/data/moodtags/`, and the associated track list is stored in `/data/xplorio/data/library-tracks.json` (generated together with the album list).

Progress and distribution are shown in “Check library” under "Mood tags (Last.fm)".

To disable it: set `MOODTAGS: false` in `web/config.local.js`, then restart the Tag Service.

**Mood Mix:** Playlist button, "Mood Mix" tab (appears as soon as the Tag Service is running). Here you can select multiple moods, an energy range, one or more genres (the album's genre tag, never relaxed), and, under "Fine-tuning", styles, tempo (with audio analysis), years (the album's release year from the Date tag; with a limit, albums without a year are left out, never relaxed), length, maximum track length (default 20 min, keeps DJ mixes out), and discovery level (based on playback history: favorites, balanced, hidden gems).

"Create mix" only shows a preview; only "Play mix" replaces the queue (the list icon next to it appends the mix instead). If there are fewer than 20 exact matches, the mix also includes similar tracks (energy ±1, then without style) and indicates this. The same artist is never played twice in a row.

### Audio Analysis with Essentia (Optional, on the Mac)

[Essentia](https://essentia.upf.edu) analyzes each track's audio directly and provides tempo (BPM), key, mood (happy, sad, relaxed, aggressive, party), danceability, vocal/instrumental classification, valence and arousal, as well as Discogs styles.

This requires too much processing power for the player, so `tools/essentia/analyse.py` runs on the Mac and uploads a results file. The Tag Service then uses the audio-derived energy, tempo, and mood values for those tracks, while Last.fm adds additional moods and styles; the Mood Mix then gets a tempo control under "Fine-tuning".

One-time setup (macOS 15 or later; Python 3.14 from python.org or `brew install python@3.14`):

```bash
python3.14 -m venv ~/mx-essentia && source ~/mx-essentia/bin/activate
python -m pip install essentia-tensorflow mutagen
```

If pip reports "from versions: none", there is no current package for that Mac. On an Intel Mac running macOS 14, the latest compatible version requires Python 3.13 (`brew install python@3.13`):

```bash
python3.13 -m venv ~/mx-essentia && source ~/mx-essentia/bin/activate
python -m pip install "essentia-tensorflow==2.1b6.dev1389" mutagen
```

The pretrained models (around 100 MB, licensed under CC BY-NC-SA 4.0, non-commercial use only) are not included in the pip package; the script downloads them to `~/.cache/mx-essentia` on the first run.

Run the analysis (first a short test run, then everything; `caffeinate -i` keeps the Mac awake):

```bash
source ~/mx-essentia/bin/activate
python3 analyse.py --limit 20 /Volumes/<Drive>/<MusicFolder>
caffeinate -i python3 analyse.py /Volumes/<Drive>/<Folder 1> /Volumes/<Drive>/<Folder 2>
python3 analyse.py --upload http://<player>:8766
```

- Matching is based on artist and title (as with the Last.fm tags), not on the path: the folder structure and drive used on the Mac do not matter. Tracks that do not exist on the player are simply ignored there.
- Multiple folders can be specified, symlinks are followed; `--exclude "*/Audiobooks/*"` excludes matching paths.
- Unchanged files are skipped on subsequent runs; Ctrl-C aborts the process, and the next invocation continues where it left off.
- `--seconds 120` (default) analyzes only the middle two minutes (for valence/arousal, the middle 45 seconds of that section); `--jobs` specifies the number of parallel processes.
- Duration: on an older Intel Mac, around 9 seconds per file, or about 5 days for 50,000 tracks; Apple Silicon Macs are significantly faster. `--profile` displays the time spent on each analysis step. Using more processes than CPU cores provides no benefit.
- An intermediate upload can be performed at any time; the Tag Service then uses the results available so far.
- If the analysis crashes on a file (macOS then reports "Python quit unexpectedly"), the script continues and records the file as an error; `--retry-errors` retries such files later. Files longer than 30 minutes (recordings, DJ mixes) are skipped because they are loaded entirely into memory (`--max-minutes`, 0 = all); they are counted as "skipped", not as errors.
- With ffmpeg (`brew install ffmpeg`) the script reads files that Essentia fails on: after a read error, an almost empty result, or a crash (the file is then retried on its own, directly with ffmpeg). The script looks for ffmpeg itself (PATH, `/opt/homebrew/bin`, `/usr/local/bin`) and shows at startup which one it uses; `--ffmpeg <path>` selects another, `--ffmpeg aus` turns it off. `--retry-errors` catches up on files that failed before. Tracks read with ffmpeg carry `"dec":"ffmpeg"` in `essentia.jsonl`.
- The result file `essentia.jsonl` is located on the player under `/data/xplorio/data/` (replaced with each upload; alternatively copy it there using `scp`). “Check library” shows under "Mood tags" how many tracks have been matched.

### Artist and Album Information

The information page queries Volumio first. If nothing is returned (Volumio 4 only provides the information with a subscription, or Volumio does not respond within 6 seconds), the app retrieves the information itself: album information from Last.fm (in the interface language, otherwise English; requires `LASTFM_KEY`), and artist information from Last.fm and Wikipedia, first both in the interface language, then both in English (Wikipedia: only articles that appear to be music-related).
If the app is set to a different language than Volumio via `LANGUAGE` or `?lang=`, it retrieves the texts itself first and asks Volumio only if that returns nothing (Volumio returns its texts in its own language).

The source is shown below the text. There is no fallback for contributors.

Contributors that Volumio delivers with a MusicBrainz ID can be tapped (without a visual marker). This expands its text below; tapping the name again or tapping the text
collapses it. For people the same order as for artists applies (Volumio, then Last.fm and Wikipedia); studios and labels
come from Volumio only.

For the current track the app looks for a text of its own in the same order (Last.fm `track.getInfo`, then a Wikipedia article whose name is the song name, which describes itself as a song or single and names the artist). Additions such as "(Remastered 2011)" are ignored for this. Only if something is found does a "Track" tab appear after "Album", or as the first tab for web radio. The browser remembers the result per track, including "nothing found" (the last 400).

**Same names:** texts, photos, covers, lyrics and contributors are looked up by name. If another artist, album or track has the same name, the information shown can occasionally belong to the wrong one. A unique MusicBrainz tag in the files helps Volumio; the app's own sources (Last.fm, Wikipedia, Deezer, LRCLIB) still go by name.

In the stage view, long lyrics without timestamps are set slightly smaller; if they still don't fit, you scroll yourself (they don't page on by themselves).

### Lyrics Offset

If synchronized lyrics consistently appear too early or too late (for example, because a different version of the track is being played), the "−" and "+" controls next to the "Lyrics" heading (stage view: round buttons at the top right) shift the lyrics by 0.5 seconds at a time.

The value applies to that track on all devices (`/data/xplorio/data/lyrics-offsets.json`); tapping the value resets it to 0.

### Recognize a Track from Another Source (iPhone, iPad, Mac)

When the amplifier plays something other than the player (turntable, CD, TV), a shortcut can recognize the track with Shazam and send it to Xplorio. As long as Volumio isn't playing, Xplorio shows it like a playing track: cover, lyrics (not synchronized) and artist information, marked "Recognized". It disappears as soon as Volumio plays again, at the latest after 10 minutes. A web browser can't use Shazam itself, hence the shortcut.

Creating the shortcut (Shortcuts app; action names vary slightly between iOS versions):

1. New shortcut, named e.g. `Xplorio recognize`.
2. Action **Recognize Music** (Shazam).
3. Action **Get Contents of URL**: URL `http://<player IP>:8766/recognized`, method **POST**, request body **JSON** with three text fields: `artist` = Shazam Media › Artist, `title` = Shazam Media › Title, `art` = Shazam Media › Artwork URL (optional, fallback cover). A field `album` is used if present.
4. Optional: action **Show Notification** with the result of "Get Contents of URL" (shows "Artist – Title").

Run it via Siri, Control Center, a widget or from Xplorio: with `window.APP_CONFIG.RECOGNIZE_SHORTCUT = 'Xplorio recognize';` in `web/config.local.js`, the menu on Apple devices gets a "Recognize track" entry that starts the shortcut (in the browser it returns to Xplorio afterwards).

Trying it without an iPhone: `curl -s -H 'Content-Type: application/json' -d '{"artist":"…","title":"…"}' localhost:8766/recognized`; `-d '{"clear":true}'` removes the track again.

## Rotel Bridge (Optional)

Controls a network-connected Rotel amplifier: power, volume and the remote control (see below). The bridge is a small service on the player (port 8765) that keeps the connection to the amplifier (TCP, port 9590); the interface only talks to the bridge.

**Preparing the amplifier:** connect it to the network, read its IP address in the amplifier's menu (ideally assign a fixed one in your router) and set Power Mode to "Quick" so it can be switched on from standby over the network.

**The easiest way** is [xplorio-deploy](#updating-with-xplorio-deploy), with the amplifier's address:

```bash
sudo xplorio-deploy --rotel 192.168.1.50
```

If needed it first deploys `main`, then adds `ROTEL = true` and `ROTEL_HOST` to `web/config.local.js` (only if there is no `ROTEL_HOST` yet, after a backup; without an address it asks for one), creates `/etc/systemd/system/rotel-bridge.service` with the right folder (`www`, `www3` or `www4`), starts the bridge and reports `rotel-bridge is running: connected to the amplifier`. If the bridge is already set up, the command changes nothing and says so; `--force` rewrites the unit file (with a backup). Your own entries in `config.local.js` stay untouched. If one of the www folders already has an address, the command does not ask and leaves the other folders as they are too.

**Entered the wrong address?** `sudo xplorio-deploy --rotel <correct IP> --force` replaces `ROTEL_HOST` (after a backup) and restarts the bridge. Without an IP the command asks for the new address; Enter keeps the old one.

**By hand**, step by step:

**1. Copy the file to the player** (in the repository folder; `xplorio-deploy` does this itself on every deployment):

```bash
sudo mkdir -p /data/xplorio/rotel && sudo cp rotel/rotel-bridge.js /data/xplorio/rotel/
sudo chown -R volumio:volumio /data/xplorio/rotel
```

**2. Settings in `web/config.local.js`** (the bridge reads them at startup; the folder depends on the Volumio version: `/volumio/http/www3/web/`, Volumio 2 `/volumio/http/www/web/`, Volumio 4 `/volumio/http/www4/web/`):

```bash
sudo nano /volumio/http/www3/web/config.local.js
```

and add:

```js
window.APP_CONFIG.ROTEL = true;                            // power, amplifier volume and remote control
window.APP_CONFIG.ROTEL_HOST = '<amplifier-ip>';           // e.g. '192.168.1.50'
```

Without `ROTEL: true`, the interface controls Volumio's volume instead (if enabled there).

**3. Set it up as a service and start it:**

```bash
sudo tee /etc/systemd/system/rotel-bridge.service > /dev/null << 'UNIT'
[Unit]
Description=Rotel bridge for Xplorio
After=network-online.target

[Service]
ExecStart=/usr/bin/env node /data/xplorio/rotel/rotel-bridge.js
WorkingDirectory=/data/xplorio/rotel
Restart=always
User=volumio
Environment=APP_CONFIG_DIR=/volumio/http/www3/web

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload && sudo systemctl enable rotel-bridge && sudo systemctl start rotel-bridge
```

`APP_CONFIG_DIR` is the folder from step 2; on Volumio 2 replace `www3` with `www` before copying, on Volumio 4 with `www4`.

**4. Check:**

```bash
curl -s localhost:8765/state
```

`"connected":true` means the bridge reached the amplifier; `"power"` and `"volume"` show its state. With `"connected":false`, the log shows why (wrong address, amplifier not on the network):

```bash
journalctl -u rotel-bridge -n 30 --no-pager
```

To switch it on as a test (without a browser the bridge needs the `X-Xplorio` header):

```bash
curl -s -H 'X-Xplorio: 1' 'localhost:8765/cmd?c=power_on'
```

**5. After changes** to `config.local.js` (address, profile below), restart the bridge:

```bash
sudo systemctl restart rotel-bridge
```

Reload the interface once; the remote control icon appears at the top right of the player view.

### Remote control

With `ROTEL: true`, a remote control icon appears at the top right of the player view. It opens the "Playback" page (gear menu) at the "Amplifier" card: power/standby, volume and mute, input, tone bypass, bass, treble, balance, and speakers A and B. The values come from the amplifier and also follow the physical remote.

The commands are preset for the Rotel RA-1572 / RA-1572MKII (ASCII protocol V2, port 9590). For other models or your own input names, use `web/config.local.js`; anything left out keeps the default:

```js
window.APP_CONFIG.ROTEL_PROFILE = {
  model: 'My amplifier',
  sources: [{cmd: 'pcusb', name: 'Player'}, {cmd: 'opt1', name: 'TV'}, {cmd: 'phono', name: 'Turntable'}],
  speakerB: false,             // false hides a control (bypass, bass, treble, balance, speakerA, speakerB)
  powerOnSource: 'pcusb'       // input selected after power-on, '' = don't switch
};
```

Other fields: `bypass: ['bypass_on', 'bypass_off']`, `speakerA`/`speakerB` each `[on, off]`, `bass`/`treble` each `[up, down, center]`, `balance: [right, left, center]`, `toneMax` (default 10) and `balanceMax` (15). Other Rotel devices and Rotel's Michi series (X3, X5, P5, S5, M8) use the same ASCII protocol; the commands and the port (`ROTEL_AMP_PORT`) are in the device's protocol PDF on rotel.com (the P5, for example, uses port 9596 instead of 9590). Commands are written without the trailing `!`; the bridge only accepts commands from the profile. Restart the bridge after a change (`sudo systemctl restart rotel-bridge`; the deploy script only does so when `rotel-bridge.js` itself has changed).

## Streaming Services (TIDAL, Qobuz, HIGHRESAUDIO, Spotify)

The elements for streaming services (tiles in search, similar artists from the service in the information view, and the service's artist and album pages) only appear if the corresponding plugin is active in Volumio.

To permanently enable or disable them, set `window.APP_CONFIG.TIDAL = true;` or `false` (likewise `QOBUZ`, `HRA`, `SPOTIFY`) in `web/config.local.js`.

If multiple services are active, search displays their results in separate sections. Spotify requires Volumio's Spotify plugin with search support (Premium account); Spotify Connect alone does not provide search.

The TIDAL watchdog described below applies only to TIDAL.

## TIDAL Watchdog (Optional)

```bash
sudo mkdir -p /volumio/http/www3/tools && sudo cp tools/tidal-watchdog.sh /volumio/http/www3/tools/
sudo chmod +x /volumio/http/www3/tools/tidal-watchdog.sh
sudo /volumio/http/www3/tools/tidal-watchdog.sh --check      # check only
echo '*/10 * * * * root /volumio/http/www3/tools/tidal-watchdog.sh' | sudo tee /etc/cron.d/tidal-watchdog
```

Checks every 10 minutes whether TIDAL responds and restarts Volumio if it does not (at most once per hour). Log: `/var/log/tidal-watchdog.log`.

If TIDAL is not logged in, do not set up the watchdog.

## Endless play (AutoDJ)

With the [autodj-plugin](https://github.com/Celindir69/autodj-plugin) (version 1.1 or later), the repeat button gets a fourth state: off → all → one → ∞. With ∞, repeat is off and AutoDJ is on; it appends similar tracks whenever the queue is about to run out. The next tap turns AutoDJ off again. If it is switched in Volumio, the button shows that too (within 30 seconds). Without the plugin, or without a Last.fm key in the plugin settings, the button keeps its three states.

## Volumio 4

The interface also runs under Volumio 4 (tested on a test instance). Differences compared with Volumio 2:

- **Folders:** Volumio 4 serves the interface from `/volumio/http/www4/` instead of `www3/`. It is still accessed via `http://<player>/xplorio.html`; `web/config.local.js` belongs in `/volumio/http/www4/web/`.

- **Updating:** as above with [xplorio-deploy](#updating-with-xplorio-deploy); it finds `www4/` by itself. The first time, inspect first: `sudo xplorio-deploy -n` ("changed" would mean that a Volumio file would be replaced). The message "Installed to …" must include `www4`.

- **Tag Service:** The service file above starts Node via `/usr/bin/env node` and therefore works on both versions. An older service file using `/usr/local/bin/node` fails under Volumio 4 with `status=203/EXEC`; in that case:

  `sudo sed -i 's|^ExecStart=/usr/local/bin/node|ExecStart=/usr/bin/env node|' /etc/systemd/system/tag-service.service && sudo systemctl daemon-reload && sudo systemctl restart tag-service`.

  Python 3 is included, and the Tag Service includes mutagen.

- **Information texts:** Volumio 4 only provides artist and album information with a subscription; the app therefore retrieves it from Last.fm and Wikipedia (see [Artist and Album Information](#artist-and-album-information)). With `LASTFM_KEY` in `/data/xplorio/data/keys.json`, album information is also available.

- **Not tested under Volumio 4:** `kioskTV.html` (kiosk folder), Rotel Bridge, and TIDAL Watchdog (the watchdog is located under `/volumio/http/www4/tools/` there; adjust the path in the cron entry accordingly).
