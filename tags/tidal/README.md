# TIDAL on the Mac (PLAYER 'mpd')

`auth.js`, `api.js`, `uris.js`, `items.js`, `browse.js`, `manifest.js`, `cache.js` and `proxy.js` come from
Michal Tamas' Volumio TIDAL plugin (https://github.com/michaltamas/volumio-tidal-plugin, MIT, see LICENSE).
Changes: `browse.js` takes `searchLimit` (the plugin always asks for 20 hits).

`service.js` is Xplorio's own glue for the tag service: login (device code, the user's own TIDAL account), browse and
search in Volumio's answer shape, queue entries for MPD (addresses of the local proxy), seeking in cached tracks.
