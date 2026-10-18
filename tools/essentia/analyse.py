#!/usr/bin/env python3
"""Audio-Analyse der Musiksammlung mit Essentia (auf dem Mac, nicht auf dem Player).

Hört jeden Titel an und schreibt je Titel eine Zeile nach essentia.jsonl: BPM, Tonart, Stimmungen
(fröhlich, traurig, entspannt, aggressiv, Party), Tanzbarkeit, Gesang, Valenz/Erregung (DEAM) und
Discogs-Stile. Der Tag-Dienst auf dem Player ordnet die Zeilen über Künstler und Titel zu, die
Ordnerstruktur ist also egal. Bereits analysierte, unveränderte Dateien werden übersprungen;
abbrechen (Ctrl-C) und später weitermachen geht jederzeit.

    python3 analyse.py /Volumes/Data/Musik /Volumes/Data/AllFlac
    python3 analyse.py --upload http://<player>:8766 /Volumes/Data/Musik
    python3 analyse.py --player http://<player> /Volumes/<SMB-Freigabe des Players>/Musik

Voraussetzung: macOS 15+ mit Python 3.14 (pip install essentia-tensorflow mutagen);
Intel-Mac mit macOS 14: Python 3.13 und pip install "essentia-tensorflow==2.1b6.dev1389" mutagen
Die vortrainierten Modelle (rund 100 MB) lädt das Skript beim ersten Lauf selbst herunter.
Optional ffmpeg (brew install ffmpeg): liest Dateien, an denen Essentia scheitert oder abstürzt. Nach dem Einrichten
holt "python3 analyse.py --retry-errors …" die bisher fehlgeschlagenen Dateien nach.
Modelle: CC BY-NC-SA 4.0 (nur nicht-kommerziell), https://essentia.upf.edu/models
"""
import argparse
import concurrent.futures as cf
import fnmatch
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
HEADS = {                                    # Name in der Ausgabe -> Modell, gesuchte Klasse
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
# Die Discogs-Effnet-Fassung rechnet immer 64 Ausschnitte auf einmal (rund 131 s Musik ohne Überlappung); bis dahin
# kostet längeres Anhören also nichts extra. MusiCNN (nur für Valenz/Erregung) ist auf dem Mac der teuerste Schritt
# und bekommt deshalb nur die mittleren 45 s, so lang wie die DEAM-Ausschnitte, mit denen das Modell gelernt hat.
EFFNET_HOP = 128
MUSICNN_SECONDS = 45
MUSICNN_HOP = 187
CRASH = 'Analyse abgestürzt (Datei beschädigt oder zu groß?)'
FFMPEG_PATHS = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']   # falls nicht im PATH (z. B. aus cron)


def find_ffmpeg(arg):
    """ffmpeg für Dateien, die Essentia nicht lesen kann: --ffmpeg PFAD, 'aus' = nie, sonst suchen"""
    if arg is not None:
        return '' if arg in ('', 'aus', 'off', 'no') else arg
    return shutil.which('ffmpeg') or next((p for p in FFMPEG_PATHS if os.access(p, os.X_OK)), '')


def ffmpeg_load(ffmpeg, path):
    """ganze Datei als Mono, 44,1 kHz, float32 (wie MonoLoader)"""
    import numpy as np
    r = subprocess.run([ffmpeg, '-v', 'error', '-nostdin', '-i', path, '-vn', '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=600)
    audio = np.frombuffer(r.stdout, dtype=np.float32)
    if r.returncode != 0 and len(audio) < SR * 5:
        raise RuntimeError('ffmpeg: ' + (r.stderr.decode('utf-8', 'replace').strip().splitlines() or ['Fehler'])[-1][:150])
    return audio


def head_path(model):
    return 'classification-heads/%s/%s-discogs-effnet-1' % (model, model)


def all_models():
    out = [EFFNET, MUSICNN, GENRE, DEAM] + [head_path(m) for m, _ in HEADS.values()]
    return out


def fetch_models(folder):
    """Modelle (.pb) und Beschreibungen (.json) einmalig herunterladen."""
    os.makedirs(folder, exist_ok=True)
    for m in all_models():
        exts = ['.pb'] if m.startswith('feature-extractors/') else ['.pb', '.json']
        for ext in exts:
            dst = os.path.join(folder, os.path.basename(m) + ext)
            if os.path.exists(dst) and os.path.getsize(dst) > 0:
                continue
            url = MODEL_URL + m + ext
            print('Lade Modell ' + os.path.basename(dst) + ' …', flush=True)
            try:
                with urllib.request.urlopen(url, timeout=120) as r, open(dst + '.neu', 'wb') as f:
                    while True:
                        b = r.read(1 << 20)
                        if not b:
                            break
                        f.write(b)
                os.replace(dst + '.neu', dst)
            except Exception as e:
                sys.exit('Modell nicht ladbar: %s (%s)' % (url, e))


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
    """-> (Künstler, Titel, Album); zuerst mutagen (kann auch DSF), sonst Essentias eigener Leser"""
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


# ---------- Analyse (je Arbeitsprozess) ----------

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
    # Merkzettel je Prozess: stürzt der Prozess bei dieser Datei ab (Essentia/TensorFlow), weiß der Hauptprozess welche
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
    """Essentia liest; scheitert es (Fehler oder fast nichts gelesen), liest ffmpeg. use_ffmpeg: gleich ffmpeg
    (die Datei hat Essentia zuvor zum Absturz gebracht). rec['dec'] = 'ffmpeg', wenn ffmpeg gelesen hat."""
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
        rec['err'] = 'keine Künstler-/Titel-Tags'
        return rec
    rec.update({'ar': ar, 'ti': ti, 'al': al})
    lim = W.get('max_minutes') or 0
    if lim:
        ln = length_of(path)                           # ganze Datei wird geladen: sehr lange Mitschnitte sprengen den Speicher
        if ln > lim * 60:
            rec['d'] = round(ln)
            rec['err'] = 'länger als %d min (--max-minutes)' % lim
            rec['skip'] = 1                            # zählt als übersprungen, nicht als Fehler
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
        lap('laden')
        n = len(audio)
        if n < SR * 5:
            rec['err'] = 'zu kurz oder nicht lesbar'
            return rec
        rec['d'] = round(n / SR)
        sec = W['seconds']
        if sec and n > sec * SR:                       # Mittelteil reicht und spart Zeit
            start = (n - sec * SR) // 2
            audio = audio[start:start + sec * SR]
        bpm = W['rhythm'](audio)[0]
        lap('tempo')
        key, scale, strength = W['key'](audio)
        lap('tonart')
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
        lap('stimmung+genre')
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


# ---------- Ablauf ----------

def find_files(roots, excludes):
    for root in roots:
        root = os.path.abspath(os.path.expanduser(root))
        for dirpath, dirnames, filenames in os.walk(root, followlinks=True):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith('.'))
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


def compact(out, done, seen_roots, present):
    """doppelte Zeilen entfernen und Einträge zu gelöschten Dateien unter den gelesenen Ordnern verwerfen"""
    seen_roots = [r for r in seen_roots if os.path.isdir(r)]   # Share inzwischen getrennt: dessen Einträge behalten
    keep = []
    for p, o in done.items():
        if any(p.startswith(r + os.sep) for r in seen_roots) and p not in present:
            continue
        keep.append(o)
    with open(out + '.neu', 'w', encoding='utf-8') as f:
        for o in keep:
            f.write(json.dumps(o, ensure_ascii=False) + '\n')
    os.replace(out + '.neu', out)
    return len(keep)


def player_state(base):
    """Zustand von Volumio ('play', 'pause', 'stop' …), None wenn der Player nicht antwortet"""
    try:
        with urllib.request.urlopen(base.rstrip('/') + '/api/v1/getState', timeout=10) as r:
            return str(json.loads(r.read().decode('utf-8')).get('status') or 'stop')
    except Exception:
        return None


def wait_for_player(base, minutes):
    """warten, bis der Player erreichbar ist und nicht spielt; gibt die gewartete Zeit in Sekunden zurück"""
    t, said = time.time(), None
    while True:
        st = player_state(base)
        if st is not None and st != 'play':
            if said:
                print('  weiter (%s)' % time.strftime('%H:%M'), flush=True)
            return time.time() - t
        why = 'Player spielt' if st == 'play' else 'Player nicht erreichbar'
        if why != said:
            print('  pausiert, %s (%s); nächste Abfrage alle %d min' % (why, time.strftime('%H:%M'), minutes), flush=True)
            said = why
        time.sleep(minutes * 60)


def upload(out, base):
    url = base.rstrip('/') + '/essentia'
    with open(out, 'rb') as f:
        data = f.read()
    req = urllib.request.Request(url, data=data, method='POST', headers={'Content-Type': 'application/x-ndjson'})
    with urllib.request.urlopen(req, timeout=300) as r:
        j = json.loads(r.read().decode('utf-8'))
    if not j.get('ok'):
        sys.exit('Hochladen fehlgeschlagen: ' + str(j.get('error')))
    print('Hochgeladen: %d Einträge; auf dem Player %d von %d Titeln zugeordnet.' % (j['tracks'], j['matched'], j['library']))


def main():
    ap = argparse.ArgumentParser(description='Musiksammlung mit Essentia analysieren (BPM, Stimmung, Energie, Stil).')
    ap.add_argument('roots', nargs='*', help='Musikordner (mehrere möglich; Symlinks werden verfolgt)')
    ap.add_argument('--out', default='essentia.jsonl', help='Ergebnisdatei (Standard: essentia.jsonl)')
    ap.add_argument('--models', default=os.path.expanduser('~/.cache/mx-essentia'), help='Ordner für die Modelle')
    ap.add_argument('--seconds', type=int, default=120, help='nur so viele Sekunden aus der Mitte anhören (0 = ganz)')
    ap.add_argument('--jobs', type=int, default=max(1, (os.cpu_count() or 4) // 4), help='parallele Prozesse')
    ap.add_argument('--exclude', action='append', default=[], help='Muster für auszulassende Pfade, z. B. "*/Hörbücher/*"')
    ap.add_argument('--retry-errors', action='store_true', help='Dateien mit Fehler erneut versuchen')
    ap.add_argument('--profile', action='store_true', help='Zeit je Analyseschritt ausgeben (zum Beschleunigen)')
    ap.add_argument('--max-minutes', type=int, default=30,
                    help='längere Dateien auslassen, sie werden ganz geladen (Standard 30, 0 = alle)')
    ap.add_argument('--limit', type=int, default=0, help='höchstens so viele Dateien analysieren (zum Ausprobieren)')
    ap.add_argument('--upload', metavar='URL', help='danach zum Tag-Dienst hochladen, z. B. http://<player>:8766')
    ap.add_argument('--ffmpeg', metavar='PFAD', help='ffmpeg für Dateien, die Essentia nicht lesen kann '
                                                    '(Standard: automatisch suchen; "aus" = nicht benutzen)')
    ap.add_argument('--player', metavar='URL', help='die Dateien liegen auf diesem Player (z. B. per SMB verbunden): '
                                                   'nur analysieren, wenn er erreichbar ist und nicht spielt, z. B. http://<player>')
    ap.add_argument('--player-wait', type=int, default=10, metavar='MIN',
                    help='mit --player: so viele Minuten bis zur nächsten Abfrage (Standard 10)')
    a = ap.parse_args()
    if not a.roots and not a.upload:
        ap.error('Musikordner angeben (oder nur --upload)')
    a.player_wait = max(1, a.player_wait)
    if a.player and '//' not in a.player:
        a.player = 'http://' + a.player
    if a.player and not a.upload:             # Ergebnis danach selbst hochladen: Tag-Dienst auf demselben Gerät
        u = urllib.parse.urlsplit(a.player)
        a.upload = '%s://%s:8766' % (u.scheme or 'http', u.hostname)

    if a.roots:
        fetch_models(a.models)
        ffmpeg = find_ffmpeg(a.ffmpeg)
        print('ffmpeg als Ersatz: ' + (ffmpeg or 'keins (brew install ffmpeg)'), flush=True)
        roots = [os.path.abspath(os.path.expanduser(r)) for r in a.roots]
        if a.player:
            wait_for_player(a.player, a.player_wait)
        for r in roots:
            if not os.path.isdir(r):          # z. B. Share nicht verbunden: sonst gälten alle Einträge darunter als gelöscht
                sys.exit('Ordner nicht gefunden: %s (bei einem Netzlaufwerk: im Finder verbunden?)' % r)
        done = load_done(a.out)
        present, todo = set(), []
        for p, size, mtime in find_files(roots, a.exclude):
            present.add(p)
            o = done.get(p)
            if o and o.get('sz') == size and o.get('mt') == mtime and o.get('v') == VERSION and not (a.retry_errors and o.get('err') and not o.get('skip')):
                continue
            # nach einem Absturz gleich mit ffmpeg lesen, sonst stürzt es wieder ab
            todo.append((p, size, mtime, bool(ffmpeg and o and o.get('err') == CRASH)))
        if a.limit:
            todo = todo[:a.limit]
        print('%d Audiodateien gefunden, %d zu analysieren (%d Prozesse).' % (len(present), len(todo), a.jobs), flush=True)
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
                    print('  übersprungen: %s: %s' % (rec['p'], rec['err']), flush=True)
                elif rec.get('err'):
                    errs += 1
                    print('  Fehler: %s: %s' % (rec['p'], rec['err']), flush=True)
                if n % 25 == 0 or n == len(todo):
                    el = time.time() - t0
                    eta = el / n * (len(todo) - n)
                    print('  %d/%d  (%.1f s je Datei, noch etwa %d min, %d Fehler, %d übersprungen)'
                          % (n, len(todo), el / n, eta / 60, errs, skips), flush=True)

            queue = list(reversed(todo))
            solo = []
            blind = 0
            ff_tried = set()                  # nach einem Absturz schon einmal mit ffmpeg versucht
            ex = pool()
            running = {}
            try:
                with open(a.out, 'a', encoding='utf-8') as f:
                    while queue or running or solo:
                        hold = False
                        if a.player and (queue or solo) and player_state(a.player) in (None, 'play'):
                            if running:
                                hold = True          # spielt oder ist aus: nichts Neues anfangen, Laufendes wird fertig
                            else:
                                t0 += wait_for_player(a.player, a.player_wait)   # Pause nicht in die Zeitschätzung
                        if hold:
                            pass
                        elif solo:                   # Verdächtige nach einem Absturz einzeln, damit klar ist, wer es war
                            if not running:
                                job = solo.pop()
                                running[ex.submit(analyse, job)] = job
                        else:
                            # mit --player keine Dateien auf Vorrat: beim Start der Wiedergabe wird nur Laufendes fertig
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
                        if broken:
                            # ein Arbeitsprozess ist abgestürzt (und hat die anderen mitgerissen). Die Dateien auf den
                            # Merkzetteln sind verdächtig: einzeln wiederholen; stürzt eine allein ab, gilt sie als Fehler.
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
                                    if ffmpeg and not j[3] and j[0] not in ff_tried:   # noch einmal einzeln, mit ffmpeg
                                        ff_tried.add(j[0])
                                        solo.append((j[0], j[1], j[2], True))
                                        queue = [q for q in queue if q[0] != j[0]]
                                    else:
                                        handle(f, {'v': VERSION, 'p': j[0], 'sz': j[1], 'mt': j[2], 'err': CRASH})
                            else:
                                solo += [j for j in queue if j[0] in crashed]
                            queue = [j for j in queue if j[0] not in crashed]
                            if not crashed:          # unklar welche: nichts verlieren, nur neu anfangen
                                blind += 1
                                if blind >= 3:
                                    sys.exit('Die Arbeitsprozesse stürzen immer wieder ab (Essentia/TensorFlow-Installation prüfen).')
                                print('  Arbeitsprozess abgestürzt, mache weiter …', flush=True)
                            else:
                                blind = 0
                            ex.shutdown(wait=False, cancel_futures=True)
                            ex = pool()
            except KeyboardInterrupt:
                ex.shutdown(wait=False, cancel_futures=True)
                print('\nAbgebrochen. Beim nächsten Aufruf geht es hier weiter.')
                sys.exit(1)
            ex.shutdown()
            try:
                os.rmdir(marks)
            except OSError:
                pass
            if prof and n:
                print('Zeit je Datei nach Schritt: ' + ', '.join('%s %.1f s' % (k, v / n) for k, v in prof.items()))
        kept = compact(a.out, done, roots, present)
        ok = sum(1 for o in done.values() if not o.get('err'))
        print('Fertig: %d Einträge in %s, davon %d analysiert.' % (kept, a.out, ok))

    if a.upload:
        if a.player:
            wait_for_player(a.player, a.player_wait)   # nicht hochladen, während der Player spielt
        upload(a.out, a.upload)


if __name__ == '__main__':
    main()
