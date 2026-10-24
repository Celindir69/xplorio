/* xplorio-deploy.sh with a test root: install, nothing to do, change, confirmation, rollback; move from /data/web-app; old names;
   setting up services (--tag-service, --rotel) */
var assert = require('assert'), cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
var repo = path.join(__dirname, '..'), n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var T = fs.mkdtempSync(path.join(os.tmpdir(), 'wad-')), app = path.join(T, 'app'), R = path.join(T, 'root');
function sh(cmd, input) { return cp.execSync(cmd, {cwd: repo, input: input || '', env: Object.assign({}, process.env, {MX_ROOT: R}), encoding: 'utf8'}); }
function pack(name) { cp.execSync('tar czf ' + name + ' --transform "s|^app|xplorio-x|" --exclude=.git app', {cwd: T}); return path.join(T, name); }
fs.mkdirSync(app);
cp.execSync('git ls-files | tar cf - -T - | tar xf - -C ' + app, {cwd: repo});     /* the repo itself as archive content */
fs.mkdirSync(path.join(R, 'volumio/http/www3/web'), {recursive: true});
fs.mkdirSync(path.join(R, 'volumio/http/www'), {recursive: true});              /* classic interface (as on Volumio 2) */
fs.writeFileSync(path.join(R, 'volumio/http/www3/web/config.local.js'), 'lokal');
fs.mkdirSync(path.join(R, 'etc/systemd/system'), {recursive: true});            /* service from an earlier installation */
var UNIT = '[Service]\nExecStart=/usr/bin/env node /data/INTERNAL/tags/tag-service.js\nWorkingDirectory=/data/INTERNAL/tags\n';
fs.writeFileSync(path.join(R, 'etc/systemd/system/tag-service.service'), UNIT);
var v1 = pack('v1.tar.gz');
var out = sh('MX_SOURCE=' + v1 + ' bash tools/xplorio-deploy.sh -y');
t('first run installs everything', function(){
  assert.ok(/Installed/.test(out));
  assert.ok(fs.existsSync(path.join(R, 'volumio/http/www3/web/js/core.js')));
  assert.ok(fs.existsSync(path.join(R, 'data/xplorio/tags/tag-service.js')));
  assert.ok(fs.existsSync(path.join(R, 'volumio/http/www3/xplorio.html')) && /xplorio.html/.test(fs.readFileSync(path.join(R, 'volumio/http/www3/app.html'), 'utf8')));   /* app.html redirects */
  assert.ok(fs.existsSync(path.join(R, 'volumio/http/www/kioskTV.html')) && fs.existsSync(path.join(R, 'volumio/http/www3/kioskTV.html')));
  assert.ok(/Installed to \/volumio\/http\/www, www3\./.test(out), out);
  assert.ok(fs.existsSync(path.join(R, 'volumio/http/www/web/js/core.js')));          /* also into the other existing folder */
  assert.ok(!fs.existsSync(path.join(R, 'volumio/http/www4')));                      /* it does not create new folders */
  assert.ok(fs.statSync(path.join(R, 'usr/local/bin/xplorio-deploy')).mode & 0o100);
  assert.ok(!fs.existsSync(path.join(R, 'usr/local/bin/mx-deploy')));                /* old names only if already there */
  assert.ok(fs.readdirSync(path.join(R, 'data/xplorio/backup')).some(function(f){ return /^backup-/.test(f); }));
  assert.strictEqual(fs.readFileSync(path.join(R, 'volumio/http/www3/web/config.local.js'), 'utf8'), 'lokal');
  assert.ok(!fs.existsSync(path.join(R, 'volumio/http/www3/README.md')));
  assert.ok(!fs.existsSync(path.join(R, 'volumio/http/www3/tests')));
  assert.strictEqual(fs.statSync(path.join(R, 'data/xplorio/data')).mode & 511, 448);   /* 0700 */
  assert.ok(!fs.existsSync(path.join(R, 'data/INTERNAL')));
  /* copy for the own web server, outside /volumio */
  assert.ok(fs.existsSync(path.join(R, 'data/xplorio/www/xplorio.html')) && fs.existsSync(path.join(R, 'data/xplorio/www/web/js/core.js')));
  assert.ok(fs.existsSync(path.join(R, 'data/xplorio/www/web/build.js')) && !fs.existsSync(path.join(R, 'data/xplorio/www/tools')));
  assert.ok(fs.existsSync(path.join(R, 'data/xplorio/server/xplorio-server.js')));
  assert.ok(!fs.existsSync(path.join(R, 'data/xplorio/www/web/config.local.js')));
  assert.ok(!/restart xplorio-server/.test(out));                                    /* not set up: nothing to restart */
});
t('--passwort creates the hash for the services, without plain text', function(){
  var o = sh('bash tools/xplorio-deploy.sh --passwort', 'geheim1\ngeheim1\n'), f = path.join(R, 'data/xplorio/data/admin.json');
  assert.ok(/Saved/.test(o), o);
  var j = fs.readFileSync(f, 'utf8');
  assert.ok(/"hash":"[0-9a-f]{64}"/.test(j) && j.indexOf('geheim1') < 0);
  assert.strictEqual(fs.statSync(f).mode & 511, 384);                               /* 0600 */
  assert.throws(function(){ sh('bash tools/xplorio-deploy.sh --password', 'abcd\nabce\n'); });
});
t('service switched from /data/INTERNAL to /data/xplorio, old file backed up', function(){
  var u = fs.readFileSync(path.join(R, 'etc/systemd/system/tag-service.service'), 'utf8');
  assert.ok(/ExecStart=\/usr\/bin\/env node --max-old-space-size=384 \/data\/xplorio\/tags\/tag-service.js/.test(u) && /WorkingDirectory=\/data\/xplorio\/tags/.test(u), u);
  assert.ok(/Service tag-service now runs from \/data\/xplorio\/tags/.test(out), out);
  assert.ok(/restart tag-service/.test(out));
});
t('version for the menu: web/version.json with branch and date (own archive without commit)', function(){
  var v = JSON.parse(fs.readFileSync(path.join(R, 'volumio/http/www3/web/version.json'), 'utf8'));
  assert.strictEqual(v.branch, 'main'); assert.strictEqual(v.commit, ''); assert.ok(/^\d{4}-\d\d-\d\d$/.test(v.date), v.date);
});
t('cache id: web/build.js with checksum of the interface', function(){
  var b = fs.readFileSync(path.join(R, 'volumio/http/www3/web/build.js'), 'utf8');
  assert.ok(/^window\.XPLORIO_BUILD = '[0-9a-f]{12}';\n$/.test(b), b);
});
t('version for the menu: commit from a GitHub-style archive (git archive)', function(){
  var ga = path.join(T, 'ga.tar.gz'), sha = cp.execSync('git rev-parse HEAD', {cwd: repo, encoding: 'utf8'}).trim();
  cp.execSync('git archive --format=tar.gz --prefix=xplorio-x/ -o ' + ga + ' HEAD', {cwd: repo});
  var o = sh('MX_SOURCE=' + ga + ' bash tools/xplorio-deploy.sh -n');
  assert.ok(/version.json/.test(o), o);
  var RG = path.join(T, 'rootg'); fs.mkdirSync(path.join(RG, 'volumio/http/www3'), {recursive: true});
  cp.execSync('bash tools/xplorio-deploy.sh -y', {cwd: repo, env: Object.assign({}, process.env, {MX_ROOT: RG, MX_SOURCE: ga}), encoding: 'utf8'});
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(RG, 'volumio/http/www3/web/version.json'), 'utf8')).commit, sha);
});
t('second run: nothing to do', function(){ assert.ok(/nothing to do/.test(sh('MX_SOURCE=' + v1 + ' bash tools/xplorio-deploy.sh -y'))); });
fs.appendFileSync(path.join(app, 'tags/tag-service.js'), '\n// X\n');
var v2 = pack('v2.tar.gz');
t('-n only shows', function(){
  var o = sh('MX_SOURCE=' + v2 + ' bash tools/xplorio-deploy.sh -n');
  assert.ok(/changed: tags\/tag-service.js/.test(o));
  assert.ok(!/X/.test(fs.readFileSync(path.join(R, 'data/xplorio/tags/tag-service.js'), 'utf8').slice(-6)));
});
t('answering n cancels', function(){ assert.ok(/Cancelled/.test(sh('MX_SOURCE=' + v2 + ' bash tools/xplorio-deploy.sh', 'n\n'))); });
t('answering j (like y) installs and restarts the tag service', function(){
  var o = sh('MX_SOURCE=' + v2 + ' bash tools/xplorio-deploy.sh', 'j\n');
  assert.ok(/restart tag-service/.test(o) && !/rotel-bridge/.test(o));
  assert.ok(/\/\/ X/.test(fs.readFileSync(path.join(R, 'data/xplorio/tags/tag-service.js'), 'utf8')));
});
t('interface files shown with their folder', function(){
  fs.appendFileSync(path.join(app, 'app.html'), '\n<!-- X -->\n');
  var o = sh('MX_SOURCE=' + pack('v3.tar.gz') + ' bash tools/xplorio-deploy.sh -n');
  assert.ok(/changed: app.html \(www3\)/.test(o) && /changed: app.html \(www\)/.test(o) && /changed: app.html \(\/data\/xplorio\/www\)/.test(o), o);
  fs.writeFileSync(path.join(app, 'app.html'), fs.readFileSync(path.join(app, 'app.html'), 'utf8').replace('\n<!-- X -->\n', ''));
});
t('--rollback restores the previous state', function(){
  sh('bash tools/xplorio-deploy.sh --rollback');
  assert.ok(!/\/\/ X/.test(fs.readFileSync(path.join(R, 'data/xplorio/tags/tag-service.js'), 'utf8')));
});
t('once more (old name --zurueck) removes the newly created files', function(){
  sh('bash tools/xplorio-deploy.sh --zurueck');
  assert.ok(!fs.existsSync(path.join(R, 'volumio/http/www3/web/js/core.js')));
  assert.ok(!fs.existsSync(path.join(R, 'data/xplorio/tags/tag-service.js')));
  assert.strictEqual(fs.readFileSync(path.join(R, 'etc/systemd/system/tag-service.service'), 'utf8'), UNIT);
  assert.strictEqual(fs.readFileSync(path.join(R, 'volumio/http/www3/web/config.local.js'), 'utf8'), 'lokal');
});
/* Volumio 4: only www4, old name volumio4-deploy and old backups present */
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
t('Volumio 4: installs to www4, replaces the old name with the redirect', function(){
  var o = sh4('bash tools/xplorio-deploy.sh -y', {MX_SOURCE: v1});
  assert.ok(/Installed to \/volumio\/http\/www4\./.test(o), o);
  assert.ok(/sudo xplorio-deploy --rollback/.test(o));
  assert.ok(fs.existsSync(path.join(R4, 'volumio/http/www4/web/js/core.js')));
  assert.ok(!fs.existsSync(path.join(R4, 'volumio/http/www3')));
  assert.ok(/is now called xplorio-deploy/.test(fs.readFileSync(path.join(R4, 'usr/local/bin/volumio4-deploy'), 'utf8')));
  assert.ok(!fs.existsSync(path.join(R4, 'usr/local/bin/mx-deploy')));
});
t('--rollback: first the new backup, then the old one from volumio4-deploy', function(){
  sh4('bash tools/xplorio-deploy.sh --rollback');
  assert.ok(!fs.existsSync(path.join(R4, 'volumio/http/www4/app.html')));
  assert.ok(/backup-20200101/.test(sh4('bash tools/xplorio-deploy.sh --rollback')));
  assert.strictEqual(fs.readFileSync(path.join(R4, 'volumio/http/www4/alt.txt'), 'utf8'), 'alt');
});
t('old name: sets up xplorio-deploy and calls it', function(){
  fs.mkdirSync(path.join(R4, 'volumio/http/www4/tools'), {recursive: true});
  fs.copyFileSync(path.join(repo, 'tools/xplorio-deploy.sh'), path.join(R4, 'volumio/http/www4/tools/xplorio-deploy.sh'));
  var o = sh4('bash tools/mx-deploy.sh -n', {MX_SOURCE: v1});
  assert.ok(/xplorio-deploy set up/.test(o) && /is now called xplorio-deploy/.test(o), o);
  assert.ok(/new: +app.html/.test(o), o);
  assert.ok(fs.statSync(path.join(R4, 'usr/local/bin/xplorio-deploy')).mode & 0o100);
});
/* earlier installation under /data/web-app with data, backup, service and the web-app-deploy command */
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
t('move: -n shows the move and changes nothing', function(){
  var o = shm('bash tools/xplorio-deploy.sh -n');
  assert.ok(/move: +\/data\/web-app to \/data\/xplorio/.test(o) && /service: +switch tag-service to \/data\/xplorio/.test(o), o);
  assert.ok(/changed: tags\/tag-service.js/.test(o), o);                       /* compared with the old folder */
  assert.ok(!fs.existsSync(path.join(RM, 'data/xplorio')));
});
var outm = shm('bash tools/xplorio-deploy.sh -y');
t('move: /data/web-app with data to /data/xplorio, symlink stays', function(){
  assert.ok(/Moved: \/data\/web-app -> \/data\/xplorio/.test(outm), outm);
  assert.ok(fs.lstatSync(path.join(RM, 'data/web-app')).isSymbolicLink());
  assert.strictEqual(fs.readFileSync(path.join(RM, 'data/xplorio/data/plays.jsonl'), 'utf8'), '{"t":1}\n');
  assert.ok(fs.existsSync(path.join(RM, 'data/xplorio/data/moodtags/tracks.jsonl')));
  assert.ok(fs.existsSync(path.join(RM, 'data/xplorio/backup/backup-20240101-000000.tar.gz')));
  assert.notStrictEqual(fs.readFileSync(path.join(RM, 'data/xplorio/tags/tag-service.js'), 'utf8'), '// alt\n');
  assert.ok(fs.existsSync(path.join(RM, 'data/web-app/tags/tag-service.js')));    /* old path still works */
});
t('move: service switched and restarted, commands set up', function(){
  var u = fs.readFileSync(path.join(RM, 'etc/systemd/system/tag-service.service'), 'utf8');
  assert.ok(/node --max-old-space-size=384 \/data\/xplorio\/tags\/tag-service.js/.test(u) && /WorkingDirectory=\/data\/xplorio\/tags/.test(u) && !/web-app/.test(u), u);
  assert.ok(/restart tag-service/.test(outm));
  assert.ok(fs.statSync(path.join(RM, 'usr/local/bin/xplorio-deploy')).mode & 0o100);
  assert.ok(/is now called xplorio-deploy/.test(fs.readFileSync(path.join(RM, 'usr/local/bin/web-app-deploy'), 'utf8')));
});
t('move: nothing to do afterwards, old command forwards', function(){
  var o = shm('bash ' + path.join(RM, 'usr/local/bin/web-app-deploy') + ' -y');
  assert.ok(/is now called xplorio-deploy/.test(o) && /nothing to do/.test(o), o);
});
t('move: --rollback restores the service (old path via the symlink)', function(){
  shm('bash tools/xplorio-deploy.sh --rollback');
  assert.strictEqual(fs.readFileSync(path.join(RM, 'etc/systemd/system/tag-service.service'), 'utf8'), UNITM);
  assert.strictEqual(fs.readFileSync(path.join(RM, 'data/web-app/tags/tag-service.js'), 'utf8'), '// alt\n');
});
t('web-app-deploy without xplorio-deploy: sets it up from the interface and calls it', function(){
  var RW = path.join(T, 'rootw');
  fs.mkdirSync(path.join(RW, 'volumio/http/www3/tools'), {recursive: true});
  fs.copyFileSync(path.join(repo, 'tools/xplorio-deploy.sh'), path.join(RW, 'volumio/http/www3/tools/xplorio-deploy.sh'));
  var o = cp.execSync('bash tools/web-app-deploy.sh -n', {cwd: repo, env: Object.assign({}, process.env, {MX_ROOT: RW, MX_SOURCE: v1}), encoding: 'utf8'});
  assert.ok(/xplorio-deploy set up/.test(o) && /is now called xplorio-deploy/.test(o) && /new: +app.html/.test(o), o);
});
t('without a /volumio/http/www* folder: abort, nothing created', function(){
  var R0 = path.join(T, 'root0'); fs.mkdirSync(R0);
  var r = cp.spawnSync('bash', ['tools/xplorio-deploy.sh', '-y'], {cwd: repo, env: Object.assign({}, process.env, {MX_ROOT: R0, MX_SOURCE: v1}), encoding: 'utf8'});
  assert.notStrictEqual(r.status, 0); assert.ok(/no folder/.test(r.stderr), r.stderr);
  assert.ok(!fs.existsSync(path.join(R0, 'volumio')));
});
/* setting up services: fresh player with www3 and www, own config.local.js only in www3 */
var RS = path.join(T, 'roots'), US = path.join(RS, 'etc/systemd/system');
function shs(args, input, env) {
  return cp.spawnSync('bash', ['tools/xplorio-deploy.sh'].concat(args), {cwd: repo, input: input || '', encoding: 'utf8',
    env: Object.assign({}, process.env, {MX_ROOT: RS, MX_SOURCE: v1}, env || {})});
}
function rd(f) { return fs.readFileSync(path.join(RS, f), 'utf8'); }
fs.mkdirSync(path.join(RS, 'volumio/http/www3/web'), {recursive: true});
fs.mkdirSync(path.join(RS, 'volumio/http/www'), {recursive: true});
fs.writeFileSync(path.join(RS, 'volumio/http/www3/web/config.local.js'), 'lokal');
t('--tag-service without files: installs main first, then unit file and data folder', function(){
  var r = shs(['--tag-service']);
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  assert.ok(/installing main first/.test(r.stdout) && /Installed to/.test(r.stdout), r.stdout);
  assert.ok(fs.existsSync(path.join(RS, 'data/xplorio/tags/tag-service.js')));
  var u = rd('etc/systemd/system/tag-service.service');
  assert.ok(/ExecStart=\/usr\/bin\/env node --max-old-space-size=384 \/data\/xplorio\/tags\/tag-service.js/.test(u) && /WorkingDirectory=\/data\/xplorio\/tags/.test(u), u);
  assert.ok(/User=volumio/.test(u) && /WantedBy=multi-user.target/.test(u) && !/APP_CONFIG_DIR/.test(u), u);
  assert.ok(/\(test\) enable and restart tag-service/.test(r.stdout), r.stdout);
  assert.strictEqual(fs.statSync(path.join(RS, 'data/xplorio/data')).mode & 511, 448);
});
t('--tag-service a second time: stays as it is', function(){
  fs.writeFileSync(path.join(US, 'tag-service.service'), 'eigen\n');
  var r = shs(['--tag-service']);
  assert.ok(/already set up, unit left unchanged/.test(r.stdout) && !/Installed/.test(r.stdout) && !/restart tag-service/.test(r.stdout), r.stdout);
  assert.strictEqual(rd('etc/systemd/system/tag-service.service'), 'eigen\n');
});
t('--tag-service --force rewrites the unit file, --rollback brings back the old one', function(){
  var r = shs(['--tag-service', '--force']);
  assert.ok(/Backup: backup-/.test(r.stdout) && /tag-service.service written/.test(r.stdout), r.stdout);
  assert.ok(/node --max-old-space-size=384 \/data\/xplorio\/tags\/tag-service.js/.test(rd('etc/systemd/system/tag-service.service')));
  var o = shs(['--rollback']).stdout;
  assert.ok(/restart tag-service/.test(o), o);
  assert.strictEqual(rd('etc/systemd/system/tag-service.service'), 'eigen\n');
});
t('--server: unit for the own web server, without config folder; a second time stays as it is', function(){
  var r = shs(['--server']);
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  var u = rd('etc/systemd/system/xplorio-server.service');
  assert.ok(/ExecStart=\/usr\/bin\/env node \/data\/xplorio\/server\/xplorio-server.js/.test(u) && /WorkingDirectory=\/data\/xplorio\/server/.test(u), u);
  assert.ok(/User=volumio/.test(u) && !/max-old-space-size/.test(u), u);
  assert.ok(/\(test\) enable and restart xplorio-server/.test(r.stdout), r.stdout);
  var r2 = shs(['--server']);
  assert.ok(/xplorio-server is already set up/.test(r2.stdout), r2.stdout);
});
t('--rotel IP: writes the amplifier into config.local.js (appends to an existing one, else creates it) and sets up the bridge', function(){
  var r = shs(['--rotel', '192.168.1.50']);
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  assert.ok(!/installing/.test(r.stdout), r.stdout);                                /* files already there */
  var c3 = rd('volumio/http/www3/web/config.local.js');
  assert.ok(/^lokal\n\/\* Rotel/.test(c3) && /window\.APP_CONFIG\.ROTEL = true;/.test(c3) && /ROTEL_HOST = '192\.168\.1\.50';/.test(c3), c3);
  assert.ok(/ROTEL_HOST = '192\.168\.1\.50'/.test(rd('volumio/http/www/web/config.local.js')));
  var u = rd('etc/systemd/system/rotel-bridge.service');
  assert.ok(/node \/data\/xplorio\/rotel\/rotel-bridge.js/.test(u) && /Environment=APP_CONFIG_DIR=\/volumio\/http\/www3\/web/.test(u), u);
  assert.ok(/\(test\) enable and restart rotel-bridge/.test(r.stdout) && /Backup: backup-/.test(r.stdout), r.stdout);
});
t('--rotel a second time: address and service stay as they are', function(){
  var before = rd('volumio/http/www3/web/config.local.js');
  var r = shs(['--rotel', '10.0.0.9']);
  assert.ok(/ROTEL_HOST is already set/.test(r.stdout) && /rotel-bridge is already set up/.test(r.stdout) && /10\.0\.0\.9 not used.*--force replaces it/.test(r.stdout), r.stdout);
  assert.ok(!/restart rotel-bridge/.test(r.stdout) && !/Backup/.test(r.stdout), r.stdout);
  assert.strictEqual(rd('volumio/http/www3/web/config.local.js'), before);
});
t('--rotel: address in only one folder, still does not ask and leaves the other folder as it is', function(){
  shs(['--rollback']);                                                            /* backup from writing the address */
  assert.strictEqual(rd('volumio/http/www3/web/config.local.js'), 'lokal');
  var r = shs(['--rotel']);                                                       /* no input: a prompt would abort */
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  assert.ok(/ROTEL_HOST is already set in \/volumio\/http\/www\//.test(r.stdout) && !/Backup/.test(r.stdout), r.stdout);
  assert.strictEqual(rd('volumio/http/www3/web/config.local.js'), 'lokal');
});
t('--rotel --force: new unit file, asks for the address; Enter keeps it', function(){
  var r = shs(['--rotel', '--force'], '\n');
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  assert.ok(/ROTEL_HOST = '192\.168\.1\.50'/.test(rd('volumio/http/www/web/config.local.js')));
  assert.strictEqual(rd('volumio/http/www3/web/config.local.js'), 'lokal');
  assert.ok(/APP_CONFIG_DIR=\/volumio\/http\/www\/web/.test(rd('etc/systemd/system/rotel-bridge.service')));   /* the folder that already had the address */
});
t('--rotel IP --force replaces a wrong address (also in custom notation), with backup', function(){
  fs.writeFileSync(path.join(RS, 'volumio/http/www/web/config.local.js'), '// ROTEL_HOST: "alt"\nObject.assign(window.APP_CONFIG, {\n  ROTEL: true,\n  ROTEL_HOST: "10.0.0.1",\n  X: 1\n});\n');
  var r = shs(['--rotel', '192.168.1.99', '--force']);
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  assert.ok(/set to 192\.168\.1\.99/.test(r.stdout) && /Backup: backup-/.test(r.stdout) && /restart rotel-bridge/.test(r.stdout), r.stdout);
  var c = rd('volumio/http/www/web/config.local.js');
  assert.ok(/  ROTEL_HOST: "192\.168\.1\.99",\n/.test(c) && /\/\/ ROTEL_HOST: "alt"/.test(c), c);    /* comment stays */
  assert.ok(/ROTEL_HOST = '192\.168\.1\.99';/.test(rd('volumio/http/www3/web/config.local.js')));
  shs(['--rollback']);
  assert.ok(/ROTEL_HOST: "10\.0\.0\.1"/.test(rd('volumio/http/www/web/config.local.js')));
  assert.strictEqual(rd('volumio/http/www3/web/config.local.js'), 'lokal');
});
t('--rotel --force asks for the new address', function(){
  var r = shs(['--rotel', '--force'], '192.168.1.77\n');
  assert.ok(/ROTEL_HOST = '192\.168\.1\.77'/.test(rd('volumio/http/www3/web/config.local.js')), r.stdout);
  assert.ok(/ROTEL_HOST: "192\.168\.1\.77"/.test(rd('volumio/http/www/web/config.local.js')));
});
t('--rotel without address and without input: abort; invalid address: abort', function(){
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
t('--rotel with branch: the branch is not an address', function(){
  var RB = path.join(T, 'rootb'); fs.mkdirSync(path.join(RB, 'volumio/http/www4/web'), {recursive: true});
  var r = shs(['--rotel', 'claude/test', '--tagdienst'], '192.168.1.80\n', {MX_ROOT: RB});
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  assert.ok(/installing claude\/test first/.test(r.stdout), r.stdout);
  assert.ok(/ROTEL_HOST = '192\.168\.1\.80'/.test(fs.readFileSync(path.join(RB, 'volumio/http/www4/web/config.local.js'), 'utf8')));
  assert.ok(/APP_CONFIG_DIR=\/volumio\/http\/www4\/web/.test(fs.readFileSync(path.join(RB, 'etc/systemd/system/rotel-bridge.service'), 'utf8')));
  assert.ok(fs.existsSync(path.join(RB, 'etc/systemd/system/tag-service.service')));
});
/* Volumio's integrity check before a system update: md5 over /volumio (md5deep replaced by a small stand-in) */
var RU = path.join(T, 'rootu'), FAKE = path.join(T, 'md5deep');
fs.writeFileSync(FAKE, '#!/bin/bash\n# md5deep -r -l -s [-q] DIR (-q keeps two spaces after the hash, like the real one)\nq=0; for a in "$@"; do [ "$a" = -q ] && q=1; d=$a; done\n' +
  'find "$d" -type f | while IFS= read -r f; do h=$(md5sum "$f" | cut -d" " -f1); if [ $q = 1 ]; then echo "$h  "; else echo "$h  $f"; fi; done\n');
fs.chmodSync(FAKE, 0o755);
fs.mkdirSync(path.join(RU, 'volumio/http/www4'), {recursive: true}); fs.mkdirSync(path.join(RU, 'volumio/app'), {recursive: true});
fs.mkdirSync(path.join(RU, 'etc'), {recursive: true});
fs.writeFileSync(path.join(RU, 'volumio/http/www4/index.html'), 'volumio ui');
fs.writeFileSync(path.join(RU, 'volumio/app/index.js'), 'backend');
var clean = cp.execSync(FAKE + ' -r -l -s -q ' + path.join(RU, 'volumio') + ' | sort | md5sum | cut -d" " -f1', {encoding: 'utf8'}).trim();
fs.writeFileSync(path.join(RU, 'etc/os-release'), 'PRETTY_NAME="Volumio"\nVOLUMIO_HASH="' + clean + '"\n');
function shu(args) { return shs(args, '', {MX_ROOT: RU, DEPLOY_MD5DEEP: FAKE}); }
function ru(f) { return path.join(RU, 'volumio/http/www4', f); }
t('update check: passes without Xplorio, names the interface as the only obstacle after install', function(){
  assert.ok(/check passes/.test(shu(['--check-update']).stdout));
  assert.strictEqual(shu(['-y']).status, 0);
  fs.writeFileSync(ru('web/config.local.js'), 'eigene');
  var r = shu(['--check-update']);
  assert.ok(/Only the Xplorio interface blocks the update/.test(r.stdout), r.stdout + r.stderr);
});
t('--remove backs up and removes the interface, Volumio files stay; the check passes', function(){
  var r = shu(['--remove']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(/Interface removed/.test(r.stdout) && /check passes now/.test(r.stdout), r.stdout);
  ['xplorio.html', 'app.html', 'kioskTV.html', 'web', 'tools'].forEach(function(f){ assert.ok(!fs.existsSync(ru(f)), f); });
  assert.ok(fs.existsSync(ru('index.html')));
  assert.ok(fs.existsSync(path.join(RU, 'data/xplorio/tags/tag-service.js')));          /* services stay */
  assert.ok(/check passes/.test(shu(['--check-update']).stdout));
  assert.ok(fs.readdirSync(path.join(RU, 'data/xplorio/backup')).some(function(f){ return /^interface-.*\.tar\.gz$/.test(f); }));
});
t('--restore puts the interface back with config.local.js', function(){
  var r = shu(['--restore']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(ru('xplorio.html')) && fs.existsSync(ru('web/js/core.js')));
  assert.strictEqual(fs.readFileSync(ru('web/config.local.js'), 'utf8'), 'eigene');
  assert.ok(/Only the Xplorio interface/.test(shu(['--check-update']).stdout));
});
t('other changes below /volumio: --remove refuses (unless --force)', function(){
  fs.writeFileSync(path.join(RU, 'volumio/app/index.js'), 'changed by hand');
  assert.ok(/Other files below \/volumio/.test(shu(['--check-update']).stdout));
  var r = shu(['--remove']);
  assert.notStrictEqual(r.status, 0); assert.ok(/not removed/.test(r.stderr), r.stderr);
  assert.ok(fs.existsSync(ru('xplorio.html')));
  assert.strictEqual(shu(['--remove', '--force']).status, 0);
  assert.ok(!fs.existsSync(ru('xplorio.html')));
  assert.strictEqual(shu(['--restore']).status, 0);
});
console.log(n + ' checks');
