import os
import sys
import time
import json
import urllib.request
import subprocess
import http.server
import socketserver
import threading
from browser_test import SimpleWebSocket
from urllib.parse import urlparse

# 要抓取的资源来源主机（仅开发期使用，不参与部署）。项目已完全本地化，
# 因此这里不内置任何外部域名，需要时显式指定自己的域名/CDN：
#   ASSET_SOURCE_BASE=https://cdn.example.com/v9.3.0.24-1 python scripts/capture_cdn_assets.py
ASSET_SOURCE_BASE = os.environ.get('ASSET_SOURCE_BASE', '').rstrip('/')
if not ASSET_SOURCE_BASE:
    sys.exit('ASSET_SOURCE_BASE is required, e.g. https://cdn.example.com/v9.3.0.24-1')
SOURCE_HOST = urlparse(ASSET_SOURCE_BASE).netloc

CHROME_PATH = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
PORT = 8088
CDP_PORT = 9222
temp_dir = os.path.join(os.environ.get('TEMP', r'C:\Windows\Temp'), 'chrome_capture_requests')

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()
    def log_message(self, *args):
        pass

class _ThreadingServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    # 编辑器并行加载上百个资源，单线程服务器会导致随机超时，必须多线程。
    allow_reuse_address = True
    daemon_threads = True


server = _ThreadingServer(('127.0.0.1', PORT), Handler)
t = threading.Thread(target=server.serve_forever, daemon=True)
t.start()

cmd = [
    CHROME_PATH,
    f'--remote-debugging-port={CDP_PORT}',
    f'--user-data-dir={temp_dir}',
    '--headless=new',
    f'http://127.0.0.1:{PORT}/index.html'
]
proc = subprocess.Popen(cmd)
time.sleep(2)

all_cdn_urls = set()

def capture_for(doc_type):
    print(f"[*] Capturing for {doc_type}...")
    req = urllib.request.urlopen(f'http://127.0.0.1:{CDP_PORT}/json/list')
    tabs = json.loads(req.read().decode())
    target_tab = [t for t in tabs if t.get('type') == 'page'][0]
    ws = SimpleWebSocket(target_tab['webSocketDebuggerUrl'])
    ws.send({'id': 1, 'method': 'Network.enable'})
    ws.send({'id': 2, 'method': 'Runtime.enable'})
    
    # navigate to home
    ws.send({'id': 3, 'method': 'Page.navigate', 'params': {'url': f'http://127.0.0.1:{PORT}/index.html'}})
    time.sleep(2)
    
    # click card
    ws.send({
        'id': 10,
        'method': 'Runtime.evaluate',
        'params': {'expression': f'document.querySelector(\'[data-type="{doc_type}"]\').click()'}
    })
    
    start_time = time.time()
    while time.time() - start_time < 8:
        m = ws.recv(timeout=0.3)
        if not m:
            continue
        if m.get('method') == 'Network.requestWillBeSent':
            url = m.get('params', {}).get('request', {}).get('url', '')
            if SOURCE_HOST in url:
                all_cdn_urls.add(url)
    ws.close()

try:
    for t in ['docx', 'xlsx', 'pptx', 'pdf']:
        capture_for(t)
    
    print("\n" + "="*50)
    print(f"Total unique CDN URLs captured: {len(all_cdn_urls)}")
    for u in sorted(all_cdn_urls):
        print(u)
    
    with open('scripts/captured_cdn_urls.json', 'w', encoding='utf-8') as f:
        json.dump(sorted(list(all_cdn_urls)), f, indent=2)
finally:
    proc.terminate()
    proc.wait()
