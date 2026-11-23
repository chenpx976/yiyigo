import "./style.css";
import { Go, analyzeMove, parseSGF, gameFromKifu } from "./engine";
import type { Kifu } from "./engine";
import { BoardView } from "./board";
import { coord, groups, localSituation } from "./position";
const get = <T extends HTMLElement = HTMLElement>(id: string) => {
  const e = document.getElementById(id);
  if (!e) throw Error(`Missing #${id}`);
  return e as T;
};
const size = get<HTMLSelectElement>("size"),
  opponent = get<HTMLSelectElement>("opponent"),
  games = get<HTMLSelectElement>("games"),
  timeline = get<HTMLInputElement>("timeline");
const records = [
  {
    file: "cho",
    title: "赵治勋 × 曹薰铉 · 2015",
    event: "韩国现代围棋 70 周年纪念赛",
    path: "2015/08/Cho-Chikun-vs-Cho-Hunhyun-20150726-Commentary-An-Younggil-8p.sgf",
  },
  {
    file: "gu",
    title: "古力 × 周睿羊 · 2015",
    event: "第 10 届春兰杯决赛",
    path: "2015/06/Gu-Li-vs-Zhou-Ruiyang-20150603-Commentary-An-Younggil.sgf",
  },
  {
    file: "lee",
    title: "李世石 × 陈耀烨 · 2013",
    event: "三星杯",
    path: "2015/08/Lee-Sedol-vs-Chen-Yaoye-20131008-Commentary-An-Younggil.sgf",
  },
];
records.forEach((r, i) => games.add(new Option(r.title, String(i))));
let game = new Go(9),
  savedGame = game,
  review = false,
  kifu: Kifu | null = null,
  cursor = 0,
  selected = -1;
let auto: ReturnType<typeof setInterval> | null = null,
  worker: Worker | null = null,
  requestId = 0,
  loadId = 0,
  sound = false,
  audio: AudioContext | null = null;
