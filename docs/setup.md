# Setting Up Xplorio on the Player

Xplorio is a Volumio plugin. It puts nothing under `/volumio`, so Volumio's check before a system update stays intact.
The plugin serves the interface from its own web server on port 4040. The web server, Tag Service and Rotel bridge run as
systemd services of their own (`xplorio-web`, `xplorio-tags`, `xplorio-rotel`), as Volumio asks of plugins: `install.sh`
sets them up, the plugin starts them when it is switched on and stops them when it is switched off. What differs on
Volumio 2 is under [Volumio 2](#volumio-2).

## Installing

From Volumio's plugin store: Plugins > Search plugins > Xplorio > Install, then switch it on under Installed plugins.
Xplorio then runs at `http://<player>:4040/`; the "Open Xplorio" button on the settings page leads there.

**Without the plugin store** (Volumio 2, or to try a branch) with `xplorio-deploy` over ssh:

```bash
curl -fsSL https://raw.githubusercontent.com/Celindir69/xplorio/main/tools/xplorio-deploy.sh | sudo tee /usr/local/bin/xplorio-deploy >/dev/null
sudo chmod +x /usr/local/bin/xplorio-deploy
sudo xplorio-deploy                  # install or update main; with a branch: sudo xplorio-deploy <branch>
```

| Command | Effect |
|---|---|
| `sudo xplorio-deploy` | install or update the plugin from `main` |
| `sudo xplorio-deploy <branch>` | another branch, e.g. to test before merging |
| `sudo xplorio-deploy -n <branch>` | only say what would happen |
| `sudo xplorio-deploy --password` | set the password for the "System" page again if it is forgotten |

`xplorio-deploy` puts the plugin together with `tools/make-plugin.sh` (plugin files from `plugin/`, interface and services in
`app/`) and installs it through Volumio's own interface, the same way as Volumio's plugin page. `volumio plugin install`
hangs on some Volumio 2 devices (e.g. MX-Stream). The first time, switch the plugin on in Volumio afterwards. The menu shows
the installed version (branch, commit and date) at the bottom below the logo and name.

Xplorio is served entirely by the player: when it can't be reached (for example away from the home network), the browser shows its error page and the home-screen web app simply stays black. From outside, it only works through a VPN into the home network. After an update the browser loads the new files by itself.

## Settings

Everything needed is on the plugin's settings page (Plugins > Installed plugins > Xplorio); no ssh or console is needed:
- **Basics:** port, Tag Service on/off, language, light/dark; plus a button that opens Xplorio.
- **Features:** history, release days, mood tags, color mood, m4a codec and m4a as lossless, TIDAL, Qobuz, HIGHRESAUDIO and
  Spotify (automatic, always or never) and further names of the player (`ALLOWED_HOSTS`).
- **Rotel amplifier:** Rotel bridge on/off, the amplifier's address and, if you like, your own names for the inputs, e.g.
  `aux=Turntable/phono, opt1=TV` (icon after the slash, optional).
- **Last.fm:** [Last.fm credentials](#lastfm-credentials) (API key and shared secret). The plugin writes both to
  `/data/xplorio/data/keys.json`; afterwards the page only shows "Saved", an empty field keeps the stored value, and
  "Delete Last.fm access" removes both.
- **Password:** password for the "System" page (at least 4 characters, leave empty to keep it; once one is set, it can
  only be changed with the current one; forgotten: `sudo xplorio-deploy --password`).

Music folders Volumio may not write to are listed by the page next to the Tag Service; the tag editor fails there.

From these values the plugin writes `app/web/config.local.js`, which the interface and the services read. To set more
(e.g. `ROTEL_PROFILE` for another amplifier), put it in `/data/xplorio/config.local.js`, template
[`web/config.local.js.example`](../web/config.local.js.example): the plugin takes the file before the values of the settings
page, so the page wins. A broken file is left out, and the settings page says so. After a change, switch the plugin off and
on once. The plugin writes the services' settings (port, paths) to `/tmp/xplorio/`. Data, history, password and Last.fm
credentials stay in `/data/xplorio/data/`, also when the plugin is updated or removed.

### Light and Dark

The interface follows the device setting (light or dark) and switches along when the device does. To fix it, use the
settings page; for a quick test, add `?theme=light` to the address.
This also applies to the stage layout for large screens.

### Language

The interface is available in German, English, French, Spanish and Italian. It uses the language set in Volumio's settings, so the artist and
album information from Volumio matches it. On the very first visit the app does not know that language yet; it briefly
shows the device (browser) language and reloads once. If the Volumio language is not available, the device language
applies, otherwise English. To fix the language, use the settings page. For a quick test,
`http://<player>:4040/?lang=en` also works.

Adding a language: copy `web/lang/en.js`, e.g. to `web/lang/nl.js`, adjust code, name and locale in the last line
(`langRegister('nl', 'Nederlands', {…}, 'nl-NL')`) and translate the texts; `{name}` are placeholders and stay as they are,
`{one: …, other: …}` are singular and plural. Then add it to `LANGUAGES` in `web/config.js`. Because an update replaces
the plugin folder, a new language belongs in the repository (pull request), not only on the player.
Texts missing from the file are shown in English.
Dates, numbers, month and weekday names come from the browser in the selected language.

Not translated: texts that Volumio itself delivers (e.g. menu names when browsing) and error messages from the tag
service; these stay German.

### Output device notices

If Volumio cannot open the output device (e.g. amplifier or DAC switched off), the app briefly shows "Audio output not
reachable" or "Audio output is busy"; the progress bar then stays at the start. When Volumio reports a disconnected
device, "Audio output disconnected" appears instead of Volumio's confirmation window; "Audio output connected" only
appears when Volumio reports the device coming back (USB DAC). Volumio's messages are recognised in German, English, French, Spanish and Italian.

## Tag Service (for the Tag Editor)

The Tag Service (`xplorio-tags`, port 8766) writes tags and covers, checks the library, keeps the history and provides
Discover, Mix and the "System" page. It runs as user `volumio`, like Volumio itself, so it only writes to music folders
`volumio` may write to; the settings page lists the others. Switch it on and off on the settings page.
Log: `journalctl -u xplorio-tags -e`.

The service starts with `--max-old-space-size=384`, i.e. with more memory than Node's default (about 256 MB on 32-bit ARM).
Large collections with audio analysis need this, otherwise it aborts with `JavaScript heap out of memory`.

**Access protection:** The Tag Service and the Rotel bridge only accept commands from the interface on the same device.
Another website open in the browser can neither write tags, switch the amplifier, nor read the history.
The services only answer when the player is addressed by its IP address, a name without a dot (`volumio`),
or a name ending in `.local`, `.lan`, `.home`, `.internal`, `.home.arpa`, or `.fritz.box`.
Add other names on the settings page under "Features".
Your own scripts that write without a browser (for example with `curl`) send the header `X-Xplorio: 1`;
`curl -s localhost:8766/health` and other queries work as before.

**Data folder:** Everything the service creates (history, Last.fm session, check result, covers, analysis …) lives in `/data/xplorio/data/`. That folder is readable only by `volumio` and is neither inside the plugin folder nor inside `/data/INTERNAL`, which Volumio may share on the network. Before reinstalling Volumio, backing up `/data/xplorio` is enough.

### Last.fm credentials

Enter the API key and "Shared secret" from https://www.last.fm/api/accounts on the settings page under "Last.fm". The plugin stores them in `/data/xplorio/data/keys.json`; only the Tag Service reads them, and the app queries Last.fm through the service.

The key is enough for similar artists, information texts, cover search, and mood tags; the secret is only needed for scrobbling.

`tags.py` runs with Python 2.7 and 3 and includes mutagen itself; if there is no `python` command, the service uses `python3`.

Notes: Only files under `/mnt/INTERNAL`, `/mnt/USB`, and `/mnt/NAS` are allowed. Previous values for "Undo" are stored in `/data/xplorio/data/changes.jsonl`. If the music files are mirrored from another computer, the next synchronization will overwrite the changes made on the player. After changes MPD re-reads the affected folders, collected 15 seconds after the last change and never while MPD is still updating; with more than three folders, one scan of their common parent folder. While “Check library” is open, changes are only collected and read in once when it is closed (at the latest 10 minutes after the last change). This only works if MPD does not watch the files itself: with `auto_update "yes"` in `/etc/mpd.conf`, MPD scans every changed file immediately, and Volumio then rebuilds its album list each time (about a minute of load per album, up to a hang when editing many albums in a row). Recommendation: `auto_update "no"` (also in the template under `/volumio/app/plugins/music_service/mpd/`, if present) and `sudo systemctl restart mpd`; read in new music as usual with "Update library" (in the Volumio menu "Update", not "Rescan", or with the button at the top of “Check library”, which also covers changes still being collected, or with "Update library" in the gear menu). The service is accessible on the local network without authentication.

### Search for Cover Art Online

In the Album Editor, "Search online" searches iTunes, Last.fm (using the Last.fm key from `keys.json`), and the Cover Art Archive (MusicBrainz) for the album artist (otherwise the artist) and album currently entered in the fields. You can temporarily change the fields for searching without saving them.

Suggestions appear side by side; tapping one applies the image just like a manually selected image (embed and/or `folder.jpg`, with Undo support).

The Tag Service performs the queries; the player therefore needs internet access.

### Check Library

In the menu (gear at the top right, only available while the Tag Service is running): finds albums without cover art, compilations without a consistent album artist, artists with multiple spellings, inconsistent album names/years, albums whose Date tag differs from the first release according to MusicBrainz (from the birthday lookup; the pencil suggests the MusicBrainz date), and tracks without track numbers; the pencil icon opens the appropriate editor.

The check reads the MPD database (`MPD_HOST`, `MPD_PORT`, default `localhost:6600`) and the folders, does not modify any files, and only runs when triggered manually (exception: “Move” for duplicate albums, see below). Result: `/data/xplorio/data/check.json`, retained until the next check. Entries whose pencil was used are recorded there and stay greyed out, also after closing, until the next check.

**Genres:** Two further categories suggest exactly one genre per album from the 15 Discogs top categories (Electronic,
Rock, Jazz, Classical, Pop, Hip Hop, Funk / Soul, Folk, World, & Country, Latin, Reggae, Blues, Stage & Screen,
Non-Music, Children's, Brass & Military).
- *Albums without genre:* suggestion from the audio analysis ([Essentia](#audio-analysis-with-essentia-optional-on-a-mac-or-windows-pc)), averaged over all
  tracks of the album. Without audio analysis there is no suggestion.
- *Merge genres:* a table in `tags/genres.js` maps existing genre tags (e.g. "Trip-Hop", "TripHop", "Klassik", "Hörspiel")
  to a top category, as well as the Discogs sub-styles from the audio analysis. For ambiguous names ("Indie": Rock or Pop)
  the audio analysis decides. Identical changes are shown in one row.

The pencil opens the batch editor with the suggestion; nothing is written until you save, and Undo works as usual. Next to every genre field in the Tag Editor a "Main genre" menu offers the 15 top categories; custom values can still be typed. The
sub-styles ("Trip Hop", "Downtempo") are not written to the files but stay in the Tag Service: `GET /genres?dir=<folder>`
returns the top category and sub-styles of an album (as of the last check), without `dir` all albums.
The model is weaker at recognising classical music, soundtracks and radio plays.

**Duplicate albums:** folders with the same album artist and album name. Case, accents, “The” and punctuation do not
count, nor do additions such as “(Remastered)”, “[Deluxe Edition]” or “- 2009 Remaster”; compilations are compared by
album name only. Folders of one album split by disc next to each other (CD1, CD2 or different disc numbers) count as one
version. Each version shows format, resolution, number of tracks, playing time and path; the best one is marked
(lossless before lossy, then more bits, higher sample rate, more tracks). ▶ plays a version (replacing the queue) while the list stays open.

“Move” puts the folders of a version into the hidden folder `.duplicates` on the same drive, keeping the rest of the
path (`/mnt/INTERNAL/mp3/Nena/Nena` becomes `/mnt/INTERNAL/.duplicates/mp3/Nena/Nena`). This is instant even for large
albums, and MPD does not read folders starting with a dot, so the album disappears from the library with the next scan.
Moving it back with `mv` restores it. If a password for the services is set, the device must be logged in once under
System at the services. Xplorio deletes nothing; to delete for good, use the command the category offers to copy, via ssh, e.g.:
```bash
sudo rm -rf '/mnt/INTERNAL/.duplicates'
```
The Tag Service needs write access to the music folders for this, as for the Tag Editor.

### Web Radio: Cover Art and Station Logos

If a web radio station broadcasts "Artist - Title", the Tag Service searches iTunes for the corresponding cover art (falling back to Deezer) and displays it in the app; if no title is available or no match is found, the station logo remains.

The radio list displays the station logos using the address provided by Volumio, otherwise by looking up the station name via radio-browser.info. The Tag Service stores both under `/data/xplorio/data/radio-covers/` and `/data/xplorio/data/stations/`.

### Welcome screen

When the page opens (only with the Tag Service), a card in the middle of the window (with a wide margin in landscape) greets you by time of day: the **album of the day** (random, preferring albums not played for a long time or never; it stays the same all day) with "Play" and the album text (as in the info overlay, scrollable), **Better together** (see below), **Recently played** (albums with at least two tracks played recently), **Around this time X years ago** (albums played around this date a year or more ago, ± 3 days), **New in the collection** (albums whose files were added or changed in the last 180 days, by MPD's modification date) and a random mix. Tapping beside it closes it. It appears on its own at most every 30 minutes and not in the stage layout; "Show on opening" at the bottom turns it off for this device, and the menu entry "Welcome screen" opens it any time. With `?welcome=0` in the address it stays closed on opening (e.g. for a bookmark). After the update the Tag Service re-reads the album list once; until then "New in the collection" is missing.

**Birthdays:** albums whose release day is today, this week (Monday to Sunday) or this month. The welcome screen shows today and this week (otherwise the month); Search & Discover shows all three in the Albums tab, plus "Recently played" and "New in the collection". Round birthdays (10, 20, 30 … years) carry the years as a badge, anniversaries (25, 50, 75 years) also a gold frame; they come first. The date comes from a complete Date tag (YYYY-MM-DD, matching the album's year); without one, the Tag Service looks it up once at MusicBrainz (first release of the release group, one request every 1.5 seconds, compilations excluded) and keeps it in `/data/xplorio/data/releasedates.jsonl`; albums not found are tried again after 90 days. For a large collection the first pass takes a few hours; while there is hardly any data and no birthday has been found yet, Discover shows the progress. To disable it: settings page under "Features" (release days).

### System

In the menu under "System": the current CPU load (refreshed every 2 seconds, with the last 3 minutes and per core), a history of the last 24 hours (load, temperature or memory, averaged per minute), temperature, memory, the usage of each drive (internal card, USB and each connection under `/mnt/NAS/` separately; an unreachable connection is shown as "not reachable"), Volumio version, kernel, uptime and the file currently playing. The Tag Service reads the values from `/proc`, `/sys` and `df`; it samples every 2 seconds (one small file, no noticeable load) and saves the history every 10 minutes to `/data/xplorio/data/sysinfo.json`.

#### Services
Below that, the "Services" card: Volumio, MPD, Xplorio web server, Tag Service and Rotel control with their state (running
for …, stopped, error) and a "Restart" button. The page asks before restarting. Services that are not running on the player
are not listed. The Tag Service restarts the services with `sudo systemctl`, which Volumio allows the user `volumio`; the
plugin adds no sudo rule of its own. If the player does not allow it, the card shows the state and a hint.

Below the services are "Restart" and "Shut down" for the whole player, each with a confirmation. If a password is set (see
below), they ask for it too; otherwise not, since Volumio itself offers both without a password. They use `/sbin/reboot`
and `/sbin/poweroff` like Volumio.

The service buttons are also protected by a password and stay locked until one is set on the plugin's settings page. Only
a hash (PBKDF2 with salt) is stored, in `/data/xplorio/data/admin.json`; a new password signs out all devices. On the first tap on a button the page asks for the password; the device (the browser) then stays signed in for
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
sudo systemctl restart xplorio-tags
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

**ReplayGain tags with rsgain (optional):** If the tags are missing, [rsgain](https://github.com/complexlogic/rsgain)
adds them to the files afterwards; the audio itself stays unchanged. Like the audio analysis, it runs on a Mac or PC, not
on the player. If the music is on the player, connect its share with write access.

```bash
brew install rsgain                                        # Mac; Ubuntu/WSL: sudo apt install rsgain
rsgain easy -m MAX /Volumes/<share>/<music folder>        # everything, using all CPU cores
rsgain easy -S -m MAX /Volumes/<share>/<music folder>     # later: only albums without tags (e.g. newly added ones)
```

On Windows, unpack the ZIP file from the [release page](https://github.com/complexlogic/rsgain/releases) and run e.g.
`rsgain.exe easy -m MAX "Z:\Music"`.

- `easy` assumes that every album is in its own folder and calculates the album values from that. If the collection is
  organised differently, write only track values with `-p no_album` and choose "Track" under "Playback".
- rsgain changes the files. If you also use the [audio analysis](#audio-analysis-with-essentia-optional-on-a-mac-or-windows-pc),
  run rsgain first; otherwise `analyse.py` analyses the changed files again on its next run.

### History and Statistics

In the menu (gear at the top right) under "History and stats": **Recent** (by day), **Most played** (tracks, albums, artists, or genres; 30 days, 12 months, or all time), **Stats** (plays, listening time, history, time of day, weekday, top 8 genres; tapping a genre opens its albums), and **Year in review** (one year: totals compared with the previous year, months, plus expandable top tracks, albums, artists, genres, and newly discovered artists; tapping a monthly bar displays the rankings for that month; genres are taken from the album list below).

Tapping plays the track or opens the album or artist.

**Did you mean …?** If the search finds nothing in your own collection (Volumio only matches exact parts of names there), the Tag Service suggests up to three similar artist or album names, e.g. "Motörhead" for "Motorhead" or "Metallica" for "Metalica". Accents, upper and lower case, a leading "The", "&"/"and" and punctuation do not matter, and small typos are forgiven. Tapping a suggestion searches for it. Track titles are not compared; the streaming services have their own typo-tolerant search.

**Discover:** As long as nothing has been entered in "Search & Discover", the page shows several swipeable rows of artists, albums, or tracks matching the selected tab: **Random Discoveries** (preferring music not played for a long time or never; ↻ draws again), **Played a Year Ago** (around this date one year ago, otherwise 2, 3, etc. years ago), **Not Heard in a While** (more than six months ago), **Never Heard**, and **Once Played a Lot** (played often, but not in the last six months). Empty rows are hidden. Tap an artist or album to open it, tap a track to play it. All of this is based on the playback history (see above). The dice at the right of each row plays 25 tracks from the whole row (not just the visible tiles), matching the tab: in the Tracks tab the row's tracks, in the Artists tab tracks by the row's artists, in the Albums tab tracks from the row's albums (so "Never Heard" in the Artists tab only uses artists never played). "Random Discoveries" and "Played X Years Ago" mix tracks in every tab. The dice rules apply (see Random mix), without "dislike" tracks.

**By mood, energy, style and decade:** Below the rows there are selection buttons. Mood (Relaxed, Dreamy, Melancholic, Dark, Happy, Intense, Epic; the same names as in the mood mix), energy (Calm, Medium energy, High energy) and style (Acoustic, Ambient, Electronic, Funky, Soulful, Experimental) open the matching albums with "Play all" and the dice, just like a genre; there the dice only takes tracks that themselves carry this mood, style or energy. An album matches when at least half of its classified tracks carry that mood or style (a style button groups related styles, e.g. Electronic also covers downtempo, house and trip-hop), or when its average energy lies in the range (Calm 1–2, Medium energy 3, High energy 4–5); it needs at least two classified tracks. How many albums match depends on the mood tags. The mood mix stays separate. A decade opens its albums, sorted by year, with "Play all" and the dice. The year is the most frequent Date tag in the album folder (from MPD, i.e. the value shown in the tag editor); albums without a year are left out. After the update the Tag Service re-reads the album list once; until then the decades are missing.

**Release year:** The album title is followed by its year in parentheses: in the player view, the album header, the album lists of the artist page, genre, decade and mood pages, and album results in search. Tapping the year opens the albums of that year. Year and decade pages have two tabs, "Albums" and "Discover". "Discover" shows artists with albums from the decade, the decade's most frequent moods and styles, and the neighbouring decades. Mood and style there show only albums of that decade (e.g. "Melancholic · 1980s"); "All decades" lifts that filter.

**Ratings** (Tag Service only): on the artist page a heart marks favourite artists; the album header has one to five stars (tap the same star again to clear the rating). Tracks have a thumb, in the queue and in an album's track list; each tap moves on from neutral (outline) to "like" (thumb up) to "dislike" (thumb down) and back. "Like" is the same as a Volumio favourite: the thumb adds the track to the Volumio favourites, and existing favourites show the thumb up. Hearts, stars and dislikes are stored by the Tag Service in `/data/xplorio/data/ratings.json`. Disliked tracks are left out of the dice, the mood mix and the track rows in Discover.

**Hidden Gems** (Tag Service only): in Discover, the row below Random Discoveries shows artists, albums or tracks from the library that have never or hardly been played (artists and albums at most twice, tracks at most once) and match your taste. Your taste is built from hearted artists, albums with 4 or 5 stars, the Volumio favourites (the Tag Service asks Volumio for them at most once a minute) and, with less weight, the playback history. Genre, mood, style and energy from the mood tags are compared; tracks without mood tags do not appear in the track row. Unheard albums and tracks by favourite artists are always included. Each tile shows the reason: "♥ Unheard" (favourite artist), "Like …" (sounds like a favourite artist) or mood · genre. Left out: disliked tracks, albums whose tracks are mostly disliked, albums you have already rated, hearted artists and favourites. ↻ draws again. Without ratings only the history counts; without history the row is hidden.

**Better together** (Tag Service only): the "Artists" tab in Discover and the welcome screen show mixes of two or three artists from your collection that fit together musically. Each starts from an artist you play often or have hearted, joined by artists with a similar sound (genre, mood, style and energy from the mood tags, compared with the other artists in your collection). If Last.fm lists one of them as a similar artist, that counts too (only with a Last.fm key), and artists you play less get a small head start. Each tile shows the artists' photos and what they have in common. Tapping it opens the preview: about 25 tracks, roughly 40 % favourites (played often, a favourite or on an album with 4–5 stars) and the rest rarely or never played (never played ones are marked "new"); the artists take turns and energy and tempo change gently. "Play mix" replaces the queue, the dice draws a new mix, + appends it. The mixes stay the same all day; ↻ draws new ones. The Tag Service remembers the pairings shown for seven days in `/data/xplorio/data/together.json`, so they do not come back right away. Left out: "Various", artists with fewer than six tracks, disliked tracks and albums with 1–2 stars.

**Discover on the artist page:** The artist page has three tabs: "Albums & tracks", "Discover" and "Background" (the last chosen one stays open when going back). "Background" shows the artist text like the information page in the player. In the "Discover" tab, buttons lead on: similar artists from the collection (Last.fm), the moods and styles carried by at least a fifth of the artist's classified tracks, their average energy and the decades of their albums. Each button opens the artist or the matching albums, just like in Discover; the path so far does not act as a filter. The dice in front of the similar artists starts a random mix of the artist and the similar artists, each appearing about equally often, however much of them is in the collection.

**Play count** (Tag Service): The album page's play row shows in the middle how often the album was played and when last (from the history; tracks without a break of more than three hours count as one listen).

**Discover on the album page** (Tag Service): The album page has the tabs "Tracks", "Discover" and "Background". "Discover" shows similar albums from the collection (comparing moods, styles and energy of the classified tracks, at most one per artist, with a dice for a random mix from them and the album itself), the album's mood, energy and styles, year, decade and genre, and more albums by the artist. "Background" shows the album text with the credits below.

For artists and albums from a streaming service the tab is called "Discover locally" and searches your own collection: similar artists via Last.fm, for an album the album of the same name in the collection or, if it is missing there, the artist's profile.

**More like this track:** Tapping the title in the player (own file) opens up to 25 tracks from the collection with a similar mood and energy and, with audio analysis, a similar tempo (half or double tempo counts as the same); style and genre count a little. At least one mood must match, at most two tracks per artist, and "dislike" tracks are left out. Each track shows the shared moods, its tempo and its energy. "Play all" plays the list, the dice lets the current track finish and replaces everything after it in the queue with 25 other similar tracks. Without mood data for the track, a note is shown.

**Random mix:** Next to "Play all" (artist page, genre lists), the dice starts 25 random tracks from that selection. Dice rules: at most three tracks per artist and two per album (on the artist page no artist limit, three per album); tracks played in the last 14 days only when there is not enough else; if the selection is too small, it is filled up beyond the limits. Never the same artist twice in a row; "dislike" tracks never.

The Tag Service reads the album list from MPD and stores it in `/data/xplorio/data/albums.json`; it is re-read when the MPD database changes (checked at most once a minute; after tag changes automatically about a minute after the scan).

**Genres:** The fourth search tab (only with the Tag Service) shows tiles of all genres when nothing is entered, and the matching genres otherwise. With more than twelve genres, a "Random genres" row sits above them; ↻ draws it again. Tapping one opens the genre page: if there are [audio analyses](#audio-analysis-with-essentia-optional-on-a-mac-or-windows-pc), it first shows tiles of the styles (Discogs sub-styles, e.g. "Trip Hop" under Electronic) with "All" in front, otherwise all albums of the genre right away, sorted by artist. Each album counts up to three sub-styles of its genre, averaged over the analysed tracks; albums without an analysis appear only under "All". Search also finds sub-styles. An album's genre is its most frequent genre tag (from the album list). The album page shows artist, album and genre one below the other; artist and genre open their pages. In album lists the genre is shown small before the pencil, in the player view small below the quality line (tapping it opens the genre page). [Check library](#check-library) helps to unify and fill in genre tags.

The Tag Service fetches artist images once from Deezer and stores them under `/data/xplorio/data/artists/` (Last.fm no longer provides them); if no image is available, Volumio's artist icon is shown.

The Tag Service checks Volumio every 5 seconds (every 15 seconds while paused/stopped) for playback status (`VOLUMIO_URL`, default `http://localhost:3000`). A track counts if it is longer than 30 seconds and has been played either halfway through or for 4 minutes; web radio does not count.

Each play is stored as one line in `/data/xplorio/data/plays.jsonl`. To disable it: settings page under "Features" (history).

**Last.fm:** For scrobbling, the service needs not only `LASTFM_KEY` but also `LASTFM_SECRET` in `/data/xplorio/data/keys.json` (see [Last.fm credentials](#lastfm-credentials)). Then, under Statistics, select "Connect to Last.fm", choose "Allow" on Last.fm, and then return to the app and select "Done". After that:

- new plays are scrobbled (including "now playing"); without an internet connection, they wait in a queue (Last.fm still accepts them up to 14 days later),
- the existing Last.fm history is imported once; "Sync with Last.fm" only fetches new entries later. Anything already in the history (same track within 5 minutes) is not added twice.

The session key is stored in `/data/xplorio/data/lastfm.json` and remains on the player. If another Last.fm plugin in Volumio is also scrobbling, disable one of them, otherwise every track will be submitted to Last.fm twice.

### Mood Tags

With `LASTFM_KEY`, the Tag Service retrieves the Last.fm tags for every track in the library (`track.getTopTags`, falling back to the artist's tags if no useful track tags are available) and maps them to mood, energy (1–5), and style according to `tags/mood/lastfm_mapping.json` and `tags/mood/classification_rules.json`.

Queries are only made while nothing is playing (stopped or paused; checked every 5 seconds), at around 4 requests per second. The music files remain unchanged; the raw tags are stored in `/data/xplorio/data/moodtags/`, and the associated track list is stored in `/data/xplorio/data/library-tracks.json` (generated together with the album list).

Progress and distribution are shown in “Check library” under "Mood tags (Last.fm)".

To disable it: settings page under "Features" (mood tags).

**Mood Mix:** Playlist button, "Mood Mix" tab (appears as soon as the Tag Service is running). Here you can select multiple moods, an energy range, one or more genres (the album's genre tag, never relaxed), and, under "Fine-tuning", styles, tempo (with audio analysis), years (the album's release year from the Date tag; with a limit, albums without a year are left out, never relaxed), length, maximum track length (default 20 min, keeps DJ mixes out), and discovery level (based on playback history: favorites, balanced, hidden gems).

"Create mix" only shows a preview; only "Play mix" replaces the queue (the list icon next to it appends the mix instead). If there are fewer than 20 exact matches, the mix also includes similar tracks (energy ±1, then without style) and indicates this. The same artist is never played twice in a row.

### Audio Analysis with Essentia (Optional, on a Mac or Windows PC)

[Essentia](https://essentia.upf.edu) analyzes each track's audio directly and provides tempo (BPM), key, mood (happy, sad, relaxed, aggressive, party), danceability, vocal/instrumental classification, valence and arousal, as well as Discogs styles.

This requires too much processing power for the player, so `tools/essentia/analyse.py` runs on the Mac (or a Windows PC, see below) and uploads a results file. The Tag Service then uses the audio-derived energy, tempo, and mood values for those tracks, while Last.fm adds additional moods and styles; the Mood Mix then gets a tempo control under "Fine-tuning".

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

**On Windows:** There is no Essentia package for Windows, but there is one for Linux, and it runs on Windows 10 and 11 in the Windows Subsystem for Linux (WSL). Once, in a Command Prompt opened as administrator, run `wsl --install` (this sets up Ubuntu; then restart and choose a user name and password for Ubuntu). Then, in the "Ubuntu" window:

```bash
sudo apt update && sudo apt install -y python3-venv ffmpeg
python3 -m venv ~/mx-essentia && source ~/mx-essentia/bin/activate
python -m pip install "essentia-tensorflow==2.1b6.dev1389" mutagen
curl -fsSLO https://raw.githubusercontent.com/Celindir69/xplorio/main/tools/essentia/analyse.py
```

If pip reports "from versions: none", Ubuntu has a newer Python; then install without `==…`. After that, proceed as below, only with different paths and without `caffeinate`:

- Windows drives are under `/mnt/c/`, `/mnt/d/` and so on, e.g. `python3 analyse.py /mnt/d/Music`.
- If the music is on the player, map its share as a network drive in Explorer (e.g. `Z:` for `\\<player IP>\<share>`) and mount it in Ubuntu: `sudo mkdir -p /mnt/z && sudo mount -t drvfs Z: /mnt/z` (again after every Windows restart). Then `python3 analyse.py --player http://<player IP> /mnt/z/<music folder>`.
- Use the player's IP address: Ubuntu under WSL often cannot resolve names ending in `.local`.
- Keep the Ubuntu window open, and do not let Windows go to sleep (Settings > System > Power, set to "Never" while the analysis runs).

Run the analysis (first a short test run, then everything; `caffeinate -i` keeps the Mac awake):

```bash
source ~/mx-essentia/bin/activate
python3 analyse.py --limit 20 /Volumes/<Drive>/<MusicFolder>
caffeinate -i python3 analyse.py /Volumes/<Drive>/<Folder 1> /Volumes/<Drive>/<Folder 2>
python3 analyse.py --upload http://<player>:8766
```

- Matching is based on artist and title (as with the Last.fm tags), not on the path: the folder structure and drive used on the Mac do not matter. Tracks that do not exist on the player are simply ignored there.
- Multiple folders can be specified, symlinks are followed; `--exclude "*/Audiobooks/*"` excludes matching paths.
- If a password for the services is set in the Xplorio settings, the player only accepts the result with it:
  the script asks for it once at the start (or takes it from the environment variable `XPLORIO_PASSWORD`).
- Unchanged files are skipped on subsequent runs; Ctrl-C aborts the process, and the next invocation continues where it left off.
  With `--upload` or `--player` it uploads the results so far when aborted (a second Ctrl-C cancels that too; if the
  player is playing, the next run catches up).
  If the collection has moved (another drive, a network share, a different folder structure), the script recognises
  files it has already analysed by file name and size and does not analyse them again.
- **Music stored on the player itself:** if the files live on the player (USB drive or internal storage), connect its
  share in Finder (⌘K, `smb://<player>`, read-only is enough) and analyse with `--player`:
  `caffeinate -i python3 analyse.py --player http://<player> /Volumes/<share>/<music folder>`.
  The script then only starts a new file while the player is reachable and not playing; when playback starts, files
  already in progress finish, then it checks again every 10 minutes (`--player-wait 20` for 20 minutes). At the end
  it uploads the result to the tag service by itself (no `--upload` needed), and the results so far every 2 hours
  in between while the player isn't playing (`--upload-every 60` for every hour, `0` only at the end). If the share is not connected at
  start, it stops instead of discarding the existing results for that folder.
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

## Rotel Bridge (Optional)

Controls a Rotel amplifier on the network: power, volume and the remote control (see below). The bridge is a small service on
the player (`xplorio-rotel`, port 8765) that keeps the connection to the amplifier (TCP, port 9590); the interface only talks
to the bridge.

**Preparing the amplifier:** connect the network cable, read the IP address from the amplifier's menu (ideally reserve it
in the router) and set the power mode to "Quick" so it can be switched on from standby over the network.

**Switching it on:** on the plugin's settings page under "Rotel amplifier", switch the Rotel bridge on and enter the
amplifier's address, e.g. `192.168.1.50`. The plugin restarts the bridge when you save. Without the Rotel bridge, the
interface controls Volumio's volume (if enabled there).

**Checking** (over ssh):

```bash
curl -s localhost:8765/state
```

`"connected":true` means the bridge has reached the amplifier; `"power"` and `"volume"` show its state. With
`"connected":false` the log shows why (wrong address, amplifier without network):

```bash
journalctl -u xplorio-rotel -n 30 --no-pager
```

Reload the interface once; the remote control icon appears at the top right of the player view.

### Remote control

With `ROTEL: true`, a remote control icon appears at the top right of the player view. It opens the "Playback" page (gear menu) at the "Amplifier" card: power/standby, volume and mute, input, tone bypass, bass, treble, balance, and speakers A and B. The values come from the amplifier and also follow the physical remote.

The commands are preset for the Rotel RA-1572 / RA-1572MKII (ASCII protocol V2, port 9590). For other models, use `/data/xplorio/config.local.js` (see [Settings](#settings)); anything left out keeps the default:

```js
window.APP_CONFIG.ROTEL_PROFILE = {
  model: 'My amplifier',
  sources: [{cmd: 'pcusb', name: 'Player'}, {cmd: 'opt1', name: 'TV'}, {cmd: 'phono', name: 'Turntable'}],
  speakerB: false,             // false hides a control (bypass, bass, treble, balance, speakerA, speakerB)
  powerOnSource: 'pcusb'       // input selected after power-on, '' = don't switch
};
```

Other fields: `bypass: ['bypass_on', 'bypass_off']`, `speakerA`/`speakerB` each `[on, off]`, `bass`/`treble` each `[up, down, center]`, `balance: [right, left, center]`, `toneMax` (default 10) and `balanceMax` (15). Other Rotel devices and Rotel's Michi series (X3, X5, P5, S5, M8) use the same ASCII protocol; the commands and the port (`ROTEL_AMP_PORT`) are in the device's protocol PDF on rotel.com (the P5, for example, uses port 9596 instead of 9590). Commands are written without the trailing `!`; the bridge only accepts commands from the profile. After a change, switch the plugin off and on once.

**Active input in the player view:** when the amplifier is set to an input other than the player's (`powerOnSource`, `pcusb` if not set), the line below the title shows the input's name instead of format and quality, and an icon replaces the pencil (tapping it opens the remote control). The input's icon is shown large in place of the cover, with its name as the title; the seek bar and playback buttons are disabled (volume is not). If you pick an album or track to play in Xplorio meanwhile, Xplorio only puts it in the queue without starting it (a start into nowhere would make Volumio skip through the album unheard), and the player view shows its album with cover, artist and album title (track title, track info and lyrics only on the player's input, since something else is playing on the other one), streaming services included. After switching the amplifier back to the player's input, tapping play starts the first track. Tapping a track in the queue does not play it meanwhile but only names the input. The icons follow the input: `phono`, `cd`, `tuner`, `bluetooth`, `usb`, `digital` (Opt/Coax), `aux` (also XLR), `pc` (PC-USB) and `tv`. To change the name and icon of single inputs without rewriting the whole list (also used by the remote control): on the settings page under "Rotel amplifier", e.g. `aux=Turntable/phono, opt1=TV/tv`.

## Streaming Services (TIDAL, Qobuz, HIGHRESAUDIO, Spotify)

The elements for streaming services (tiles in search, similar artists from the service in the information view, and the service's artist and album pages) only appear if the corresponding plugin is active in Volumio.

To permanently enable or disable them, use the settings page under "Features" (automatic, always or never).

If multiple services are active, search displays their results in separate sections. Spotify requires Volumio's Spotify plugin with search support (Premium account); Spotify Connect alone does not provide search.

The TIDAL watchdog described below applies only to TIDAL.

## TIDAL Watchdog (Optional)

Not part of the plugin; set it up over ssh if you need it (from the repository folder):

```bash
sudo mkdir -p /data/xplorio/tools && sudo cp tools/tidal-watchdog.sh /data/xplorio/tools/
sudo chmod +x /data/xplorio/tools/tidal-watchdog.sh
sudo /data/xplorio/tools/tidal-watchdog.sh --check      # check only
echo '*/10 * * * * root /data/xplorio/tools/tidal-watchdog.sh' | sudo tee /etc/cron.d/tidal-watchdog
```

Checks every 10 minutes whether TIDAL responds and restarts Volumio if it does not (at most once per hour). Log: `/var/log/tidal-watchdog.log`.

If TIDAL is not logged in, do not set up the watchdog.

## Endless play (AutoDJ)

With the [autodj-plugin](https://github.com/Celindir69/autodj-plugin) (version 1.1 or later), the repeat button gets a fourth state: off → all → one → ∞. With ∞, repeat is off and AutoDJ is on; it appends similar tracks whenever the queue is about to run out. The next tap turns AutoDJ off again. If it is switched in Volumio, the button shows that too (within 30 seconds). Without the plugin, or without a Last.fm key in the plugin settings, the button keeps its three states.

## Volumio 2

The plugin store for Volumio 4 only takes plugins for Debian bookworm. The plugin also runs on Volumio 2 (e.g. MX-Stream);
there it is installed and updated with [`xplorio-deploy`](#installing). Differences:

- **Python:** Volumio 2 has Python 2.7, Volumio 4 Python 3; `tags.py` runs with both, and the Tag Service includes mutagen.
- **Information texts:** Volumio 4 only provides artist and album information with a subscription; the app therefore retrieves it from Last.fm and Wikipedia (see [Artist and Album Information](#artist-and-album-information)). With a Last.fm key, album information is also available.
- **Not tested under Volumio 4:** Rotel Bridge and TIDAL Watchdog.
