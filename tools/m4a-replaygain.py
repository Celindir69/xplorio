#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""m4a-replaygain: ReplayGain in m4a (ALAC, AAC) for older players.

The usual place for ReplayGain in m4a is a freeform atom with the domain "com.apple.iTunes". libav 11 (Volumio 2,
e.g. MX-Stream; MPD reads m4a through it) only reads the domain "org.hydrogenaudio.replaygain" and ignores the rest,
so MPD plays these files without ReplayGain. This copies the four values (track/album gain and peak) into that
domain as well. The iTunes fields stay; newer ffmpeg (Volumio 4) reads both, other programs ignore the second domain.
Only the tags change, the audio data stays as it is; the file's modification time is kept.

  python tools/m4a-replaygain.py /mnt/USB/MX-Media/Musik            # trial run: only shows what it would do
  python tools/m4a-replaygain.py --write /mnt/USB/MX-Media/Musik    # writes
  python tools/m4a-replaygain.py --remove --write <folder>          # takes the copies out again

Runs with Python 2.7 and 3 and the mutagen that comes with Xplorio (tags/vendor).
"""
from __future__ import print_function
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
for d in (os.path.join(HERE, '..', 'tags', 'vendor'), os.path.join(HERE, '..', 'app', 'tags', 'vendor'),
          '/data/plugins/user_interface/xplorio/app/tags/vendor'):   # the installed plugin
    if os.path.isdir(d):
        sys.path.insert(0, d)
from mutagen.mp4 import MP4, MP4FreeForm, AtomDataType  # noqa: E402

KEYS = ['replaygain_track_gain', 'replaygain_album_gain', 'replaygain_track_peak', 'replaygain_album_peak']
SRC = '----:com.apple.iTunes:'
DST = '----:org.hydrogenaudio.replaygain:'
EXT = ('.m4a', '.mp4', '.m4b')


def text(v):
    v = bytes(v)
    try:
        return v.decode('utf-8').strip()
    except UnicodeDecodeError:
        return ''


def plan(tags, remove):
    """-> {key: value or None (delete)} for this file"""
    have = dict((k.lower(), k) for k in tags.keys())
    out = {}
    for name in KEYS:
        dst = have.get((DST + name).lower())
        if remove:
            if dst:
                out[dst] = None
            continue
        src = have.get((SRC + name).lower())
        val = text(tags[src][0]) if src and tags[src] else ''
        if not val:
            continue
        if dst and tags[dst] and text(tags[dst][0]) == val:
            continue
        out[dst or DST + name] = val
    return out


def main(argv):
    write = '--write' in argv
    remove = '--remove' in argv
    dirs = [a for a in argv if not a.startswith('--')]
    if not dirs:
        print(__doc__)
        return 2
    seen = changed = failed = 0
    for top in dirs:
        for root, _, files in os.walk(top):
            for f in sorted(files):
                if not f.lower().endswith(EXT):
                    continue
                path = os.path.join(root, f)
                seen += 1
                try:
                    audio = MP4(path)
                    todo = plan(audio.tags or {}, remove)
                    if not todo:
                        continue
                    changed += 1
                    print(('' if write else '[Probe] ') + path)
                    for k, v in sorted(todo.items()):
                        print('    ' + k.split(':')[-1] + ': ' + ('entfernt' if v is None else v))
                    if not write:
                        continue
                    st = os.stat(path)
                    for k, v in todo.items():
                        if v is None:
                            del audio.tags[k]
                        else:
                            audio.tags[k] = [MP4FreeForm(v.encode('utf-8'), dataformat=AtomDataType.UTF8)]
                    audio.save()
                    os.utime(path, (st.st_atime, st.st_mtime))
                except Exception as e:  # one broken file does not stop the run
                    failed += 1
                    print('FEHLER ' + path + ': ' + str(e), file=sys.stderr)
    print('%d m4a-Dateien, %d %s, %d Fehler%s' % (seen, changed, 'geändert' if write else 'zu ändern', failed,
                                                  '' if write else ' (Probelauf, mit --write schreiben)'))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
