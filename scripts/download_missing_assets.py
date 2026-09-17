"""
Dev-only helper (never part of the deployed site): download assets that are
still missing locally. The project is fully self-hosted, so no external domain
is baked in - point it at your own domain/CDN when you need it:
    ASSET_SOURCE_BASE=https://cdn.example.com/v9.3.0.24-1 python scripts/download_missing_assets.py

- 218 font files (000-217)
- UI images, icons, placeholders
- drawingfile.js, warnings_s.svg, fonts_thumbnail_ea.png.bin
"""
import os
import re
import urllib.request
import time
import sys

ASSET_SOURCE_BASE = os.environ.get('ASSET_SOURCE_BASE', '').rstrip('/')
if not ASSET_SOURCE_BASE:
    sys.exit('ASSET_SOURCE_BASE is required, e.g. https://cdn.example.com/v9.3.0.24-1')
BASE_CDN = ASSET_SOURCE_BASE + '/'
LOCAL_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'v9.3.0.24-1')

# Parse font IDs from AllFonts.js
allfonts_path = os.path.join(LOCAL_ROOT, 'sdkjs', 'common', 'AllFonts.js')
with open(allfonts_path, 'r', encoding='utf-8') as f:
    content = f.read()
m = re.search(r'window\["__fonts_files"\]\s*=\s*\[(.*?)\];', content, re.DOTALL)
font_ids = re.findall(r'"([^"]+)"', m.group(1)) if m else []
print(f"[INFO] Found {len(font_ids)} font IDs in AllFonts.js")

# Build download list: (relative_path, cdn_url)
downloads = []

# 1) All 218 fonts
for fid in font_ids:
    downloads.append(('fonts/' + fid, BASE_CDN + 'fonts/' + fid))

# 2) Missing UI images
missing_images = [
    'sdkjs/common/Images/icons/anchor.png',
    'sdkjs/common/Images/content_controls/img.png',
    'sdkjs/common/Images/content_controls/img_active.png',
    'sdkjs/common/Images/content_controls/toc.png',
    'sdkjs/common/Images/content_controls/toc_active.png',
    'sdkjs/common/Images/content_controls/signature.png',
    'sdkjs/common/Images/placeholders/image.png',
    'sdkjs/common/Images/placeholders/image_url.png',
    'sdkjs/common/Images/placeholders/table.png',
    'sdkjs/common/Images/placeholders/table_active.png',
    'sdkjs/common/Images/placeholders/chart.png',
    'sdkjs/common/Images/placeholders/chart_active.png',
    'sdkjs/common/Images/placeholders/audio.png',
    'sdkjs/common/Images/placeholders/video.png',
    'sdkjs/common/Images/placeholders/smartart.png',
    'sdkjs/common/Images/placeholders/smartart_active.png',
    'sdkjs/common/Images/fonts_thumbnail_ea.png.bin',
    'sdkjs/pdf/src/engine/drawingfile.js',
    'web-apps/apps/common/main/resources/img/controls/warnings_s.svg',
]
for path in missing_images:
    downloads.append((path, BASE_CDN + path))

print(f"[INFO] Total files to download: {len(downloads)}")

# Download
success = 0
failed = []
skipped = 0
total_bytes = 0

for i, (rel_path, url) in enumerate(downloads):
    local_path = os.path.join(LOCAL_ROOT, rel_path.replace('/', os.sep))

    # Skip if already exists
    if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
        skipped += 1
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
            size = len(data)
            total_bytes += size
            success += 1
            if (success % 20 == 0) or size > 1024*1024:
                print(f"  [{i+1}/{len(downloads)}] {rel_path} ({size/1024:.1f} KB)")
            break
        except Exception as e:
            if attempt == 2:
                failed.append((rel_path, str(e)))
                print(f"  [FAIL] {rel_path}: {e}")
            else:
                time.sleep(1)

print(f"\n{'='*50}")
print(f"Download Summary:")
print(f"  Success: {success}")
print(f"  Skipped (already exist): {skipped}")
print(f"  Failed: {len(failed)}")
print(f"  Total downloaded: {total_bytes/1024/1024:.2f} MB")
if failed:
    print(f"\nFailed files:")
    for path, err in failed:
        print(f"  - {path}: {err}")
print(f"{'='*50}")
