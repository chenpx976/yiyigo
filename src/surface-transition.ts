export interface SurfaceTarget {
  i: number;
  j: number;
  type: 0 | 1;
  color: number;
  lib: number;
  seed: number;
}
export interface SurfaceTransition extends SurfaceTarget {
  from: number;
  to: number;
  start: number;
}
export const morphDuration = 0.7;
export function sampleSurface(state: SurfaceTransition, time: number) {
  const t = Math.max(0, Math.min(1, (time - state.start) / morphDuration));
  return state.from + (state.to - state.from) * t * t * (3 - 2 * t);
}
export function updateSurfaces(
  targets: SurfaceTarget[],
  states: Map<string, SurfaceTransition>,
  time: number,
  animate: boolean,
) {
  const active = new Set<string>();
  for (const target of targets) {
    const key = `${target.type}:${target.color}:${target.i}:${target.j}`;
    active.add(key);
    const old = states.get(key);
    if (!old || old.to !== 1)
      states.set(key, {
        ...target,
        from: animate ? (old ? sampleSurface(old, time) : 0) : 1,
        to: 1,
        start: time,
      });
    else Object.assign(old, target);
  }
  for (const [key, old] of states)
    if (!active.has(key)) {
      if (!animate && old.to !== 0) {
        states.delete(key);
        continue;
      }
      if (old.to === 0 && time >= old.start + morphDuration) {
        states.delete(key);
        continue;
      }
      if (old.to !== 0)
        states.set(key, {
          ...old,
          from: sampleSurface(old, time),
          to: 0,
          start: time,
        });
    }
  return [...states.values()];
}
