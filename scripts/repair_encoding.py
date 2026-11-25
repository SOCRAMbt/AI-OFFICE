#!/usr/bin/env python3
"""Repara archivos dañados por PowerShell/cp850/cp1252.
1) Si el archivo tiene mojibake cp850 (├│, ´┐¢...), lo revierte (encode cp850 -> decode utf-8).
2) Si tiene mojibake cp1252 (Ã³, Ã©, Ã¡...), lo revierte (encode cp1252 -> decode utf-8).
3) Las palabras con U+FFFD se reparan buscando la palabra correcta en un diccionario
   construido con versiones limpias del historial git y con todo el repo.
4) Quita BOM y normaliza a LF.
Con --check: falla ante BOM, U+FFFD, ├│ ├í ├® ├¡ ├▒ ÔåÆ ´┐¢ Ã³ Ã© Ã¡ Ã± Ã¼ â€.
"""
import re, subprocess, sys, collections, os

MOJI_CP850 = ['├│','├í','├®','├¡','├▒','├║','ÔåÆ','´┐¢','ÔÇö','ÔÇ£','┬á']
MOJI_CP1252 = ['Ã³','Ã©','Ã¡','Ã±','Ã¼','Ãº','Ã¶','Ã§','Ã¢','Ã´','Ã»','Ã','Ã¨','Ã¬','Ã¹','Ã¿','â€','â€œ','â€','â€"','â€˜','â€™','â€¢','â€¦']

def git(*a):
    result = subprocess.run(['git']+list(a), capture_output=True, text=True, encoding='utf-8', errors='replace')
    return result.stdout

def build_dict():
    words = collections.Counter()
    for f in git('ls-files').split():
        if not re.search(r'\.(md|ts|mjs|json|txt|html)$', f): continue
        try:
            s = open(f, encoding='utf-8').read()
        except Exception:
            continue
        if '\ufffd' in s or any(m in s for m in MOJI_CP850 + MOJI_CP1252): continue
        words.update(re.findall(r'\w+', s, flags=re.UNICODE))
    # versiones limpias del historial
    for c in git('log', '--format=%h', '-n', '150').split():
        for f in ['skills/oficina/SKILL.md','docs/QUE-ES.md','docs/ARCHITECTURE.md','skills/oficina/reference/protocol.md']:
            s = git('show', f'{c}:{f}')
            if s and '\ufffd' not in s and not any(m in s for m in MOJI_CP850 + MOJI_CP1252):
                words.update(re.findall(r'\w+', s, flags=re.UNICODE))
    return words

def fix_word(w, words):
    pat = re.compile('^'+re.escape(w).replace('\ufffd', r'\w')+'$')
    pat2 = re.compile('^'+re.escape(w).replace('\ufffd', '')+'$')
    cands = [(n,c) for c,n in words.items() if pat.match(c) and not c.isascii()]
    if not cands: cands = [(n,c) for c,n in words.items() if pat.match(c)]
    return max(cands)[1] if cands else None

def check_file(f):
    try:
        b = open(f, 'rb').read()
    except Exception:
        return True, True, True  # skip
    has_bom = b[:3] == b'\xef\xbb\xbf'
    has_bom |= b[:2] in (b'\xff\xfe', b'\xfe\xff')
    try:
        if b[:2] in (b'\xff\xfe', b'\xfe\xff'):
            s = b.decode('utf-16')
        else:
            s = b.decode('utf-8', 'replace')
    except Exception:
        return True, True, True
    has_fffd = '\ufffd' in s
    has_moji = any(m in s for m in MOJI_CP850 + MOJI_CP1252)
    return has_bom, has_fffd, has_moji

def repair_file(f, words):
    b = open(f, 'rb').read()
    if b[:2] in (b'\xff\xfe', b'\xfe\xff'):
        s = b.decode('utf-16')
    else:
        s = b.decode('utf-8', 'replace')
    s = s.lstrip('\ufeff')
    if any(m in s for m in MOJI_CP850):
        try:
            s = s.encode('cp850').decode('utf-8', 'replace')
        except UnicodeEncodeError:
            def seg(m):
                try: return m.group(0).encode('cp850').decode('utf-8')
                except Exception: return m.group(0)
            s = re.sub(r'[\u0080-\u00ff\u2500-\u25ff\u0131\u0192\u2017]{2,}', seg, s)
    if any(m in s for m in MOJI_CP1252):
        try:
            s = s.encode('cp1252').decode('utf-8', 'replace')
        except UnicodeEncodeError:
            def seg(m):
                try: return m.group(0).encode('cp1252').decode('utf-8')
                except Exception: return m.group(0)
            s = re.sub(r'[\u0080-\u00ff]{2,}', seg, s)
    # fix specific patterns
    s = s.replace('PowerShell\uFFFD', 'PowerShell\u2026')
    s = re.sub(r'(?<=\s)\uFFFD(?=\s)', '\u2014', s)
    s = re.sub(r'(?<=[A-Za-z0-9])\uFFFD(?=[A-Z0-9])', '\u2013', s)
    s = re.sub(r'(?m)(?:(?<=^)|(?<=[\s(*|>"]))\uFFFD(?=[A-Z\u00c0-\u00ff][^?\n]*\?)', '\u00bf', s)
    s = re.sub(r'ci\uFFFDn\\b', 'ci\u00f3n', s)
    s = re.sub(r'si\uFFFDn\\b', 'si\u00f3n', s)
    # fix remaining U+FFFD
    def rep(m):
        w = m.group(0)
        r = fix_word(w, words)
        if r is None: return w
        return r
    s = re.sub(r'[\w]*\uFFFD[\w\uFFFD]*', rep, s)
    s = s.replace('\r\n', '\n')
    open(f, 'w', encoding='utf-8', newline='\n').write(s)

def main(files, check_only=False):
    words = build_dict()
    total_bom = total_fffd = total_moji = 0
    for f in files:
        has_bom, has_fffd, has_moji = check_file(f)
        if has_bom: total_bom += 1
        if has_fffd: total_fffd += 1
        if has_moji: total_moji += 1
        if not check_only and (has_bom or has_fffd or has_moji):
            repair_file(f, words)
            has_bom2, has_fffd2, has_moji2 = check_file(f)
            if has_bom2 or has_fffd2 or has_moji2:
                print(f"  {f}: BOM={has_bom2}, FFFD={has_fffd2}, MOJI={has_moji2} (NOT FULLY REPAIRED)")
    if check_only:
        if total_bom or total_fffd or total_moji:
            print(f"FAIL: BOM={total_bom}, U+FFFD={total_fffd}, MOJIBAKE={total_moji}")
            sys.exit(1)
        else:
            print("OK: No BOM, no U+FFFD, no mojibake")
    else:
        print(f"Repaired {len(files)} files. Remaining issues: BOM={total_bom}, U+FFFD={total_fffd}, MOJIBAKE={total_moji}")

if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--check', action='store_true')
    p.add_argument('files', nargs='*')
    args = p.parse_args()
    if args.files:
        files = args.files
    else:
        files = []
        for root, dirs, fnames in os.walk('.'):
            dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', 'dist', '.turbo')]
            for fn in fnames:
                if re.search(r'\.(md|ts|mjs|json|txt|html)$', fn):
                    files.append(os.path.join(root, fn))
    main(files, check_only=args.check)