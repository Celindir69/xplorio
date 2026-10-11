/* xplorio-deploy.sh mit einer Test-Wurzel: einspielen, nichts zu tun, Änderung, Rückfrage, zurück; Umzug aus /data/web-app; alte Namen;
   Dienste einrichten (--tag-service, --rotel) */
var assert = require('assert'), cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
var repo = path.join(__dirname, '..'), n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var T = fs.mkdtempSync(path.join(os.tmpdir(), 'wad-')), app = path.join(T, 'app'), R = path.join(T, 'root');
function sh(cmd, input) { return cp.execSync(cmd, {cwd: repo, input: input || '', env: Object.assign({}, process.env, {MX_ROOT: R}), encoding: 'utf8'}); }
function pack(name) { cp.execSync('tar czf ' + name + ' --transform "s|^app|xplorio-x|" --exclude=.git app', {cwd: T}); return path.join(T, name); }
fs.mkdirSync(app);
cp.execSync('git ls-files | tar cf - -T - | tar xf - -C ' + app, {cwd: repo});     /* das Repo selbst als Archivinhalt */
fs.mkdirSync(path.join(R, 'volumio/http/www3/web'), {recursive: true});
fs.mkdirSync(path.join(R, 'volumio/http/www'), {recursive: true});              /* klassische Oberfläche (wie auf dem mxstream) */
fs.writeFileSync(path.join(R, 'volumio/http/www3/web/config.local.js'), 'lokal');
fs.mkdirSync(path.join(R, 'etc/systemd/system'), {recursive: true});            /* Dienst aus einer früheren Installation */
var UNIT = '[Service]\nExecStart=/usr/bin/env node /data/INTERNAL/tags/tag-service.js\nWorkingDirectory=/data/INTERNAL/tags\n';
fs.writeFileSync(path.join(R, 'etc/systemd/system/tag-service.service'), UNIT);
var v1 = pack('v1.tar.gz');
var out = sh('MX_SOURCE=' + v1 + ' bash tools/xplorio-deploy.sh -y');
t('erster Lauf spielt alles ein', function(){
  assert.ok(/Installed/.test(out));
  assert.ok(fs.existsSync(path.join(R, 'volumio/http/www3/web/js/core.js')));
  assert.ok(fs.existsSync(path.join(R, 'data/xplorio/tags/tag-service.js')));
  assert.ok(fs.existsSync(path.join(R, 'volumio/http/www3/xplorio.html')) && /xplorio.html/.test(fs.readFileSync(path.join(R, 'volumio/http/www3/app.html'), 'utf8')));   /* app.html leitet weiter */
  assert.ok(fs.existsSync(path.join(R, 'volumio/http/www/kioskTV.html')) && fs.existsSync(path.join(R, 'volumio/http/www3/kioskTV.html')));
  assert.ok(/Installed to \/volumio\/http\/www, www3\./.test(out), out);
  assert.ok(fs.existsSync(path.join(R, 'volumio/http/www/web/js/core.js')));          /* auch in den anderen vorhandenen Ordner */
  assert.ok(!fs.existsSync(path.join(R, 'volumio/http/www4')));                      /* neue Ordner legt es nicht an */
  assert.ok(fs.statSync(path.join(R, 'usr/local/bin/xplorio-deploy')).mode & 0o100);
  assert.ok(!fs.existsSync(path.join(R, 'usr/local/bin/mx-deploy')));                /* alte Namen nur, wenn schon da */
  assert.ok(fs.readdirSync(path.join(R, 'data/xplorio/backup')).some(function(f){ return /^backup-/.test(f); }));
  assert.strictEqual(fs.readFileSync(path.join(R, 'volumio/http/www3/web/config.local.js'), 'utf8'), 'lokal');
  assert.ok(!fs.existsSync(path.join(R, 'volumio/http/www3/README.md')));
  assert.ok(!fs.existsSync(path.join(R, 'volumio/http/www3/tests')));
  assert.strictEqual(fs.statSync(path.join(R, 'data/xplorio/data')).mode & 511, 448);   /* 0700 */
  assert.ok(!fs.existsSync(path.join(R, 'data/INTERNAL')));
});
t('--passwort legt den Hash für die Dienste an, ohne Klartext', function(){
  var o = sh('bash tools/xplorio-deploy.sh --passwort', 'geheim1\ngeheim1\n'), f = path.join(R, 'data/xplorio/data/admin.json');
  assert.ok(/Saved/.test(o), o);
  var j = fs.readFileSync(f, 'utf8');
  assert.ok(/"hash":"[0-9a-f]{64}"/.test(j) && j.indexOf('geheim1') < 0);
  assert.strictEqual(fs.statSync(f).mode & 511, 384);                               /* 0600 */
  assert.throws(function(){ sh('bash tools/xplorio-deploy.sh --password', 'abcd\nabce\n'); });
});
t('Dienst von /data/INTERNAL auf /data/xplorio umgestellt, alte Datei gesichert', function(){
  var u = fs.readFileSync(path.join(R, 'etc/systemd/system/tag-service.service'), 'utf8');
  assert.ok(/ExecStart=\/usr\/bin\/env node \/data\/xplorio\/tags\/tag-service.js/.test(u) && /WorkingDirectory=\/data\/xplorio\/tags/.test(u), u);
  assert.ok(/Service tag-service now runs from \/data\/xplorio\/tags/.test(out), out);
  assert.ok(/restart tag-service/.test(out));
});
t('Stand fürs Menü: web/version.json mit Branch und Datum (eigenes Archiv ohne Commit)', function(){
  var v = JSON.parse(fs.readFileSync(path.join(R, 'volumio/http/www3/web/version.json'), 'utf8'));
  assert.strictEqual(v.branch, 'main'); assert.strictEqual(v.commit, ''); assert.ok(/^\d{4}-\d\d-\d\d$/.test(v.date), v.date);
});
t('Cache-Kennung: web/build.js mit Prüfsumme der Oberfläche', function(){
  var b = fs.readFileSync(path.join(R, 'volumio/http/www3/web/build.js'), 'utf8');
  assert.ok(/^window\.XPLORIO_BUILD = '[0-9a-f]{12}';\n$/.test(b), b);
});
t('Stand fürs Menü: Commit aus einem Archiv wie bei GitHub (git archive)', function(){
  var ga = path.join(T, 'ga.tar.gz'), sha = cp.execSync('git rev-parse HEAD', {cwd: repo, encoding: 'utf8'}).trim();
  cp.execSync('git archive --format=tar.gz --prefix=xplorio-x/ -o ' + ga + ' HEAD', {cwd: repo});
  var o = sh('MX_SOURCE=' + ga + ' bash tools/xplorio-deploy.sh -n');
  assert.ok(/version.json/.test(o), o);
  var RG = path.join(T, 'rootg'); fs.mkdirSync(path.join(RG, 'volumio/http/www3'), {recursive: true});
  cp.execSync('bash tools/xplorio-deploy.sh -y', {cwd: repo, env: Object.assign({}, process.env, {MX_ROOT: RG, MX_SOURCE: ga}), encoding: 'utf8'});
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(RG, 'volumio/http/www3/web/version.json'), 'utf8')).commit, sha);
});
t('zweiter Lauf: nichts zu tun', function(){ assert.ok(/nothing to do/.test(sh('MX_SOURCE=' + v1 + ' bash tools/xplorio-deploy.sh -y'))); });
fs.appendFileSync(path.join(app, 'tags/tag-service.js'), '\n// X\n');
var v2 = pack('v2.tar.gz');
t('-n zeigt nur', function(){
  var o = sh('MX_SOURCE=' + v2 + ' bash tools/xplorio-deploy.sh -n');
  assert.ok(/changed: tags\/tag-service.js/.test(o));
  assert.ok(!/X/.test(fs.readFileSync(path.join(R, 'data/xplorio/tags/tag-service.js'), 'utf8').slice(-6)));
});
t('Rückfrage mit n bricht ab', function(){ assert.ok(/Cancelled/.test(sh('MX_SOURCE=' + v2 + ' bash tools/xplorio-deploy.sh', 'n\n'))); });
t('Rückfrage mit j (wie y) spielt ein und startet den Tag-Dienst neu', function(){
  var o = sh('MX_SOURCE=' + v2 + ' bash tools/xplorio-deploy.sh', 'j\n');
  assert.ok(/restart tag-service/.test(o) && !/rotel-bridge/.test(o));
  assert.ok(/\/\/ X/.test(fs.readFileSync(path.join(R, 'data/xplorio/tags/tag-service.js'), 'utf8')));
});
t('Oberflächen-Dateien mit Ordner in der Anzeige', function(){
  fs.appendFileSync(path.join(app, 'app.html'), '\n<!-- X -->\n');
  var o = sh('MX_SOURCE=' + pack('v3.tar.gz') + ' bash tools/xplorio-deploy.sh -n');
  assert.ok(/changed: app.html \(www3\)/.test(o) && /changed: app.html \(www\)/.test(o), o);
  fs.writeFileSync(path.join(app, 'app.html'), fs.readFileSync(path.join(app, 'app.html'), 'utf8').replace('\n<!-- X -->\n', ''));
});
t('--rollback stellt den vorigen Stand her', function(){
  sh('bash tools/xplorio-deploy.sh --rollback');
  assert.ok(!/\/\/ X/.test(fs.readFileSync(path.join(R, 'data/xplorio/tags/tag-service.js'), 'utf8')));
});
t('noch einmal (alter Name --zurueck) entfernt die neu angelegten Dateien', function(){
  sh('bash tools/xplorio-deploy.sh --zurueck');
  assert.ok(!fs.existsSync(path.join(R, 'volumio/http/www3/web/js/core.js')));
  assert.ok(!fs.existsSync(path.join(R, 'data/xplorio/tags/tag-service.js')));
  assert.strictEqual(fs.readFileSync(path.join(R, 'etc/systemd/system/tag-service.service'), 'utf8'), UNIT);
  assert.strictEqual(fs.readFileSync(path.join(R, 'volumio/http/www3/web/config.local.js'), 'utf8'), 'lokal');
});
/* Volumio 4: nur www4, alter Name volumio4-deploy und alte Sicherungen vorhanden */
var R4 = path.join(T, 'root4');
function sh4(cmd, env) { return cp.execSync(cmd, {cwd: repo, env: Object.assign({}, process.env, {MX_ROOT: R4}, env || {}), encoding: 'utf8'}); }
fs.mkdirSync(path.join(R4, 'volumio/http/www4'), {recursive: true});
fs.mkdirSync(path.join(R4, 'usr/local/bin'), {recursive: true});
fs.writeFileSync(path.join(R4, 'usr/local/bin/volumio4-deploy'), '#!/bin/bash\necho alt\n');
var oldState = path.join(R4, 'data/INTERNAL/volumio4-deploy');
fs.mkdirSync(oldState, {recursive: true});
fs.writeFileSync(path.join(R4, 'volumio/http/www4/alt.txt'), 'alt');
cp.execSync('tar czf ' + path.join(oldState, 'backup-20200101-000000.tar.gz') + ' volumio/http/www4/alt.txt', {cwd: R4});
fs.writeFileSync(path.join(R4, 'volumio/http/www4/alt.txt'), 'neuer');
t('Volumio 4: spielt nach www4 ein, ersetzt den alten Namen durch den Verweis', function(){
  var o = sh4('bash tools/xplorio-deploy.sh -y', {MX_SOURCE: v1});
  assert.ok(/Installed to \/volumio\/http\/www4\./.test(o), o);
  assert.ok(/sudo xplorio-deploy --rollback/.test(o));
  assert.ok(fs.existsSync(path.join(R4, 'volumio/http/www4/web/js/core.js')));
  assert.ok(!fs.existsSync(path.join(R4, 'volumio/http/www3')));
  assert.ok(/is now called xplorio-deploy/.test(fs.readFileSync(path.join(R4, 'usr/local/bin/volumio4-deploy'), 'utf8')));
  assert.ok(!fs.existsSync(path.join(R4, 'usr/local/bin/mx-deploy')));
});
t('--rollback: erst die neue, dann die alte Sicherung von volumio4-deploy', function(){
  sh4('bash tools/xplorio-deploy.sh --rollback');
  assert.ok(!fs.existsSync(path.join(R4, 'volumio/http/www4/app.html')));
  assert.ok(/backup-20200101/.test(sh4('bash tools/xplorio-deploy.sh --rollback')));
  assert.strictEqual(fs.readFileSync(path.join(R4, 'volumio/http/www4/alt.txt'), 'utf8'), 'alt');
});
t('alter Name: richtet xplorio-deploy ein und ruft es auf', function(){
  fs.mkdirSync(path.join(R4, 'volumio/http/www4/tools'), {recursive: true});
  fs.copyFileSync(path.join(repo, 'tools/xplorio-deploy.sh'), path.join(R4, 'volumio/http/www4/tools/xplorio-deploy.sh'));
  var o = sh4('bash tools/mx-deploy.sh -n', {MX_SOURCE: v1});
  assert.ok(/xplorio-deploy set up/.test(o) && /is now called xplorio-deploy/.test(o), o);
  assert.ok(/new: +app.html/.test(o), o);
  assert.ok(fs.statSync(path.join(R4, 'usr/local/bin/xplorio-deploy')).mode & 0o100);
});
/* frühere Installation unter /data/web-app mit Daten, Sicherung, Dienst und dem Befehl web-app-deploy */
var RM = path.join(T, 'rootm');
function shm(cmd) { return cp.execSync(cmd, {cwd: repo, env: Object.assign({}, process.env, {MX_ROOT: RM, MX_SOURCE: v1}), encoding: 'utf8'}); }
fs.mkdirSync(path.join(RM, 'volumio/http/www3'), {recursive: true});
['tags', 'data/moodtags', 'backup'].forEach(function(d){ fs.mkdirSync(path.join(RM, 'data/web-app', d), {recursive: true}); });
fs.writeFileSync(path.join(RM, 'data/web-app/tags/tag-service.js'), '// alt\n');
fs.writeFileSync(path.join(RM, 'data/web-app/data/plays.jsonl'), '{"t":1}\n');
fs.writeFileSync(path.join(RM, 'data/web-app/data/moodtags/tracks.jsonl'), 'x\n');
fs.writeFileSync(path.join(RM, 'data/web-app/backup/backup-20240101-000000.tar.gz'), '');
fs.mkdirSync(path.join(RM, 'etc/systemd/system'), {recursive: true});
var UNITM = '[Service]\nExecStart=/usr/bin/env node /data/web-app/tags/tag-service.js\nWorkingDirectory=/data/web-app/tags\n';
fs.writeFileSync(path.join(RM, 'etc/systemd/system/tag-service.service'), UNITM);
fs.mkdirSync(path.join(RM, 'usr/local/bin'), {recursive: true});
fs.writeFileSync(path.join(RM, 'usr/local/bin/web-app-deploy'), '#!/bin/bash\necho alt\n');
t('Umzug: -n zeigt den Umzug und ändert nichts', function(){
  var o = shm('bash tools/xplorio-deploy.sh -n');
  assert.ok(/move: +\/data\/web-app to \/data\/xplorio/.test(o) && /service: +switch tag-service to \/data\/xplorio/.test(o), o);
  assert.ok(/changed: tags\/tag-service.js/.test(o), o);                       /* verglichen mit dem alten Ordner */
  assert.ok(!fs.existsSync(path.join(RM, 'data/xplorio')));
});
var outm = shm('bash tools/xplorio-deploy.sh -y');
t('Umzug: /data/web-app samt Daten nach /data/xplorio, Verweis bleibt', function(){
  assert.ok(/Moved: \/data\/web-app -> \/data\/xplorio/.test(outm), outm);
  assert.ok(fs.lstatSync(path.join(RM, 'data/web-app')).isSymbolicLink());
  assert.strictEqual(fs.readFileSync(path.join(RM, 'data/xplorio/data/plays.jsonl'), 'utf8'), '{"t":1}\n');
  assert.ok(fs.existsSync(path.join(RM, 'data/xplorio/data/moodtags/tracks.jsonl')));
  assert.ok(fs.existsSync(path.join(RM, 'data/xplorio/backup/backup-20240101-000000.tar.gz')));
  assert.notStrictEqual(fs.readFileSync(path.join(RM, 'data/xplorio/tags/tag-service.js'), 'utf8'), '// alt\n');
  assert.ok(fs.existsSync(path.join(RM, 'data/web-app/tags/tag-service.js')));    /* alter Pfad geht weiter */
});
t('Umzug: Dienst umgestellt und neu gestartet, Befehle eingerichtet', function(){
  var u = fs.readFileSync(path.join(RM, 'etc/systemd/system/tag-service.service'), 'utf8');
  assert.ok(/node \/data\/xplorio\/tags\/tag-service.js/.test(u) && /WorkingDirectory=\/data\/xplorio\/tags/.test(u) && !/web-app/.test(u), u);
  assert.ok(/restart tag-service/.test(outm));
  assert.ok(fs.statSync(path.join(RM, 'usr/local/bin/xplorio-deploy')).mode & 0o100);
  assert.ok(/is now called xplorio-deploy/.test(fs.readFileSync(path.join(RM, 'usr/local/bin/web-app-deploy'), 'utf8')));
});
t('Umzug: danach nichts zu tun, alter Befehl leitet weiter', function(){
  var o = shm('bash ' + path.join(RM, 'usr/local/bin/web-app-deploy') + ' -y');
  assert.ok(/is now called xplorio-deploy/.test(o) && /nothing to do/.test(o), o);
});
t('Umzug: --rollback stellt den Dienst wieder her (alter Pfad über den Verweis)', function(){
  shm('bash tools/xplorio-deploy.sh --rollback');
  assert.strictEqual(fs.readFileSync(path.join(RM, 'etc/systemd/system/tag-service.service'), 'utf8'), UNITM);
  assert.strictEqual(fs.readFileSync(path.join(RM, 'data/web-app/tags/tag-service.js'), 'utf8'), '// alt\n');
});
t('web-app-deploy ohne xplorio-deploy: richtet es aus der Oberfläche ein und ruft es auf', function(){
  var RW = path.join(T, 'rootw');
  fs.mkdirSync(path.join(RW, 'volumio/http/www3/tools'), {recursive: true});
  fs.copyFileSync(path.join(repo, 'tools/xplorio-deploy.sh'), path.join(RW, 'volumio/http/www3/tools/xplorio-deploy.sh'));
  var o = cp.execSync('bash tools/web-app-deploy.sh -n', {cwd: repo, env: Object.assign({}, process.env, {MX_ROOT: RW, MX_SOURCE: v1}), encoding: 'utf8'});
  assert.ok(/xplorio-deploy set up/.test(o) && /is now called xplorio-deploy/.test(o) && /new: +app.html/.test(o), o);
});
t('ohne Ordner /volumio/http/www*: Abbruch, nichts angelegt', function(){
  var R0 = path.join(T, 'root0'); fs.mkdirSync(R0);
  var r = cp.spawnSync('bash', ['tools/xplorio-deploy.sh', '-y'], {cwd: repo, env: Object.assign({}, process.env, {MX_ROOT: R0, MX_SOURCE: v1}), encoding: 'utf8'});
  assert.notStrictEqual(r.status, 0); assert.ok(/no folder/.test(r.stderr), r.stderr);
  assert.ok(!fs.existsSync(path.join(R0, 'volumio')));
});
/* Dienste einrichten: frischer Player mit www3 und www, eigene config.local.js nur in www3 */
var RS = path.join(T, 'roots'), US = path.join(RS, 'etc/systemd/system');
function shs(args, input, env) {
  return cp.spawnSync('bash', ['tools/xplorio-deploy.sh'].concat(args), {cwd: repo, input: input || '', encoding: 'utf8',
    env: Object.assign({}, process.env, {MX_ROOT: RS, MX_SOURCE: v1}, env || {})});
}
function rd(f) { return fs.readFileSync(path.join(RS, f), 'utf8'); }
fs.mkdirSync(path.join(RS, 'volumio/http/www3/web'), {recursive: true});
fs.mkdirSync(path.join(RS, 'volumio/http/www'), {recursive: true});
fs.writeFileSync(path.join(RS, 'volumio/http/www3/web/config.local.js'), 'lokal');
t('--tag-service ohne Dateien: spielt erst main ein, dann Dienstdatei und Datenordner', function(){
  var r = shs(['--tag-service']);
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  assert.ok(/installing main first/.test(r.stdout) && /Installed to/.test(r.stdout), r.stdout);
  assert.ok(fs.existsSync(path.join(RS, 'data/xplorio/tags/tag-service.js')));
  var u = rd('etc/systemd/system/tag-service.service');
  assert.ok(/ExecStart=\/usr\/bin\/env node \/data\/xplorio\/tags\/tag-service.js/.test(u) && /WorkingDirectory=\/data\/xplorio\/tags/.test(u), u);
  assert.ok(/User=volumio/.test(u) && /WantedBy=multi-user.target/.test(u) && !/APP_CONFIG_DIR/.test(u), u);
  assert.ok(/\(test\) enable and restart tag-service/.test(r.stdout), r.stdout);
  assert.strictEqual(fs.statSync(path.join(RS, 'data/xplorio/data')).mode & 511, 448);
});
t('--tag-service ein zweites Mal: bleibt, wie es ist', function(){
  fs.writeFileSync(path.join(US, 'tag-service.service'), 'eigen\n');
  var r = shs(['--tag-service']);
  assert.ok(/already set up, unit left unchanged/.test(r.stdout) && !/Installed/.test(r.stdout) && !/restart tag-service/.test(r.stdout), r.stdout);
  assert.strictEqual(rd('etc/systemd/system/tag-service.service'), 'eigen\n');
});
t('--tag-service --force schreibt die Dienstdatei neu, --rollback holt die alte zurück', function(){
  var r = shs(['--tag-service', '--force']);
  assert.ok(/Backup: backup-/.test(r.stdout) && /tag-service.service written/.test(r.stdout), r.stdout);
  assert.ok(/node \/data\/xplorio\/tags\/tag-service.js/.test(rd('etc/systemd/system/tag-service.service')));
  var o = shs(['--rollback']).stdout;
  assert.ok(/restart tag-service/.test(o), o);
  assert.strictEqual(rd('etc/systemd/system/tag-service.service'), 'eigen\n');
});
t('--rotel IP: trägt den Verstärker in config.local.js ein (vorhandene ergänzt, sonst neu) und richtet die Bridge ein', function(){
  var r = shs(['--rotel', '192.168.1.50']);
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  assert.ok(!/installing/.test(r.stdout), r.stdout);                                /* Dateien schon da */
  var c3 = rd('volumio/http/www3/web/config.local.js');
  assert.ok(/^lokal\n\/\* Rotel/.test(c3) && /window\.APP_CONFIG\.ROTEL = true;/.test(c3) && /ROTEL_HOST = '192\.168\.1\.50';/.test(c3), c3);
  assert.ok(/ROTEL_HOST = '192\.168\.1\.50'/.test(rd('volumio/http/www/web/config.local.js')));
  var u = rd('etc/systemd/system/rotel-bridge.service');
  assert.ok(/node \/data\/xplorio\/rotel\/rotel-bridge.js/.test(u) && /Environment=APP_CONFIG_DIR=\/volumio\/http\/www3\/web/.test(u), u);
  assert.ok(/\(test\) enable and restart rotel-bridge/.test(r.stdout) && /Backup: backup-/.test(r.stdout), r.stdout);
});
t('--rotel ein zweites Mal: Adresse und Dienst bleiben, wie sie sind', function(){
  var before = rd('volumio/http/www3/web/config.local.js');
  var r = shs(['--rotel', '10.0.0.9']);
  assert.ok(/ROTEL_HOST is already set/.test(r.stdout) && /rotel-bridge is already set up/.test(r.stdout) && /10\.0\.0\.9 not used/.test(r.stdout), r.stdout);
  assert.ok(!/restart rotel-bridge/.test(r.stdout) && !/Backup/.test(r.stdout), r.stdout);
  assert.strictEqual(rd('volumio/http/www3/web/config.local.js'), before);
});
t('--rotel --force: Dienstdatei neu, Adresse bleibt; --rollback stellt beides her', function(){
  shs(['--rollback']);                                                            /* Sicherung vom Eintragen der Adresse */
  assert.strictEqual(rd('volumio/http/www3/web/config.local.js'), 'lokal');
  var r = shs(['--rotel', '--force'], '192.168.1.60\n');                          /* fragt nach der Adresse */
  assert.ok(/ROTEL_HOST is already set in \/volumio\/http\/www\//.test(r.stdout), r.stdout);
  assert.ok(/ROTEL_HOST = '192\.168\.1\.60'/.test(rd('volumio/http/www3/web/config.local.js')));
  assert.ok(/APP_CONFIG_DIR=\/volumio\/http\/www\/web/.test(rd('etc/systemd/system/rotel-bridge.service')));   /* der Ordner, der die Adresse schon hatte */
});
t('--rotel ohne Adresse und ohne Eingabe: Abbruch; ungültige Adresse: Abbruch', function(){
  var RR = path.join(T, 'rootr'); fs.mkdirSync(path.join(RR, 'volumio/http/www4/web'), {recursive: true});
  var env = {MX_ROOT: RR};
  var r = shs(['--rotel'], '', env);
  assert.notStrictEqual(r.status, 0); assert.ok(/no amplifier address/.test(r.stderr), r.stderr);
  r = shs(['--rotel'], 'a b;c\n', env);
  assert.notStrictEqual(r.status, 0); assert.ok(/invalid amplifier address/.test(r.stderr), r.stderr);
  assert.ok(!fs.existsSync(path.join(RR, 'etc/systemd/system/rotel-bridge.service')));
  assert.ok(!fs.existsSync(path.join(RR, 'volumio/http/www4/web/config.local.js')));
  r = shs(['--rotel', '192.168.1.70', '-n'], '', env);
  assert.notStrictEqual(r.status, 0); assert.ok(/-n does not work/.test(r.stderr), r.stderr);
});
t('--rotel mit Branch: der Branch ist keine Adresse', function(){
  var RB = path.join(T, 'rootb'); fs.mkdirSync(path.join(RB, 'volumio/http/www4/web'), {recursive: true});
  var r = shs(['--rotel', 'claude/test', '--tagdienst'], '192.168.1.80\n', {MX_ROOT: RB});
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  assert.ok(/installing claude\/test first/.test(r.stdout), r.stdout);
  assert.ok(/ROTEL_HOST = '192\.168\.1\.80'/.test(fs.readFileSync(path.join(RB, 'volumio/http/www4/web/config.local.js'), 'utf8')));
  assert.ok(/APP_CONFIG_DIR=\/volumio\/http\/www4\/web/.test(fs.readFileSync(path.join(RB, 'etc/systemd/system/rotel-bridge.service'), 'utf8')));
  assert.ok(fs.existsSync(path.join(RB, 'etc/systemd/system/tag-service.service')));
});
console.log(n + ' Prüfungen');
