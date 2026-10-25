/* xplorio-deploy.sh with a test root: puts the plugin together from an archive and packs it for Volumio (install, update
   with the installed dependencies), version for the menu, -n, password */
var assert = require('assert'), cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
var repo = path.join(__dirname, '..'), n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
process.on('exit', function(code){ if (!code) { assert.strictEqual(n, 6, 'not all checks finished'); console.log(n + ' checks'); } });

var T = fs.mkdtempSync(path.join(os.tmpdir(), 'xd-')), R = path.join(T, 'root'), B = path.join(R, 'plugin-build');
var SRC = path.join(T, 'src.tar.gz'), SHA = cp.execSync('git rev-parse HEAD', {cwd: repo, encoding: 'utf8'}).trim();
cp.execSync('git archive --format=tar.gz --prefix=xplorio-x/ -o ' + SRC + ' HEAD', {cwd: repo});   /* like GitHub's archive */
fs.mkdirSync(R);
function run(args, input) {
  return cp.spawnSync('bash', ['tools/xplorio-deploy.sh'].concat(args), {cwd: repo, input: input || '', encoding: 'utf8',
    env: Object.assign({}, process.env, {DEPLOY_ROOT: R, DEPLOY_SOURCE: SRC})});
}
function zipNames() {
  return cp.execFileSync('python3', ['-c', 'import sys, zipfile; print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', B + '.zip'],
                         {encoding: 'utf8'}).split('\n');
}

t('first call: plugin put together and packed for installing, nothing else on the player', function(){
  var r = run([]);
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  assert.ok(/\(test\) plugin install through Volumio/.test(r.stdout), r.stdout);
  assert.ok(fs.existsSync(path.join(B, 'index.js')) && fs.existsSync(path.join(B, 'app/web/js/core.js')));
  var names = zipNames();
  assert.ok(names.indexOf('package.json') >= 0 && names.indexOf('app/tags/tags.py') >= 0, names.slice(0, 5));   /* as Volumio expects it */
  assert.deepStrictEqual(fs.readdirSync(R).sort(), ['plugin-build', 'plugin-build.zip']);
});

t('version for the menu: branch, commit from the archive, date; cache id', function(){
  var v = JSON.parse(fs.readFileSync(path.join(B, 'app/web/version.json'), 'utf8'));
  assert.strictEqual(v.branch, 'main'); assert.strictEqual(v.commit, SHA); assert.ok(/^\d{4}-\d\d-\d\d$/.test(v.date), v.date);
  assert.ok(/^window\.XPLORIO_BUILD = '[0-9a-f]{12}';\n$/.test(fs.readFileSync(path.join(B, 'app/web/build.js'), 'utf8')));
});

t('installed plugin: update, with its dependencies, branch in the version', function(){
  var kew = path.join(R, 'data/plugins/user_interface/xplorio/node_modules/kew');
  fs.mkdirSync(kew, {recursive: true}); fs.writeFileSync(path.join(kew, 'index.js'), '');
  var r = run(['claude/test']);
  assert.ok(/\(test\) plugin update through Volumio/.test(r.stdout), r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(B, 'node_modules/kew/index.js')));
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(B, 'app/web/version.json'), 'utf8')).branch, 'claude/test');
  assert.ok(/\(test\) plugin update/.test(run(['--plugin']).stdout));                 /* option of earlier versions */
});

t('-n only says what would happen', function(){
  cp.execSync('rm -rf ' + B + ' ' + B + '.zip');
  var r = run(['-n']);
  assert.ok(/would be installed as Volumio plugin \(update/.test(r.stdout), r.stdout);
  assert.ok(!fs.existsSync(B));
  assert.notStrictEqual(run(['--remove']).status, 0);                                 /* old options are gone */
});

t('--password with the installed plugin: hash only, mode 0600; mismatch fails', function(){
  var tags = path.join(R, 'data/plugins/user_interface/xplorio/app/tags');
  fs.mkdirSync(tags, {recursive: true});
  fs.copyFileSync(path.join(repo, 'tags/adminpass.js'), path.join(tags, 'adminpass.js'));
  var r = run(['--password'], 'geheim1\ngeheim1\n'), f = path.join(R, 'data/xplorio/data/admin.json');
  assert.ok(/Saved/.test(r.stdout), r.stdout + r.stderr);
  var j = fs.readFileSync(f, 'utf8');
  assert.ok(/"hash":"[0-9a-f]{64}"/.test(j) && j.indexOf('geheim1') < 0);
  assert.strictEqual(fs.statSync(f).mode & 511, 384);
  assert.notStrictEqual(run(['--password'], 'abcd\nabce\n').status, 0);
});

t('--password without the plugin: clear message', function(){
  cp.execSync('rm -rf ' + path.join(R, 'data/plugins'));
  var r = run(['--password']);
  assert.notStrictEqual(r.status, 0);
  assert.ok(/plugin is not installed/.test(r.stderr), r.stderr);
});
