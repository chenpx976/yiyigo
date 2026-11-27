import * as THREE from 'three';
import { Go, gameFromKifu, parseSGF } from '../engine';
import type { Kifu } from '../engine';
import { createSurfaceFromModel } from '../living-stones';
import { surfaceModel } from '../surface-model';
import type { ConnectionState } from '../connection-state';
import type { SurfaceTransition } from '../surface-transition';
import { BabylonBoardRenderer } from './babylon-renderer';
import { ThreeComparisonRenderer } from './three-comparison-renderer';
import { createReferenceImplicitStones } from './reference-implicit-stones';
import { gridLineGLSL } from '../grid-material';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = el<HTMLOutputElement>('status');
const errorBox = el<HTMLDivElement>('error');
const slider = el<HTMLInputElement>('move');
const sourceSelect = el<HTMLSelectElement>('game');
const pixels = el<HTMLSelectElement>('pixels');
const zoom = el<HTMLSelectElement>('zoom');
const workload = el<HTMLSelectElement>('workload');
const engineComparison = new URLSearchParams(location.search).get('mode') === 'engines';
const names = { three: engineComparison ? 'Three.js · 当前算法' : 'Three.js · 优化前', babylon: engineComparison ? 'Babylon.js · 当前算法' : 'Three.js · 优化后' };
el('left-title').textContent = names.three;
el('right-title').textContent = names.babylon;
el<HTMLAnchorElement>('compare-mode').href = engineComparison ? location.pathname : `${location.pathname}?mode=engines`;
el('compare-mode').textContent = engineComparison ? '切换优化前后对比' : '切换引擎对比';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const frame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));

// Shared sRGB board image, with identical texels and sampling in both engines.
function boardImage() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 1024, 1024);
  gradient.addColorStop(0, '#d6b987'); gradient.addColorStop(1, '#b98e59');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1024, 1024);
  for (let y = 0; y < 1024; y += 3) {
    ctx.strokeStyle = `rgba(87,55,23,${.025 + .018 * Math.sin(y * 2.43)})`;
    ctx.beginPath();
    for (let x = 0; x <= 1024; x += 16) {
      const height = y + Math.sin(x * .012 + y * .023) * 2;
      if (x === 0) ctx.moveTo(x, height); else ctx.lineTo(x, height);
    }
    ctx.stroke();
  }
  const at = (i: number) => (30 + i * 660 / 18) / 720 * 1024;
  ctx.fillStyle = '#59432c';
  for (const x of [3, 9, 15]) for (const y of [3, 9, 15]) {
    ctx.beginPath(); ctx.arc(at(x), at(y), 3.2, 0, Math.PI * 2); ctx.fill();
  }
  return new Uint8Array(ctx.getImageData(0, 0, 1024, 1024).data);
}

