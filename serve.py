import http.server
import socketserver
import os
import webbrowser

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class CORSHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

class ReusableTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    # 编辑器会并行加载上百个资源（sdkjs / 字体 / wasm），单线程服务器会把请求串行化，
    # 造成随机超时（表现为资源加载失败或文档迟迟不渲染），因此必须多线程。
    allow_reuse_address = True
    daemon_threads = True

if __name__ == '__main__':
    print(f"==================================================")
    print(f"  ONLYOFFICE 本地调试服务已启动！")
    print(f"  访问地址: http://127.0.0.1:{PORT}")
    print(f"  按 Ctrl+C 可停止服务")
    print(f"==================================================")
    
    # 自动打开浏览器
    webbrowser.open(f"http://127.0.0.1:{PORT}")
    
    with ReusableTCPServer(('127.0.0.1', PORT), CORSHTTPRequestHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n服务已停止。")
