/* Passwort für die Dienste auf der Seite „System“ (Neustart, Start, Stopp). Node 8, nur ES5.
   In admin.json im Datenordner steht nur ein Hash (PBKDF2-SHA256 mit Salt), dazu die Anmeldungen der Geräte als
   SHA-256 ihres Schlüssels mit Ablaufdatum (30 Tage). Ohne Passwort bleiben die Knöpfe gesperrt.
   Festlegen: sudo xplorio-deploy --password (ruft diese Datei auf); ein neues Passwort meldet alle Geräte ab.
   Nach 5 falschen Versuchen wartet der Dienst, bei jedem weiteren doppelt so lange (höchstens 15 min). */
var fs = require('fs'), path = require('path'), crypto = require('crypto');

var FILE = 'admin.json', ITER = 20000, TOKEN_DAYS = 30, MAX_TOKENS = 20;
var FREE_TRIES = 5, LOCK_MS = 30000, LOCK_MAX = 900000, MIN_LEN = 4;

function sha(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function same(a, b) {
  a = Buffer.from(String(a), 'hex'); b = Buffer.from(String(b), 'hex');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function Auth(dir) {
  this.file = path.join(dir, FILE);
  this.fails = 0; this.lockUntil = 0;
}
Auth.prototype.read = function() {
  try { var j = JSON.parse(fs.readFileSync(this.file, 'utf8')); return j && j.hash ? j : null; } catch (e) { return null; }
};
Auth.prototype.write = function(j) {
  fs.writeFileSync(this.file + '.neu', JSON.stringify(j) + '\n', {mode: 384});   /* 0600 */
  fs.renameSync(this.file + '.neu', this.file);
};
Auth.prototype.isSet = function() { return !!this.read(); };

/* neues Passwort (synchron, für die Kommandozeile); alle Anmeldungen verfallen */
Auth.prototype.setPassword = function(pw) {
  if (String(pw).length < MIN_LEN) throw new Error('zu kurz');
  var salt = crypto.randomBytes(16).toString('hex');
  var hash = crypto.pbkdf2Sync(String(pw), salt, ITER, 32, 'sha256').toString('hex');
  this.write({v: 1, salt: salt, iter: ITER, hash: hash, tokens: []});
};

/* Anmeldung: cb({ok, token} | {ok:false, error:'unset'|'wrong'|'locked', wait (s)}) */
Auth.prototype.login = function(pw, now, cb) {
  var self = this, j = this.read();
  now = now || Date.now();
  if (!j) return cb({ok: false, error: 'unset'});
  if (now < this.lockUntil) return cb({ok: false, error: 'locked', wait: Math.ceil((this.lockUntil - now) / 1000)});
  crypto.pbkdf2(String(pw || ''), j.salt, j.iter || ITER, 32, 'sha256', function(err, key){
    if (err || !same(key.toString('hex'), j.hash)) {
      self.fails++;
      if (self.fails >= FREE_TRIES) self.lockUntil = now + Math.min(LOCK_MAX, LOCK_MS * Math.pow(2, self.fails - FREE_TRIES));
      return cb({ok: false, error: 'wrong', wait: self.lockUntil > now ? Math.ceil((self.lockUntil - now) / 1000) : 0});
    }
    self.fails = 0; self.lockUntil = 0;
    var token = crypto.randomBytes(32).toString('hex'), cur = self.read() || j;
    var list = (cur.tokens || []).filter(function(t){ return t.exp > now; });
    list.push({h: sha(token), exp: now + TOKEN_DAYS * 86400000});
    cur.tokens = list.slice(-MAX_TOKENS);
    try { self.write(cur); } catch (e) { return cb({ok: false, error: 'write'}); }
    cb({ok: true, token: token});
  });
};

/* ist das Gerät angemeldet? */
Auth.prototype.check = function(token, now) {
  var j = this.read();
  if (!j || !token || !/^[0-9a-f]{64}$/.test(String(token))) return false;
  now = now || Date.now();
  var h = sha(token);
  return (j.tokens || []).some(function(t){ return t.exp > now && same(t.h, h); });
};

/* command line: node adminpass.js [data folder] -> asks for the password twice, hidden (output in English like xplorio-deploy) */
if (require.main === module) {
  var dir = process.argv[2] || '/data/xplorio/data', auth = new Auth(dir);
  var tty = !!process.stdin.isTTY, muted = false;
  var rl = require('readline').createInterface({input: process.stdin, output: process.stdout, terminal: tty});
  rl._writeToOutput = function(s){ if (!muted) rl.output.write(s); else if (/[\r\n]/.test(s)) rl.output.write('\n'); };
  var ask = function(q, cb){ muted = false; rl.question(q, function(x){ cb(x); }); muted = true; };
  console.log('Password for restarting, starting and stopping the services ("System" page), at least ' + MIN_LEN + ' characters.');
  console.log('The connection is not encrypted: do not use a password you use anywhere else.');
  ask('New password: ', function(a){
    ask('Repeat: ', function(b){
      rl.close();
      if (a !== b) { console.error('The entries differ, nothing changed.'); process.exit(1); }
      try { auth.setPassword(a); }
      catch (e) { console.error(e.message === 'zu kurz' ? 'Too short, nothing changed.' : 'Not saved: ' + e.message); process.exit(1); }
      console.log('Saved to ' + auth.file + '. All devices have to log in again.');
    });
  });
}

module.exports = {Auth: Auth, FILE: FILE, MIN_LEN: MIN_LEN};
