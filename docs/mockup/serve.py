# 画面イメージを表示するための小さなサーバー。
# 毎回いちばん新しい中身を返す（ブラウザに古いものを覚えさせない）。
# 使い方: python3 docs/mockup/serve.py
import functools
import http.server
import os


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCacheHandler, directory=here)
    http.server.ThreadingHTTPServer(("127.0.0.1", 8765), handler).serve_forever()
