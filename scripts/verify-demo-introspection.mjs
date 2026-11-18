import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

// Verify built demos with deterministic HTTP responses instead of public APIs.
const production = process.argv.includes('--production');
const root = resolve(import.meta.dirname, production ? '../dist/apps-production' : '../dist/apps');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname.replace(/^\/(app\d+)\//, '/$1/browser/');
    const file = resolve(root, `.${path.endsWith('/') ? `${path}index.html` : path}`);
    if (!file.startsWith(`${root}/`) && !file.startsWith(`${root}\\`)) throw new Error('Invalid path');
    response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    const content = await readFile(file);
    response.end(extname(file) === '.html'
      ? content.toString().replace('<base href="/">', '<base href="./">')
      : content);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const app of process.argv.includes('--app6') ? [6]
    : process.argv.includes('--app8') ? [8]
    : process.argv.includes('--app10') ? [10]
    : production ? [5, 6]
    : [1, 2, 3, 4, 5, 6, 7, 8, 10]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://jsonplaceholder.typicode.com/**', route => route.fulfill({
      contentType: 'application/json', body: JSON.stringify([{ id: 1, title: 'Inspector test post' }]),
    }));
    await page.goto(`${origin}/app${app}/`);
    if (production) {
      await page.waitForSelector('main');
      assert.equal(await page.evaluate(() => typeof window.__streamix), 'undefined');
    } else if (app === 8) {
      // The FIFO visualizer is backed by a real fromPush source and Streamix
      // atoms/derived state, so the inspector must discover both.
      await page.waitForSelector('.focus-workbench');
      await page.waitForFunction(() => window.__streamix?.inspect().length >= 5);
      const entries = await page.evaluate(() => window.__streamix.inspect().map(entry => entry.name));
      assert(entries.includes('App.occupancyAtom'), 'The FIFO visualizer must expose its occupancy source');
      assert(entries.includes('app8-fifo'), 'The FIFO visualizer must expose its fromPush source');
      // Drive the real source manually: push, then pull, and observe both the
      // buffer slot and the delivery counter.
      await page.locator('.focus-settings select').first().selectOption('manual');
      await page.getByRole('button', { name: 'Push one' }).click();
      await page.waitForFunction(() => document.querySelectorAll('.focus-slot.is-occupied').length === 1);
      await page.getByRole('button', { name: 'Pull one' }).click();
      await page.waitForFunction(() => document.querySelectorAll('.focus-slot.is-occupied').length === 0);
      await page.waitForFunction(() => document.querySelector('.focus-statusline')?.textContent.includes('Delivered 1'));
    } else {
      await page.waitForFunction(() => window.__streamix?.inspect().length > 0);
    }
    if (app === 5 && !production) {
      const scopes = await page.evaluate(() => window.__streamix.inspect({ kind: 'scope' }));
      assert.equal(scopes.length, 8, 'Each HTTP demo card must have an inspectable output scope');
      await page.getByRole('button', { name: 'Run Request' }).first().click();
      await page.waitForFunction(() => document.querySelector('.output')?.textContent.includes('Inspector test post'));
      assert(await page.evaluate(() => window.__streamix.inspect().some(entry => entry.value.includes('Inspector test post'))),
        'The inspector must expose the response output');
    }
    if (app === 10 && !production) {
      // One Sentence Each owns the commission genre in a Streamix atom and the
      // midnight countdown in an iterable; the inspector must discover the atom.
      await page.waitForSelector('text=One Sentence Each');
      // The commission desk opens on explicit request. Requesting with the
      // default "Surprise me" genre must fall back to the demo pitches
      // because the static build has no commission endpoint.
      await page.getByRole('button', { name: 'Commission Desk' }).click();
      await page.getByRole('button', { name: 'Request This Month’s Commissions' }).click();
      await page.waitForFunction(() => document.body.textContent.includes('Demo commissions'));
      await page.getByRole('button', { name: 'Close commission desk' }).click();
      const kinds = await page.evaluate(() => window.__streamix.inspect().map(entry => entry.kind));
      assert(kinds.includes('atom'), 'The fiction demo (app10) must expose its commission atom');
      const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
      await navigation.getByRole('button', { name: 'How It Works' }).click();
      await page.waitForFunction(() => document.body.textContent.includes('How One Sentence Each Works'));
      await navigation.getByRole('button', { name: 'Canon Archive' }).click();
      await page.waitForFunction(() => document.body.textContent.includes('Permanent Broadsheet Collection'));
    }
    if (app === 6) {
      if (process.argv.includes('--screenshot')) await page.screenshot({ path: resolve(root, 'app6-layout.png') });
      if (!production) {
        await page.locator('.sx-collapse').click();
        await page.waitForFunction(() => {
          const panel = document.querySelector('[data-streamix-inspector]');
          const bars = document.querySelector('.rainbow');
          return bars.getBoundingClientRect().bottom < panel.getBoundingClientRect().top;
        });
        assert.equal(await page.locator('.sx-tabs button').first().evaluate(button => getComputedStyle(button).boxShadow), 'none');
        assert.equal(await page.locator('.sx-row').first().evaluate(button => getComputedStyle(button).borderRadius), '0px');
      }
      await page.getByRole('button', { name: 'Click me!' }).click({ clickCount: 5 });
      await page.waitForFunction(() => document.querySelector('.number')?.textContent === '5');
      await page.getByPlaceholder('your name').fill('Ada');
      await page.waitForFunction(() => document.querySelector('.greeting')?.textContent.includes('Ada'));
      await page.getByRole('button', { name: 'Start over' }).click();
      await page.waitForFunction(() => document.querySelector('.number')?.textContent === '0');
      for (const size of [{ width: 1280, height: 720 }, { width: 1024, height: 600 }, { width: 390, height: 640 }]) {
        await page.setViewportSize(size);
        await page.waitForFunction(() => {
          const rect = document.querySelector('main').getBoundingClientRect();
          const bars = document.querySelector('.rainbow').getBoundingClientRect();
          const panel = document.querySelector('[data-streamix-inspector]:not([data-collapsed])');
          const bottom = panel ? panel.getBoundingClientRect().top : innerHeight;
          return rect.top >= 0 && rect.bottom <= bottom && rect.left >= 0 && rect.right <= innerWidth && bars.bottom <= bottom;
        });
        assert(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), 'The page must fit without vertical scrolling');
      }
    }
    assert.deepEqual(errors, [], `app${app} must not throw browser errors`);
    console.log(`app${app}: ${production ? 'production inspector disabled' : 'inspector discovers objects'}; interactions passed`);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
