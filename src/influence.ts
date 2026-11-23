import type { Go } from "./engine";

/** Local influence only: never territory, score, life/death, or a promise of connection. */
export interface InfluenceField {
  n: number;
  /** Each channel is in [0, 1]. Own stones emit 1; enemy stones block it. */
  black: Float32Array;
  white: Float32Array;
  /** Black minus white, in [-1, 1]. Zero alone does not mean an empty area. */
  advantage: Float32Array;
  /** Combined nearby presence, in [0, 1], including balanced confrontations. */
  total: Float32Array;
  /** Shared presence: 2 * min(black, white), in [0, total]. */
  contest: Float32Array;
}

/**
 * Diffuse the two colours separately on the actual board graph. Occupied points
 * are fixed sources/barriers; no liberties, eyes or supposed dead stones are
 * inferred. A boundary has only its existing neighbours: it emits nothing and
 * does not extend the board. Attenuation limits the reach of a lone stone.
 *
 * Keep the positive channels until rendering. Subtracting them first loses the
 * difference between an open area and a heavily contested, balanced position.
 */
export function influenceField(game: Go, iterations = 28): InfluenceField {
  const length = game.board.length;
  const steps = Number.isFinite(iterations)
    ? Math.max(0, Math.min(64, Math.floor(iterations)))
    : 28;
  let black = Float32Array.from(game.board, (c) => (c === 1 ? 1 : 0));
  let white = Float32Array.from(game.board, (c) => (c === 2 ? 1 : 0));
  let nextBlack = black.slice();
  let nextWhite = white.slice();
  const empty = game.board.flatMap((c, i) => (c === 0 ? [i] : []));
  const neighbours = empty.map((i) => game.neighbors(i));

  for (let step = 0; step < steps; step++) {
    for (let k = 0; k < empty.length; k++) {
      const i = empty[k];
      const adjacent = neighbours[k];
      let b = 0;
      let w = 0;
      for (const j of adjacent) {
        b += black[j];
        w += white[j];
      }
      const attenuation = adjacent.length ? 0.94 / adjacent.length : 0;
      nextBlack[i] = b * attenuation;
      nextWhite[i] = w * attenuation;
    }
    [black, nextBlack] = [nextBlack, black];
    [white, nextWhite] = [nextWhite, white];
  }

  const advantage = new Float32Array(length);
  const total = new Float32Array(length);
  const contest = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    advantage[i] = black[i] - white[i];
    total[i] = black[i] + white[i];
    contest[i] = 2 * Math.min(black[i], white[i]);
  }
  return { n: game.n, black, white, advantage, total, contest };
}
