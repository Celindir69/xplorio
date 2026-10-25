/* Light or dark: ?theme=light|dark|auto in the URL, else THEME in config(.local).js, else 'auto' (follows the device,
   switches along, e.g. in the evening). Sets html.light; the colors are in web/css/base.css. Also applies to the stage view.
   Classic script, ES5; loaded in <head> after config.js so the page appears in the right colors right away. */
(function(){
  var cfg = window.APP_CONFIG || {};
  var m = /[?&]theme=(light|dark|auto)\b/.exec(location.search);
  var want = (m && m[1]) || cfg.THEME || 'auto';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function apply() {
    var light = want === 'light' || (want !== 'dark' && !!(mq && mq.matches));
    document.documentElement.classList.toggle('light', light);
  }
  apply();
  if (want === 'auto' && mq) {
    if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply);
  }
})();
