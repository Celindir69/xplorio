/* App settings. Do NOT put your own values (e.g. the Last.fm key) here,
   but in web/config.local.js; that file is not in the repository (.gitignore). */
window.APP_CONFIG = {
  LANGUAGE: '',       /* UI language, e.g. 'de' or 'en'; empty = as set in Volumio (else device language, else English) */
  LANGUAGES: ['de', 'en', 'fr', 'es', 'it'],  /* available language files in web/lang/; add a new language (e.g. nl.js) here */
  THEME: 'auto',      /* 'auto' = light or dark like the device; 'light' = always light; 'dark' = always dark */
  HISTORY: true,      /* history: tag service records played tracks; false = off (restart the tag service) */
  RELEASEDATES: true, /* birthdays: look up missing album release dates on MusicBrainz; false = off */
  ARTISTNAMES: true,  /* library check: look up the usual spelling of the artists on MusicBrainz (else Last.fm); false = off */
  MOODTAGS: true,     /* mood tags: collect Last.fm tags per track, only while nothing is playing (needs LASTFM_KEY in keys.json); false = off */
  COLOR_MOOD: true,   /* color mood from the cover (only covers from the player itself); false = off */
  M4A_PROBE: true,    /* m4a: read the codec (ALAC/AAC) from the file; false = only M4A_LOSSLESS */
  M4A_LOSSLESS: true, /* classify m4a as lossless (ALAC); false = no badge for m4a (AAC would otherwise be misclassified) */
  VU_REF_DBFS: -8,    /* VU meter: level (dBFS RMS) the needle shows as 0 VU; lower = needles further right (docs/einrichten.md) */
  VU_NEEDLE: 'fast', /* VU meter: needle 'fast' or 'classic' (slow like a real VU meter, ~300 ms to the value) */
  VU_DELAY_MS: 400,   /* VU meter: the needles wait this long, MPD fills the fifo ahead of the amplifier's sound */
  PLAYER: 'volumio',  /* who plays: 'volumio' (default) or 'mpd' = MPD alone, without Volumio (e.g. on a Mac with
                         "brew install mpd"). Playback and queue then go through the tag service (tags/mpdplayer.js);
                         streaming services and Volumio's own pages are not available there yet */
  TAGS_PORT: 8766,    /* port of the tag service (tag editor) on the player */
  ALLOWED_HOSTS: [],  /* tag service and Rotel bridge only answer on IP, names without a dot and .local/.lan/.home/.internal/
                         .home.arpa/.fritz.box. Add further names of the player here, e.g. ['player.example.net'] */
  ROTEL: false,       /* Rotel amplifier via rotel/rotel-bridge.js: on/off at the top left, volume on the amplifier.
                         false = volume from Volumio (if enabled there), no on/off button */
  ROTEL_HOST: '',     /* network address of the amplifier (read only by rotel-bridge.js), e.g. '192.168.1.50' */
  ROTEL_INPUTS: {},   /* change name and icon of individual inputs (read by rotel-bridge.js), e.g. {aux: {name: 'Turntable', icon: 'phono'}};
                         icons: phono, cd, tuner, bluetooth, usb, digital, aux, pc, tv */
  ROTEL_MODEL: 'RA-1572', /* amplifier model (read by rotel-bridge.js): 'RA-1572' (also MKII), 'RA-1592', 'RC-1592', 'RSP-1582' */
  ROTEL_AMP_PORT: null, /* amplifier port (ASCII protocol); null = the model's (9590, RSP-1582: 9596) */
  ROTEL_PORT: 8765,   /* port of the Rotel service on the player */
  ROTEL_PROFILE: null, /* remote control (playback page): commands and inputs of the amplifier. null = those of
                         ROTEL_MODEL; override individual parts, false hides an element (docs/einrichten.md) */
  TIDAL: 'auto',      /* TIDAL parts (Local/TIDAL choice in the search, similar artists on TIDAL):
                         'auto' = only if the TIDAL plugin is active in Volumio; true = always; false = never */
  QOBUZ: 'auto',      /* Qobuz same as TIDAL (choice in the search, similar artists on Qobuz):
                         'auto' = only if the Qobuz plugin is active in Volumio; true = always; false = never */
  HRA: 'auto',        /* HIGHRESAUDIO likewise (plugin "hra"); 'auto' / true / false as above */
  SPOTIFY: 'auto',    /* Spotify likewise (Volumio's Spotify plugin with search, needs Premium); 'auto' / true / false as above */
  ROTEL_CMD_POWER_ON:  'power_on',    /* command names for /cmd?c=... of the Rotel service */
  ROTEL_CMD_POWER_OFF: 'power_off'
};
