import type { Go } from './engine';
import { influenceField } from './influence';

export const influenceDuration = 0.55;
/** Retarget from the currently displayed channels, including rapid undo. */
export class InfluenceTransition {
  n = 0;
  from = new Float32Array(0);
  to = new Float32Array(0);
  start = -100;
  private key = '';
  amount(time: number) {
    const t = Math.max(0, Math.min(1, (time - this.start) / influenceDuration));
    return t * t * (3 - 2 * t);
  }
  settle(time: number) {
    this.from = this.to.slice();
    this.start = time - influenceDuration;
  }
  update(game: Go, time: number, animate: boolean) {
    const key = `${game.n}:${game.board.join('')}`;
    if (key === this.key) return false;
    const field = influenceField(game), target = new Float32Array(game.board.length * 4);
    for (let i = 0; i < game.board.length; i++) {
      target[i * 4] = field.black[i];
      target[i * 4 + 1] = field.white[i];
      target[i * 4 + 3] = 1;
    }
    const t = this.amount(time);
    const origin = animate && this.n === game.n
      ? Float32Array.from(this.from, (v, i) => v + (this.to[i] - v) * t)
      : target.slice();
    this.n = game.n;
    this.key = key;
    this.from = origin;
    this.to = target;
    this.start = animate ? time : time - influenceDuration;
    return true;
  }
}
