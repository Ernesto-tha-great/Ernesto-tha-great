import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { chromium, type Browser } from 'playwright';
import { measureSite } from '../src/measure.js';

// A page with one stylesheet and one script, most of which never runs.
const usedCode = 'document.title = "Fixture";\n';
const unusedCode = `function neverCalled() {\n${'  console.log("this never runs");\n'.repeat(400)}}\n`;
const script = usedCode + unusedCode;
const stylesheet = `.card { padding: 1rem; }\n`.repeat(3_000);

let server: Server;
let browser: Browser;
let base: string;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/app.js') {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=3600' }).end(script);
    } else if (req.url === '/styles.css') {
      res.writeHead(200, { 'content-type': 'text/css', 'cache-control': 'public, max-age=3600' }).end(stylesheet);
    } else if (req.url === '/blocked') {
      res.writeHead(403, { 'content-type': 'text/html' }).end('<title>Access Denied</title>');
    } else {
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-cache' })
        .end('<!doctype html><title>x</title><link rel="stylesheet" href="/styles.css"><script src="/app.js"></script>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
  server.close();
});

describe('measureSite', () => {
  it('counts what a first visit downloads, and how much less a second visit needs', async () => {
    const result = await measureSite(browser, { name: 'fixture', url: `${base}/` }, { quietMs: 300 });

    assert.equal(result.error, undefined);
    assert.equal(result.blocked, false);
    assert.equal(result.cold!.requests, 3);
    assert.ok(result.cold!.bytes > stylesheet.length + script.length, `cold was ${result.cold!.bytes} bytes`);
    assert.ok(result.cold!.byType.Script! >= script.length);
    // The cached stylesheet and script aren't downloaded again; only the HTML is.
    assert.ok(result.warm!.bytes < 2_000, `warm was ${result.warm!.bytes} bytes`);
  });

  it('measures how much of the JavaScript actually ran', async () => {
    const result = await measureSite(browser, { name: 'fixture', url: `${base}/` }, { quietMs: 300 });
    const unused = 1 - result.js!.usedBytes / result.js!.sourceBytes;
    assert.ok(unused > 0.9, `expected most of the script to be unused, got ${(unused * 100).toFixed(1)}%`);
  });

  it('flags error pages and bot walls so they can be left out', async () => {
    const result = await measureSite(browser, { name: 'blocked', url: `${base}/blocked` }, { quietMs: 300 });
    assert.equal(result.blocked, true);
  });
});
