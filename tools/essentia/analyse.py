#!/usr/bin/env python3
"""Audio analysis of the music collection with Essentia (on the Mac, not on the player).

Listens to every track and writes one line per track to essentia.jsonl: BPM, key, moods
(happy, sad, relaxed, aggressive, party), danceability, vocals, valence/arousal (DEAM) and
Discogs styles. The tag service on the player matches the lines by artist and title, so the
folder structure does not matter. Files already analysed and unchanged are skipped; you can
abort (Ctrl-C) and continue later at any time. With --upload or --player the progress so far is
uploaded on abort, with --player also every 2 hours (--upload-every). If a password for the services is
set on the player (Xplorio settings), the script asks for it once at the start (or takes XPLORIO_PASSWORD).

    python3 analyse.py /Volumes/Data/Musik /Volumes/Data/AllFlac
    python3 analyse.py --upload http://<player>:8766 /Volumes/Data/Musik
    python3 analyse.py --player http://<player> /Volumes/<SMB share of the player>/Musik

Requires: macOS 15+ with Python 3.14 (pip install essentia-tensorflow mutagen);
Intel Mac with macOS 14: Python 3.13 and pip install "essentia-tensorflow==2.1b6.dev1389" mutagen
The script downloads the pretrained models (about 100 MB) itself on the first run.
Optional ffmpeg (brew install ffmpeg): reads files on which Essentia fails or crashes. Once it is set up,
"python3 analyse.py --retry-errors …" catches up on the files that failed so far.
Models: CC BY-NC-SA 4.0 (non-commercial only), https://essentia.upf.edu/models
"""
import argparse
import concurrent.futures as cf
import fnmatch
import getpass
import json
import multiprocessing as mp
import os
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request

VERSION = 2
AUDIO_EXT = {'.flac', '.m4a', '.mp4', '.mp3', '.wav', '.aif', '.aiff', '.dsf', '.dff', '.ogg', '.oga', '.opus',
             '.wv', '.ape', '.wma', '.alac'}
MODEL_URL = 'https://essentia.upf.edu/models/'
EFFNET = 'feature-extractors/discogs-effnet/discogs-effnet-bs64-1'
MUSICNN = 'feature-extractors/musicnn/msd-musicnn-1'
HEADS = {                                    # name in the output -> model, wanted class
    'happy': ('mood_happy', 'happy'),
    'sad': ('mood_sad', 'sad'),
    'relaxed': ('mood_relaxed', 'relaxed'),
    'aggressive': ('mood_aggressive', 'aggressive'),
    'party': ('mood_party', 'party'),
    'dance': ('danceability', 'danceable'),
    'voice': ('voice_instrumental', 'voice'),
}
GENRE = 'classification-heads/genre_discogs400/genre_discogs400-discogs-effnet-1'
DEAM = 'classification-heads/deam/deam-msd-musicnn-2'
SR = 44100
SR_MODEL = 16000
# The Discogs-Effnet build always computes 64 patches at once (about 131 s of music without overlap); up to that,
# listening longer costs nothing extra. MusiCNN (only for valence/arousal) is the most expensive step on the Mac
# and so gets only the middle 45 s, as long as the DEAM excerpts the model was trained on.
EFFNET_HOP = 128
MUSICNN_SECONDS = 45
MUSICNN_HOP = 187
CRASH = 'analysis crashed (file damaged or too large?)'
CRASH_OLD = 'Analyse abgest\u00fcrzt (Datei besch\u00e4digt oder zu gro\u00df?)'   # written by earlier versions
FFMPEG_PATHS = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']   # in case it is not in PATH (e.g. from cron)


def find_ffmpeg(arg):
    """ffmpeg for files Essentia cannot read: --ffmpeg PATH, 'off' (or 'aus') = never, else search for it"""
    if arg is not None:
        return '' if arg in ('', 'aus', 'off', 'no') else arg
    return shutil.which('ffmpeg') or next((p for p in FFMPEG_PATHS if os.access(p, os.X_OK)), '')


