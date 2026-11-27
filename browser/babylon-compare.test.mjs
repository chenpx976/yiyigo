import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

test('Babylon comparison: rendered parity, replay restoration, idle and serial measurement', { timeout: 240_000 }, async t => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true }, logLevel: 'error' });
  await server.listen(); t.after(() => server.close());
  const hardware = process.env.YIYIGO_BENCH_GPU === 'metal';
  const optimized = process.env.YIYIGO_COMPARE_SURFACE === '1';
  const artifact = name => `artifacts/${optimized ? 'surface-optimized' : 'engines-optimized'}-${name}${hardware ? '-metal' : ''}`;
  const browser = await chromium.launch({ headless: true, args: hardware ? ['--use-angle=metal'] : ['--enable-unsafe-swiftshader'] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1150 }, deviceScaleFactor: optimized ? 2 : 1, reducedMotion: 'no-preference' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/dev/babylon-compare.html${optimized ? '' : '?mode=engines'}`);
  await page.waitForFunction(() => document.body.dataset.ready === 'true' || document.querySelector('#error').textContent, null, { timeout: 60_000 });
  assert.equal(await page.locator('#error').textContent(), '');
  assert.deepEqual(errors, []);
  if (optimized) {
    const sizing = await page.locator('#three').evaluate(canvas => ({ pixels: canvas.width, css: canvas.getBoundingClientRect().width }));
    assert.ok(sizing.pixels >= sizing.css * 1.49, 'automatic clarity uses available Retina pixel density');
    assert.ok(sizing.pixels ** 2 <= 1_500_000, 'automatic clarity preserves the pixel budget');
  }
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: artifact('full') + '.png', fullPage: true });
  const comparePixels = () => page.evaluate(() => {
    const images = ['three', 'babylon'].map(id => {
      const source = document.getElementById(id), canvas = document.createElement('canvas');
      canvas.width = source.width; canvas.height = source.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(source, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    });
    let changed = 0, total = 0, dark = 0, light = 0;
    for (let i = 0; i < images[0].length; i += 4) {
      const difference = Math.max(...[0,1,2].map(c => Math.abs(images[0][i+c] - images[1][i+c])));
      if (difference > 5) changed++; total += difference;
      if (images[1][i] < 80 && images[1][i+1] < 80 && images[1][i+2] < 80) dark++;
      if (images[1][i] > 210 && images[1][i+1] > 210 && images[1][i+2] > 210) light++;
    }
    return { changedFraction: changed / (images[0].length / 4), meanMaxChannelDifference: total / (images[0].length / 4), dark, light };
  });
  const full = await comparePixels();
  console.log('Full-board comparison:', full);
  assert.ok(full.dark > 2000 && full.light > 300, 'both black and white stones actually render');
  assert.ok(full.changedFraction < .03, 'equivalent surfaces stay visually aligned');
  const board = await page.locator('body').getAttribute('data-board');
  await page.locator('#rapid').click();
  await page.waitForFunction(() => !document.querySelector('#rapid').disabled && document.body.dataset.animating === 'false', null, { timeout: 30_000 });
  assert.equal(await page.locator('body').getAttribute('data-board'), board);
  const rapid = await comparePixels();
  assert.ok(rapid.changedFraction < .03);
  const draws = await page.locator('body').getAttribute('data-babylon-draws');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('body').getAttribute('data-babylon-draws'), draws, 'idle stops submitting frames');
  await page.locator('#zoom').selectOption('detail');
  await page.screenshot({ path: artifact('detail') + '.png', fullPage: true });
  const detail = await comparePixels();
  assert.ok(detail.changedFraction < .03);
  await page.locator('#zoom').selectOption('full');
  await page.locator('#pixels').selectOption(hardware ? '640' : '384');
  await page.locator('#benchmark').click();
  await page.waitForFunction(() => document.body.dataset.benchmark === 'complete', null, { timeout: 120_000 });
  const downloaded = page.waitForEvent('download'); await page.locator('#download').click();
  await (await downloaded).saveAs(artifact('benchmark') + '.json');
  const report = JSON.parse(await readFile(artifact('benchmark') + '.json', 'utf8'));
  if (hardware) for (const context of Object.values(report.contexts)) assert.match(context.renderer, /Apple|Metal/, 'hardware run must not silently use SwiftShader');
  assert.equal(report.comparison, optimized ? 'surface-before-after' : 'engines');
  assert.match(report.rightVersion, optimized ? /^187$/ : /^9\./);
  assert.equal(report.rows.length, 2);
  for (const row of report.rows) {
    assert.equal(row.samples.submit.length, 40);
    assert.equal(row.samples.complete.length, 40);
    assert.ok(row.samples.complete.every((value, i) => Number.isFinite(value) && value >= row.samples.submit[i]));
  }
  await page.screenshot({ path: artifact('measured') + '.png', fullPage: true });
  if (hardware) {
    await page.locator('#workload').selectOption('breathing');
    await page.locator('#benchmark').click();
    await page.waitForFunction(() => document.body.dataset.benchmark === 'complete', null, { timeout: 120_000 });
    const breathingDownload = page.waitForEvent('download'); await page.locator('#download').click();
    await (await breathingDownload).saveAs(artifact('benchmark-breathing') + '.json');
  }
  await page.locator('#move').fill('0'); await page.locator('#move').dispatchEvent('input');
  assert.equal(await page.locator('body').getAttribute('data-stones'), '0');
  await page.locator('#next').click();
  await page.waitForFunction(() => document.body.dataset.animating === 'false');
  assert.equal(await page.locator('body').getAttribute('data-stones'), '1');
  await page.locator('#game').selectOption('gu');
  await page.waitForFunction(() => document.body.dataset.move === '90' && !document.querySelector('#game').disabled);
  assert.ok(await page.locator('#download').isDisabled(), 'changing the position invalidates the old measurement');
  await page.locator('#workload').selectOption('breathing');
  await page.locator('#benchmark').click();
  await page.locator('#cancel').click();
  await page.waitForFunction(() => !document.querySelector('#benchmark').disabled);
  assert.match(await page.locator('#status').textContent(), /取消/);
  assert.ok(await page.locator('#download').isDisabled(), 'cancelled samples cannot be exported');
  assert.equal(await page.locator('#error').textContent(), '');
  assert.deepEqual(errors, []);
  await writeFile(artifact('validation') + '.json', JSON.stringify({ full, rapid, detail, errors }, null, 2));
});
