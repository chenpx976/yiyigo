import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer, preview } from "vite";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const timeout = 20_000;
const setup = "(;GM[1]FF[4]SZ[9]KM[6.5]AB[aa][cc]AW[hh]PL[W];W[dd];B[];W[ee])";
const shortRecord = "(;GM[1]FF[4]SZ[9];B[bb];W[gg])";
let server, origin;

before(async () => {
  server = await createServer({ root, server: { host: "127.0.0.1", port: 0, strictPort: true }, logLevel: "error" });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
}, { timeout: 60_000 });
after(async () => { await server?.close(); });

async function session(t, { motion = "reduce", url = origin, init, expectedConsoleError = () => false, viewport = { width: 1280, height: 960 } } = {}) {
  // A separate browser bounds software-GPU resources to one scenario; no
  // renderer contexts or driver state survive into the next acceptance case.
  const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport, reducedMotion: motion, serviceWorkers: "block" });
  // Never borrow the user's browser profile, cookies, storage, or open tabs.
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  page.setDefaultNavigationTimeout(timeout);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && !/Failed to load resource.*(?:404|503)/.test(message.text()) && !expectedConsoleError(message)) errors.push(message.text());
    if (message.type() === "warning" && /shader.*(?:error|fail)|WebGL.*(?:INVALID_|CONTEXT_LOST)|GPU.*(?:error|fail)/i.test(message.text())) errors.push(message.text());
  });
  t.after(() => assert.deepEqual(errors, [], "uncaught JavaScript, GPU initialization, or shader errors"));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return page;
}
async function ready(page, count = 0) {
  await page.waitForFunction(n => document.querySelector("#board")?.dataset.stoneCount === String(n), count);
  assert.equal(await page.locator("#board").getAttribute("data-renderer"), "three-webgl-pbr");
  await page.locator("#board canvas").waitFor({ state: "visible" });
}
async function text(page, selector, expected) {
  await page.waitForFunction(({ selector, expected }) => document.querySelector(selector)?.textContent === expected, { selector, expected });
}
async function labels(page) { return page.locator("#board .intersection").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label"))); }
async function stone(page, index, color) {
  const label = await page.locator("#board .intersection").nth(index).getAttribute("aria-label");
  assert.ok(label.endsWith(color), `${index}: expected ${color}, got ${label}`);
}
async function upload(page, name, content = setup) {
  await page.locator("#import").setInputFiles({ name, mimeType: "application/x-go-sgf", buffer: Buffer.from(content) });
}
async function review(page) {
  await page.locator("#review-tab").click();
  await page.waitForFunction(() => Number(document.querySelector("#timeline").max) > 1);
}
async function seek(page, value) {
  const slider = page.locator("#timeline");
  await slider.press("Home");
  for (let move = 0; move < value; move++) await slider.press("ArrowRight");
}
async function exportRecord(page) {
  const pending = page.waitForEvent("download");
  await page.locator("#export").click();
  const download = await pending;
  assert.equal(await download.failure(), null);
  return readFile(await download.path(), "utf8");
}
async function screenshotPixels(page, clip) {
  const png = await page.screenshot({ clip });
  return page.evaluate(async bytes => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const data = Array.from(ctx.getImageData(0, 0, image.width, image.height).data);
    image.close();
    return data;
  }, Array.from(png));
}

test("production GPU paints a visible stone; moves, pass, undo and refresh preserve the game", { timeout: 60_000 }, async t => {
  const page = await session(t);
  await ready(page);
  const point = page.locator("#board .intersection").nth(40);
  const bounds = await point.boundingBox();
  assert.ok(bounds && bounds.width > 10);
  const clip = { x: Math.floor(bounds.x + bounds.width * .3), y: Math.floor(bounds.y + bounds.height * .3), width: Math.floor(bounds.width * .4), height: Math.floor(bounds.height * .4) };
  await page.mouse.move(0, 0);
  const empty = await screenshotPixels(page, clip);
  await point.click();
  await page.locator("#turn").click();
  await ready(page, 1);
  const occupied = await screenshotPixels(page, clip);
  let darker = 0, opaque = 0;
  for (let i = 0; i < occupied.length; i += 4) {
    if (empty[i] + empty[i + 1] + empty[i + 2] - occupied[i] - occupied[i + 1] - occupied[i + 2] > 60) darker++;
    if (occupied[i + 3] === 255) opaque++;
  }
  assert.ok(darker > occupied.length / 4 * .35, `visible black stone must darken its footprint (${darker} pixels)`);
  assert.ok(opaque > occupied.length / 4 * .95, "board screenshot must be opaque and nonblank");
  await stone(page, 40, "黑棋");
  await page.locator("#pass").click();
  await text(page, "#turn", "黑棋落子");
  await page.locator("#board .intersection").nth(41).click();
  await ready(page, 2);
  await page.locator("#undo").click();
  await ready(page, 1);
  await text(page, "#turn", "黑棋落子");
  const expected = await labels(page), exported = await exportRecord(page);
  assert.match(exported, /;B\[ee\];W\[\]/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page, 1);
  assert.deepEqual(await labels(page), expected);
  assert.equal(await exportRecord(page), exported);
  await page.locator("#undo").click();
  await text(page, "#turn", "白棋落子");
  await page.locator("#undo").click();
  await ready(page);
});

