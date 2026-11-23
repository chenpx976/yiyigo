import { Go, parseSGF, links } from "./engine.js";
const $ = (id) => document.getElementById(id),
  svg = $("board"),
  NS = "http://www.w3.org/2000/svg";
let game = new Go(9),
  savedGame = game,
  review = false,
  kifu = null,
  cursor = 0,
  selected = -1,
  timer = null,
  botTimer = null,
  sound = false,
  audio = null;
const records = [
  {
    file: "cho",
    title: "赵治勋 × 曹薰铉 · 2015",
    path: "2015/08/Cho-Chikun-vs-Cho-Hunhyun-20150726-Commentary-An-Younggil-8p.sgf",
  },
  {
    file: "gu",
    title: "古力 × 周睿羊 · 2015",
    path: "2015/06/Gu-Li-vs-Zhou-Ruiyang-20150603-Commentary-An-Younggil.sgf",
  },
  {
    file: "lee",
    title: "李世石 × 陈耀烨 · 2013",
    path: "2015/08/Lee-Sedol-vs-Chen-Yaoye-20131008-Commentary-An-Younggil.sgf",
  },
];
records.forEach((r, i) => $("games").add(new Option(r.title, i)));
function el(tag, attrs = {}, parent = svg) {
  let e = document.createElementNS(NS, tag);
  for (let [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.append(e);
  return e;
}
function msg(s) {
  $("status").textContent = s;
}
function ping() {
  if (!sound) return;
  audio ??= new AudioContext();
  audio.resume();
  let o = audio.createOscillator(),
    a = audio.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(480, audio.currentTime);
  o.frequency.exponentialRampToValueAtTime(190, audio.currentTime + 0.07);
  a.gain.setValueAtTime(0.16, audio.currentTime);
  a.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.12);
  o.connect(a).connect(audio.destination);
  o.start();
  o.stop(audio.currentTime + 0.13);
}
function draw() {
  if (selected < 0) {
    $("group-title").textContent = "每一口气，都有迹可循。";
    $("group-text").textContent =
      "棋块上的数字是共用的气数。轻点棋子，高亮它的每一口气；珊瑚色表示只剩一口气。";
  }
  let n = game.n,
    s = 660 / (n - 1),
    xy = (i) => [50 + (i % n) * s, 50 + Math.floor(i / n) * s],
    r = s * 0.425;
  svg.replaceChildren();
  const defs = el("defs");
  for (let [id, a, b] of [
    ["black", "#536267", "#111c21"],
    ["white", "#ffffff", "#dbe3d7"],
  ]) {
    let grad = el(
      "radialGradient",
      { id, cx: "32%", cy: "25%", r: "75%" },
      defs,
    );
    el("stop", { offset: "0%", "stop-color": a }, grad);
    el("stop", { offset: "100%", "stop-color": b }, grad);
  }
  for (let [id, c] of [
    ["mist-b", "#285f57"],
    ["mist-w", "#fffce6"],
  ]) {
    let grad = el("radialGradient", { id }, defs);
    el("stop", { offset: "0%", "stop-color": c, "stop-opacity": ".24" }, grad);
    el("stop", { offset: "100%", "stop-color": c, "stop-opacity": "0" }, grad);
  }
  // Continuous influence field: sum signed distance kernels; cancel contested influence.
  const fog = el("g", { "pointer-events": "none" });
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let force = 0;
      for (let i = 0; i < game.board.length; i++)
        if (game.board[i]) {
          let d = (x - (i % n)) ** 2 + (y - Math.floor(i / n)) ** 2;
          force += (game.board[i] === 1 ? 1 : -1) * Math.exp(-d / 5);
        }
      if (Math.abs(force) > 0.15)
        el(
          "circle",
          {
            cx: 50 + x * s,
            cy: 50 + y * s,
            r: s * 1.4,
            fill: `url(#mist-${force > 0 ? "b" : "w"})`,
            opacity: Math.min(0.75, Math.abs(force) * 0.25),
          },
          fog,
        );
    }
  for (let i = 0; i < n; i++) {
    let p = 50 + i * s;
    el("path", {
      d: `M50 ${p}H710 M${p} 50V710`,
      stroke: "#5a5947",
      "stroke-width": i === 0 || i === n - 1 ? 1.4 : 0.8,
      opacity: 0.65,
    });
    let t = el("text", {
      x: p,
      y: 28,
      "text-anchor": "middle",
      fill: "#676650",
      "font-size": 12,
    });
    t.textContent = "ABCDEFGHJKLMNOPQRST"[i];
    t = el("text", {
      x: 25,
      y: p + 4,
      "text-anchor": "middle",
      fill: "#676650",
      "font-size": 12,
    });
    t.textContent = n - i;
  }
  let stars = n === 9 ? [2, 4, 6] : n === 13 ? [3, 6, 9] : [3, 9, 15];
  for (let x of stars)
    for (let y of stars)
      if (n === 19 || x === y || x + y === n - 1)
        el("circle", { cx: 50 + x * s, cy: 50 + y * s, r: 3, fill: "#61614d" });
  let groups = [],
    seen = new Set();
  for (let i = 0; i < game.board.length; i++)
    if (game.board[i] && !seen.has(i)) {
      let g = game.group(i);
      g.stones.forEach((p) => seen.add(p));
      groups.push({ ...g, color: game.board[i] });
    }
  let focus =
    selected >= 0 && game.board[selected] ? game.group(selected) : null;
  // Each empty point has one breathing mark; shared liberties are not counted twice.
  let libColors = new Map();
  for (let g of groups)
    for (let p of g.liberties) {
      let entry = libColors.get(p) || new Set();
      entry.add(g.color);
      libColors.set(p, entry);
    }
  for (let [p, colors] of libColors) {
    let [x, y] = xy(p),
      active = focus?.liberties.has(p);
    el("circle", {
      cx: x,
      cy: y,
      r: active ? s * 0.12 : s * 0.055,
      fill: colors.size > 1 ? "#dbb36d" : colors.has(1) ? "#2d7964" : "#fffbe0",
      stroke: active ? "#3b8265" : "none",
      "stroke-width": 1,
      opacity: active ? 1 : 0.8,
      class: "liberty",
      "pointer-events": "none",
    });
  }
  for (let l of links(game)) {
    let [x, y] = xy(l.i),
      [a, b] = xy(l.j),
      solid = l.kind === "solid";
    el("path", {
      d: `M${x} ${y} Q${(x + a) / 2 + (solid ? 0 : s * 0.08)} ${(y + b) / 2 - (solid ? 0 : s * 0.08)} ${a} ${b}`,
      stroke: l.color === 1 ? "#233238" : "#e9eee2",
      "stroke-width": solid ? s * 0.48 : s * 0.055,
      "stroke-linecap": "round",
      "stroke-dasharray": solid
        ? "none"
        : l.kind === "large"
          ? `${s * 0.08} ${s * 0.16}`
          : `${s * 0.13} ${s * 0.11}`,
      fill: "none",
      opacity: solid ? 1 : l.kind === "large" ? 0.32 : 0.56,
      class: solid ? "" : "ghostlink",
      "pointer-events": "none",
    });
  }
  for (let g of groups) {
    let danger = g.liberties.size === 1;
    for (let i of g.stones) {
      let [x, y] = xy(i);
      if (danger || focus?.stones.has(i))
        el("circle", {
          cx: x,
          cy: y,
          r: r + 3,
          fill: "none",
          stroke: danger ? "#cf715c" : "#5eaa83",
          "stroke-width": danger ? 3 : 2,
          class: danger ? "atari" : "",
          "pointer-events": "none",
        });
      el("circle", {
        cx: x,
        cy: y + 2,
        r,
        fill: "#000",
        opacity: 0.14,
        "pointer-events": "none",
      });
      el("circle", {
        cx: x,
        cy: y,
        r,
        fill: `url(#${game.board[i] === 1 ? "black" : "white"})`,
        stroke: game.board[i] === 1 ? "#16262b" : "#f7f8ee",
        "stroke-width": 0.8,
        "pointer-events": "none",
      });
    }
    let anchor = [...g.stones][0],
      [x, y] = xy(anchor);
    el("circle", {
      cx: x,
      cy: y,
      r: s * 0.12,
      fill: g.color === 1 ? "#17292d" : "#e3e9db",
      "pointer-events": "none",
    });
    let t = el("text", {
      x,
      y: y + s * 0.048,
      "text-anchor": "middle",
      "font-size": Math.max(9, s * 0.16),
      fill: danger ? "#ed957c" : g.color === 1 ? "#a5c9b5" : "#5b7768",
      "pointer-events": "none",
    });
    t.textContent = g.liberties.size;
  }
  const last = game.history.at(-1)?.move;
  if (last != null && game.board[last]) {
    let [x, y] = xy(last);
    el("circle", {
      cx: x + s * 0.22,
      cy: y + s * 0.22,
      r: s * 0.045,
      fill: "#d5aa61",
      "pointer-events": "none",
    });
  }
  for (let i = 0; i < n * n; i++) {
    let [x, y] = xy(i);
    let hit = el("rect", {
      x: x - s / 2,
      y: y - s / 2,
      width: s,
      height: s,
      fill: "transparent",
      role: "button",
      tabindex: i === 0 ? 0 : -1,
      "aria-label": `${"ABCDEFGHJKLMNOPQRST"[i % n]}${n - Math.floor(i / n)} ${game.board[i] === 1 ? "黑棋" : game.board[i] === 2 ? "白棋" : "空点"}`,
    });
    hit.addEventListener("click", () => activate(i));
    hit.addEventListener("pointerenter", () => inspect(i));
    hit.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate(i);
      }
      let d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -n, ArrowDown: n }[
        e.key
      ];
      if (d) {
        e.preventDefault();
        svg
          .querySelectorAll("[role=button]")
          [Math.max(0, Math.min(n * n - 1, i + d))].focus();
      }
    });
  }
  $("turn").textContent = game.ended
    ? "双方停着 · 本局结束"
    : game.turn === 1
      ? "黑棋落子"
      : "白棋落子";
  $("turn-stone").className = "stone " + (game.turn === 1 ? "black" : "white");
  $("move").textContent =
    `第 ${game.history.length + 1} 手 · ${review ? "正在回看名局" : $("opponent").value === "bot" ? "基础策略陪练" : "同屏双人对弈"}`;
  $("cap-b").textContent = game.captures[1];
  $("cap-w").textContent = game.captures[2];
  $("board-label").textContent =
    `${n} 路 · ${review ? "名局回响" : "一方天地"}`;
  $("undo").disabled = !game.history.length;
  $("pass").disabled = game.ended;
  if (review) {
    $("timeline").value = cursor;
    $("review-count").textContent =
      `第 ${cursor} / ${kifu?.moves.length || 0} 手`;
  }
}
function inspect(i) {
  if (!game.board[i]) return;
  let g = game.group(i);
  $("group-title").textContent =
    `${game.board[i] === 1 ? "黑" : "白"}棋 · ${g.stones.size} 子相连 · ${g.liberties.size} 口气`;
  $("group-text").textContent =
    g.liberties.size === 1
      ? "只剩最后一口气。这一口气被占据，整块棋就会被提走。"
      : "相邻棋子共用这些空点。连成一块后，气按空点去重计算。";
}
function activate(i) {
  if (game.board[i]) {
    selected = i;
    inspect(i);
    draw();
    return;
  }
  if (review) {
    msg("正在回看棋谱；切回自由对弈即可落子。");
    return;
  }
  if ($("opponent").value === "bot" && game.turn === 2) return;
  move(i);
}
function move(i) {
  let err = game.play(i);
  if (err) {
    msg(err);
    return;
  }
  selected = -1;
  ping();
  draw();
  persist();
  if (game.ended) {
    let score = game.score(7.5);
    msg(
      `双方停着。面积粗计：黑 ${score[1]}，白 ${score[2]}（贴 7.5）。未自动判死活；有争议请悔棋并继续下完。`,
    );
  } else {
    msg(
      i === null
        ? "已停一手；双方连续停着后结束。"
        : "棋子已落下，看看彼此的气与联系如何变化。",
    );
    scheduleBot();
  }
}
function scheduleBot() {
  clearTimeout(botTimer);
  if (
    !review &&
    $("opponent").value === "bot" &&
    game.turn === 2 &&
    !game.ended
  )
    botTimer = setTimeout(bot, 350);
}
function bot() {
  if (review || game.turn !== 2 || game.ended) return;
  if (game.passes) {
    move(null);
    return;
  }
  let best = -Infinity,
    choice = null;
  for (let i = 0; i < game.board.length; i++) {
    if (game.board[i]) continue;
    let own = game.neighbors(i).filter((p) => game.board[p] === 2).length,
      enemy = game.neighbors(i).filter((p) => game.board[p] === 1).length,
      before = game.captures[2];
    if (game.play(i)) continue;
    let g = game.group(i),
      v =
        (game.captures[2] - before) * 15 +
        Math.min(g.liberties.size, 6) * 0.55 +
        enemy * 0.5 +
        Math.random() * 0.8;
    let x = i % game.n,
      y = Math.floor(i / game.n),
      edge = Math.min(x, y, game.n - 1 - x, game.n - 1 - y);
    v += Math.min(edge, 2) * 0.25;
    if (g.liberties.size === 1) v -= 12;
    if (own === game.neighbors(i).length) v -= 10;
    game.undo();
    if (v > best) {
      best = v;
      choice = i;
    }
  }
  move(choice);
}
function persist() {
  try {
    localStorage.setItem(
      "yiyigo-v1",
      JSON.stringify({
        n: game.n,
        moves: game.history.map((h) => ({ i: h.move, color: h.color })),
      }),
    );
  } catch {}
}
function newGame() {
  if (game.history.length && !confirm("开始新局会清空当前对局，是否继续？")) {
    $("size").value = game.n;
    return;
  }
  clearTimeout(botTimer);
  game = new Go(+$("size").value);
  savedGame = game;
  selected = -1;
  draw();
  persist();
  msg("新的一局，从一口气开始。");
}
$("new").onclick = newGame;
$("size").onchange = newGame;
$("opponent").onchange = scheduleBot;
$("undo").onclick = () => {
  clearTimeout(botTimer);
  game.undo();
  if ($("opponent").value === "bot" && game.turn === 2) game.undo();
  selected = -1;
  draw();
  persist();
  msg("已回到上一手。");
};
$("pass").onclick = () => {
  if ($("opponent").value === "bot" && game.turn === 2) return;
  move(null);
};
function stop() {
  clearInterval(timer);
  timer = null;
  $("auto").textContent = "自动回放";
}
function seek(v) {
  if (!kifu) return;
  cursor = Math.max(0, Math.min(v, kifu.moves.length));
  game = new Go(kifu.n);
  for (let m of kifu.moves.slice(0, cursor)) {
    let err = game.play(m.i, m.color);
    if (err) {
      msg("棋谱无法继续：" + err);
      stop();
      break;
    }
  }
  selected = -1;
  draw();
}
let loadId = 0;
async function loadRecord() {
  let id = ++loadId;
  stop();
  try {
    let r = records[+$("games").value],
      res = await fetch(`games/${r.file}.sgf`);
    if (!res.ok) throw Error("棋谱读取失败");
    let parsed = parseSGF(await res.text());
    if (id !== loadId || !review) return;
    kifu = parsed;
    $("game-meta").textContent =
      `${r.title} · ${kifu.root.EV?.[0] || ""} · ${kifu.root.RE?.[0] || ""}`;
    $("source").href =
      "https://github.com/gogameguru/commented-go-games/blob/master/" + r.path;
    $("source").hidden = false;
    $("timeline").max = kifu.moves.length;
    seek(0);
    msg("拖动进度条，看整盘棋的气与势如何流动。");
  } catch (e) {
    msg(e.message);
  }
}
$("review-tab").onclick = () => {
  if (review) return;
  clearTimeout(botTimer);
  savedGame = game;
  review = true;
  $("play-panel").hidden = true;
  $("review-panel").hidden = false;
  $("play-tab").classList.remove("active");
  $("review-tab").classList.add("active");
  loadRecord();
};
$("play-tab").onclick = () => {
  if (!review) return;
  loadId++;
  stop();
  review = false;
  game = savedGame;
  $("play-panel").hidden = false;
  $("review-panel").hidden = true;
  $("play-tab").classList.add("active");
  $("review-tab").classList.remove("active");
  selected = -1;
  draw();
  scheduleBot();
  msg("已回到你的对局。");
};
$("games").onchange = loadRecord;
$("prev").onclick = () => {
  stop();
  seek(cursor - 1);
};
$("next").onclick = () => {
  stop();
  seek(cursor + 1);
};
$("timeline").oninput = (e) => {
  stop();
  seek(+e.target.value);
};
$("auto").onclick = () => {
  if (timer) {
    stop();
    return;
  }
  if (!kifu) return;
  if (cursor === kifu.moves.length) seek(0);
  $("auto").textContent = "暂停回放";
  timer = setInterval(() => {
    seek(cursor + 1);
    if (cursor >= kifu.moves.length) stop();
  }, 700);
};
$("import").onchange = async (e) => {
  let f = e.target.files[0];
  if (!f) return;
  stop();
  loadId++;
  try {
    if (f.size > 2e6) throw Error("棋谱请小于 2 MB");
    let parsed = parseSGF(await f.text());
    let check = new Go(parsed.n);
    for (let m of parsed.moves) {
      let err = check.play(m.i, m.color);
      if (err) throw Error("棋谱包含不支持或非法着手：" + err);
    }
    kifu = parsed;
    $("game-meta").textContent = f.name;
    $("source").hidden = true;
    $("timeline").max = kifu.moves.length;
    seek(0);
    msg("已导入棋谱主线。");
  } catch (err) {
    msg(err.message);
  }
  e.target.value = "";
};
$("sound").onclick = () => {
  sound = !sound;
  $("sound").textContent = "声音 · " + (sound ? "开" : "关");
  $("sound").setAttribute("aria-pressed", sound);
  ping();
};
$("export").onclick = () => {
  let str =
    `(;GM[1]FF[4]CA[UTF-8]SZ[${game.n}]KM[7.5]` +
    game.history
      .map(
        (h) =>
          `;${h.color === 1 ? "B" : "W"}[${h.move === null ? "" : String.fromCharCode(97 + (h.move % game.n), 97 + Math.floor(h.move / game.n))}]`,
      )
      .join("") +
    ")";
  let url = URL.createObjectURL(
      new Blob([str], { type: "application/x-go-sgf" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = "yiyigo.sgf";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
try {
  let data = JSON.parse(localStorage.getItem("yiyigo-v1"));
  if (data && [9, 13, 19].includes(data.n)) {
    let restored = new Go(data.n);
    for (let m of data.moves) {
      if (restored.play(m.i, m.color)) throw Error("invalid");
    }
    game = restored;
    savedGame = game;
    $("size").value = game.n;
  }
} catch {}
draw();
