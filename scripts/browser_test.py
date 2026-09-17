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
PORT = 8088
CDP_PORT = 9222
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USER_DATA_DIR = os.path.join(os.environ.get('TEMP', r'C:\Windows\Temp'), 'chrome_test_profile_debug')

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
            if opcode == 0x01: # text
                return json.loads(payload.decode('utf-8'))
            elif opcode == 0x08: # close
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
    # 编辑器并行加载上百个资源，单线程服务器会导致随机超时，必须多线程。
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
            pass # suppress request noise
    
    server = ReusableTCPServer(('127.0.0.1', PORT), CORSHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server

def main():
    print(f"[*] Starting local HTTP server at http://127.0.0.1:{PORT} ...")
    server = start_http_server()
    time.sleep(1)

    # Launch Chrome with CDP
    cmd = [
        CHROME_PATH,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={USER_DATA_DIR}",
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        f"http://127.0.0.1:{PORT}/index.html"
    ]
    print("[*] Launching Chrome in headless debugging mode...")
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    try:
        # Wait for CDP endpoint
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
            print("[!] Could not connect to Chrome CDP")
            return

        print(f"[*] Connected to Chrome page via CDP: {ws_url}")
        ws = SimpleWebSocket(ws_url)

        # Enable domains
        msg_id = 1
        def send_cmd(method, params=None):
            nonlocal msg_id
            m_id = msg_id
            msg_id += 1
            ws.send({"id": m_id, "method": method, "params": params or {}})
            return m_id

        send_cmd("Runtime.enable")
        send_cmd("Page.enable")
        send_cmd("Log.enable")
        send_cmd("Network.enable")

        logs = []
        errors = []
        not_found_urls = []

        print("[*] Listening for browser console messages...")
        start_time = time.time()
        word_clicked = False

        while time.time() - start_time < 25:
            msg = ws.recv(timeout=0.5)
            if not msg:
                # If 6 seconds passed and hasn't clicked Word yet, click Word
                if time.time() - start_time > 6 and not word_clicked:
                    word_clicked = True
                    print("\n[>>>] Triggering click on 'Word 文档' card...")
                    send_cmd("Runtime.evaluate", {
                        "expression": "document.querySelector('[data-type=\"docx\"]').click(); 'clicked docx';"
                    })
                continue

            method = msg.get('method')
            if method == 'Runtime.consoleAPICalled':
                params = msg.get('params', {})
                c_type = params.get('type')
                args = [str(a.get('value', a.get('description', ''))) for a in params.get('args', [])]
                text = " ".join(args)
                logs.append(f"[{c_type}] {text}")
                print(f"  [CONSOLE.{c_type.upper()}] {text}")
                if c_type == 'error':
                    errors.append(text)
            elif method == 'Runtime.exceptionThrown':
                details = msg.get('params', {}).get('exceptionDetails', {})
                text = details.get('text', '') + ' ' + str(details.get('exception', {}).get('description', ''))
                errors.append(text)
                print(f"  [EXCEPTION] {text}")
            elif method == 'Network.responseReceived':
                resp = msg.get('params', {}).get('response', {})
                status = resp.get('status')
                url = resp.get('url')
                if status == 404:
                    not_found_urls.append(url)
                    print(f"  [404 NOT FOUND] {url}")
            elif method == 'Log.entryAdded':
                entry = msg.get('params', {}).get('entry', {})
                level = entry.get('level')
                text = entry.get('text', '')
                if level in ('error', 'warning'):
                    print(f"  [BROWSER LOG.{level.upper()}] {text}")
                    if level == 'error':
                        errors.append(text)

        # Take screenshot
        print("\n[*] Taking screenshot...")
        s_id = send_cmd("Page.captureScreenshot", {"format": "png"})
        scr_data = None
        for _ in range(10):
            m = ws.recv(timeout=1.0)
            if m and m.get('id') == s_id:
                scr_data = m.get('result', {}).get('data')
                break

        if scr_data:
            scr_path = os.path.join(ROOT_DIR, "scripts", "test_screenshot.png")
            with open(scr_path, "wb") as f:
                f.write(base64.b64decode(scr_data))
            print(f"[+] Screenshot saved to: {scr_path}")

        print("\n" + "="*50)
        print(f"Test complete. Total console logs: {len(logs)}, Total errors: {len(errors)}")
        if errors:
            print("Errors encountered:")
            for e in errors:
                print(" -", e)
        else:
            print("No runtime errors encountered! ALL CHECKS PASSED.")
        print("="*50)

        ws.close()
    finally:
        proc.terminate()
        proc.wait()

if __name__ == '__main__':
    main()