test("main-page capture, pass, undo and refresh preserve prisoners and board history", { timeout: 60_000 }, async t => {
  const page = await session(t);
  await ready(page);
  for (const index of [39, 40, 31, 0, 41, 1, 49]) await page.locator("#board .intersection").nth(index).click();
  await ready(page, 6);
  await stone(page, 40, "空点");
  await stone(page, 49, "黑棋");
  await text(page, "#cap-b", "1");
  await text(page, "#cap-w", "0");
  const captured = await labels(page), captureSGF = await exportRecord(page);
  await page.locator("#pass").click();
  await text(page, "#turn", "黑棋落子");
  assert.match(await exportRecord(page), /;B\[ef\];W\[\]/);
  await page.locator("#undo").click();
  await text(page, "#turn", "白棋落子");
  assert.deepEqual(await labels(page), captured);
  assert.equal(await exportRecord(page), captureSGF);
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page, 6);
  await text(page, "#cap-b", "1");
  await text(page, "#turn", "白棋落子");
  assert.deepEqual(await labels(page), captured);
  assert.equal(await exportRecord(page), captureSGF);
  await page.locator("#undo").click();
  await stone(page, 40, "白棋");
  await stone(page, 49, "空点");
  await text(page, "#cap-b", "0");
  await text(page, "#turn", "黑棋落子");
});

test("corrupt browser save recovers to a playable empty board", { timeout: 45_000 }, async t => {
  const page = await session(t, { init: () => localStorage.setItem("yiyigo-v1", '{"sgf":') });
  await ready(page);
  await text(page, "#status", "旧存档无法恢复，已准备空盘。");
  assert.equal((await labels(page)).filter(label => label.endsWith("空点")).length, 81);
  await page.locator("#board .intersection").nth(40).click();
  await ready(page, 1);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("yiyigo-v1")));
  assert.match(saved.sgf, /;B\[ee\]/);
});

test("failed storage writes remain visible while play, undo and SGF export still work", { timeout: 60_000 }, async t => {
  const page = await session(t, { init: () => {
    const original = Storage.prototype.setItem;
    window.__storageFailures = 0;
    Storage.prototype.setItem = function (key, value) {
      if (key === "yiyigo-v1") { window.__storageFailures++; throw new DOMException("Acceptance quota failure", "QuotaExceededError"); }
      return original.call(this, key, value);
    };
  } });
  page.on("dialog", dialog => dialog.accept());
  await ready(page);
  await page.locator("#board .intersection").nth(40).click();
  await ready(page, 1);
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("浏览器存储不可用"));
  assert.match(await exportRecord(page), /;B\[ee\]/);
  await page.locator("#pass").click();
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("浏览器存储不可用"));
  assert.match(await exportRecord(page), /;B\[ee\];W\[\]/);
  await page.locator("#undo").click();
  await text(page, "#turn", "白棋落子");
  assert.match(await page.locator("#status").textContent(), /浏览器存储不可用/);
  await page.locator("#new").click();
  await ready(page);
  assert.match(await page.locator("#status").textContent(), /浏览器存储不可用/);
  assert.ok(await page.evaluate(() => window.__storageFailures >= 4));
  assert.equal(await page.evaluate(() => localStorage.getItem("yiyigo-v1")), null);
});

