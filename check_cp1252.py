import os, re
MOJI_CP1252 = ['Ã³','Ã©','Ã¡','Ã±','Ã¼','Ã','Ã¶','Ã¼','Ã§','Ã¢','Ã´','Ã»','Ã','Ã¨','Ã¬','Ã¹','Ã±','Ã¿','â€','â€œ','â€','â€"','â€˜','â€™','â€¢','â€¦']
count = 0
for root, dirs, files in os.walk('.'):
    dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', 'dist', '.turbo', '.release')]
    for f in files:
        if re.search(r'\.(md|ts|mjs|json|txt|html)$', f):
            path = os.path.join(root, f)
            try:
                b = open(path, 'rb').read()
                s = b.decode('utf-8', 'replace')
                for m in MOJI_CP1252:
                    c = s.count(m)
                    if c > 0:
                        count += c
                        print(f'FOUND {c}x {repr(m)} in {path}')
            except: pass
print(f'Total CP1252: {count}')