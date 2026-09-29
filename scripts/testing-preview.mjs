import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testingBuild = fileURLToPath(new URL('../dist-testing/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

export function createTestingPreviewServer(buildDir = testingBuild) {
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // Browser testing cannot contact cloud sync, Notion, production, or workers.
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; worker-src 'none'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const expectedHost = `127.0.0.1:${serverPort(res)}`;
    if (req.headers.host !== expectedHost || (req.headers.origin && req.headers.origin !== `http://${expectedHost}`)) {
      res.writeHead(403).end('Local testing only'); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    try {
      const pathname = decodeURIComponent(new URL(req.url, `http://${expectedHost}`).pathname);
      const file = await realpath(path.resolve(buildDir, '.' + (pathname === '/' ? '/index.html' : pathname)));
      const root = await realpath(buildDir);
      const relative = path.relative(root, file);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !relative || path.basename(file) === 'sw.js') {
        res.writeHead(403).end(); return;
      }
      const data = await readFile(file);
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      res.writeHead(200).end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(404).end('Not found'); }
  });
}

function serverPort(res) { return res.socket.localPort; }

export async function startTestingPreview() {
  const server = createTestingPreviewServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(4174, '127.0.0.1', resolve);
  });
  console.log('Milestone Testing preview: http://127.0.0.1:4174/');
  console.log('Testing build only. Browser test data stays on this separate local origin. Production is unchanged.');
  return server;
}