const msg = (s: string) => (get("status").textContent = s);
const board = new BoardView(get("board"), activate, inspect);
function cancelBot() {
  requestId++;
  worker?.terminate();
  worker = null;
}
function stop() {
  if (auto) clearInterval(auto);
  auto = null;
  get("auto").textContent = "自动回放";
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
  } catch {
    msg("浏览器存储不可用；可导出 SGF 保存本局。");
  }
}
function ping() {
  if (!sound) return;
  audio ??= new AudioContext();
  void audio.resume();
  const o = audio.createOscillator(),
    gain = audio.createGain();
  o.frequency.setValueAtTime(430, audio.currentTime);
  o.frequency.exponentialRampToValueAtTime(180, audio.currentTime + 0.08);
  gain.gain.setValueAtTime(0.13, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.13);
  o.connect(gain).connect(audio.destination);
  o.start();
  o.stop(audio.currentTime + 0.14);
}
function local(i: number) {
  const context = localSituation(game, i);
  get("local-title").textContent = `${context.zone} · 第 ${context.line} 路`;
  get("local-text").textContent = context.note;
  get("local-fight").textContent = context.summary;
  get("position-label").textContent = `${coord(i, game.n)} · ${context.zone}`;
}
function inspect(i: number) {
  local(i);
  if (game.board[i]) {
    const chain = game.group(i);
    get("group-title").textContent =
      `${game.board[i] === 1 ? "黑" : "白"}棋 · ${chain.stones.size} 子 · ${chain.liberties.size} 口气`;
    get("group-text").textContent =
      chain.liberties.size === 1
        ? `最后一气在 ${coord([...chain.liberties][0], game.n)}。可考虑逃出、连接或反提，不能只凭一气判定死棋。`
        : "亮起的空点是整块棋共用的气；斜连与跳连不合并气数。";
    return;
  }
  if (review || game.ended) {
    get("group-title").textContent = "看局部，也看全盘";
    get("group-text").textContent =
      "角边帮助围地，具体战斗仍要看气、断点和出路。";
    return;
  }
  const a = analyzeMove(game, i);
  get("group-title").textContent = a.error
    ? "此处暂时不能落子"
    : a.captured.length
      ? `这一手可提 ${a.captured.length} 子`
      : a.rescued.length
        ? `这 ${a.rescued.length} 子暂时脱离打吃`
        : a.atari.length
          ? `这一手打吃 ${a.atari.length} 子`
          : `落子后 ${a.liberties} 口气`;
  get("group-text").textContent =
    a.error ||
    (a.liberties === 1
      ? "落下后自己只剩一气，请先看对方是否能提。"
      : a.rescued.length
        ? "落子后气数增加，但不代表后续已经安全做活。"
        : a.connected > 1
          ? `这一手实际接起 ${a.connected} 块棋，气会合并去重。`
          : a.captured.length
            ? "叉号标记的是合法落子后会被提走的棋子。"
            : "这是单手变化的准确气数；后续征子、死活尚未搜索。");
}
function update(animate = false) {
  board.render(game, selected, animate, !review);
  get("turn").textContent = game.ended
    ? "双方停着 · 本局结束"
    : game.turn === 1
      ? "黑棋落子"
      : "白棋落子";
  get("turn-stone").className = `stone ${game.turn === 1 ? "black" : "white"}`;
  get("move").textContent =
    `第 ${game.history.length + 1} 手 · ${review ? "真实棋谱回放" : opponent.value === "bot" ? "局部策略陪练" : "同屏双人对弈"}`;
  get("cap-b").textContent = String(game.captures[1]);
  get("cap-w").textContent = String(game.captures[2]);
  get("board-label").textContent =
    `${game.n} 路 · ${review ? "名局回响" : "一方天地"}`;
  get<HTMLButtonElement>("undo").disabled = !game.history.length;
  get<HTMLButtonElement>("pass").disabled =
    game.ended || (!review && opponent.value === "bot" && game.turn === 2);
  if (review && kifu) {
    timeline.value = String(cursor);
    get("review-count").textContent = `第 ${cursor} / ${kifu.moves.length} 手`;
  }
  const focus = selected >= 0 ? selected : game.history.at(-1)?.move;
  if (focus != null) inspect(focus);
  else {
    get("group-title").textContent = "一子落下，彼此呼应";
    get("group-text").textContent = "悬停空点预览变化，轻点棋子查看共用的气。";
    get("local-title").textContent = "金角银边，先顾急所";
    get("local-text").textContent =
      game.n === 9
        ? "九路棋盘紧凑，中央也很重要。围地效率与局部战斗要一起看。"
        : "角借两条边、边借一条边，围地通常更省子。三、四路常兼顾地与势。";
    get("local-fight").textContent =
      "边界不是气；被围住的棋子仍要有真实空点才能存活。";
    get("position-label").textContent = "触碰棋盘，感受局部";
  }
}
function activate(i: number) {
  if (game.board[i]) {
    selected = i;
    update();
    return;
  }
  if (review) {
    msg("正在回看名局；切回自由对弈可继续你的棋局。");
    return;
  }
  if (worker || (opponent.value === "bot" && game.turn === 2)) return;
  move(i);
}
function move(i: number | null) {
  const before = game.captures[game.turn],
    color = game.turn,
    error = game.play(i);
  if (error) {
    msg(error);
    return;
  }
  selected = -1;
  ping();
  update(true);
  persist();
  const captured = game.captures[color] - before;
  if (game.ended) {
    const score = game.score();
    msg(
      `双方停着。面积粗计：黑 ${score[1]}，白 ${score[2]}（贴 7.5）。未判死活；有争议可悔棋继续下。`,
    );
    return;
  }
  const endangered = groups(game).filter(
    (g) => g.color === game.turn && g.liberties.size === 1,
  );
  msg(
    captured
      ? `提走 ${captured} 子，空点重新成为气。`
      : endangered.length
        ? `打吃：对方有 ${endangered.length} 块棋仅剩一气，呼吸变紧。`
        : i === null
          ? "已停一手。双方连续停着后结束。"
          : "棋子已落下；虚连可被切断，淡雾表示影响。",
  );
  scheduleBot();
}
function scheduleBot() {
  cancelBot();
  if (review || game.ended || opponent.value !== "bot" || game.turn !== 2)
    return;
  const id = requestId;
  worker = new Worker(new URL("./bot.worker.ts", import.meta.url), {
    type: "module",
  });
  msg("小弈正在考虑救急、提子与局部连接……");
  worker.onmessage = (
    event: MessageEvent<{ id: number; move: number | null; error?: string }>,
  ) => {
    if (event.data.id !== requestId || review) return;
    cancelBot();
    if (event.data.error) {
      opponent.value = "human";
      update();
      msg("陪练计算失败，已切换双人，可继续落子。");
      return;
    }
    move(event.data.move);
  };
  worker.onerror = () => {
    cancelBot();
    opponent.value = "human";
    update();
    msg("浏览器未能启动陪练，已切换双人。");
  };
  worker.postMessage({
    id,
    position: {
      n: game.n,
      board: game.board,
      turn: game.turn,
      history: game.history,
      captures: game.captures,
      passes: game.passes,
      ended: game.ended,
    },
  });
}
function newGame() {
  if (game.history.length && !confirm("开始新局会清空当前对局，是否继续？")) {
    size.value = String(game.n);
    return;
  }
  cancelBot();
  game = new Go(Number(size.value));
  savedGame = game;
  selected = -1;
  update();
  persist();
  msg("新局已开始。角边有围地效率，战斗中先照顾急所。");
}
get("new").onclick = newGame;
size.onchange = newGame;
opponent.onchange = () => {
  update();
  scheduleBot();
};
get("undo").onclick = () => {
  cancelBot();
  game.undo();
  if (opponent.value === "bot" && game.turn === 2) game.undo();
  selected = -1;
  update(true);
  persist();
  msg("已悔棋。");
};
get("pass").onclick = () => {
  if (opponent.value === "bot" && game.turn === 2) return;
  move(null);
};
function validate(k: Kifu) {
  const g = gameFromKifu(k);
  for (const m of k.moves) {
    const error = g.play(m.i, m.color);
    if (error) throw Error(`棋谱第 ${g.history.length + 1} 手：${error}`);
  }
}
function seek(v: number, animate = false) {
  if (!kifu) return;
  cursor = Math.max(0, Math.min(v, kifu.moves.length));
  game = gameFromKifu(kifu);
  for (const m of kifu.moves.slice(0, cursor)) game.play(m.i, m.color);
  selected = -1;
  update(animate);
}
async function loadRecord() {
  const id = ++loadId;
  stop();
  try {
    const record = records[Number(games.value)],
      response = await fetch(
        `${import.meta.env.BASE_URL}games/${record.file}.sgf`,
      );
    if (!response.ok) throw Error("棋谱读取失败");
    const parsed = parseSGF(await response.text());
    validate(parsed);
    if (id !== loadId || !review) return;
    kifu = parsed;
    get("game-meta").textContent =
      `${record.event} · ${parsed.root.DT?.[0] || ""} · ${parsed.root.RE?.[0] || ""}`;
    get<HTMLAnchorElement>("source").href =
      `https://github.com/gogameguru/commented-go-games/blob/master/${record.path}`;
    get("source").hidden = false;
    timeline.max = String(kifu.moves.length);
    seek(0);
    msg("同样的气、势与连接，在真实对局里自然呈现。");
  } catch (error) {
    msg(String(error));
  }
}
get("review-tab").onclick = () => {
  if (review) return;
  cancelBot();
  savedGame = game;
  review = true;
  get("play-panel").hidden = true;
  get("review-panel").hidden = false;
  get("play-tab").classList.remove("active");
  get("review-tab").classList.add("active");
  void loadRecord();
};
get("play-tab").onclick = () => {
  if (!review) return;
  loadId++;
  stop();
  review = false;
  game = savedGame;
  selected = -1;
  get("play-panel").hidden = false;
  get("review-panel").hidden = true;
  get("play-tab").classList.add("active");
  get("review-tab").classList.remove("active");
  update();
  msg("回到你的对局。");
  scheduleBot();
};
games.onchange = () => void loadRecord();
get("prev").onclick = () => {
  stop();
  seek(cursor - 1, true);
};
get("next").onclick = () => {
  stop();
  seek(cursor + 1, true);
};
timeline.oninput = () => {
  stop();
  seek(Number(timeline.value));
};
get("auto").onclick = () => {
  if (auto) {
    stop();
    return;
  }
  if (!kifu) return;
  if (cursor >= kifu.moves.length) seek(0);
  get("auto").textContent = "暂停回放";
  auto = setInterval(() => {
    seek(cursor + 1, true);
    if (kifu && cursor >= kifu.moves.length) stop();
  }, 900);
};
get<HTMLInputElement>("import").onchange = async (event) => {
  const input = event.currentTarget as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  stop();
  loadId++;
  try {
    if (file.size > 2e6) throw Error("棋谱请小于 2 MB");
    const parsed = parseSGF(await file.text());
    validate(parsed);
    if (!review) return;
    kifu = parsed;
    timeline.max = String(parsed.moves.length);
    get("game-meta").textContent = file.name;
    get("source").hidden = true;
    seek(0);
    msg("已导入棋谱主线。");
  } catch (error) {
    msg(String(error));
  }
  input.value = "";
};
get("sound").onclick = () => {
  sound = !sound;
  get("sound").textContent = `声音 · ${sound ? "开" : "关"}`;
  get("sound").setAttribute("aria-pressed", String(sound));
  ping();
};
get("export").onclick = () => {
  const komi = review ? kifu?.root.KM?.[0] || "0" : "7.5";
  const sgf =
    `(;GM[1]FF[4]CA[UTF-8]SZ[${game.n}]KM[${komi}]` +
    game.history
      .map(
        (h) =>
          `;${h.color === 1 ? "B" : "W"}[${h.move === null ? "" : String.fromCharCode(97 + (h.move % game.n), 97 + Math.floor(h.move / game.n))}]`,
      )
      .join("") +
    ")";
  const url = URL.createObjectURL(
      new Blob([sgf], { type: "application/x-go-sgf" }),
    ),
    link = document.createElement("a");
  link.href = url;
  link.download = "yiyigo.sgf";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
try {
  const data = JSON.parse(localStorage.getItem("yiyigo-v1") || "null") as {
    n: number;
    moves: { i: number | null; color: 1 | 2 }[];
  } | null;
  if (data && [9, 13, 19].includes(data.n) && Array.isArray(data.moves)) {
    const restored = new Go(data.n);
    for (const m of data.moves) {
      if (restored.play(m.i, m.color)) throw Error("无效存档");
    }
    game = restored;
    savedGame = game;
    size.value = String(game.n);
  }
} catch {
  msg("旧存档无法恢复，已准备空盘。");
}
try {
  await board.init();
  update();
} catch (error) {
  get("board").textContent =
    "棋盘需要浏览器开启 WebGL / 硬件加速。请换用支持 WebGL 的浏览器后重试。";
  msg(`棋盘初始化失败：${String(error)}`);
}
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    cancelBot();
    stop();
    board.destroy();
    void audio?.close();
  });
