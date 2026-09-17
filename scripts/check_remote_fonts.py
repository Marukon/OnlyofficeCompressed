import os
import sys
import urllib.request
import time

sample_fonts = ['000', '022', '068', '184', '217']

# 资源来源地址（仅开发期使用，不参与部署）。项目已完全本地化，
# 因此这里不内置任何外部域名，需要时显式指定自己的域名/CDN：
#   ASSET_SOURCE_BASE=https://cdn.example.com/v9.3.0.24-1 python scripts/check_remote_fonts.py
ASSET_SOURCE_BASE = os.environ.get('ASSET_SOURCE_BASE', '').rstrip('/')
if not ASSET_SOURCE_BASE:
    sys.exit('ASSET_SOURCE_BASE is required, e.g. https://cdn.example.com/v9.3.0.24-1')
base_url = ASSET_SOURCE_BASE + '/fonts/'

for fid in sample_fonts:
    url = base_url + fid
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = resp.read()
            print(f"Font {fid}: {len(data)} bytes ({len(data)/1024:.1f} KB)")
    except Exception as e:
        print(f"Font {fid} error: {e}")
