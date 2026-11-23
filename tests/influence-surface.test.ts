import test from "node:test";
import assert from "node:assert/strict";
import { Go } from "../src/engine.ts";
import { createInfluenceSurface } from "../src/influence-surface.ts";

 test("influence texture reuse preserves rapid undo from displayed channels", () => {
  const game = new Go(9);
  const surface = createInfluenceSurface();
  try {
    surface.update(game, 0, false);
    const uniforms = surface.mesh.material.uniforms;
    const origin = uniforms.uFrom.value;
    const target = uniforms.uTo.value;
    assert.equal(game.play(40), null);
    surface.update(game, 1, true);
    surface.setTime(1.2);
    const displayed = target.image.data[40 * 4] * uniforms.uMix.value;
    assert(displayed > 0 && displayed < target.image.data[40 * 4]);
    game.undo();
    surface.update(game, 1.2, true);
    assert.equal(uniforms.uFrom.value, origin);
    assert.equal(uniforms.uTo.value, target);
    assert(Math.abs(origin.image.data[40 * 4] - displayed) < 1e-6);
    assert.equal(target.image.data[40 * 4], 0);
    assert(surface.isAnimating(1.2));
    surface.setTime(2);
    assert.equal(uniforms.uMix.value, 1);
    assert.equal(surface.isAnimating(2), false);
  } finally {
    surface.dispose();
  }
});

test("board resize retires influence textures and reduced motion settles immediately", () => {
  const surface = createInfluenceSurface();
  try {
    surface.update(new Go(9), 0, false);
    const uniforms = surface.mesh.material.uniforms;
    const origin = uniforms.uFrom.value;
    const target = uniforms.uTo.value;
    let disposals = 0;
    origin.addEventListener("dispose", () => disposals++);
    target.addEventListener("dispose", () => disposals++);
    const game = new Go(19);
    assert.equal(game.play(180), null);
    surface.update(game, 1, true, false);
    assert.equal(disposals, 2);
    assert.notEqual(uniforms.uFrom.value, origin);
    assert.notEqual(uniforms.uTo.value, target);
    assert.equal(uniforms.uTo.value.image.width, 19);
    assert.equal(uniforms.uTo.value.image.data[180 * 4], 1);
    assert.equal(uniforms.uMix.value, 1);
    assert.equal(surface.isAnimating(1), false);
  } finally {
    surface.dispose();
  }
});
