import os
import sys
import urllib.request
import time

# 资源来源地址（仅开发期使用，不参与部署）。项目已完全本地化，
# 因此这里不内置任何外部域名，需要时显式指定自己的域名/CDN：
#   ASSET_SOURCE_BASE=https://cdn.example.com/v9.3.0.24-1 python scripts/download_remaining.py
ASSET_SOURCE_BASE = os.environ.get('ASSET_SOURCE_BASE', '').rstrip('/')
if not ASSET_SOURCE_BASE:
    sys.exit('ASSET_SOURCE_BASE is required, e.g. https://cdn.example.com/v9.3.0.24-1')
BASE_CDN = ASSET_SOURCE_BASE + '/'
LOCAL_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'v9.3.0.24-1')

missing = [
    # PDF WASM engine (critical)
    'sdkjs/pdf/src/engine/drawingfile.wasm',
    # code.js for each editor
    'web-apps/apps/documenteditor/main/code.js',
    'web-apps/apps/spreadsheeteditor/main/code.js',
    'web-apps/apps/presentationeditor/main/code.js',
    'web-apps/apps/pdfeditor/main/code.js',
    # alphabet/keyboard layouts
    'web-apps/apps/common/main/resources/alphabetletters/alphabetletters.json',
    'web-apps/apps/common/main/resources/alphabetletters/qwertyletters.json',
    # numbering lists (word)
    'web-apps/apps/documenteditor/main/resources/numbering/numbering-lists.json',
    'web-apps/apps/documenteditor/main/resources/numbering/multilevel-lists.json',
    # high-DPI SVG icons
    'web-apps/apps/documenteditor/main/resources/img/iconssmall@2.5x.svg',
    'web-apps/apps/documenteditor/main/resources/img/iconsbig@2.5x.svg',
    'web-apps/apps/documenteditor/main/resources/img/iconshuge@2.5x.svg',
    'web-apps/apps/spreadsheeteditor/main/resources/img/iconssmall@2.5x.svg',
    'web-apps/apps/spreadsheeteditor/main/resources/img/iconsbig@2.5x.svg',
    'web-apps/apps/spreadsheeteditor/main/resources/img/iconshuge@2.5x.svg',
    'web-apps/apps/presentationeditor/main/resources/img/iconssmall@2.5x.svg',
    'web-apps/apps/presentationeditor/main/resources/img/iconsbig@2.5x.svg',
    'web-apps/apps/presentationeditor/main/resources/img/iconshuge@2.5x.svg',
    'web-apps/apps/pdfeditor/main/resources/img/iconssmall@2.5x.svg',
    'web-apps/apps/pdfeditor/main/resources/img/iconsbig@2.5x.svg',
    'web-apps/apps/pdfeditor/main/resources/img/iconshuge@2.5x.svg',
    # formula descriptions
    'web-apps/apps/spreadsheeteditor/main/resources/formula-lang/zh_desc.json',
    'web-apps/apps/spreadsheeteditor/main/resources/formula-lang/en_desc.json',
]

print(f"[INFO] Downloading {len(missing)} missing files...")
success = 0
failed = []

for rel_path in missing:
    url = BASE_CDN + rel_path
    local_path = os.path.join(LOCAL_ROOT, rel_path.replace('/', os.sep))

    if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
        print(f"  [SKIP] {rel_path}")
        success += 1
        continue

    os.makedirs(os.path.dirname(local_path), exist_ok=True)

    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = bytearray()
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    data.extend(chunk)
            with open(local_path, 'wb') as f:
                f.write(data)
            print(f"  [OK] {rel_path} ({len(data)/1024:.1f} KB)")
            success += 1
            break
        except Exception as e:
            if attempt == 2:
                failed.append((rel_path, str(e)))
                print(f"  [FAIL] {rel_path}: {e}")
            else:
                time.sleep(1)

print(f"\nSuccess: {success}, Failed: {len(failed)}")
if failed:
    for p, e in failed:
        print(f"  FAILED: {p} -> {e}")
