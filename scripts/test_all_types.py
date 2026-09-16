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
CDP_PORT = 9223
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USER_DATA_DIR = os.path.join(os.environ.get('TEMP', r'C:\Windows\Temp'), 'chrome_test_profile_all_types')

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

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

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
    print(f"\n{'='*20} Testing Document Type: {doc_type} {'='*20}")
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
            return False

        ws = SimpleWebSocket(ws_url)
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

        logs = []
        errors = []
        rendered = False
        start_time = time.time()
        clicked = False

        while time.time() - start_time < 20:
            msg = ws.recv(timeout=0.5)
            if not msg:
                if time.time() - start_time > 5 and not clicked:
                    clicked = True
                    print(f"[*] Triggering click on card: [data-type='{doc_type}'] ...")
                    send_cmd("Runtime.evaluate", {
                        "expression": f"document.querySelector('[data-type=\"{doc_type}\"]').click();"
                    })
                continue

            method = msg.get('method')
            if method == 'Runtime.consoleAPICalled':
                params = msg.get('params', {})
                c_type = params.get('type')
                args = [str(a.get('value', a.get('description', ''))) for a in params.get('args', [])]
                text = " ".join(args)
                logs.append(f"[{c_type}] {text}")
                if "文档渲染完毕" in text:
                    rendered = True
                    print(f"  [+] SUCCESS: {text}")
                if c_type == 'error':
                    errors.append(text)
                    print(f"  [ERROR] {text}")
            elif method == 'Runtime.exceptionThrown':
                details = msg.get('params', {}).get('exceptionDetails', {})
                text = details.get('text', '') + ' ' + str(details.get('exception', {}).get('description', ''))
                errors.append(text)
                print(f"  [EXCEPTION] {text}")

            if rendered and time.time() - start_time > 10:
                break

        # Save screenshot
        s_id = send_cmd("Page.captureScreenshot", {"format": "png"})
        scr_data = None
        for _ in range(10):
            m = ws.recv(timeout=1.0)
            if m and m.get('id') == s_id:
                scr_data = m.get('result', {}).get('data')
                break

        if scr_data:
            scr_path = os.path.join(ROOT_DIR, "scripts", f"screenshot_{doc_type}.png")
            with open(scr_path, "wb") as f:
                f.write(base64.b64decode(scr_data))
            print(f"[+] Screenshot saved to: {scr_path}")

        ws.close()
        print(f"[*] {doc_type} result: rendered={rendered}, errors={len(errors)}")
        return rendered and len(errors) == 0
    finally:
        proc.terminate()
        proc.wait()

def main():
    print(f"[*] Starting server on port {PORT}...")
    server = start_http_server()
    time.sleep(1)

    results = {}
    for t in ['docx', 'xlsx', 'pptx', 'pdf']:
        results[t] = test_type(t)
        time.sleep(1)

    print("\n" + "="*50)
    print("ALL TESTS COMPLETED:")
    for t, ok in results.items():
        print(f" - {t.upper()}: {'PASSED' if ok else 'FAILED'}")
    print("="*50)

if __name__ == '__main__':
    main()
