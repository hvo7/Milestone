import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createTestingPreviewServer } from './testing-preview.mjs';

test('preview serves only the local testing build with isolated network policy', async () => {
  const server = createTestingPreviewServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const request = (url, options = {}) => new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: url, ...options }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
  try {
    const page = await request('/');
    assert.equal(page.status, 200);
    assert.match(page.body, /id="root"/);
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.match(page.headers['content-security-policy'], /connect-src 'none'/);
    assert.match(page.headers['content-security-policy'], /worker-src 'none'/);
    const asset = page.body.match(/src="([^"]+\.js)"/)[1].replace(/^\.\//, '/');
    assert.equal((await request(asset)).status, 200);
    for (const url of ['/package.json', '/.testing/seed.json', '/../package.json', '/%2e%2e%5cpackage.json', '/sw.js']) {
      assert.notEqual((await request(url)).status, 200, url);
    }
    assert.equal((await request('/', { headers: { Host: `attacker.invalid:${port}` } })).status, 403);
    assert.equal((await request('/', { headers: { Origin: 'https://example.com' } })).status, 403);
    assert.equal((await request('/', { method: 'POST' })).status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
