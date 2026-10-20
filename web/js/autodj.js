/* Endless playback via the AutoDJ plugin (Celindir69/autodj-plugin, REST endpoint "autodj"): fourth state ∞ on the
   repeat button (off → all → one → ∞). AutoDJ pauses while repeat is on, so the states are mutually
   exclusive. Without the plugin or without a Last.fm key in the plugin, there are only three states.
   Classic script, shared global scope; load order see xplorio.html. */
var autodj = {avail: false, enabled: false, ready: false};

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
      var d = j && j.data;
      if (!d || typeof d.enabled !== 'boolean') throw new Error('no AutoDJ');
      autodj = {avail: true, enabled: d.enabled, ready: d.ready !== false};
    })
    .catch(function(){ autodj = {avail: false, enabled: false, ready: false}; })
    .then(function(){
      if (typeof updateCtrlUI === 'function') updateCtrlUI();
      /* keep the state in sync (also when switched in Volumio); without plugin check rarely */
      autodjTimer = setTimeout(function(){ autodjCall(); }, autodj.avail ? 30000 : 300000);
    });
}

if (typeof module !== 'undefined') module.exports = {repeatShown: repeatShown, repeatNext: repeatNext};
else {
  document.addEventListener('visibilitychange', function(){ if (!document.hidden) autodjCall(); });
  setTimeout(function(){ autodjCall(); }, 0);                               /* after all scripts have loaded */
}
