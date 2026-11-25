import os, re

MOJI_CP850 = ['├│','├í','├®','├¡','├▒','├║','ÔåÆ','´┐¢','ÔÇö','ÔÇ£','┬á']
MOJI_CP1252 = ['Ã³','Ã©','Ã¡','Ã±','Ã¼','Ã','Ã¶','Ã¼','Ã§','Ã¢','Ã´','Ã»','Ã','Ã¨','Ã¬','Ã¹','Ã±','Ã¿','â€','â€œ','â€','â€"','â€˜','â€™','â€¢','â€¦']

bom_count = 0
fffd_count = 0
moji_count = 0

for root, dirs, files in os.walk('.'):
    dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', 'dist', '.turbo', '.release')]
    for f in files:
        if re.search(r'\.(md|ts|mjs|json|txt|html)$', f):
            path = os.path.join(root, f)
            try:
                b = open(path, 'rb').read()
                if b[:3] == b'\xef\xbb\xbf' or b[:2] in (b'\xff\xfe', b'\xfe\xff'):
                    bom_count += 1
                    print('BOM: ' + path)
                s = b.decode('utf-8', 'replace')
                if '\ufffd' in s:
                    fffd_count += 1
                    print('U+FFFD: ' + path + ' (' + str(s.count(chr(0xfffd))) + ')')
                for m in MOJI_CP850 + MOJI_CP1252:
                    c = s.count(m)
                    if c > 0:
                        moji_count += c
                        print('MOJIBAKE: ' + path + ' (' + str(c) + 'x ' + repr(m) + ')')
            except: pass

print('Total: BOM=' + str(bom_count) + ', U+FFFD=' + str(fffd_count) + ', MOJIBAKE=' + str(moji_count))