test("SGF setup, player to move, moves and pass survive actual file import/export", { timeout: 60_000 }, async t => {
  const page = await session(t);
  await ready(page);
  await review(page);
  await upload(page, "setup.sgf");
  await text(page, "#game-meta", "setup.sgf");
  await ready(page, 3);
  await stone(page, 0, "黑棋"); await stone(page, 20, "黑棋"); await stone(page, 70, "白棋");
  await text(page, "#turn", "白棋落子");
  const start = await labels(page);
  await seek(page, 3);
  await ready(page, 5);
  const end = await labels(page), exported = await exportRecord(page);
  assert.match(exported, /KM\[6\.5\]/);
  assert.match(exported, /PL\[W\]/);
  assert.match(exported, /;W\[dd\];B\[\];W\[ee\]/);
  await upload(page, "roundtrip.sgf", exported);
  await text(page, "#game-meta", "roundtrip.sgf");
  assert.deepEqual(await labels(page), start);
  await text(page, "#turn", "白棋落子");
  await seek(page, 3);
  assert.deepEqual(await labels(page), end);
  assert.equal(await exportRecord(page), exported);
});

// Delay only browser I/O boundaries. Production handlers, parser, renderer and
// state stay untouched; failures can arrive after the user's newer selection.
function fileTiming() {
  const original = File.prototype.text;
  const pending = new Map(), finished = new Set();
  window.__fileTiming = {
    pending, finished,
    release(name, fail = false) {
      const request = pending.get(name);
      if (!request) throw Error(`Missing pending file ${name}`);
      pending.delete(name);
      if (fail) request.reject(Error("delayed file read failure"));
      else request.resolve();
    },
  };
  File.prototype.text = async function () {
    try {
      if (this.name.startsWith("held-")) {
        finished.delete(this.name);
        await new Promise((resolve, reject) => pending.set(this.name, { resolve, reject }));
      }
      return await original.call(this);
    } finally { finished.add(this.name); }
  };
}
async function holdFile(page, name, content = setup) {
  await upload(page, name, content);
  await page.waitForFunction(name => window.__fileTiming.pending.has(name), name);
}
async function releaseFile(page, name, fail = false) {
  await page.evaluate(({ name, fail }) => window.__fileTiming.release(name, fail), { name, fail });
  await page.waitForFunction(name => window.__fileTiming.finished.has(name), name);
  await drain(page);
}
async function drain(page) {
  // Flush promise continuations, DOM event tasks and a painted frame, without
  // guessing a network/computation delay.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))));
}
async function holdRecord(page, file) {
  let received;
  const pending = new Promise(resolve => { received = resolve; });
  const pattern = `**/games/${file}.sgf`;
  const handler = route => received(route);
  await page.route(pattern, handler);
  return {
    pending,
    async release(body = shortRecord, status = 200) {
      const route = await pending;
      const request = route.request();
      if (!request.failure()) {
        try { await route.fulfill({ status, contentType: "application/x-go-sgf", body }); }
        catch (error) { if (!request.failure()) throw error; }
      }
      const response = await request.response();
      if (response) await response.finished();
      await page.unroute(pattern, handler);
      await drain(page);
    },
  };
}
async function recordState(page) {
  return page.evaluate(() => ({
    meta: document.querySelector("#game-meta").textContent,
    status: document.querySelector("#status").textContent,
    count: document.querySelector("#review-count").textContent,
    source: document.querySelector("#source").getAttribute("href"),
    hidden: document.querySelector("#source").hidden,
    labels: [...document.querySelectorAll("#board .intersection")].map(node => node.getAttribute("aria-label")),
  }));
}

