#!/usr/bin/env python3
"""Benny Thomas Band Study Guide — LAN server with shared-vote API.
Serves the static site AND a tiny ballot store at /api/ballots so every
phone on the venue wifi shares the same votes. Zero external services."""
import http.server
import json
import os
import socketserver
import sys
import threading

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, 'data', 'ballots.json')
LOCK = threading.Lock()


def load_ballots():
    try:
        with open(DATA, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {"v": 1, "ballots": {}}


def save_ballots(b):
    os.makedirs(os.path.dirname(DATA), exist_ok=True)
    with open(DATA, 'w', encoding='utf-8') as f:
        json.dump(b, f, indent=1)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split('?')[0] == '/api/ballots':
            self._json(200, load_ballots())
            return
        super().do_GET()

    def do_POST(self):
        if self.path.split('?')[0] == '/api/ballots':
            try:
                n = int(self.headers.get('Content-Length', 0))
                data = json.loads(self.rfile.read(n) or b'{}')
                with LOCK:
                    cur = load_ballots()
                    if isinstance(data, dict) and data.get('ballots'):
                        ballots = cur.setdefault('ballots', {})
                        for name, b in data['ballots'].items():
                            if name not in ballots or (b.get('updatedAt') or 0) >= (ballots[name].get('updatedAt') or 0):
                                ballots[name] = b
                    save_ballots(cur)
                self._json(200, cur)
            except Exception as e:
                self._json(400, {'error': str(e)})
            return
        self._json(405, {'error': 'not found'})

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    with socketserver.ThreadingTCPServer(('', port), Handler) as httpd:
        print('Benny Thomas Band Study Guide — http://localhost:%d' % port)
        print('Phones on the same wifi: http://<this-machines-LAN-IP>:%d' % port)
        httpd.serve_forever()
