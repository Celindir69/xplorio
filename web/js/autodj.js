/* Endless playback: fourth state ∞ on the repeat button (off → all → one → ∞), via the AutoDJ plugin
   (Celindir69/autodj-plugin, REST endpoint "autodj") or, without it, MyVolumio's Continuous Play (Infinity Playback,
   Premium). AutoDJ pauses while repeat is on, so the states are mutually exclusive. With neither (or AutoDJ without
   a Last.fm key) there are only three states.
   Classic script, shared global scope; load order see xplorio.html. */
var autodj = {avail: false, enabled: false, ready: false};

/* answer of the endpoint -> state; replayGain/crossfade (automatic mode, shown on the "Playback" page) are null
   with plugin versions that do not report them yet */
function autodjState(d) {
  if (!d || typeof d.enabled !== 'boolean') return {avail: false, enabled: false, ready: false};
  return {avail: true, enabled: d.enabled, ready: d.ready !== false,
          replayGain: typeof d.replayGain === 'boolean' ? d.replayGain : null,
          crossfade: typeof d.crossfade === 'number' ? Math.max(0, d.crossfade) : null};
}

/* displayed state: AutoDJ on and repeat off = ∞ */
function repeatShown(mode, adj) { return (mode === 'off' && adj.avail && adj.enabled) ? 'inf' : mode; }

/* next state on tap: {mode, repeat: values for setRepeat or null, autodj: true/false or null (do nothing)} */
function repeatNext(shown, adj) {
  var OFF = {value: false, repeatSingle: false};
  if (shown === 'off') return {mode: 'all', repeat: {value: true, repeatSingle: false}, autodj: null};
  if (shown === 'all') return {mode: 'one', repeat: {value: true, repeatSingle: true}, autodj: null};
  if (shown === 'one') {
    if (adj.avail && adj.ready) return {mode: 'inf', repeat: OFF, autodj: true};
    return {mode: 'off', repeat: OFF, autodj: (adj.avail && adj.enabled) ? false : null};
  }
  return {mode: 'off', repeat: null, autodj: false};                       /* ∞ → off */
}

/* query the plugin ({} = state, {enabled: …} = switch); no answer means it is not installed */
var autodjTimer = null;
function autodjCall(data) {
  clearTimeout(autodjTimer);
  return withTimeout(fetch('/api/v1/pluginEndpoint', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({endpoint: 'autodj', data: data || {}})
  }), 5000).then(function(r){ return r.json(); })
    .then(function(j){
      autodj = autodjState(j && j.data);
    })
    .catch(function(){ autodj = {avail: false, enabled: false, ready: false}; })
    .then(function(){
      if (typeof updateCtrlUI === 'function') updateCtrlUI();
      /* keep the state in sync (also when switched in Volumio); without plugin check rarely */
      autodjTimer = setTimeout(function(){ autodjCall(); }, autodj.avail ? 30000 : 300000);
    });
}

/* MyVolumio's Infinity Playback ("Continuous Play", Premium, Volumio 4) over the websocket:
   pushInfinityPlayback {available, enabled}; without Premium or on older Volumio there is no answer */
var volumioInfinity = {avail: false, enabled: false};
function infinityState(d) {
  return (d && d.available === true) ? {avail: true, enabled: d.enabled === true} : {avail: false, enabled: false};
}

/* which one ∞ switches: AutoDJ when installed (installing it is a deliberate choice), else Continuous Play;
   same shape as autodjState plus kind 'autodj' | 'infinity' | null */
function endlessState(adj, inf) {
  if (adj.avail) return {avail: true, enabled: adj.enabled, ready: adj.ready, kind: 'autodj'};
  if (inf.avail) return {avail: true, enabled: inf.enabled, ready: true, kind: 'infinity'};
  return {avail: false, enabled: false, ready: false, kind: null};
}
function endless() { return endlessState(autodj, volumioInfinity); }
/* switch the active one; turning AutoDJ on also turns Continuous Play off, or both would add tracks */
function endlessSet(on) {
  var e = endless();
  if (e.kind === 'autodj') {
    autodj.enabled = on;
    autodjCall({enabled: on});
    if (on && volumioInfinity.enabled) socket.emit('setInfinityPlayback', {enabled: false});
  } else if (e.kind === 'infinity') {
    volumioInfinity.enabled = on;
    socket.emit('setInfinityPlayback', {enabled: on});
  }
}

if (typeof module !== 'undefined') module.exports = {repeatShown: repeatShown, repeatNext: repeatNext, autodjState: autodjState, infinityState: infinityState, endlessState: endlessState};
else {
  socket.on('pushInfinityPlayback', function(d){
    volumioInfinity = infinityState(d);
    if (typeof updateCtrlUI === 'function') updateCtrlUI();
  });
  socket.on('connect', function(){ socket.emit('getInfinityPlayback'); });
  if (socket.connected) socket.emit('getInfinityPlayback');
  document.addEventListener('visibilitychange', function(){ if (!document.hidden) autodjCall(); });
  setTimeout(function(){ autodjCall(); }, 0);                               /* after all scripts have loaded */
}
