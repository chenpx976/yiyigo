import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

test('64 surface fixtures retain silhouettes, colors and transitions; angled rays retain the old solver', { timeout: 180_000 }, async t => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen(); t.after(() => server.close());
  const browser = await chromium.launch({ headless: true, args: process.env.YIYIGO_BENCH_GPU === 'metal' ? ['--use-angle=metal'] : ['--enable-unsafe-swiftshader'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  // Empty Vite-owned document, so this test controls every GPU submission.
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/qi-mai/manifest.json`);
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { parseSGF, gameFromKifu } = await import('/src/engine.ts');
    const { createLivingSurface } = await import('/src/living-stones.ts');
    const { createReferenceImplicitStones } = await import('/src/prototype/reference-implicit-stones.ts');
    const fixtures = await (await fetch('/qi-mai/manifest.json')).json();
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    renderer.setSize(256,256); renderer.setClearColor(0,0); renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const gl=renderer.getContext(),scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-100,100,100,-100,1,2000);
    const a=new Uint8Array(256*256*4),b=new Uint8Array(a.length),rows=[],images=[];
    let comparisons=0;
    for(const fixture of fixtures){
      const kifu=parseSGF(await (await fetch('/qi-mai/'+fixture.file)).text()),game=gameFromKifu(kifu);
      const live=createLivingSurface(game,[],false,0,false,new Map(),new Map());
      const mesh=live.mesh.children[0],current=mesh.material;
      const old=createReferenceImplicitStones(mesh.geometry,current.uniforms);
      const indices=[...kifu.setup.map(x=>x.i),...kifu.moves.map(x=>x.i).filter(x=>x!==null)];
      const xs=indices.map(i=>i%game.n),ys=indices.map(i=>Math.floor(i/game.n));
      const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
      const half=Math.max(2,(Math.max(...xs)-Math.min(...xs)+2)/2,(Math.max(...ys)-Math.min(...ys)+2)/2)*660/(game.n-1);
      camera.left=-half;camera.right=half;camera.top=half;camera.bottom=-half;camera.updateProjectionMatrix();
      const x=50+cx*660/(game.n-1),y=-50-cy*660/(game.n-1);
      camera.position.set(x,y,1000);camera.lookAt(x,y,0);
      scene.add(live.mesh);
      const compare=(label,time,side=false)=>{
        live.setTime(time);
        camera.position.set(x,y-(side?420:0),side?750:1000);camera.lookAt(x,y,0);camera.updateMatrixWorld();
        const ray=camera.getWorldDirection(new THREE.Vector3());ray.y*=-1;old.material.uniforms.uRay.value.copy(ray);
        const capture=['ko-swap','captured-thread'].includes(fixture.id)&&label==='undo-1';
        mesh.material=old.material;renderer.render(scene,camera);gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,a);
        if(capture)images.push({name:fixture.id+'-before',data:renderer.domElement.toDataURL()});
        mesh.material=current;renderer.render(scene,camera);gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,b);
        if(capture)images.push({name:fixture.id+'-after',data:renderer.domElement.toDataURL()});
        let silhouette=0,changed=0,sum=0,visible=0;
        for(let i=0;i<a.length;i+=4){
          if((a[i+3]>127)!==(b[i+3]>127))silhouette++;
          if(a[i+3]>127||b[i+3]>127)visible++;
          const d=Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));
          if(d>5)changed++;sum+=d;
        }
        comparisons++;
        rows.push({fixture:fixture.id,label,side,visible,silhouetteFraction:silhouette/65536,changedFraction:changed/65536,meanMaxChannelDifference:sum/65536});
      };
      compare('initial',0);compare('side',0,true);
      let time=1;
      for(const [index,move] of kifu.moves.entries()){
        const before=game.board.slice();const error=game.play(move.i,move.color);if(error)throw Error(error);
        live.update(game,before,true,time,true);
        for(const phase of [.02,.18,.35,.7])compare(`move-${index+1}-${phase}`,time+phase);
        // Reverse during the transition, then replay, exercising retargeting.
        game.undo();live.update(game,game.board,true,time+.12,true);compare(`undo-${index+1}`,time+.2);
        game.play(move.i,move.color);live.update(game,game.board,true,time+.22,true);compare(`replay-${index+1}`,time+1);
        time+=2;
      }
      scene.remove(live.mesh);old.material.dispose();old.depth.dispose();live.dispose();
    }
    renderer.dispose();return {fixtures:fixtures.length,comparisons,rows,images};
  });
  await mkdir('artifacts',{recursive:true});
  const {images,...report}=result;
  for(const image of images)await writeFile(`artifacts/surface-worst-${image.name}.png`,Buffer.from(image.data.split(',')[1],'base64'));
  await writeFile('artifacts/surface-accuracy.json',JSON.stringify(report,null,2));
  assert.equal(result.fixtures,64);
  assert.ok(result.comparisons>200);
  for(const row of result.rows){
    assert.ok(row.silhouetteFraction<.004,JSON.stringify(row));
    assert.ok(row.changedFraction<.005,JSON.stringify(row));
    if(row.side)assert.equal(row.changedFraction,0,JSON.stringify(row));
  }
  console.log(JSON.stringify({fixtures:result.fixtures,comparisons:result.comparisons,worstSilhouette:Math.max(...result.rows.map(x=>x.silhouetteFraction)),worstChanged:Math.max(...result.rows.map(x=>x.changedFraction))}));
  assert.deepEqual(errors,[]);
});