test("latest file/record intent wins over stale successes and errors", { timeout: 120_000 }, async t => {
  const page = await session(t, { init: fileTiming });
  await ready(page); await review(page);
  for (const fail of [false, true]) {
    await holdFile(page, "held-older.sgf", shortRecord);
    await upload(page, "newer.sgf");
    await text(page, "#game-meta", "newer.sgf");
    const expected = await recordState(page);
    await releaseFile(page, "held-older.sgf", fail);
    assert.deepEqual(await recordState(page), expected, `stale file ${fail ? "failure" : "success"} overwrote newer import`);

    await holdFile(page, "held-before-record.sgf");
    await page.locator("#games").selectOption("1");
    await page.waitForFunction(() => document.querySelector("#source").hidden === false && document.querySelector("#game-meta").textContent.includes("春兰"));
    const record = await recordState(page);
    await releaseFile(page, "held-before-record.sgf", fail);
    assert.deepEqual(await recordState(page), record, "stale import overwrote newer record selection");

    const oldRecord = await holdRecord(page, "lee");
    await page.locator("#games").selectOption("2");
    await oldRecord.pending;
    await upload(page, "wins-over-record.sgf");
    await text(page, "#game-meta", "wins-over-record.sgf");
    const imported = await recordState(page);
    await oldRecord.release(shortRecord, fail ? 503 : 200);
    assert.deepEqual(await recordState(page), imported, "stale record overwrote newer file import");

    const olderSelection = await holdRecord(page, "cho");
    await page.locator("#games").selectOption("0");
    await olderSelection.pending;
    await page.locator("#games").selectOption("1");
    await page.waitForFunction(() => document.querySelector("#game-meta").textContent.includes("春兰"));
    const selected = await recordState(page);
    await olderSelection.release(shortRecord, fail ? 503 : 200);
    assert.deepEqual(await recordState(page), selected, "stale record overwrote newer record selection");
  }
  // A latest failed intent still supersedes earlier successful work.
  await holdFile(page, "held-before-error.sgf", shortRecord);
  const priorStatus = await page.locator("#status").textContent();
  await upload(page, "invalid-latest.sgf", "not an SGF");
  await page.waitForFunction(previous => document.querySelector("#status").textContent !== previous, priorStatus);
  const failedLatest = await recordState(page);
  assert.match(failedLatest.status, /Error|无效|格式|失败/);
  await releaseFile(page, "held-before-error.sgf");
  assert.deepEqual(await recordState(page), failedLatest);

  await holdFile(page, "held-before-network-error.sgf", shortRecord);
  const latestFailure = await holdRecord(page, "lee");
  await page.locator("#games").selectOption("2");
  await latestFailure.pending;
  await latestFailure.release("unavailable", 503);
  await page.waitForFunction(() => /读取失败/.test(document.querySelector("#status").textContent));
  const networkFailure = await recordState(page);
  await releaseFile(page, "held-before-network-error.sgf");
  assert.deepEqual(await recordState(page), networkFailure, "older success must not erase a latest network error");

  await holdFile(page, "held-leaving-review.sgf");
  await page.locator("#play-tab").click();
  const playState = await recordState(page);
  await releaseFile(page, "held-leaving-review.sgf", true);
  assert.deepEqual(await recordState(page), playState, "stale error leaked into play mode");

  const leavingRecord = await holdRecord(page, "lee");
  await page.locator("#review-tab").click();
  await leavingRecord.pending;
  await page.locator("#play-tab").click();
  const afterLeaving = await recordState(page);
  await leavingRecord.release("unavailable", 503);
  assert.deepEqual(await recordState(page), afterLeaving, "stale network error leaked into play mode");
});

function workerTiming() {
  const NativeWorker = window.Worker;
  const timing = window.__workerTiming = { pending: [], replies: 0, terminated: 0 };
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", event => {
        event.stopImmediatePropagation();
        timing.replies++;
        // Capture the real callback and actual computed reply; release can
        // deliver an already queued callback even after terminate().
        const handler = this.onmessage, worker = this, data = event.data;
        timing.pending.push(() => handler?.call(worker, new MessageEvent("message", { data })));
      });
    }
    terminate() { timing.terminated++; super.terminate(); }
  };
}
async function computedReply(page) {
  await page.waitForFunction(() => window.__workerTiming.pending.length > 0, null, { timeout });
}
async function releaseReply(page) {
  await page.evaluate(() => window.__workerTiming.pending.shift()());
  await drain(page);
}

test("real Worker module load failure falls back to playable and persisted human mode", { timeout: 60_000 }, async t => {
  const aborted = new Set();
  const page = await session(t, {
    expectedConsoleError: message => aborted.has(message.location().url) && /net::ERR_FAILED|Failed to load/.test(message.text()),
  });
  await ready(page);
  await page.context().route(url => url.pathname.endsWith("/bot.worker.ts"), async route => {
    aborted.add(route.request().url());
    await route.abort("failed");
  });
  await page.locator("#opponent").selectOption("bot");
  await page.locator("#board .intersection").nth(40).click();
  await page.waitForFunction(() => document.querySelector("#opponent").value === "human");
  assert.equal(aborted.size, 1, "the real worker module network request must have failed");
  await text(page, "#status", "浏览器未能启动陪练，已切换双人。");
  await ready(page, 1);
  await text(page, "#turn", "白棋落子");
  await page.locator("#board .intersection").nth(41).click();
  await ready(page, 2);
  await stone(page, 41, "白棋");
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page, 2);
  assert.equal(await page.locator("#opponent").inputValue(), "human");
  await text(page, "#turn", "黑棋落子");
});

