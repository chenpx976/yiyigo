export type Color = 1 | 2;
export type Cell = 0 | Color;
export interface Chain {
  stones: Set<number>;
  liberties: Set<number>;
}
export interface HistoryEntry {
  board: Cell[];
  turn: Color;
  captures: number[];
  passes: number;
  ended: boolean;
  move: number | null;
  color: Color;
}
export interface RecordMove {
  i: number | null;
  color: Color;
}
export interface Kifu {
  n: number;
  root: Record<string, string[]>;
  moves: RecordMove[];
  setup: {i:number;color:Color}[];
  toPlay: Color;
}
export interface Link {
  i: number;
  j: number;
  kind: "solid" | "small" | "large" | "diagonal";
  color: Cell;
  threatened: boolean;
}
export interface MoveAnalysis {
  error: string | null;
  captured: number[];
  atari: number[];
  liberties: number;
  rescued: number[];
  connected: number;
  ownSize: number;
}
export class Go {
  n: number;
  board: Cell[];
  turn: Color;
  history: HistoryEntry[];
  captures: number[];
  passes: number;
  ended: boolean;
  constructor(n = 9) {
    this.n = n;
    this.board = Array(n * n).fill(0);
    this.turn = 1;
    this.history = [];
    this.captures = [0, 0, 0];
    this.passes = 0;
    this.ended = false;
  }
  neighbors(i: number) {
    let n = this.n,
      x = i % n,
      y = Math.floor(i / n);
    return [
      x > 0 ? i - 1 : -1,
      x < n - 1 ? i + 1 : -1,
      y > 0 ? i - n : -1,
      y < n - 1 ? i + n : -1,
    ].filter((v) => v >= 0);
  }
  group(i: number, b = this.board): Chain {
    let color = b[i],
      stones = new Set<number>(),
      liberties = new Set<number>(),
      todo = [i];
    if (!color) return { stones, liberties };
    while (todo.length) {
      let p = todo.pop()!;
      if (stones.has(p)) continue;
      stones.add(p);
      for (let q of this.neighbors(p)) {
        if (!b[q]) liberties.add(q);
        else if (b[q] === color && !stones.has(q)) todo.push(q);
      }
    }
    return { stones, liberties };
  }
  play(i: number | null, color: Color = this.turn): string | null {
    if (color !== 1 && color !== 2) return "棋子颜色无效";
    if (this.ended) return "对局已结束，请开始新局";
    if (
      i !== null &&
      (!Number.isInteger(i) || i < 0 || i >= this.board.length || this.board[i])
    )
      return "这里已有棋子或不在棋盘内";
    let old = this.board.slice(),
      caps = this.captures.slice(),
      taken = 0;
    if (i !== null) {
      this.board[i] = color;
      for (let q of this.neighbors(i))
        if (this.board[q] === 3 - color) {
          let g = this.group(q);
          if (!g.liberties.size) {
            taken += g.stones.size;
            for (let p of g.stones) this.board[p] = 0;
          }
        }
      if (!this.group(i).liberties.size) {
        this.board = old;
        return "禁入点：落子后没有气";
      }
      if (this.history.some((h) => h.board.join("") === this.board.join(""))) {
        this.board = old;
        return "打劫：不能立即还原先前局面";
      }
      this.captures[color] += taken;
    }
    this.history.push({
      board: old,
      turn: this.turn,
      captures: caps,
      passes: this.passes,
      ended: this.ended,
      move: i,
      color,
    });
    this.turn = (3 - color) as Color;
    this.passes = i === null ? this.passes + 1 : 0;
    this.ended = this.passes >= 2;
    return null;
  }
  undo() {
    let h = this.history.pop();
    if (h)
      Object.assign(this, {
        board: h.board,
        turn: h.turn,
        captures: h.captures,
        passes: h.passes,
        ended: h.ended,
      });
  }
  score(komi = 7.5) {
    let totals = [0, 0, komi],
      seen = new Set();
    for (let i = 0; i < this.board.length; i++) {
      if (this.board[i]) {
        totals[this.board[i]]++;
        continue;
      }
      if (seen.has(i)) continue;
      let todo = [i],
        region = [],
        owners = new Set<Cell>();
      while (todo.length) {
        let p = todo.pop()!;
        if (seen.has(p)) continue;
        seen.add(p);
        region.push(p);
        for (let q of this.neighbors(p)) {
          if (this.board[q]) owners.add(this.board[q]);
          else if (!seen.has(q)) todo.push(q);
        }
      }
      if (owners.size === 1) totals[[...owners][0]] += region.length;
    }
    return totals;
  }
}
// SGF recursive descent: use the first variation as main line; comments never become moves.
export function parseSGF(text: string): Kifu {
  let p = 0;
  function ws() {
    while (/\s/.test(text[p] || "") && p < text.length) p++;
  }
  function tree(): Record<string, string[]>[] {
    ws();
    if (text[p++] !== "(") throw Error("无效 SGF");
    let nodes: Record<string, string[]>[] = [];
    ws();
    while (text[p] === ";") {
      p++;
      let node: Record<string, string[]> = {};
      ws();
      while (/[A-Za-z]/.test(text[p] || "") && p < text.length) {
        let key = "";
        while (/[A-Za-z]/.test(text[p] || "") && p < text.length)
          key += text[p++];
        ws();
        let vals = [];
        while (text[p] === "[") {
          p++;
          let v = "";
          while (p < text.length && text[p] !== "]") {
            if (text[p] === "\\") {
              p++;
              if (text[p] === "\r" || text[p] === "\n") {
                if (text[p++] === "\r" && text[p] === "\n") p++;
                continue;
              }
            }
            v += text[p++];
          }
          if (text[p++] !== "]") throw Error("SGF 缺少括号");
          vals.push(v);
          ws();
        }
        node[key] = vals;
      }
      nodes.push(node);
      ws();
    }
    let first = true;
    while (text[p] === "(") {
      let child = tree();
      if (first) nodes.push(...child);
      first = false;
      ws();
    }
    if (text[p++] !== ")") throw Error("SGF 树不完整");
    return nodes;
  }
  let nodes = tree(),
    root = nodes[0] || {},
    n = Number(root.SZ?.[0] || 19);
  if (![9, 13, 19].includes(n)) throw Error("支持 9、13、19 路棋盘");
  let moves: RecordMove[] = [];
  for (let node of nodes) {
    for (let c of ["B", "W"])
      if (node[c]) {
        let v = node[c][0];
        if (v !== "" && !/^[a-s]{2}$/.test(v)) throw Error("棋谱坐标无效");
        let x = v.charCodeAt(0) - 97,
          y = v.charCodeAt(1) - 97;
        if (v && (x >= n || y >= n)) throw Error("棋谱坐标超出棋盘");
        moves.push({ color: c === "B" ? 1 : 2, i: v ? y * n + x : null });
      }
  }
  if (root.AE || nodes.slice(1).some(node=>node.AB||node.AW||node.AE))
    throw Error("仅支持根节点摆子，不支持中途编辑棋盘");
  const setup: {i:number;color:Color}[]=[],seen=new Set<number>();
  for(const [prop,color] of [["AB",1],["AW",2]] as const)for(const value of root[prop]??[]){
    if(!/^[a-s]{2}$/.test(value))throw Error("摆子坐标无效（暂不支持压缩范围）");
    const x=value.charCodeAt(0)-97,y=value.charCodeAt(1)-97,i=y*n+x;
    if(x>=n||y>=n||seen.has(i))throw Error("摆子越界或重复");
    seen.add(i);setup.push({i,color});
  }
  if(root.PL && !['B','W'].includes(root.PL[0]))throw Error("行棋方无效");
  const toPlay:Color=root.PL?.[0]==='W'?2:root.PL?.[0]==='B'?1:(root.AB?.length??0)>1?2:1;
  return { n, moves, root, setup, toPlay };
}
export function gameFromKifu(kifu:Kifu){
 const game=new Go(kifu.n);
 for(const {i,color} of kifu.setup)game.board[i]=color;
 game.turn=kifu.toPlay;
 for(const {i} of kifu.setup)if(game.group(i).liberties.size===0)throw Error("初始摆子含无气棋块");
 return game;
}
export function links(g: Go): Link[] {
  let result: Link[] = [];
  let membership = new Map();
  for (let p = 0; p < g.board.length; p++)
    if (g.board[p] && !membership.has(p)) {
      for (let q of g.group(p).stones) membership.set(q, p);
    }
  for (let i = 0; i < g.board.length; i++)
    if (g.board[i])
      for (let j = i + 1; j < g.board.length; j++)
        if (g.board[i] === g.board[j]) {
          let dx = (j % g.n) - (i % g.n),
            dy = Math.floor(j / g.n) - Math.floor(i / g.n),
            a = Math.abs(dx),
            b = Math.abs(dy);
          let kind: Link["kind"] | null =
            a + b === 1
              ? "solid"
              : (a === 0 && b === 2) || (b === 0 && a === 2)
                ? "small"
                : (a === 0 && b === 3) || (b === 0 && a === 3)
                  ? "large"
                  : a === 1 && b === 1
                    ? "diagonal"
                    : null;
          if (!kind) continue;
          if (kind !== "solid" && membership.get(i) === membership.get(j))
            continue;
          if (kind === "small" || kind === "large") {
            let steps = Math.max(a, b);
            if (
              Array.from(
                { length: steps - 1 },
                (_, k) => i + (k + 1) * (dx / steps + (dy / steps) * g.n),
              ).some((p) => g.board[p])
            )
              continue;
          }
          const cuts =
            kind === "diagonal"
              ? [i + dx, i + dy * g.n].filter(
                  (p) => g.board[p] === 3 - g.board[i],
                ).length
              : 0;
          if (cuts === 2) continue;
          result.push({
            i,
            j,
            kind,
            color: g.board[i],
            threatened: cuts === 1,
          });
        }
  return result;
}

