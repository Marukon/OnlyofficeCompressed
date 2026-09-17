import os
import sys
import json
import urllib.request
import concurrent.futures
from urllib.parse import urlparse

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 仅开发期使用的批量下载脚本，不参与部署：下载地址完全来自 captured_cdn_urls.json
# 清单（可用 scripts/capture_cdn_assets.py + ASSET_SOURCE_BASE 重新生成），
# 代码自身不内置任何外部域名。

with open(os.path.join(ROOT_DIR, 'scripts', 'captured_cdn_urls.json'), 'r', encoding='utf-8') as f:
    urls = json.load(f)

# Keep only v9.3.0.24-1 urls
urls = [u for u in urls if 'v9.3.0.24-1' in u]

print(f"[*] Starting download of {len(urls)} CDN assets into local repository...")

def download_one(url):
    # 从清单里的绝对地址取出仓库内的相对路径（如 v9.3.0.24-1/sdkjs/...），
    # 不在代码里写死任何域名。
    rel_path = urlparse(url).path.lstrip('/')
    # Remove query string if any
    rel_path = rel_path.split('?')[0]
    # Normalize double slashes
    rel_path = rel_path.replace('//', '/')
    local_path = os.path.join(ROOT_DIR, rel_path)
    
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
            with open(local_path, 'wb') as out_f:
                out_f.write(data)
            size_kb = len(data) / 1024
            print(f"[+] Downloaded ({size_kb:7.1f} KB): {rel_path}", flush=True)
            return (url, len(data), True, None)
    except Exception as e:
        print(f"[-] FAILED: {rel_path} -> {e}", flush=True)
        return (url, 0, False, str(e))

results = []
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
    futures = [executor.submit(download_one, u) for u in urls]
    for future in concurrent.futures.as_completed(futures):
        results.append(future.result())

success_count = sum(1 for _, _, ok, _ in results if ok)
total_bytes = sum(s for _, s, ok, _ in results if ok)

print("\n" + "="*60)
print(f"Download complete: {success_count}/{len(urls)} succeeded.")
print(f"Total downloaded size: {total_bytes / (1024*1024):.2f} MB")
print("="*60)
