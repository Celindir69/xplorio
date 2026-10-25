/* App settings. Do NOT put your own values (e.g. the Last.fm key) here,
   but in web/config.local.js; that file is not in the repository (.gitignore). */
window.APP_CONFIG = {
  LANGUAGE: '',       /* UI language, e.g. 'de' or 'en'; empty = as set in Volumio (else device language, else English) */
  LANGUAGES: ['de', 'en', 'fr', 'es', 'it'],  /* available language files in web/lang/; add a new language (e.g. nl.js) here */
  THEME: 'auto',      /* 'auto' = light or dark like the device; 'light' = always light; 'dark' = always dark */
  LASTFM_KEY: '',     /* deprecated: Last.fm access is in /data/xplorio/data/keys.json (tag service); here only a fallback without tag service */
  LASTFM_SECRET: '',  /* deprecated: copied once into keys.json by the tag service, then delete it here */
  HISTORY: true,      /* history: tag service records played tracks; false = off (restart the tag service) */
  RELEASEDATES: true, /* birthdays: look up missing album release dates on MusicBrainz; false = off */
  MOODTAGS: true,     /* mood tags: collect Last.fm tags per track, only while nothing is playing (needs LASTFM_KEY in keys.json); false = off */
  COLOR_MOOD: true,   /* color mood from the cover (only covers from the player itself); false = off */
  M4A_PROBE: true,    /* m4a: read the codec (ALAC/AAC) from the file; false = only M4A_LOSSLESS */
  M4A_LOSSLESS: true, /* classify m4a as lossless (ALAC); false = no badge for m4a (AAC would otherwise be misclassified) */
  TAGS_PORT: 8766,    /* port of the tag service (tag editor) on the player */
  ALLOWED_HOSTS: [],  /* tag service and Rotel bridge only answer on IP, names without a dot and .local/.lan/.home/.internal/
                         .home.arpa/.fritz.box. Add further names of the player here, e.g. ['player.example.net'] */
  ROTEL: false,       /* Rotel amplifier via rotel/rotel-bridge.js: on/off at the top left, volume on the amplifier.
                         false = volume from Volumio (if enabled there), no on/off button */
  ROTEL_HOST: '',     /* network address of the amplifier (read only by rotel-bridge.js), e.g. '192.168.1.50' */
  ROTEL_INPUTS: {},   /* change name and icon of individual inputs (read by rotel-bridge.js), e.g. {aux: {name: 'Turntable', icon: 'phono'}};
                         icons: phono, cd, tuner, bluetooth, usb, digital, aux, pc, tv */
  ROTEL_AMP_PORT: 9590, /* amplifier port (ASCII protocol) */
  ROTEL_PORT: 8765,   /* port of the Rotel service on the player */
  ROTEL_PROFILE: null, /* remote control (playback page): commands and inputs of the amplifier. null = Rotel RA-1572 /
                         RA-1572MKII; override individual parts, false hides an element (docs/einrichten.md) */
  TIDAL: 'auto',      /* TIDAL parts (Local/TIDAL choice in the search, similar artists on TIDAL):
                         'auto' = only if the TIDAL plugin is active in Volumio; true = always; false = never */
  QOBUZ: 'auto',      /* Qobuz same as TIDAL (choice in the search, similar artists on Qobuz):
                         'auto' = only if the Qobuz plugin is active in Volumio; true = always; false = never */
  HRA: 'auto',        /* HIGHRESAUDIO likewise (plugin "hra"); 'auto' / true / false as above */
  SPOTIFY: 'auto',    /* Spotify likewise (Volumio's Spotify plugin with search, needs Premium); 'auto' / true / false as above */
  ROTEL_CMD_POWER_ON:  'power_on',    /* command names for /cmd?c=... of the Rotel service */
  ROTEL_CMD_POWER_OFF: 'power_off'
};
