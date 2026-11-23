import { chooseMove, restorePosition } from "./position";
import type { PositionData } from "./position";
self.onmessage = (
  event: MessageEvent<{ id: number; position: PositionData }>,
) => {
  try {
    const move = chooseMove(restorePosition(event.data.position));
    self.postMessage({ id: event.data.id, move });
  } catch (error) {
    self.postMessage({ id: event.data.id, error: String(error) });
  }
};
