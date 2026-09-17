import os
import sys
import time
import json
import base64
import socket
import subprocess
import threading
import http.server
import socketserver
import urllib.request

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 8089
CDP_PORT = 9224
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USER_DATA_DIR = os.path.join(os.environ.get('TEMP', r'C:\Windows\Temp'), 'chrome_test_profile_zero_ext')

class SimpleWebSocket:
    def __init__(self, ws_url):
        parts = ws_url.replace('ws://', '').split('/', 1)
        host_port = parts[0].split(':')
        self.host = host_port[0]
        self.port = int(host_port[1])
        self.path = '/' + (parts[1] if len(parts) > 1 else '')
        self.sock = socket.create_connection((self.host, self.port), timeout=15)
        self._handshake()

    def _handshake(self):
        key = base64.b64encode(os.urandom(16)).decode('utf-8')
        req = (
            f"GET {self.path} HTTP/1.1\r\n"
            f"Host: {self.host}:{self.port}\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode('utf-8'))
        resp = b""
        while b"\r\n\r\n" not in resp:
            data = self.sock.recv(1024)
            if not data:
                break
            resp += data
        if b" 101 " not in resp:
            raise RuntimeError(f"WebSocket handshake failed: {resp.decode('utf-8', errors='ignore')}")

    def send(self, msg_obj):
        payload = json.dumps(msg_obj).encode('utf-8')
        length = len(payload)
        header = bytearray([0x81])
        mask_key = os.urandom(4)
        if length <= 125:
            header.append(0x80 | length)
        elif length <= 65535:
            header.append(0x80 | 126)
            header.extend(length.to_bytes(2, 'big'))
        else:
            header.append(0x80 | 127)
            header.extend(length.to_bytes(8, 'big'))
        header.extend(mask_key)
        masked = bytearray(payload)
        for i in range(len(masked)):
            masked[i] ^= mask_key[i % 4]
        self.sock.sendall(header + masked)

    def recv(self, timeout=1.0):
        self.sock.settimeout(timeout)
        try:
            b1_b2 = self._recv_exact(2)
            if not b1_b2:
                return None
            b1, b2 = b1_b2[0], b1_b2[1]
            opcode = b1 & 0x0F
            is_masked = bool(b2 & 0x80)
            length = b2 & 0x7F
            if length == 126:
                length = int.from_bytes(self._recv_exact(2), 'big')
            elif length == 127:
                length = int.from_bytes(self._recv_exact(8), 'big')
            mask_key = self._recv_exact(4) if is_masked else None
            payload = self._recv_exact(length)
            if is_masked:
                payload = bytearray(payload)
                for i in range(len(payload)):
                    payload[i] ^= mask_key[i % 4]
            if opcode == 0x01:
                return json.loads(payload.decode('utf-8'))
            elif opcode == 0x08:
                return {'type': 'close'}
            return {'raw': payload}
        except socket.timeout:
            return None

    def _recv_exact(self, n):
        buf = bytearray()
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                break
            buf.extend(chunk)
        return bytes(buf)

    def close(self):
        try:
            self.sock.close()
        except:
            pass

class ReusableTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    # 编辑器会并行加载上百个资源，单线程服务器会把请求串行化，
    # 造成随机超时（表现为 “Failed to fetch” 或文档迟迟不渲染），因此必须多线程。
    allow_reuse_address = True
    daemon_threads = True

def start_http_server():
    os.chdir(ROOT_DIR)
    class CORSHandler(http.server.SimpleHTTPRequestHandler):
        def end_headers(self):
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', '*')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            super().end_headers()
        def log_message(self, format, *args):
            pass
    server = ReusableTCPServer(('127.0.0.1', PORT), CORSHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server

def test_type(doc_type):
    print(f"\n==================== Testing {doc_type.upper()} ====================")
    cmd = [
        CHROME_PATH,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={USER_DATA_DIR}_{doc_type}",
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        f"http://127.0.0.1:{PORT}/index.html"
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    try:
        ws_url = None
        for _ in range(20):
            try:
                req = urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/list", timeout=1)
                tabs = json.loads(req.read().decode('utf-8'))
                for tab in tabs:
                    if tab.get('type') == 'page' and 'devtoolsFrontendUrl' in tab:
                        ws_url = tab.get('webSocketDebuggerUrl')
                        break
                if ws_url:
                    break
            except Exception:
                time.sleep(0.5)

        if not ws_url:
            print(f"[!] Could not connect to Chrome CDP for {doc_type}")
            return False, [], []

        ws = SimpleWebSocket(ws_url)
        msg_id = 1
        def send_cmd(method, params=None):
            nonlocal msg_id
            m_id = msg_id
            msg_id += 1
            ws.send({'id': m_id, 'method': method, 'params': params or {}})
            return m_id

        send_cmd("Runtime.enable")
        send_cmd("Page.enable")
        send_cmd("Log.enable")
        send_cmd("Network.enable")
        # 模拟非 100% 的显示器缩放：编辑器会按 devicePixelRatio 去取
        # "<name>@1.25x.png" 这类高 DPI 变体，只测 DPR=1 会漏掉整类 404。
        send_cmd("Emulation.setDeviceMetricsOverride", {
            "width": 1600,
            "height": 1000,
            "deviceScaleFactor": float(os.environ.get('DPR', '1.25')),
            "mobile": False,
        })

        external_requests = []
        failed_requests = []
        rendered = False
        start_time = time.time()
        clicked = False

        while time.time() - start_time < 25:
            msg = ws.recv(timeout=0.4)
            if not msg:
                if time.time() - start_time > 4 and not clicked:
                    clicked = True
                    print(f"[*] Clicking [{doc_type}] card...")
                    send_cmd("Runtime.evaluate", {
                        "expression": f"document.querySelector('[data-type=\"{doc_type}\"]').click();"
                    })
                continue

            method = msg.get('method')
            if method == 'Network.requestWillBeSent':
                req = msg.get('params', {}).get('request', {})
                url = req.get('url', '')
                if not url.startswith(f"http://127.0.0.1:{PORT}") and not url.startswith('data:') and not url.startswith('blob:'):
                    print(f"  [EXTERNAL REQUEST DETECTED!] {url}")
                    external_requests.append(url)
            elif method == 'Network.responseReceived':
                resp = msg.get('params', {}).get('response', {})
                status = resp.get('status')
                url = resp.get('url', '')
                if status >= 400:
                    print(f"  [HTTP {status}] {url}")
                    failed_requests.append((status, url))
            elif method == 'Runtime.consoleAPICalled':
                params = msg.get('params', {})
                args = [str(a.get('value', a.get('description', ''))) for a in params.get('args', [])]
                text = ' '.join(args)
                if '文档渲染完毕' in text:
                    rendered = True
                    print(f"  [+] SUCCESS: {text}")
                elif 'error' == params.get('type'):
                    print(f"  [CONSOLE.ERROR] {text}")

            if rendered and time.time() - start_time > 8:
                break

        ws.close()
        return rendered, external_requests, failed_requests
    finally:
        proc.terminate()
        proc.wait()

def main():
    print(f"[*] Starting local HTTP server at http://127.0.0.1:{PORT} ...")
    server = start_http_server()
    time.sleep(1)

    all_ok = True
    summary = {}
    for t in ['docx', 'xlsx', 'pptx', 'pdf']:
        rendered, ext_reqs, failed_reqs = test_type(t)
        ok = rendered and len(ext_reqs) == 0 and len(failed_reqs) == 0
        summary[t] = {
            'rendered': rendered,
            'external_requests': len(ext_reqs),
            'failed_requests': len(failed_reqs)
        }
        if not ok:
            all_ok = False

    print("\n" + "="*60)
    print("SUMMARY TEST RESULTS:")
    for t, res in summary.items():
        print(f" - {t.upper()}: Rendered={res['rendered']}, ExternalReqs={res['external_requests']}, FailedReqs={res['failed_requests']}")
    print("="*60)
    if all_ok:
        print("[SUCCESS] 100% LOCALIZED! ZERO external requests and all documents rendered successfully!")
    else:
        print("[FAILURE] Some tests failed or made external requests.")

if __name__ == '__main__':
    main()
