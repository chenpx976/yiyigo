import test from "node:test";
import assert from "node:assert/strict";
import { attachmentHeightBounds, attachmentRoot, wholeConnectionSection, wholeConnectionDistance } from "../src/connection-envelope";
import { ellipsoidDistance, stoneProfile } from "../src/stone-profile";
import { rayEllipsoidIntersection } from "../src/implicit-stones";

// The ray marcher skips the empty slab above these bounds. Exercise production
// sections at roots, waists, unequal endpoint lifecycles and intermediate points.
// In particular a disappearing endpoint must not raise the opposite half.
test("attachment ray-entry bounds enclose root, waist and unequal lifecycle sections", () => {
  for (const solid of [true, false]) {
    const bound = solid ? attachmentHeightBounds.solid : attachmentHeightBounds.virtual;
    assert.ok(bound < stoneProfile.height, "body crowns can bypass attachment marching");
    for (const length of [1, Math.SQRT2, 2, Math.sqrt(5), 3])
      for (const lifeA of [0.001, 0.08, 0.4, 1])
        for (const lifeB of [0.001, 0.08, 0.4, 1])
          for (const visibility of [0.001, 0.1, 0.5, 0.9, 1])
            for (const [strength, pressure] of [[0, 0], [1, 0], [0.5, 1]]) {
              const root = attachmentRoot(solid, visibility);
              const start = root * lifeA, end = length - root * lifeB;
              for (let step = 0; step <= 32; step++) {
                const x = start + (end - start) * step / 32;
                const section = wholeConnectionSection(x, length, solid, strength, lifeA, lifeB, visibility, pressure);
                const top = section.centerHeight + section.halfHeight;
                assert.ok(Number.isFinite(top) && top <= bound + 1e-12,
                  `solid=${solid} length=${length} life=${lifeA}/${lifeB} visibility=${visibility} x=${x} top=${top}`);
              }
            }
  }
});

test("cuts and crossing masks cannot place attachment material above the ray-entry plane", () => {
  for (const solid of [true, false]) {
    const bound = solid ? attachmentHeightBounds.solid : attachmentHeightBounds.virtual;
    for (const length of [1, 2, 3]) for (const gap of [0, 0.15, 0.5, 1]) {
      for (const [lifeA, lifeB] of [[1, 1], [0.2, 0.8], [0.8, 0.2]]) {
        for (let i = 0; i <= 32; i++) {
          const distance = wholeConnectionDistance([length * i / 32, 0, bound + 0.001], {
            a: [0, 0], b: [length, 0], solid, lifeA, lifeB, strength: 1,
            visibility: 1, gap, cut: 0.3, crossings: [{ t: 0.6, amount: 0.7 }],
          });
          assert.ok(distance > 0, "skipped slab contains no attachment surface");
        }
      }
    }
  }
});

test("analytic sphere hits agree with independent chord geometry and ray direction scaling", () => {
  for (const radius of [0.001, 0.2, 1, 3]) for (const fraction of [0, 0.2, 0.75, 0.99, 1]) {
    const x = radius * fraction;
    const expected = 4 * radius - Math.sqrt(radius * radius - x * x);
    for (const speed of [0.25, 1, 3]) {
      const hit = rayEllipsoidIntersection([x, 0, 4 * radius], [0, 0, -speed], [0, 0, 0], [radius, radius, radius]);
      assert.notEqual(hit, null);
      assert.ok(Math.abs(hit! * speed - expected) < 1e-11);
    }
  }
});

test("stone ray hits lie on the implicit zero surface for overhead and angled shadow rays", () => {
  for (const life of [0.001, 0.03, 0.2, 0.65, 1]) {
    const radius = stoneProfile.radius * life, halfHeight = stoneProfile.height * life / 2;
    const center: [number, number, number] = [9, 13, halfHeight];
    const radii: [number, number, number] = [radius, radius, halfHeight];
    for (const tilt of [0, 0.25, 0.7, 1.1]) for (const angle of [0, 1, 2, 4]) {
      const target: [number, number, number] = [
        center[0] + radius * Math.sin(tilt) * Math.cos(angle),
        center[1] + radius * Math.sin(tilt) * Math.sin(angle),
        halfHeight * (1 + Math.cos(tilt)),
      ];
      for (const ray of [[0, 0, -1], [0.35, -0.45, -1], [-0.6, 0.2, -1]] as const) {
        const expected = (0.5 - target[2]) / -ray[2];
        const origin: [number, number, number] = [target[0] - expected * ray[0], target[1] - expected * ray[1], 0.5];
        const hit = rayEllipsoidIntersection(origin, ray, center, radii);
        assert.notEqual(hit, null);
        assert.ok(Math.abs(hit! - expected) < 1e-10, "first hit reaches the independently constructed front-facing surface");
        const distance = (t: number) => ellipsoidDistance(
          origin[0] + t * ray[0] - center[0], origin[1] + t * ray[1] - center[1],
          origin[2] + t * ray[2] - center[2], ...radii,
        );
        assert.ok(Math.abs(distance(hit!)) < 1e-10);
        assert.ok(distance(hit! - life * 1e-5) > 0, "before entry is outside the implicit body");
        assert.ok(distance(hit! + life * 1e-5) < 0, "after entry is inside the implicit body");
      }
    }
  }
});

test("grazing rays touch once while adjacent misses and backwards rays remain empty", () => {
  const radius = stoneProfile.radius, halfHeight = stoneProfile.height / 2;
  const center: [number, number, number] = [0, 0, halfHeight];
  const radii: [number, number, number] = [radius, radius, halfHeight];
  const tangent = rayEllipsoidIntersection([radius, 0, 0.5], [0, 0, -1], center, radii);
  assert.notEqual(tangent, null);
  assert.ok(Math.abs(tangent! - (0.5 - halfHeight)) < 1e-12);
  assert.equal(rayEllipsoidIntersection([radius * (1 + 1e-8), 0, 0.5], [0, 0, -1], center, radii), null);
  assert.equal(rayEllipsoidIntersection([0, 0, 0.5], [0, 0, 1], center, radii), null);
  assert.equal(rayEllipsoidIntersection([2, 0, 0.5], [0.1, 0, -1], center, radii), null);
  const near = rayEllipsoidIntersection([radius * (1 - 1e-8), 0, 0.5], [0, 0, -1], center, radii);
  assert.notEqual(near, null);
  assert.ok(near! < 0.5 - halfHeight);
  assert.ok(Math.abs(ellipsoidDistance(radius * (1 - 1e-8), 0, 0.5 - near! - halfHeight, ...radii)) < 1e-12);
});
