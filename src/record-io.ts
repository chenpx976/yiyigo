import { Go, gameFromKifu, parseSGF } from "./engine";
import type { Kifu } from "./engine";

const metadata = [
  "KM", "HA", "PB", "PW", "BR", "WR", "BT", "WT", "DT", "EV", "RO", "PC",
  "GN", "GC", "SO", "US", "AN", "CP", "RU", "RE", "OT", "TM", "C", "AP",
];

/** Export the displayed prefix, including its initial position and root metadata. */
export function serializeSGF(game: Go, root?: Kifu["root"]): string {
  const point = (i: number) => String.fromCharCode(97 + i % game.n, 97 + Math.floor(i / game.n));
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
  const properties: Kifu["root"] = {
    GM: ["1"], FF: ["4"], CA: ["UTF-8"], SZ: [String(game.n)],
    KM: [root ? "0" : "7.5"],
  };
  for (const key of metadata) if (root?.[key]?.length) properties[key] = root[key];
  const initial = game.history[0] ?? game;
  for (const [key, color] of [["AB", 1], ["AW", 2]] as const) {
    const points = initial.board.flatMap((cell, i) => cell === color ? [point(i)] : []);
    if (points.length) properties[key] = points;
  }
  properties.PL = [initial.turn === 1 ? "B" : "W"];
  const header = Object.entries(properties)
    .map(([key, values]) => key + values.map(value => `[${escape(value)}]`).join(""))
    .join("");
  const moves = game.history.map(h => `;${h.color === 1 ? "B" : "W"}[${h.move === null ? "" : point(h.move)}]`).join("");
  return `(;${header}${moves})`;
}

export function validateRecord(text: string): Kifu {
  const kifu = parseSGF(text);
  replayRecord(kifu);
  return kifu;
}

function replayRecord(kifu: Kifu): Go {
  const game = gameFromKifu(kifu);
  for (const move of kifu.moves) {
    const error = game.play(move.i, move.color);
    if (error) throw Error(`棋谱第 ${game.history.length + 1} 手：${error}`);
  }
  return game;
}

/** New saves contain SGF; legacy move-only saves remain readable. */
export function restoreSavedGame(text: string | null): { game: Go; opponent: "human" | "bot" } | null {
  if (text === null) return null;
  const data = JSON.parse(text);
  if (data === null) return null;
  if (typeof data !== "object" || Array.isArray(data)) throw Error("无效存档");
  let game: Go;
  if (typeof data.sgf === "string") {
    game = replayRecord(parseSGF(data.sgf));
  } else {
    if (![9, 13, 19].includes(data.n) || !Array.isArray(data.moves)) throw Error("无效存档");
    game = new Go(data.n);
    for (const move of data.moves) {
      if (!move || (move.color !== 1 && move.color !== 2) ||
          (move.i !== null && !Number.isInteger(move.i)) || game.play(move.i, move.color))
        throw Error("无效存档");
    }
  }
  if (data.opponent !== undefined && data.opponent !== "human" && data.opponent !== "bot")
    throw Error("无效存档");
  return { game, opponent: data.opponent ?? "human" };
}

/** Fetches and file reads share one generation, including errors and body reads. */
export class RecordLoader {
  private generation = 0;
  private controller: AbortController | null = null;

  cancel() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
  }

  async load(
    read: (signal: AbortSignal) => Promise<string>,
    loaded: (kifu: Kifu) => void,
    failed: (error: unknown) => void,
  ): Promise<void> {
    this.cancel();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const text = await read(controller.signal);
      if (generation !== this.generation) return;
      loaded(validateRecord(text));
    } catch (error) {
      if (generation === this.generation) failed(error);
    } finally {
      if (generation === this.generation) this.controller = null;
    }
  }
}
