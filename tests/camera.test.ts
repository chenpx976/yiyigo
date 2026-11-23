import test from "node:test";
import assert from "node:assert/strict";
import {
  projectBoard,
  unprojectBoard,
  scenePoint,
  sceneWidth,
  sceneHeight,
  cameraCos,
  cameraSin,
} from "../src/board-camera";
test("top-down board projection round-trips all nineteen-line intersections", () => {
  for (let y = 0; y < 19; y++)
    for (let x = 0; x < 19; x++) {
      const px = 50 + (x * 660) / 18,
        py = 50 + (y * 660) / 18;
      const q = unprojectBoard(...projectBoard(px, py));
      assert.ok(Math.abs(q[0] - px) < 1e-8 && Math.abs(q[1] - py) < 1e-8);
    }
});
test("stone height does not displace its screen position in the top-down view", () => {
  const plane = scenePoint(380, 380),
    top = scenePoint(380, 380, 12);
  assert.equal(plane[0], top[0]);
  assert.ok(Math.abs(plane[1] - top[1] - 12 * cameraSin) < 1e-8);
  assert.equal(cameraCos, 1);
  assert.deepEqual(plane, top);
});
test("scene keeps board and bowls inside viewport without changing grid spacing", () => {
  for (const [x, y] of [
    [-112, 510],
    [872, 244],
    [4, 4],
    [756, 770],
  ]) {
    const p = scenePoint(x, y);
    assert.ok(p[0] >= 0 && p[0] <= sceneWidth);
    assert.ok(p[1] >= 0 && p[1] <= sceneHeight);
  }
  const a = scenePoint(50, 50),
    b = scenePoint(50, 50 + 660 / 18);
  assert.ok(Math.abs(b[1] - a[1] - (660 / 18) * cameraCos) < 1e-8);
});

test("Three camera projects actual mesh heights onto the same accessible hit grid", async () => {
  const THREE = await import("three");
  const camera = new THREE.OrthographicCamera(
    -sceneWidth / 2,
    sceneWidth / 2,
    sceneHeight / 2,
    -sceneHeight / 2,
    1,
    4000,
  );
  camera.up.set(0, 1, 0);
  camera.position.set(380, -380 - cameraSin * 1500, cameraCos * 1500);
  camera.lookAt(380, -380, 0);
  camera.updateMatrixWorld();
  for (const n of [9, 13, 19])
    for (let i = 0; i < n * n; i++) {
      const x = 50 + ((i % n) * 660) / (n - 1),
        y = 50 + (Math.floor(i / n) * 660) / (n - 1);
      for (const z of [0, 10]) {
        const p = new THREE.Vector3(x, -y, z).project(camera),
          expected = scenePoint(x, y, z);
        assert.ok(Math.abs(((p.x + 1) * sceneWidth) / 2 - expected[0]) < 1e-7);
        assert.ok(Math.abs(((1 - p.y) * sceneHeight) / 2 - expected[1]) < 1e-7);
      }
    }
});