// Pure hypothetical move analysis, including ko and suicide legality.
export function analyzeMove(game: Go, i: number): MoveAnalysis {
  const copy = new Go(game.n);
  copy.board = game.board.slice();
  copy.turn = game.turn;
  copy.history = game.history.slice();
  copy.captures = game.captures.slice();
  copy.passes = game.passes;
  copy.ended = game.ended;
  const ownGroups: Chain[] = [],
    ownSeen = new Set<number>();
  for (const p of game.neighbors(i))
    if (game.board[p] === game.turn && !ownSeen.has(p)) {
      const group = game.group(p);
      group.stones.forEach((q) => ownSeen.add(q));
      ownGroups.push(group);
    }
  const error = copy.play(i);
  if (error)
    return {
      error,
      captured: [],
      atari: [],
      liberties: 0,
      rescued: [],
      connected: 0,
      ownSize: 0,
    };
  const captured = game.board.flatMap((c, p) =>
    c && !copy.board[p] ? [p] : [],
  );
  const atari = [],
    seen = new Set();
  for (const p of copy.neighbors(i)) {
    if (copy.board[p] !== 3 - game.turn || seen.has(p)) continue;
    const group = copy.group(p);
    group.stones.forEach((q) => seen.add(q));
    if (group.liberties.size === 1) atari.push(...group.stones);
  }
  return {
    error: null,
    captured,
    atari,
    liberties: copy.group(i).liberties.size,
    rescued: ownGroups
      .filter((g) => g.liberties.size === 1 && copy.group(i).liberties.size > 1)
      .flatMap((g) => [...g.stones]),
    connected: ownGroups.length,
    ownSize: copy.group(i).stones.size,
  };
}