test("real Worker moves once, and delayed computed replies cannot mutate a new game or review", { timeout: 90_000 }, async t => {
  const page = await session(t, { init: workerTiming });
  page.on("dialog", dialog => dialog.accept());
  await ready(page);
  await page.locator("#opponent").selectOption("bot");
  const worker = page.waitForEvent("worker");
  await page.locator("#board .intersection").nth(40).click();
  assert.match((await worker).url(), /bot\.worker/);
  await computedReply(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page, 1);
  assert.equal(await page.locator("#opponent").inputValue(), "bot");
  await computedReply(page);
  await releaseReply(page);
  await ready(page, 2);
  assert.equal((await labels(page)).filter(label => label.endsWith("白棋")).length, 1, "real worker must play a white stone");
  await text(page, "#turn", "黑棋落子");
  const completed = await exportRecord(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page, 2);
  assert.equal(await page.locator("#opponent").inputValue(), "bot");
  assert.equal(await exportRecord(page), completed);
  await text(page, "#turn", "黑棋落子");

  await page.locator("#new").click();
  await ready(page);
  await page.locator("#board .intersection").nth(40).click();
  await computedReply(page);
  await page.locator("#new").click();
  await ready(page);
  const fresh = await exportRecord(page);
  await releaseReply(page);
  await ready(page);
  assert.equal(await exportRecord(page), fresh, "obsolete bot reply polluted new game");
  await page.locator("#board .intersection").nth(40).click();
  await computedReply(page);
  await page.locator("#undo").click();
  await ready(page);
  await releaseReply(page);
  await ready(page);
  assert.equal(await exportRecord(page), fresh, "obsolete bot reply polluted an undone game");

  await page.locator("#board .intersection").nth(40).click();
  await computedReply(page);
  await review(page);
  const reviewing = await recordState(page);
  await releaseReply(page);
  assert.deepEqual(await recordState(page), reviewing, "obsolete bot reply polluted review");
  assert.ok(await page.evaluate(() => window.__workerTiming.terminated >= 2));
});