def ffmpeg_load(ffmpeg, path):
    """whole file as mono, 44.1 kHz, float32 (like MonoLoader)"""
    import numpy as np
    r = subprocess.run([ffmpeg, '-v', 'error', '-nostdin', '-i', path, '-vn', '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=600)
    audio = np.frombuffer(r.stdout, dtype=np.float32)
    if r.returncode != 0 and len(audio) < SR * 5:
        raise RuntimeError('ffmpeg: ' + (r.stderr.decode('utf-8', 'replace').strip().splitlines() or ['error'])[-1][:150])
    return audio


def head_path(model):
    return 'classification-heads/%s/%s-discogs-effnet-1' % (model, model)


def all_models():
    out = [EFFNET, MUSICNN, GENRE, DEAM] + [head_path(m) for m, _ in HEADS.values()]
    return out


def fetch_models(folder):
    """Download the models (.pb) and descriptions (.json) once."""
    os.makedirs(folder, exist_ok=True)
    for m in all_models():
        exts = ['.pb'] if m.startswith('feature-extractors/') else ['.pb', '.json']
        for ext in exts:
            dst = os.path.join(folder, os.path.basename(m) + ext)
            if os.path.exists(dst) and os.path.getsize(dst) > 0:
                continue
            url = MODEL_URL + m + ext
            print('Loading model ' + os.path.basename(dst) + ' …', flush=True)
            try:
                with urllib.request.urlopen(url, timeout=120) as r, open(dst + '.neu', 'wb') as f:
                    while True:
                        b = r.read(1 << 20)
                        if not b:
                            break
                        f.write(b)
                os.replace(dst + '.neu', dst)
            except Exception as e:
                sys.exit('Cannot load model: %s (%s)' % (url, e))


def model_file(folder, m, ext='.pb'):
    return os.path.join(folder, os.path.basename(m) + ext)


def classes_of(folder, m):
    with open(model_file(folder, m, '.json'), encoding='utf-8') as f:
        return json.load(f)['classes']


# ---------- Tags ----------

def first(v):
    if v is None:
        return ''
    if hasattr(v, 'text'):                     # ID3-Frame
        v = v.text
    if isinstance(v, (list, tuple)):
        v = v[0] if v else ''
    return str(v).strip()


def read_tags(path):
    """-> (artist, title, album); mutagen first (handles DSF too), else Essentia's own reader"""
    try:
        import mutagen
        f = mutagen.File(path, easy=True)
        if f is not None and f.tags is not None:
            t = f.tags
            ar, ti, al = first(t.get('artist')), first(t.get('title')), first(t.get('album'))
            if ar and ti:
                return ar, ti, al
        f = mutagen.File(path)
        if f is not None and f.tags is not None:
            t = f.tags
            for a, b, c in (('TPE1', 'TIT2', 'TALB'), ('\xa9ART', '\xa9nam', '\xa9alb'), ('ARTIST', 'TITLE', 'ALBUM')):
                ar, ti, al = first(t.get(a)), first(t.get(b)), first(t.get(c))
                if ar and ti:
                    return ar, ti, al
    except Exception:
        pass
    try:
        import essentia.standard as es
        md = es.MetadataReader(filename=path, failOnError=False)()
        return md[1].strip(), md[0].strip(), md[2].strip()
    except Exception:
        return '', '', ''


# ---------- Analysis (per worker process) ----------

W = {}


def worker_init(folder, seconds, profile=False, max_minutes=0, marks='', ffmpeg=''):
    W['max_minutes'] = max_minutes
    W['ffmpeg'] = ffmpeg
    W['marks'] = marks
    os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '3')
    import essentia
    import essentia.standard as es
    essentia.log.infoActive = False
    essentia.log.warningActive = False
    W['es'] = es
    W['seconds'] = seconds
    W['profile'] = profile
    W['rhythm'] = es.RhythmExtractor2013(method='degara')
    W['key'] = es.KeyExtractor(profileType='edma')
    W['resample'] = es.Resample(inputSampleRate=SR, outputSampleRate=SR_MODEL, quality=4)
    W['effnet'] = es.TensorflowPredictEffnetDiscogs(graphFilename=model_file(folder, EFFNET), output='PartitionedCall:1',
                                                    patchHopSize=EFFNET_HOP)
    W['musicnn'] = es.TensorflowPredictMusiCNN(graphFilename=model_file(folder, MUSICNN), output='model/dense/BiasAdd',
                                               patchHopSize=MUSICNN_HOP)
    W['heads'] = {}
    for name, (m, want) in HEADS.items():
        cls = classes_of(folder, head_path(m))
        W['heads'][name] = (es.TensorflowPredict2D(graphFilename=model_file(folder, head_path(m)), output='model/Softmax'),
                            cls.index(want))
    W['genre'] = es.TensorflowPredict2D(graphFilename=model_file(folder, GENRE),
                                        input='serving_default_model_Placeholder', output='PartitionedCall:0')
    W['genre_cls'] = classes_of(folder, GENRE)
    W['deam'] = es.TensorflowPredict2D(graphFilename=model_file(folder, DEAM), output='model/Identity')
    W['deam_cls'] = classes_of(folder, DEAM)


def mean_rows(a):
    import numpy as np
    a = np.asarray(a)
    return a.mean(axis=0) if a.ndim == 2 else a


def analyse(job):
    path, size, mtime, use_ffmpeg = job
    rec = {'v': VERSION, 'p': path, 'sz': size, 'mt': mtime}
    # marker per process: if the process crashes on this file (Essentia/TensorFlow), the main process knows which one
    mark = os.path.join(W['marks'], str(os.getpid())) if W.get('marks') else ''
    if mark:
        with open(mark, 'w', encoding='utf-8') as m:
            m.write(path)
    try:
        return analyse_file(rec, path, use_ffmpeg)
    finally:
        if mark:
            try:
                os.remove(mark)
            except OSError:
                pass


def length_of(path):
    try:
        import mutagen
        f = mutagen.File(path)
        return float(f.info.length) if f is not None and f.info else 0.0
    except Exception:
        return 0.0


def load_audio(rec, path, use_ffmpeg):
    """Essentia reads; if it fails (error or hardly anything read), ffmpeg reads. use_ffmpeg: use ffmpeg right away
    (the file crashed Essentia before). rec['dec'] = 'ffmpeg' if ffmpeg did the reading."""
    ff = W.get('ffmpeg')
    if use_ffmpeg and ff:
        rec['dec'] = 'ffmpeg'
        return ffmpeg_load(ff, path)
    try:
        audio = W['es'].MonoLoader(filename=path, sampleRate=SR)()
        if len(audio) >= SR * 5 or not ff:
            return audio
    except Exception:
        if not ff:
            raise
    rec['dec'] = 'ffmpeg'
    return ffmpeg_load(ff, path)


def analyse_file(rec, path, use_ffmpeg=False):
    ar, ti, al = read_tags(path)
    if not ar or not ti:
        rec['err'] = 'no artist/title tags'
        return rec
    rec.update({'ar': ar, 'ti': ti, 'al': al})
    lim = W.get('max_minutes') or 0
    if lim:
        ln = length_of(path)                           # the whole file is loaded: very long recordings blow the memory
        if ln > lim * 60:
            rec['d'] = round(ln)
            rec['err'] = 'longer than %d min (--max-minutes)' % lim
            rec['skip'] = 1                            # counts as skipped, not as an error
            return rec
    try:
        es = W['es']
        tt, t0 = {}, [time.time()]
        def lap(name):
            if W['profile']:
                now = time.time()
                tt[name] = round(now - t0[0], 2)
                t0[0] = now
        audio = load_audio(rec, path, use_ffmpeg)
        lap('load')
        n = len(audio)
        if n < SR * 5:
            rec['err'] = 'too short or not readable'
            return rec
        rec['d'] = round(n / SR)
        sec = W['seconds']
        if sec and n > sec * SR:                       # the middle part is enough and saves time
            start = (n - sec * SR) // 2
            audio = audio[start:start + sec * SR]
        bpm = W['rhythm'](audio)[0]
        lap('tempo')
        key, scale, strength = W['key'](audio)
        lap('key')
        a16 = W['resample'](audio)
        emb = W['effnet'](a16)
        lap('effnet')
        mood = {}
        for name, (model, idx) in W['heads'].items():
            p = float(mean_rows(model(emb))[idx])
            if name in ('dance', 'voice'):
                rec[name] = round(p, 3)
            else:
                mood[name] = round(p, 3)
        g = mean_rows(W['genre'](emb))
        top = sorted(range(len(g)), key=lambda i: -g[i])[:5]
        rec['styles'] = [[W['genre_cls'][i], round(float(g[i]), 3)] for i in top if g[i] >= 0.05]
        lap('mood+genre')
        m = MUSICNN_SECONDS * SR_MODEL
        mid = a16[(len(a16) - m) // 2:(len(a16) - m) // 2 + m] if len(a16) > m else a16
        av = mean_rows(W['deam'](W['musicnn'](mid)))
        lap('musicnn')
        if tt:
            rec['_t'] = tt
        cls = W['deam_cls']
        rec['val'] = round(float(av[cls.index('valence')]), 3)
        rec['aro'] = round(float(av[cls.index('arousal')]), 3)
        rec.update({'bpm': round(float(bpm), 1), 'key': key, 'scale': scale, 'kstr': round(float(strength), 2), 'mood': mood})
    except Exception as e:
        rec['err'] = str(e)[:200] or e.__class__.__name__
    return rec


# ---------- Main flow ----------

def find_files(roots, excludes):
    for root in roots:
        root = os.path.abspath(os.path.expanduser(root))
        for dirpath, dirnames, filenames in os.walk(root, followlinks=True):
            # hidden folders and the duplicates moved aside by Xplorio ("Library check") are not part of the library
            dirnames[:] = sorted(d for d in dirnames if not d.startswith('.') and d != 'Xplorio Duplicates')
            for fn in sorted(filenames):
                if fn.startswith('._') or os.path.splitext(fn)[1].lower() not in AUDIO_EXT:
                    continue
                p = os.path.join(dirpath, fn)
                if any(fnmatch.fnmatch(p, x) for x in excludes):
                    continue
                try:
                    st = os.stat(p)
                except OSError:
                    continue
                yield p, st.st_size, int(st.st_mtime)


def load_done(out):
    done = {}
    if os.path.exists(out):
        with open(out, encoding='utf-8') as f:
            for line in f:
                try:
                    o = json.loads(line)
                    done[o['p']] = o
                except Exception:
                    pass
    return done


def compact(out, done, seen_roots, present, prune=False):
    """remove duplicate lines and drop entries for deleted files under the scanned folders;
    prune: also drop everything outside these folders (old paths, other drives), with a backup <out>.bak"""
    seen_roots = [r for r in seen_roots if os.path.isdir(r)]   # share disconnected in the meantime: keep its entries
    keep, dropped = [], 0
    for p, o in done.items():
        inside = any(p.startswith(r + os.sep) for r in seen_roots)
        if (inside and p not in present) or (prune and not inside):
            dropped += prune and not inside
            continue
        keep.append(o)
    if dropped:
        shutil.copy2(out, out + '.bak')
        print('--prune: %d entries outside the given folders removed (backup: %s.bak)' % (dropped, out))
    with open(out + '.neu', 'w', encoding='utf-8') as f:
        for o in keep:
            f.write(json.dumps(o, ensure_ascii=False) + '\n')
    os.replace(out + '.neu', out)
    return len(keep), sum(1 for o in keep if not o.get('err'))


def player_state(base):
    """Volumio state ('play', 'pause', 'stop' …), None if the player does not answer"""
    try:
        with urllib.request.urlopen(base.rstrip('/') + '/api/v1/getState', timeout=10) as r:
            return str(json.loads(r.read().decode('utf-8')).get('status') or 'stop')
    except Exception:
        return None


def wait_for_player(base, minutes):
    """wait until the player is reachable and not playing; returns the time waited in seconds"""
    t, said = time.time(), None
    while True:
        st = player_state(base)
        if st is not None and st != 'play':
            if said:
                print('  continuing (%s)' % time.strftime('%H:%M'), flush=True)
            return time.time() - t
        why = 'player is playing' if st == 'play' else 'player not reachable'
        if why != said:
            print('  paused, %s (%s); checking again every %d min' % (why, time.strftime('%H:%M'), minutes), flush=True)
            said = why
        time.sleep(minutes * 60)


PASSWORD = None                               # password for the services on the player, if one is set there


def ask_password(base):
    """The player has a password for the services: then the upload needs it (asked once, or XPLORIO_PASSWORD)."""
    global PASSWORD
    try:
        with urllib.request.urlopen(base.rstrip('/') + '/services', timeout=10) as r:
            needed = json.loads(r.read().decode('utf-8')).get('pw')
    except Exception:
        return                                # not reachable now: the upload says so later
    if needed:
        PASSWORD = os.environ.get('XPLORIO_PASSWORD') or getpass.getpass('Password for the services on the player: ')


def upload(out, base):
    url = base.rstrip('/') + '/essentia'
    with open(out, 'rb') as f:
        data = f.read()
    headers = {'Content-Type': 'application/x-ndjson'}
    if PASSWORD:
        headers['X-Xplorio-Password'] = PASSWORD
    req = urllib.request.Request(url, data=data, method='POST', headers=headers)
    with urllib.request.urlopen(req, timeout=300) as r:
        j = json.loads(r.read().decode('utf-8'))
    if not j.get('ok'):
        why = {'auth': 'wrong or missing password for the services (XPLORIO_PASSWORD)',
               'locked': 'too many wrong passwords, try again in %s s' % j.get('wait')}.get(j.get('error'), str(j.get('error')))
        sys.exit('Upload failed: ' + why)
    print('Uploaded: %d entries; on the player %d of %d tracks matched.' % (j['tracks'], j['matched'], j['library']))
    if j.get('full'):
        print('Note: the player keeps at most %d entries; the rest of the file is not used.' % j['tracks'])


def upload_partial(done, out, base, player):
    """Upload the progress so far (only the newest entry per file) without ending the run; True if uploaded.
    Not while the player is playing: the next partial upload or the end of the run catches up."""
    if player and player_state(player) in (None, 'play'):
        return False
    tmp = out + '.zwischenstand'
    try:
        with open(tmp, 'w', encoding='utf-8') as f:
            for o in done.values():
                f.write(json.dumps(o, ensure_ascii=False) + '\n')
        print('  uploading progress so far (%s) …' % time.strftime('%H:%M'), flush=True)
        upload(tmp, base)
        return True
    except SystemExit as e:                   # the tag service answered with an error
        print('  ' + str(e), flush=True)
    except Exception as e:
        print('  Upload failed: %s' % e, flush=True)
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    return True                               # don't retry right away


def main():
    ap = argparse.ArgumentParser(description='Analyse the music collection with Essentia (BPM, mood, energy, style).')
    ap.add_argument('roots', nargs='*', help='music folders (several allowed; symlinks are followed)')
    ap.add_argument('--out', default='essentia.jsonl', help='result file (default: essentia.jsonl)')
    ap.add_argument('--models', default=os.path.expanduser('~/.cache/mx-essentia'), help='folder for the models')
    ap.add_argument('--seconds', type=int, default=120, help='listen to only this many seconds from the middle (0 = whole track)')
    ap.add_argument('--jobs', type=int, default=max(1, (os.cpu_count() or 4) // 4), help='parallel processes')
    ap.add_argument('--exclude', action='append', default=[], help='pattern for paths to skip, e.g. "*/Audiobooks/*"')
    ap.add_argument('--retry-errors', action='store_true', help='retry files that had errors')
    ap.add_argument('--prune', action='store_true', help='remove entries outside the given music folders '
                    '(old paths, other drives); backup in <out>.bak')
    ap.add_argument('--profile', action='store_true', help='print the time per analysis step (for speeding up)')
    ap.add_argument('--max-minutes', type=int, default=30,
                    help='skip longer files, they are loaded whole (default 30, 0 = all)')
    ap.add_argument('--limit', type=int, default=0, help='analyse at most this many files (for trying it out)')
    ap.add_argument('--upload', metavar='URL', help='upload to the tag service afterwards, e.g. http://<player>:8766')
    ap.add_argument('--ffmpeg', metavar='PATH', help='ffmpeg for files Essentia cannot read '
                                                    '(default: search automatically; "off" = do not use)')
    ap.add_argument('--player', metavar='URL', help='the files are on this player (e.g. connected via SMB): '
                                                   'analyse only while it is reachable and not playing, e.g. http://<player>')
    ap.add_argument('--player-wait', type=int, default=10, metavar='MIN',
                    help='with --player: minutes until the next check (default 10)')
    ap.add_argument('--upload-every', type=int, default=None, metavar='MIN',
                    help='upload the progress this often, only while the player is not playing '
                         '(default with --player 120, else 0 = only at the end)')
    a = ap.parse_args()
    if not a.roots and not a.upload:
        ap.error('give music folders (or only --upload)')
    a.player_wait = max(1, a.player_wait)
    if a.player and '//' not in a.player:
        a.player = 'http://' + a.player
    if a.player and not a.upload:             # upload the result afterwards: tag service on the same device
        u = urllib.parse.urlsplit(a.player)
        a.upload = '%s://%s:8766' % (u.scheme or 'http', u.hostname)
    if a.upload_every is None:
        a.upload_every = 120 if a.player else 0
    if a.upload:
        ask_password(a.upload)

    if a.roots:
        fetch_models(a.models)
        ffmpeg = find_ffmpeg(a.ffmpeg)
        print('ffmpeg as fallback: ' + (ffmpeg or 'none (brew install ffmpeg)'), flush=True)
        roots = [os.path.abspath(os.path.expanduser(r)) for r in a.roots]
        if a.player:
            wait_for_player(a.player, a.player_wait)
        for r in roots:
            if not os.path.isdir(r):          # e.g. share not connected: otherwise all entries under it would count as deleted
                sys.exit('Folder not found: %s (network drive: connected in the Finder?)' % r)
        done = load_done(a.out)
        # recognise moved files (other drive, other folder structure) by file name and size
        by_name = {}
        for q, o in done.items():
            k = (os.path.basename(q), o.get('sz'))
            if k not in by_name or (o.get('v') == VERSION and not o.get('err')):   # prefer a current, error-free one
                by_name[k] = q
        present, todo, moved = set(), [], []
        for p, size, mtime in find_files(roots, a.exclude):
            present.add(p)
            o = done.get(p)
            if o is None:
                q = by_name.get((os.path.basename(p), size))
                if q and q in done and q not in present:
                    o = dict(done[q], p=p, mt=mtime)
                    done[p] = o
                    moved.append(o)
            if o and o.get('sz') == size and o.get('mt') == mtime and o.get('v') == VERSION and not (a.retry_errors and o.get('err') and not o.get('skip')):
                continue
            # after a crash read with ffmpeg right away, else it crashes again
            todo.append((p, size, mtime, bool(ffmpeg and o and o.get('err') in (CRASH, CRASH_OLD))))
        if moved:
            with open(a.out, 'a', encoding='utf-8') as f:   # record right away, even if the run is aborted
                for o in moved:
                    f.write(json.dumps(o, ensure_ascii=False) + '\n')
            again = set(j[0] for j in todo)
            print('%d files recognised in a new location (file name and size), %d of them without a new analysis.'
                  % (len(moved), sum(1 for o in moved if o['p'] not in again)), flush=True)
        if a.limit:
            todo = todo[:a.limit]
        print('%d audio files found, %d to analyse (%d processes).' % (len(present), len(todo), a.jobs), flush=True)
        if todo:
            t0, n, errs, skips, prof = time.time(), 0, 0, 0, {}
            marks = a.out + '.laeuft'
            os.makedirs(marks, exist_ok=True)
            for x in os.listdir(marks):
                os.remove(os.path.join(marks, x))
            ctx = mp.get_context('spawn')

            def pool():
                return cf.ProcessPoolExecutor(a.jobs, mp_context=ctx, initializer=worker_init,
                                              initargs=(a.models, a.seconds, a.profile, a.max_minutes, marks, ffmpeg))

            def handle(f, rec):
                nonlocal n, errs, skips
                for k, v in rec.pop('_t', {}).items():
                    prof[k] = prof.get(k, 0) + v
                f.write(json.dumps(rec, ensure_ascii=False) + '\n')
                f.flush()
                done[rec['p']] = rec
                n += 1
                if rec.get('skip'):
                    skips += 1
                    print('  skipped: %s: %s' % (rec['p'], rec['err']), flush=True)
                elif rec.get('err'):
                    errs += 1
                    print('  Error: %s: %s' % (rec['p'], rec['err']), flush=True)
                if n % 25 == 0 or n == len(todo):
                    el = time.time() - t0
                    eta = el / n * (len(todo) - n)
                    print('  %d/%d  (%.1f s per file, about %d min left, %d errors, %d skipped)'
                          % (n, len(todo), el / n, eta / 60, errs, skips), flush=True)

            queue = list(reversed(todo))
            solo = []
            blind = 0
            ff_tried = set()                  # already retried once with ffmpeg after a crash
            ex = pool()
            running = {}
            up_t, up_n = time.time(), 0          # last partial upload: time and number of files up to then
            try:
                with open(a.out, 'a', encoding='utf-8') as f:
                    while queue or running or solo:
                        hold = False
                        if a.player and (queue or solo) and player_state(a.player) in (None, 'play'):
                            if running:
                                hold = True          # playing or off: start nothing new, running jobs finish
                            else:
                                t0 += wait_for_player(a.player, a.player_wait)   # keep the pause out of the time estimate
                        if hold:
                            pass
                        elif solo:                   # suspects after a crash one at a time, so it is clear which one it was
                            if not running:
                                job = solo.pop()
                                running[ex.submit(analyse, job)] = job
                        else:
                            # with --player no files queued ahead: when playback starts only running jobs finish
                            while queue and len(running) < a.jobs * (1 if a.player else 2):
                                job = queue.pop()
                                running[ex.submit(analyse, job)] = job
                        fin, _ = cf.wait(running, return_when=cf.FIRST_COMPLETED)
                        broken = False
                        for fu in fin:
                            job = running.pop(fu)
                            try:
                                handle(f, fu.result())
                            except cf.process.BrokenProcessPool:
                                broken = True
                                queue.append(job)
                        if a.upload and a.upload_every and n > up_n and time.time() - up_t >= a.upload_every * 60:
                            if upload_partial(done, a.out, a.upload, a.player):
                                up_t, up_n = time.time(), n
                        if broken:
                            # a worker process crashed (and took the others down with it). The files on the
                            # markers are suspects: retry them one at a time; if one crashes alone, it counts as an error.
                            alone = len(running) == 0 and sum(1 for _ in fin) == 1
                            crashed = set()
                            for x in os.listdir(marks):
                                with open(os.path.join(marks, x), encoding='utf-8') as m:
                                    crashed.add(m.read())
                                os.remove(os.path.join(marks, x))
                            for fu, job in running.items():
                                queue.append(job)
                            running = {}
                            if alone and crashed:
                                for j in todo:
                                    if j[0] not in crashed:
                                        continue
                                    if ffmpeg and not j[3] and j[0] not in ff_tried:   # once more on its own, with ffmpeg
                                        ff_tried.add(j[0])
                                        solo.append((j[0], j[1], j[2], True))
                                        queue = [q for q in queue if q[0] != j[0]]
                                    else:
                                        handle(f, {'v': VERSION, 'p': j[0], 'sz': j[1], 'mt': j[2], 'err': CRASH})
                            else:
                                solo += [j for j in queue if j[0] in crashed]
                            queue = [j for j in queue if j[0] not in crashed]
                            if not crashed:          # unclear which: lose nothing, just start again
                                blind += 1
                                if blind >= 3:
                                    sys.exit('The worker processes keep crashing (check the Essentia/TensorFlow installation).')
                                print('  Worker process crashed, continuing …', flush=True)
                            else:
                                blind = 0
                            ex.shutdown(wait=False, cancel_futures=True)
                            ex = pool()
            except KeyboardInterrupt:
                ex.shutdown(wait=False, cancel_futures=True)
                print('\nAborted. The next run continues from here.')
                if a.upload and n > up_n:          # don't wait for the end of the next run to get the progress to the player
                    if a.player and player_state(a.player) in (None, 'play'):
                        print('Player is playing or not reachable: not uploaded, the next run will do it.')
                    else:
                        print('Uploading the progress so far (Ctrl-C aborts) …', flush=True)
                        try:
                            upload_partial(done, a.out, a.upload, None)
                        except KeyboardInterrupt:
                            print('\nUpload aborted.')
                sys.exit(1)
            ex.shutdown()
            try:
                os.rmdir(marks)
            except OSError:
                pass
            if prof and n:
                print('Time per file by step: ' + ', '.join('%s %.1f s' % (k, v / n) for k, v in prof.items()))
        # entries at the old location of moved files: if the file is no longer there, the entry moves
        here = set((os.path.basename(p), done[p].get('sz')) for p in present if p in done)
        for q in [q for q in done if q not in present and (os.path.basename(q), done[q].get('sz')) in here]:
            if not os.path.exists(q):
                del done[q]
        kept, ok = compact(a.out, done, roots, present, a.prune)
        print('Done: %d entries in %s, %d of them analysed.' % (kept, a.out, ok))

    if a.upload:
        if a.player:
            wait_for_player(a.player, a.player_wait)   # don't upload while the player is playing
        upload(a.out, a.upload)


if __name__ == '__main__':
    main()
