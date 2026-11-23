import { Go, analyzeMove } from "./engine";
import type { Cell, Chain, Color, HistoryEntry } from "./engine";
import { influenceField } from "./influence";
export interface Group extends Chain {
  color: Color;
  anchor: number;
}
export function groups(game: Go): Group[] {
  const result: Group[] = [],
    seen = new Set<number>();
  game.board.forEach((color, i) => {
    if (color && !seen.has(i)) {
      const chain = game.group(i);
      chain.stones.forEach((p) => seen.add(p));
      result.push({ ...chain, color, anchor: i });
    }
  });
  return result;
}
export function coord(i: number, n: number): string {
  return `${"ABCDEFGHJKLMNOPQRST"[i % n]}${n - Math.floor(i / n)}`;
}
export function geography(i: number, n: number) {
  const x = i % n,
    y = Math.floor(i / n),
    dx = Math.min(x, n - 1 - x),
    dy = Math.min(y, n - 1 - y);
  const edges: ("left" | "right" | "top" | "bottom")[] = [];
  if (dx <= 3) edges.push(x < n / 2 ? "left" : "right");
  if (dy <= 3) edges.push(y < n / 2 ? "top" : "bottom");
  const zone =
    edges.length === 2 ? "角部" : edges.length === 1 ? "边上" : "中央";
  const line = Math.min(dx, dy) + 1;
  let note =
    edges.length === 2
      ? "两条棋盘边界可以帮助围地，但也压缩逃跑方向。"
      : edges.length === 1
        ? "借一条边围地，向中央仍需照顾出路。"
        : "四面开阔，利于联络与出头；围地需要更多封锁。";
  if (line <= 2) note += " 一、二路偏低，适合具体战斗和收官，不宜机械抢占。";
  else if (line === 3) note += " 三路通常偏向围地。";
  else if (line === 4) note += " 四路通常更重外势，但角地仍可被侵入。";
  if (n === 9) note += " 九路全盘紧凑，中央同样重要，先看局部急所。";
  return { zone, line, edges, note };
}
// Compatibility for callers needing only the net influence. Renderers should
// use influenceField to retain the distinction between open and contested areas.
export function influence(game: Go, iterations = 28): Float32Array {
  return influenceField(game, iterations).advantage;
}
export function localSituation(game: Go, i: number) {
  const geo = geography(i, game.n),
    near = groups(game).filter((g) =>
      [...g.stones].some(
        (p) =>
          Math.abs((p % game.n) - (i % game.n)) +
            Math.abs(Math.floor(p / game.n) - Math.floor(i / game.n)) <=
          3,
      ),
    );
  const urgent = near.filter((g) => g.liberties.size === 1),
    tight = near.filter((g) => g.liberties.size === 2);
  return {
    ...geo,
    urgent,
    tight,
    summary: urgent.length
      ? urgent
          .map(
            (g) =>
              `${g.color === 1 ? "黑" : "白"} ${g.stones.size} 子只剩 ${coord([...g.liberties][0], game.n)} 一气`,
          )
          .join("；") + "。被打吃不等于必死，要看逃出、接回或反提。"
      : tight.length
        ? `附近 ${tight.length} 块棋只有两气，先留意断点和紧气。`
        : "附近暂无一气或两气棋块。虚连仍可能被切断，势场不表示已围成实地。",
  };
}
export interface PositionData {
  n: number;
  board: Cell[];
  turn: Color;
  history: HistoryEntry[];
  captures: number[];
  passes: number;
  ended: boolean;
}
export function restorePosition(data: PositionData): Go {
  const g = new Go(data.n);
  Object.assign(g, data);
  g.board = data.board.slice();
  g.history = data.history.slice();
  g.captures = data.captures.slice();
  return g;
}
function ownEye(game: Go, i: number): boolean {
  if (!game.neighbors(i).every((p) => game.board[p] === game.turn))
    return false;
  const x = i % game.n,
    y = Math.floor(i / game.n),
    diagonals: number[] = [];
  for (const dx of [-1, 1])
    for (const dy of [-1, 1])
      if (x + dx >= 0 && x + dx < game.n && y + dy >= 0 && y + dy < game.n)
        diagonals.push((y + dy) * game.n + x + dx);
  const enemies = diagonals.filter(
    (p) => game.board[p] === 3 - game.turn,
  ).length;
  return enemies <= (diagonals.length === 4 ? 1 : 0);
}
export function openingValue(game: Go, i: number): number {
  const x = i % game.n,
    y = Math.floor(i / game.n),
    dx = Math.min(x, game.n - 1 - x),
    dy = Math.min(y, game.n - 1 - y);
  if (game.n === 9) return dx >= 2 && dy >= 2 ? 1.5 : Math.min(dx, dy) * 0.35;
  // 3-3, 3-4 and 4-4 regions; a corner bonus is suppressed by nearby stones.
  const corner = dx >= 2 && dx <= 3 && dy >= 2 && dy <= 3;
  const nearest = game.board.reduce(
    (d, c, p) =>
      c
        ? Math.min(
            d,
            Math.abs(x - (p % game.n)) + Math.abs(y - Math.floor(p / game.n)),
          )
        : d,
    99,
  );
  if (corner && nearest >= 4) return 5;
  const line = Math.min(dx, dy);
  return line === 2 || line === 3 ? 1.8 : line < 2 ? -1 : 0.2;
}
export function chooseMove(game: Go): number | null {
  if (game.ended) return null;
  const occupied = game.board.filter(Boolean).length;
  const candidates: { i: number; score: number }[] = [];
  for (let i = 0; i < game.board.length; i++) {
    if (game.board[i]) continue;
    const result = analyzeMove(game, i);
    if (result.error) continue;
    let score =
      result.captured.length * 22 +
      result.rescued.length * 28 +
      Math.min(result.liberties, 5) * 0.4 +
      Math.max(0, result.connected - 1) * 1.4;
    if (result.liberties === 1) score -= 20 + result.ownSize * 8;
    score += Math.min(result.atari.length, 6) * 2;
    if (ownEye(game, i) && !result.captured.length) score -= 60;
    const proximity = game
      .neighbors(i)
      .filter((p) => game.board[p] === game.turn).length;
    if (proximity >= 3 && !result.captured.length && !result.rescued.length)
      score -= 4;
    if (occupied < game.n * 2)
      score += openingValue(game, i) * (1 - occupied / (game.n * 2));
    const last = game.history.at(-1)?.move;
    if (last != null && occupied > 4) {
      const d =
        Math.abs((i % game.n) - (last % game.n)) +
        Math.abs(Math.floor(i / game.n) - Math.floor(last / game.n));
      score += Math.max(0, 3 - d) * 0.2;
    }
    candidates.push({ i, score });
  }
  candidates.sort((a, b) => b.score - a.score || a.i - b.i);
  // Check legal immediate opponent captures for the strongest candidates.
  for (const candidate of candidates.slice(0, 12)) {
    const copy = restorePosition(game);
    copy.play(candidate.i);
    let replyCapture = 0;
    for (const chain of groups(copy))
      if (chain.color === game.turn && chain.liberties.size === 1) {
        const reply = analyzeMove(copy, [...chain.liberties][0]);
        if (!reply.error)
          replyCapture = Math.max(replyCapture, reply.captured.length);
      }
    candidate.score -= replyCapture * 25;
  }
  const shortlist = candidates
    .slice(0, 12)
    .sort((a, b) => b.score - a.score || a.i - b.i);
  if (!shortlist.length || shortlist[0].score < 0) return null;
  // Passing is not automatically mirrored while there are useful tactical moves.
  if (game.passes && occupied > game.n * 2 && shortlist[0].score < 3)
    return null;
  return shortlist[0].i;
}
