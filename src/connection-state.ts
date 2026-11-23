import { connectionEase } from "./connection-motion";
import { Go, links } from "./engine";
import type { Link } from "./engine";
export type ConnectionTone = [number, number, number, number]; // strength, pressure, threat, gap
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
}
export const connectionDuration = 0.7;
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
  const dx = (link.j % game.n) - (link.i % game.n),
    dy = Math.floor(link.j / game.n) - Math.floor(link.i / game.n);
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  const route =
    link.kind === "diagonal"
      ? [link.i + dx, link.i + dy * game.n]
      : Array.from(
          { length: steps - 1 },
          (_, k) => link.i + (k + 1) * (dx / steps + (dy / steps) * game.n),
        );
  // Nearby enemy stones put pressure on a jump; this is not a tactical cut proof.
  const exposed =
    route.filter((p) =>
      game.neighbors(p).some((q) => game.board[q] === 3 - link.color),
    ).length / route.length;
  const threat = link.threatened
    ? 0.85
    : link.kind === "diagonal"
      ? 0
      : exposed * 0.5;
  const base =
    link.kind === "diagonal" ? 0.88 : link.kind === "small" ? 0.64 : 0.39;
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
): ConnectionState[] {
  const active = new Set<string>();
  const candidates=links(game).filter(link=>link.kind!=="solid");
  const tones=new Map(candidates.map(link=>[link,connectionTone(game,link)]));
  for (const link of candidates) {
    const key = `${link.color}:${link.i}:${link.j}`;
    active.add(key);
    const to = [...tones.get(link)!] as ConnectionTone,
      old = states.get(key);
    // Presentation only: keep every rule-level link, but retire a weaker jump
    // when two unthreatened diagonals already express a stronger route.
    // Diagonals are never suppressed, so this cannot erase the alternate path.
    if(link.kind==='small'){
      const diagonals=candidates.filter(l=>l.kind==='diagonal'&&!l.threatened&&l.color===link.color);
      const redundant=diagonals.some(a=>{
        const via=a.i===link.i?a.j:a.j===link.i?a.i:-1;
        if(via<0)return false;
        const b=diagonals.find(b=>(b.i===via&&b.j===link.j)||(b.j===via&&b.i===link.j));
        return b && Math.min(tones.get(a)![0],tones.get(b)![0])>to[0]*1.1;
      });
      if(redundant)to[0]=0;
    }
    if (!old || old.to.some((v, i) => v !== to[i]))
      states.set(key, {
        link,
        from: animate
          ? old
            ? sampleConnection(old, time)
            : [0, to[1], to[2], to[3]]
          : to,
        to,
        fromVisibility: animate ? old ? sampleVisibility(old,time) : 0 : Number(to[0]>0),
        toVisibility: Number(to[0]>0),
        start: time,
        cut: old ? sampleCut(old,time) : 0.5,
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
          steps = Math.max(Math.abs(dx), Math.abs(dy));
        let cut = 0.5;
        if (state.link.kind !== "diagonal")
          for (let k = 1; k < steps; k++)
            if (
              game.board[i + k * (dx / steps + (dy / steps) * game.n)] ===
              3 - color
            ) {
              cut = k / steps;
              break;
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
  return [...states.values()];
}
