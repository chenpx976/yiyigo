import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectionTopAt } from '../src/vertical-surface';
import { wholeConnectionDistance, wholeConnectionSection, attachmentRoot } from '../src/connection-envelope';
import type { WholeConnection } from '../src/connection-envelope';

test('vertical hits lie on the unchanged connection field through lifecycle, cuts and rotations', () => {
  let hits = 0, misses = 0;
  for (const solid of [true, false]) for (const angle of [0, Math.PI / 4, Math.PI / 2, 2.7])
    for (const length of [1, Math.SQRT2, 2, 3]) for (const [lifeA, lifeB] of [[1,1],[.2,.8],[.8,.2],[.03,.1]])
      for (const visibility of [.1,.6,1]) for (const gap of [0,.2,.8,1]) {
        const edge: WholeConnection = { a:[3,5], b:[3+length*Math.cos(angle),5+length*Math.sin(angle)], solid, lifeA, lifeB, visibility, gap, cut:.37, strength:.6, pressure:.7 };
        const root = attachmentRoot(solid,visibility);
        for (const fraction of [.05,.25,.5,.8,.95]) {
          const x=root*lifeA+(length-root*(lifeA+lifeB))*fraction;
          const section=wholeConnectionSection(x,length,solid,.6,lifeA,lifeB,visibility,.7);
          for (const across of [0,section.width*.4,section.width*.95,section.width*1.1]) {
            const point: [number,number]=[3+x*Math.cos(angle)-across*Math.sin(angle),5+x*Math.sin(angle)+across*Math.cos(angle)];
            const z=connectionTopAt(point,edge);
            if(z===null){misses++; continue;}
            hits++;
            assert.ok(Math.abs(wholeConnectionDistance([...point,z],edge))<1e-9);
            assert.ok(wholeConnectionDistance([...point,z+1e-6],edge)>0);
            assert.ok(wholeConnectionDistance([...point,z-1e-7],edge)<=1e-10);
          }
        }
      }
  assert.ok(hits>1000 && misses>1000);
});

test('cut openings, crossing openings, hidden links and missing endpoints remain empty', () => {
  const edge: WholeConnection = {a:[0,0],b:[2,0],solid:false};
  assert.notEqual(connectionTopAt([1,0],edge),null);
  assert.equal(connectionTopAt([1,0],{...edge,gap:1}),null);
  assert.equal(connectionTopAt([1,0],{...edge,crossings:[{t:.5,amount:1}]}),null);
  assert.equal(connectionTopAt([1,0],{...edge,visibility:0}),null);
  assert.equal(connectionTopAt([1,0],{...edge,lifeA:0}),null);
  assert.equal(connectionTopAt([1,0],{...edge,lifeB:0}),null);
  assert.equal(connectionTopAt([1,1],edge),null);
});

test('vertical connection hits are endpoint symmetric and root-width culling is conservative', () => {
  for (const solid of [true,false]) for (const lifeA of [.02,.2,1]) for (const lifeB of [.02,.7,1])
    for (const visibility of [.001,.2,1]) for (let i=0;i<=50;i++) {
      // Avoid sampling exactly on a clipped root: floating subtraction can
      // classify the two endpoint orders on opposite sides of that boundary.
      const x=3*(i+.17)/50.34,edge:WholeConnection={a:[0,0],b:[3,0],solid,lifeA,lifeB,visibility,strength:1};
      const a=connectionTopAt([x,.01],edge),b=connectionTopAt([x,.01],{...edge,a:edge.b,b:edge.a,lifeA:lifeB,lifeB:lifeA});
      assert.equal(a===null,b===null);
      if(a!==null&&b!==null)assert.ok(Math.abs(a-b)<1e-10);
      const section=wholeConnectionSection(x,3,solid,1,lifeA,lifeB,visibility);
      assert.ok(section.width*(solid?1:1.045)<.3);
    }
});
