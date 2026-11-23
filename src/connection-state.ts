import { connectionEase } from "./connection-motion";
import { hiddenConnections, connectionKey } from "./connection-presentation";
import type { CrossingTarget } from "./connection-presentation";
import { Go, links } from "./engine";
import type { Link } from "./engine";
import { linkRoutePoints } from "./link-pattern";
export type ConnectionTone = [number, number, number, number]; // strength, pressure, threat, gap
export interface ConnectionCrossing extends CrossingTarget {
  from: number;
  to: number;
  start: number;
}
export interface ConnectionState {
  link: Link;
  from: ConnectionTone;
  to: ConnectionTone;
  start: number;
  cut: number;
  cutFrom?: number;
  merging?: boolean;
  fromVisibility?: number;
  toVisibility?: number;
  crossings?: ConnectionCrossing[];
}
export const connectionDuration = 0.7;
export function sampleCrossing(crossing: ConnectionCrossing, time: number) {
  return crossing.from + (crossing.to - crossing.from) *
    connectionEase((time - crossing.start) / connectionDuration);
}
export function sampleConnection(
  state: ConnectionState,
  time: number,
): ConnectionTone {
  const t = Math.max(0, Math.min(1, (time - state.start) / connectionDuration));
  const ease = connectionEase(t, state.merging);
  return state.from.map(
    (v, i) => v + (state.to[i] - v) * ease,
  ) as ConnectionTone;
}
export function sampleVisibility(state:ConnectionState,time:number){
 const from=state.fromVisibility??(state.from[0]>0?1:0),to=state.toVisibility??(state.to[0]>0?1:0);
 return from+(to-from)*connectionEase((time-state.start)/connectionDuration,state.merging);
}
export function sampleCut(state:ConnectionState,time:number){
 const ease=connectionEase((time-state.start)/connectionDuration,state.merging);
 return (state.cutFrom??state.cut)+(state.cut-(state.cutFrom??state.cut))*ease;
}
export function connectionTone(game: Go, link: Link): ConnectionTone {
  const libs = Math.min(
    game.group(link.i).liberties.size,
    game.group(link.j).liberties.size,
  );
  const pressure = Math.max(0, Math.min(1, (4 - libs) / 3));
  const route = linkRoutePoints(game.n, link);
  // Nearby enemy stones put pressure on a jump; this is not a tactical cut proof.
  const exposed =
    route.filter((p) =>
      game.neighbors(p).some((q) => game.board[q] === 3 - link.color),
    ).length / Math.max(1, route.length);
  const threat = link.threatened
    ? 0.85
    : link.kind === "diagonal"
      ? 0
      : exposed * 0.5;
  const base =
    link.kind === "diagonal" ? 0.88 : link.kind === "small" ? 0.64 : link.kind === "knight" ? 0.52 : 0.39;
  return [
    base * (1 - pressure * 0.43) * (1 - threat * 0.46),
    pressure,
    threat,
    0, // One occupied diagonal cut point weakens the neck; it is not a completed cut.
  ];
}
export function updateConnections(
  game: Go,
  states: Map<string, ConnectionState>,
  time: number,
  animate: boolean,
  focus = -1,
): ConnectionState[] {
  const active = new Set<string>();
  const candidates=links(game).filter(link=>link.kind!=="solid");
  const tones=new Map(candidates.map(link=>[link,connectionTone(game,link)]));
  const hidden = hiddenConnections(game, candidates, link => tones.get(link)![0], focus);
  for (const link of candidates) {
    const key = connectionKey(link);
    active.add(key);
    const to = [...tones.get(link)!] as ConnectionTone,
      old = states.get(key);
    const visibility = Number(!hidden.has(link));
    if (!old || old.to.some((v, i) => v !== to[i]) || old.toVisibility !== visibility ||
      (!animate && (old.from.some((v, i) => v !== to[i]) || old.fromVisibility !== visibility)))
      states.set(key, {
        link,
        from: animate
          ? old
            ? sampleConnection(old, time)
            : [0, to[1], to[2], to[3]]
          : to,
        to,
        fromVisibility: animate ? old ? sampleVisibility(old,time) : 0 : visibility,
        toVisibility: visibility,
        start: time,
        cut: old ? sampleCut(old,time) : 0.5,
        crossings: [],
      });
  }
  for (const [key, state] of states)
    if (!active.has(key)) {
      if (
        !animate ||
        (state.to[0] === 0 && time - state.start >= connectionDuration)
      ) {
        states.delete(key);
        continue;
      }
      {
        const { i, j, color } = state.link,
          dx = (j % game.n) - (i % game.n),
          dy = Math.floor(j / game.n) - Math.floor(i / game.n),
          lengthSquared = dx * dx + dy * dy;
        let cut = 0.5;
        const obstruction = linkRoutePoints(game.n, state.link)
          .find(p => game.board[p] === 3 - color);
        if (obstruction !== undefined) {
          const px = obstruction % game.n - i % game.n;
          const py = Math.floor(obstruction / game.n) - Math.floor(i / game.n);
          cut = Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared));
        }
        const intact = game.board[i] === color && game.board[j] === color;
        const merged = intact && game.group(i).stones.has(j);
        const to:ConnectionTone=merged || !intact ? [0,0,0,0] : [0,1,1,1];
        if(state.to.every((v,i)=>v===to[i])&&!!state.merging===merged&&state.cut===cut)continue;
        states.set(key, {
          ...state,
          from: sampleConnection(state, time),
          to,
          fromVisibility: sampleVisibility(state,time),
          toVisibility: 0,
          start: time,
          cut,
          cutFrom: sampleConnection(state,time)[3]>0 ? sampleCut(state,time) : cut,
          merging: merged,
        });
      }
    }
  // Display suppression has its own visibility channel, never a tactical gap
  // or pinched arms around an imaginary crossing stone.
  for (const state of states.values()) state.crossings = [];
  return [...states.values()];
}