test("real BoardView limits breathing, caches shadows and resumes after interaction or viewport return", { timeout: 90_000 }, async t => {
  const page = await session(t, { motion: "no-preference", url: `${origin}/browser/board-fixture.html` });
  await ready(page);
  const budget = await page.evaluate(() => {
    const renderer = window.boardFixture.board.renderer;
    return { width: renderer.domElement.width, height: renderer.domElement.height, ratio: renderer.getPixelRatio() };
  });
  assert.ok(budget.width * budget.height <= 1_500_000, `framebuffer exceeds 1.5M pixels: ${JSON.stringify(budget)}`);
  assert.ok(budget.ratio <= 1.5, `renderer exceeds 1.5 DPR: ${budget.ratio}`);
  await page.evaluate(() => window.boardFixture.play(40, 1));
  await page.waitForFunction(() => window.boardFixture.board.frame === 0 && window.boardFixture.board.lastTime === 0, null, { timeout: 30_000 });
  const idle = await page.evaluate(async () => {
    const fixture = window.boardFixture, before = { draws: fixture.draws, clock: fixture.board.clock };
    // This interval measures the absence of work after observed quiescence.
    await new Promise(resolve => setTimeout(resolve, 400));
    return { before, after: { draws: fixture.draws, clock: fixture.board.clock } };
  });
  assert.deepEqual(idle.after, idle.before, "a settled isolated stone must not schedule or draw idle frames");
  const shadows = await page.evaluate(() => {
    const fixture = window.boardFixture, before = fixture.shadowDraws;
    fixture.board.draw(); fixture.board.draw(); fixture.board.draw();
    const cached = fixture.shadowDraws;
    fixture.play(41, 2);
    return { before, cached, changed: fixture.shadowDraws };
  });
  assert.ok(shadows.before > 0, "fixture must observe actual shadow draw callbacks");
  assert.equal(shadows.cached, shadows.before, "static redraws must reuse the settled shadow map");
  assert.ok(shadows.changed > shadows.cached, "changed geometry must refresh its actual shadow map");

  await page.evaluate(() => window.boardFixture.load('(;GM[1]FF[4]SZ[9]AB[dd][ee])'));
  await ready(page, 2);
  await page.waitForFunction(() => [...window.boardFixture.board.connections.values()].some(state => state.link.kind !== "solid" && state.to[0] > 0));
  const breathing = await page.evaluate(() => ({ draws: window.boardFixture.draws, clock: window.boardFixture.board.clock }));
  await page.waitForFunction(before => window.boardFixture.draws >= before.draws + 3 && window.boardFixture.board.clock > before.clock, breathing);
  await page.waitForFunction(() => window.boardFixture.board.frame === 0 && window.boardFixture.board.lastTime === 0, null, { timeout: 10_000 });
  const restedLinks = await page.evaluate(async () => {
    const fixture = window.boardFixture, before = { draws: fixture.draws, clock: fixture.board.clock };
    await new Promise(resolve => setTimeout(resolve, 400));
    return { before, after: { draws: fixture.draws, clock: fixture.board.clock } };
  });
  assert.deepEqual(restedLinks.after, restedLinks.before, "visible virtual links must stop after their decorative breathing budget expires");
  await page.evaluate(() => { window.boardFixture.originalResources = window.boardFixture.resources(); });
  for (const index of [30, 40, 31, 0, 30]) await page.locator("#board .intersection").nth(index).hover();
  await page.mouse.move(1000, 900);
  assert.equal(await page.evaluate(() => {
    const fixture = window.boardFixture, current = fixture.resources();
    return current.length === fixture.originalResources.length && current.every((resource, index) => resource === fixture.originalResources[index]);
  }), true, "pointer focus must preserve the live object, geometry, materials and GPU textures");
  const renewed = await page.evaluate(() => ({ draws: window.boardFixture.draws, clock: window.boardFixture.board.clock }));
  await page.waitForFunction(before => window.boardFixture.draws >= before.draws + 3 && window.boardFixture.board.clock > before.clock, renewed);
  await page.mouse.wheel(0, 1400);
  await page.waitForFunction(() => document.querySelector("#board").getBoundingClientRect().bottom < 0 && window.boardFixture.board.frame === 0);
  const offscreen = await page.evaluate(async () => {
    const fixture = window.boardFixture, before = { draws: fixture.draws, clock: fixture.board.clock };
    await new Promise(resolve => setTimeout(resolve, 400));
    return { before, after: { draws: fixture.draws, clock: fixture.board.clock } };
  });
  assert.deepEqual(offscreen.after, offscreen.before, "offscreen virtual links must stop drawing and advancing animation");
  await page.locator("#board").scrollIntoViewIfNeeded();
  await page.waitForFunction(before => window.boardFixture.draws >= before.draws + 3 && window.boardFixture.board.clock > before.clock, offscreen.after);
  await page.waitForFunction(() => window.boardFixture.board.frame === 0 && window.boardFixture.board.lastTime === 0, null, { timeout: 10_000 });
  const restedAfterReturn = await page.evaluate(async () => {
    const fixture = window.boardFixture, before = { draws: fixture.draws, clock: fixture.board.clock };
    await new Promise(resolve => setTimeout(resolve, 400));
    return { before, after: { draws: fixture.draws, clock: fixture.board.clock } };
  });
  assert.deepEqual(restedAfterReturn.after, restedAfterReturn.before, "viewport return must renew a bounded burst rather than permanent animation");
  t.diagnostic(JSON.stringify({ framebuffer: budget, idle, shadows, restedLinks, offscreen, restedAfterReturn }));
});

test("capture retirement removes dead renderer states at its animation deadline without interaction", { timeout: 60_000 }, async t => {
  const page = await session(t, { motion: "no-preference", url: `${origin}/browser/board-fixture.html` });
  await ready(page);
  const retiring = await page.evaluate(() => {
    const fixture = window.boardFixture;
    fixture.load('(;GM[1]FF[4]SZ[9]AB[dd][ed]AW[cd][dc][ec][fd][de]PL[W])');
    fixture.play(40, 2);
    const surfaces = [...fixture.board.surfaces.values()].filter(state => state.to === 0);
    const connections = [...fixture.board.connections.values()].filter(state => state.to[0] === 0);
    return { count: surfaces.length + connections.length, deadline: Math.max(...surfaces.map(state => state.start + .7), ...connections.map(state => state.start + .7)), captures: fixture.game.captures[2] };
  });
  assert.equal(retiring.captures, 2, "fixture must really capture both black stones");
  assert.ok(retiring.count > 0, "capture must create retiring states before checking cleanup");
  await page.waitForFunction(deadline => {
    const board = window.boardFixture.board;
    return board.clock >= deadline && [...board.surfaces.values()].every(state => state.to !== 0) && [...board.connections.values()].every(state => state.to[0] !== 0);
  }, retiring.deadline, { timeout: 30_000 });
  await stone(page, 30, "空点");
  await stone(page, 31, "空点");
});

