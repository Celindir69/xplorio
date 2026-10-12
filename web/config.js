/* Einstellungen der App. Eigene Werte (z. B. den Last.fm-Schlüssel) NICHT hier eintragen,
   sondern in web/config.local.js; diese Datei ist nicht im Repository (.gitignore). */
window.APP_CONFIG = {
  LANGUAGE: '',       /* Sprache der Oberfläche, z. B. 'de' oder 'en'; leer = wie in Volumio eingestellt (sonst Gerätesprache, sonst Englisch) */
  LANGUAGES: ['de', 'en', 'fr', 'es', 'it'],  /* vorhandene Sprachdateien in web/lang/; eine neue Sprache (z. B. nl.js) hier ergänzen */
  THEME: 'auto',      /* 'auto' = hell oder dunkel wie das Gerät; 'light' = immer hell; 'dark' = immer dunkel (kioskTV.html bleibt dunkel) */
  LASTFM_KEY: '',     /* veraltet: Last.fm-Zugang steht in /data/xplorio/data/keys.json (Tag-Dienst); hier nur noch Ersatz ohne Tag-Dienst */
  LASTFM_SECRET: '',  /* veraltet: wird vom Tag-Dienst einmal nach keys.json übernommen, dann hier löschen */
  HISTORY: true,      /* Verlauf: Tag-Dienst schreibt gespielte Titel mit; false = aus (Tag-Dienst neu starten) */
  RELEASEDATES: true, /* Geburtstage: fehlende Erscheinungsdaten der Alben bei MusicBrainz nachschlagen; false = aus */
  MOODTAGS: true,     /* Stimmungs-Tags: Last.fm-Tags je Titel sammeln, nur wenn nichts spielt (braucht LASTFM_KEY in keys.json); false = aus */
  COLOR_MOOD: true,   /* Farbstimmung aus dem Cover (nur Cover vom Player selbst); false = aus */
  M4A_PROBE: true,    /* m4a: Codec (ALAC/AAC) aus der Datei lesen; false = nur M4A_LOSSLESS */
  M4A_LOSSLESS: true, /* m4a als verlustfrei (ALAC) einstufen; false = kein Abzeichen für m4a (AAC wäre sonst falsch eingestuft) */
  TAGS_PORT: 8766,    /* Port des Tag-Dienstes (Tag-Editor) auf dem Player */
  ALLOWED_HOSTS: [],  /* Tag-Dienst und Rotel-Bridge antworten nur unter IP, Namen ohne Punkt und .local/.lan/.home/.internal/
                         .home.arpa/.fritz.box. Weitere Namen des Players hier eintragen, z. B. ['player.example.net'] */
  ROTEL: false,       /* Rotel-Verstärker über rotel/rotel-bridge.js: Ein/Aus oben links, Lautstärke am Verstärker.
                         false = Lautstärke von Volumio (falls dort eingeschaltet), kein Ein/Aus-Knopf */
  ROTEL_HOST: '',     /* Adresse des Verstärkers im Netz (liest nur rotel-bridge.js), z. B. '192.168.1.50' */
  ROTEL_AMP_PORT: 9590, /* Port des Verstärkers (ASCII-Protokoll) */
  ROTEL_PORT: 8765,   /* Port des Rotel-Dienstes auf dem Player */
  ROTEL_PROFILE: null, /* Fernbedienung (Seite Wiedergabe): Befehle und Eingänge des Verstärkers. null = Rotel RA-1572 /
                         RA-1572MKII; einzelne Teile überschreiben, false blendet ein Element aus (docs/einrichten.md) */
  RECOGNIZE_SHORTCUT: '', /* Name des iOS/macOS-Kurzbefehls, der den Titel einer anderen Quelle mit Shazam erkennt
                         (docs/einrichten.md); gesetzt = Eintrag „Titel erkennen“ im Menü auf Apple-Geräten; leer = aus */
  TIDAL: 'auto',      /* TIDAL-Teile (Auswahl Lokal/TIDAL in der Suche, ähnliche Künstler bei TIDAL):
                         'auto' = nur, wenn das TIDAL-Plugin in Volumio aktiv ist; true = immer; false = nie */
  QOBUZ: 'auto',      /* Qobuz genauso wie TIDAL (Auswahl in der Suche, ähnliche Künstler bei Qobuz):
                         'auto' = nur, wenn das Qobuz-Plugin in Volumio aktiv ist; true = immer; false = nie */
  HRA: 'auto',        /* HIGHRESAUDIO genauso (Plugin "hra"); 'auto' / true / false wie oben */
  SPOTIFY: 'auto',    /* Spotify genauso (Volumios Spotify-Plugin mit Suche, braucht Premium); 'auto' / true / false wie oben */
  ROTEL_CMD_POWER_ON:  'power_on',    /* Befehlsnamen für /cmd?c=... des Rotel-Dienstes */
  ROTEL_CMD_POWER_OFF: 'power_off'
};