async function start() {
  let game = new Go(19), kifu: Kifu, move = 0, generation = 0;
  let time = 0, animationStart = 0, animationUntil = 0, animationBase = 0, animationFrame = 0;
  let busy = false, cancelled = false, disposed = false;
  let report: unknown;
  let threeDraws = 0;
  let inViewport = true;
  const connections = new Map<string, ConnectionState>();
  const surfaces = new Map<string, SurfaceTransition>();
  const live = createSurfaceFromModel(19, surfaceModel(game, -1, [], false, 0, false, connections, surfaces), 0, false);
  const threeCanvas = el<HTMLCanvasElement>('three');
  const babylonCanvas = el<HTMLCanvasElement>('babylon');
  const renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true, preserveDrawingBuffer: true, stencil: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  renderer.setClearColor('#142624');
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(); scene.add(live.mesh);
  const camera = new THREE.OrthographicCamera(-380, 380, 380, -380, 1, 2000);
  camera.position.set(380, -380, 1000); camera.lookAt(380, -380, 0);
  const bytes = boardImage();
  const boardTexture = new THREE.DataTexture(bytes, 1024, 1024, THREE.RGBAFormat);
  boardTexture.minFilter = boardTexture.magFilter = THREE.LinearFilter;
  boardTexture.needsUpdate = true;
  const boardMaterial = new THREE.ShaderMaterial({
    uniforms: { board: { value: boardTexture } },
    vertexShader: 'varying vec2 vUV; void main(){vUV=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `uniform sampler2D board; varying vec2 vUV; ${gridLineGLSL} void main(){vec4 wood=texture2D(board,vUV);gl_FragColor=vec4(mix(wood.rgb,vec3(.37647,.29020,.18039),gridLineCoverage(vUV*720.+20.,19.)),1.);}`,
    toneMapped: false, side: THREE.DoubleSide,
  });
  const groundGeometry = new THREE.BufferGeometry();
  groundGeometry.setAttribute('position', new THREE.Float32BufferAttribute([20,-20,-.1, 740,-20,-.1, 20,-740,-.1, 740,-740,-.1], 3));
  groundGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0,0, 1,0, 0,1, 1,1], 2));
  groundGeometry.setIndex([0,2,1, 1,2,3]);
  const ground = new THREE.Mesh(groundGeometry, boardMaterial); scene.add(ground);
  const babylon = engineComparison ? new BabylonBoardRenderer(babylonCanvas, live, bytes, 1024) : new ThreeComparisonRenderer(babylonCanvas, live, ground);
  const glThree = renderer.getContext() as WebGL2RenderingContext;
  const glBabylon = babylonCanvas.getContext('webgl2')!;
  const sourceMesh = live.mesh.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  const optimizedMaterial = sourceMesh.material;
  const reference = createReferenceImplicitStones(sourceMesh.geometry, sourceMesh.material.uniforms);
  function renderThree(t: number, motion: boolean) {
    live.setTime(t); optimizedMaterial.uniforms.uMotion.value = Number(motion);
    sourceMesh.material = engineComparison ? optimizedMaterial : reference.material;
    renderer.render(scene, camera); threeDraws++;
    sourceMesh.material = optimizedMaterial;
  }
  function renderBoth(t: number, motion: boolean) {
    renderThree(t, motion); babylon.render(t, motion);
    document.body.dataset.threeDraws = String(threeDraws);
    document.body.dataset.babylonDraws = String(babylon.draws);
  }
  function setCamera() {
    const last = kifu?.moves[move - 1]?.i;
    const close = zoom.value === 'detail';
    const cx = close && last != null ? 50 + last % 19 * 660 / 18 : 380;
    const cy = close && last != null ? -50 - Math.floor(last / 19) * 660 / 18 : -380;
    const half = close ? 110 : 380;
    camera.left = -half; camera.right = half; camera.top = half; camera.bottom = -half;
    camera.position.set(cx, cy, 1000); camera.lookAt(cx, cy, 0); camera.updateProjectionMatrix();
    babylon.setCamera(camera);
  }
  function resize() {
    const width = Math.max(1, threeCanvas.getBoundingClientRect().width);
    const size = pixels.value === 'auto' ? Math.max(1, Math.floor(Math.min(width * Math.min(1.5, devicePixelRatio || 1), Math.sqrt(1_500_000)))) : Number(pixels.value);
    if (threeCanvas.width === size && babylonCanvas.width === size) return;
    clearReport();
    renderer.setSize(size, size, false); babylon.setSize(size);
    document.body.dataset.renderPixels = String(size);
    for (const id of ['three-meta', 'babylon-meta']) el(id).textContent = `WebGL2 · ${size} × ${size} 实际像素 · 显示 ${Math.round(width)} px · 每 CSS 像素 ${(size / width).toFixed(2)} 个采样`;
    renderBoth(time, false);
  }
  function stopAnimation() { cancelAnimationFrame(animationFrame); animationFrame = 0; }
  function clearReport() {
    report = undefined;
    document.body.dataset.benchmark = '';
    el<HTMLButtonElement>('download').disabled = true;
    el('results').innerHTML = '<tr><td colspan="4">当前配置尚未测量。请运行对照采样。</td></tr>';
  }
  let lastPreview = 0;
  function tick(now: number) {
    animationFrame = 0;
    if (disposed || document.hidden || !inViewport) return;
    time = animationBase + Math.min(.8, (now - animationStart) / 1000);
    if (now - lastPreview >= 1000 / 30 || now >= animationUntil) {
      renderBoth(time, true); lastPreview = now;
    }
    if (now < animationUntil) animationFrame = requestAnimationFrame(tick);
    else {
      // Prune finished capture/connection records in both renderers.
      const model = surfaceModel(game, -1, game.board, false, time, true, connections, surfaces, 'sample');
      live.updateModel(19, model, time, true); babylon.update(live); renderBoth(time, false);
      document.body.dataset.animating = 'false';
    }
  }
  function show(target: number, animate = false) {
    clearReport();
    stopAnimation();
    const previous = game.board.slice();
    target = Math.max(0, Math.min(kifu.moves.length, target));
    if (target === move + 1) {
      const next = kifu.moves[move]; const error = game.play(next.i, next.color); if (error) throw new Error(error);
    } else if (target === move - 1) game.undo();
    else {
      game = gameFromKifu(kifu);
      for (const step of kifu.moves.slice(0, target)) { const error = game.play(step.i, step.color); if (error) throw new Error(error); }
    }
    move = target; animate = animate && !reduced.matches;
    const model = surfaceModel(game, -1, previous, animate, time, animate, connections, surfaces);
    live.updateModel(19, model, time, animate); babylon.update(live);
    slider.value = String(move); el('move-label').textContent = `${move} / ${kifu.moves.length}`;
    document.body.dataset.move = String(move);
    document.body.dataset.board = game.board.join('');
    document.body.dataset.stones = String(game.board.filter(Boolean).length);
    document.body.dataset.animating = String(animate);
    setCamera(); renderBoth(time, animate);
    if (animate) {
      animationStart = performance.now(); animationBase = time; animationUntil = animationStart + 800;
      animationFrame = requestAnimationFrame(tick);
    }
  }
  function lock(value: boolean, cancellable = false) {
    busy = value;
    for (const node of document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('nav button, nav input, nav select')) node.disabled = value;
    el<HTMLButtonElement>('cancel').disabled = !value || !cancellable;
    el<HTMLButtonElement>('download').disabled = value || !report;
    if (!value && pixels.value === 'auto') resize();
  }
  async function load() {
    const token = ++generation;
    document.body.dataset.ready = 'false';
    lock(true); stopAnimation(); status.textContent = '正在载入真实棋谱…';
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}games/${sourceSelect.value}.sgf`);
      if (!response.ok) throw new Error(`棋谱加载失败：${response.status}`);
      const next = parseSGF(await response.text());
      if (token !== generation || disposed) return;
      kifu = next; game = gameFromKifu(kifu); move = 0; time = 0;
      connections.clear(); surfaces.clear(); slider.max = String(kifu.moves.length);
      show(Math.min(sourceSelect.value === 'cho' ? 150 : 90, kifu.moves.length));
      await babylon.ready(); renderBoth(time, false);
      document.body.dataset.ready = 'true'; status.textContent = '两侧已同步。可回放落子、检查根部近景，或运行串行采样。';
    } catch (error) { errorBox.textContent = String(error); }
    finally { if (token === generation) lock(false); }
  }
  const statistics = (values: number[]) => {
    const ordered = [...values].sort((a, b) => a - b);
    return { median: ordered[Math.floor(ordered.length / 2)], p95: ordered[Math.ceil(ordered.length * .95) - 1] };
  };
  async function benchmark() {
    stopAnimation(); show(move); lock(true, true); cancelled = false;
    const motion = workload.value === 'breathing';
    const samples: Record<string, { submit: number[]; complete: number[] }> = {
      three: { submit: [], complete: [] }, babylon: { submit: [], complete: [] },
    };
    const runners = { three: { gl: glThree, draw: renderThree }, babylon: { gl: glBabylon, draw: (t: number, m: boolean) => babylon.render(t, m) } };
    const pixel = new Uint8Array(4);
    const complete = (gl: WebGL2RenderingContext) => {
      gl.finish();
      // Force a synchronous result across the browser/GPU process boundary.
      // finish() alone can measure command submission on some browser stacks.
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    };
    try {
      for (let round = -8; round < 40; round++) {
        for (const name of (round % 2 === 0 ? ['three', 'babylon'] : ['babylon', 'three']) as ('three' | 'babylon')[]) {
          await frame();
          if (cancelled || document.hidden || disposed) throw new Error('采样已取消；不输出不完整结果。');
          const { gl, draw } = runners[name];
          if (gl.isContextLost()) throw new Error('图形上下文丢失，采样无效。');
          complete(gl);
          const before = performance.now();
          draw(time + (motion ? Math.max(round, 0) / 30 : 0), motion);
          const submitted = performance.now(); complete(gl); const completed = performance.now();
          if (round >= 0) {
            samples[name].submit.push(submitted - before);
            samples[name].complete.push(completed - before);
          }
        }
        status.textContent = round < 0 ? `预热 ${round + 9} / 8…` : `串行采样 ${round + 1} / 40；两侧交替先后顺序…`;
      }
      const rows = Object.entries(samples).map(([name, values]) => ({ name, submit: statistics(values.submit), complete: statistics(values.complete), samples: values }));
      const gpuInfo = (gl: WebGL2RenderingContext) => {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return { renderer: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)), attributes: gl.getContextAttributes(), samples: gl.getParameter(gl.SAMPLES) };
      };
      report = { schema: 1, date: new Date().toISOString(), userAgent: navigator.userAgent, threeVersion: THREE.REVISION,
        comparison: engineComparison ? 'engines' : 'surface-before-after', variants: names,
        rightVersion: babylon.version, game: sourceSelect.value, move, board: game.board, pixels: threeCanvas.width, view: zoom.value,
        workload: workload.value, warmupPerEngine: 8, sampleCountPerEngine: 40, order: 'alternating AB/BA, serial, one RAF per sample',
        metric: 'CPU submission and CPU wall-clock through gl.finish + synchronous 1px readPixels; includes readback/process synchronization, not GPU timer or FPS; excludes model update/upload; preserveDrawingBuffer enabled on both engines',
        scope: 'shared production surface and board; no cast shadows, furniture, influence or UI hints',
        contexts: { three: gpuInfo(glThree), babylon: gpuInfo(glBabylon) }, rows };
      el('results').innerHTML = rows.map(row => `<tr><td>${names[row.name as keyof typeof names]}</td><td>${row.submit.median.toFixed(2)} ms</td><td>${row.complete.median.toFixed(2)} / ${row.complete.p95.toFixed(2)} ms</td><td>40</td></tr>`).join('');
      status.textContent = '采样完成。结果仅适用于当前设备、浏览器、局面及显示尺寸；可下载原始样本。';
      document.body.dataset.benchmark = 'complete';
    } catch (error) { status.textContent = String(error); }
    finally { lock(false); renderBoth(time, false); }
  }
  el('prev').onclick = () => show(move - 1, true);
  el('next').onclick = () => show(move + 1, true);
  slider.oninput = () => show(Number(slider.value));
  sourceSelect.onchange = () => { void load(); };
  zoom.onchange = () => { clearReport(); setCamera(); renderBoth(time, false); };
  pixels.onchange = resize;
  workload.onchange = clearReport;
  el('rapid').onclick = async () => {
    if (move === kifu.moves.length) return;
    const original = move; lock(true); show(original + 1, true);
    // Keep this short reversal on the same displayed timeline as the shader.
    await new Promise(resolve => setTimeout(resolve, 120));
    time = animationBase + Math.min(.8, (performance.now() - animationStart) / 1000);
    lock(false); show(original, true);
  };
  el('benchmark').onclick = () => { void benchmark(); };
  el('cancel').onclick = () => { cancelled = true; };
  el('download').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `yiyigo-render-${sourceSelect.value}-${move}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelled = true; stopAnimation(); }
    else if (!busy) show(move);
  });
  for (const canvas of [threeCanvas, babylonCanvas]) canvas.addEventListener('webglcontextlost', () => {
    cancelled = true; stopAnimation(); errorBox.textContent = '图形上下文已丢失，请重新加载对比页。';
  });
  const observer = new IntersectionObserver(([entry]) => {
    inViewport = entry.isIntersecting;
    if (!inViewport) stopAnimation();
    else if (!busy && document.body.dataset.animating === 'true') {
      animationFrame = requestAnimationFrame(tick);
    }
  });
  observer.observe(document.querySelector('main')!);
  const sizeObserver = new ResizeObserver(() => { if (!busy && pixels.value === 'auto') resize(); });
  sizeObserver.observe(threeCanvas);
  window.addEventListener('pagehide', () => {
    disposed = true; cancelled = true; generation++; stopAnimation();
    observer.disconnect();
    sizeObserver.disconnect(); reference.material.dispose(); reference.depth.dispose();
    babylon.dispose(); live.dispose(); groundGeometry.dispose(); boardMaterial.dispose(); boardTexture.dispose(); renderer.dispose();
  }, { once: true });
  setCamera(); resize(); await load();
}
start().catch(error => { errorBox.textContent = String(error); status.textContent = '初始化失败。'; });
