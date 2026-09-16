import glob

files = glob.glob('v9.3.0.24-1/**/*.html', recursive=True)
target = 'const child=htmlToElements(text,el_id);if(sprite_uid.length)child.setAttribute("data-sprite-uid",sprite_uid);el.appendChild(child);'
replacement = 'const child=htmlToElements(text,el_id);if(child&&child.setAttribute){if(sprite_uid.length)child.setAttribute("data-sprite-uid",sprite_uid);el.appendChild(child);}'

count = 0
for f in files:
    with open(f, 'r', encoding='utf-8', errors='ignore') as fp:
        c = fp.read()
    if target in c:
        c = c.replace(target, replacement)
        with open(f, 'w', encoding='utf-8') as fp:
            fp.write(c)
        count += 1
        print('Guarded in:', f)
print('Total files updated:', count)