test("rapid transition harness restores board and same-time clean GPU image", { timeout: 90_000 }, async t => {
  const page = await session(t, { motion: "no-preference", url: `${origin}/dev/transition-review.html?game=gu&mode=rapid&phase=100` });
  await page.waitForFunction(() => document.querySelector("#verification")?.dataset.boardRestored !== undefined);
  assert.equal(await page.locator("#verification").getAttribute("data-board-restored"), "true");
  assert.equal(await page.locator("#verification").getAttribute("data-residue-pixels"), "0");
  assert.ok(await page.locator("#event option").count() > 0, "must exercise an actual record event");
  if (process.env.YIYIGO_BROWSER_CAPTURE === "1") await page.screenshot({ path: join(root, "artifacts/optimized-19x19-final.png") });
});

for (const name of ["local", "front", "invasion", "gu", "cho"]) {
  test(`influence rapid ${name}: four real moves/undos restore the same-time GPU field`, { timeout: 120_000 }, async t => {
    // The real dense shader on SwiftShader needs several seconds per round.
    // Use a normal 720px viewport and bound each observable round separately;
    // no skipped cases, simulated renderer, or unbounded completion wait.
    const page = await session(t, { motion: "no-preference", viewport: { width: 1280, height: 720 }, url: `${origin}/dev/influence-review.html?case=${name}` });
    await page.waitForFunction(() => document.querySelector("#board")?.dataset.renderer);
    await page.locator("#rapid").click({ noWaitAfter: true });
    for (let round = 1; round <= 4; round++) {
      await page.waitForFunction(round => {
        const state = document.querySelector("#readout").dataset;
        return state.rapid === "failed" || Number(state.rounds) >= round;
      }, round);
    }
    await page.waitForFunction(() => ["passed", "failed"].includes(document.querySelector("#readout")?.dataset.rapid));
    const result = await page.locator("#readout").evaluate(node => ({ ...node.dataset, text: node.textContent }));
    assert.equal(result.rapid, "passed", result.text);
    assert.equal(result.rounds, "4");
    assert.equal(result.restored, "true");
    assert.equal(result.residuePixels, "0");
  });
}

test("an exhausted influence fixture fails explicitly instead of passing without moves", { timeout: 45_000 }, async t => {
  const page = await session(t, { url: `${origin}/dev/influence-review.html?case=local` });
  // An exhausted fixture must be an explicit failure, never a vacuous pass.
  await page.waitForFunction(() => document.querySelector("#board")?.dataset.renderer);
  await page.locator("#move").click();
  await page.locator("#rapid").click();
  assert.equal(await page.locator("#readout").getAttribute("data-rapid"), "failed");
  assert.equal(await page.locator("#readout").getAttribute("data-rounds"), "0");
});

// Opt in after a real `npm run build`; never silently substitute dev assets.
// Vite preview mounts the existing production build at a non-root base.
test("built subpath loads local SGFs and its real bundled Worker", { timeout: 90_000, skip: process.env.YIYIGO_BROWSER_PREVIEW !== "1" }, async t => {
  await readFile(join(root, "dist/index.html"));
  const built = await preview({ root, base: "/acceptance/", preview: { host: "127.0.0.1", port: 0, strictPort: true }, logLevel: "error" });
  t.after(() => new Promise((resolve, reject) => {
    built.httpServer.close(error => error ? reject(error) : resolve());
    built.httpServer.closeAllConnections();
  }));
  const url = `http://127.0.0.1:${built.httpServer.address().port}/acceptance/`;
  const page = await session(t, { url });
  await ready(page); await review(page);
  assert.ok(Number(await page.locator("#timeline").getAttribute("max")) > 100);
  await page.locator("#play-tab").click();
  await page.locator("#opponent").selectOption("bot");
  const worker = page.waitForEvent("worker");
  await page.locator("#board .intersection").nth(40).click();
  assert.ok((await worker).url().startsWith(`${url}assets/`));
  await ready(page, 2);
  await text(page, "#turn", "黑棋落子");
});
