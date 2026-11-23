export class Go {
  constructor(n = 9) {
    this.n = n;
    this.board = Array(n * n).fill(0);
    this.turn = 1;
    this.history = [];
    this.captures = [0, 0, 0];
    this.passes = 0;
    this.ended = false;
  }
  neighbors(i) {
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
  group(i, b = this.board) {
    let color = b[i],
      stones = new Set(),
      liberties = new Set(),
      todo = [i];
    if (!color) return { stones, liberties };
    while (todo.length) {
      let p = todo.pop();
      if (stones.has(p)) continue;
      stones.add(p);
      for (let q of this.neighbors(p)) {
        if (!b[q]) liberties.add(q);
        else if (b[q] === color && !stones.has(q)) todo.push(q);
      }
    }
    return { stones, liberties };
  }
  play(i, color = this.turn) {
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
    this.turn = 3 - color;
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
        owners = new Set();
      while (todo.length) {
        let p = todo.pop();
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
export function parseSGF(text) {
  let p = 0;
  function ws() {
    while (/\s/.test(text[p] || "") && p < text.length) p++;
  }
  function tree() {
    ws();
    if (text[p++] !== "(") throw Error("无效 SGF");
    let nodes = [];
    ws();
    while (text[p] === ";") {
      p++;
      let node = {};
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
  let moves = [];
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
  if (nodes.some((n) => n.AB || n.AW || n.AE))
    throw Error("暂不支持带摆子或让子的棋谱");
  return { n, moves, root };
}
export function links(g) {
  let result = [],
    membership = new Map();
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
          let kind =
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
          if (
            kind === "diagonal" &&
            [i + dx, i + dy * g.n].some((p) => g.board[p] === 3 - g.board[i])
          )
            continue;
          result.push({ i, j, kind, color: g.board[i] });
        }
  return result;
}
