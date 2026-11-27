import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Go, analyzeMove } from "./engine";
import type { Cell } from "./engine";
import { coord, geography, groups } from "./position";
import { createInfluenceSurface } from "./influence-surface";
import { createLivingSurface } from "./living-stones";
import type { LivingSurface } from "./living-stones";
import { createTableScene, disposeObject } from "./table-scene";
import { cameraCos, cameraSin, sceneWidth, sceneHeight } from "./board-camera";
import { connectionDuration, type ConnectionState } from "./connection-state";
import { morphDuration, type SurfaceTransition } from "./surface-transition";
import { createGridMaterial } from './grid-material';
export class BoardView {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(
    -sceneWidth / 2,
    sceneWidth / 2,
    sceneHeight / 2,
    -sceneHeight / 2,
    1,
    4000,
  );
  private fixed = new THREE.Group();
  private marks = new THREE.Group();
  private hints = new THREE.Group();
  private fixedTextures: THREE.Texture[] = [];
  private markTextures: THREE.Texture[] = [];
  private environment!: THREE.WebGLRenderTarget;
  private furniture!: ReturnType<typeof createTableScene>;
  private live: LivingSurface | null = null;
  private field = createInfluenceSurface();
  private surfaceFocus = -1;
  private connections = new Map<string, ConnectionState>();
  private surfaces = new Map<string, SurfaceTransition>();
  private game = new Go();
  private previous: Cell[] = [];
  private selected = -1;
  private interactive = true;
  private size = 0;
  private clock = 0;
  private observer!: ResizeObserver;
  private viewportObserver!: IntersectionObserver;
  private inViewport = true;
  private frame = 0;
  private resizeFrame = 0;
  private displayWidth = 0;
  private displayRatio = 0;
  private lastTime = 0;
  private animateUntil = 0;
  private breatheUntil = 0;
  private retireAt = Infinity;
  private breathing = false;
  private disposed = false;
  private hitLayer = document.createElement("div");
  private buttons: HTMLButtonElement[] = [];
  private focusIndex = 0;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)");
  private motionHandler = () => {
    this.connections.clear();
    this.surfaces.clear();
    this.render(this.game, this.selected, false, this.interactive);
  };
  private visibilityHandler = () => {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lastTime = 0;
    if (!document.hidden) {
      this.breatheUntil = performance.now() + 3000;
      this.draw();
    }
  };
  constructor(
    private host: HTMLElement,
    private onPlay: (i: number) => void,
    private onInspect: (i: number) => void,
  ) {}
  async init() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    });
    this.renderer.setClearColor(0, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.host.append(this.renderer.domElement);
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(380, -380 - cameraSin * 1500, cameraCos * 1500);
    this.camera.lookAt(380, -380, 0);
    const pmrem = new THREE.PMREMGenerator(this.renderer),
      room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.15;
    room.dispose();
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xfff9ef, 0x626d68, 0.30));
    const key = new THREE.DirectionalLight(0xfffaf2, 1.9);
    key.position.set(-150, 100, 1100);
    key.target.position.set(380, -380, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, {
      left: -750,
      right: 750,
      top: 750,
      bottom: -750,
      near: 100,
      far: 2400,
    });
    key.shadow.bias = -0.00015;
    key.shadow.normalBias = 0.12;
    key.shadow.radius = 3;
    this.scene.add(key, key.target);
    const fill = new THREE.DirectionalLight(0xe6efff, 0.2);
    fill.position.set(1100, -900, 700);
    this.scene.add(fill);
    this.furniture = createTableScene();
    this.scene.add(this.furniture.scene, this.field.mesh, this.fixed, this.marks, this.hints);
    this.hitLayer.className = "board-hits";
    this.hitLayer.setAttribute("role", "group");
    this.hitLayer.setAttribute("aria-label", "围棋棋盘");
    this.host.append(this.hitLayer);
    this.observer = new ResizeObserver(() => {
      const w = Math.max(1, this.host.clientWidth);
      const h = w * sceneHeight / sceneWidth;
      // Respect native density, with bounded work on Retina and large displays.
      const ratio = Math.min(1.5, devicePixelRatio || 1, Math.sqrt(1_500_000 / (w * h)));
      if (w === this.displayWidth && ratio === this.displayRatio) return;
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = requestAnimationFrame(() => {
        this.resizeFrame = 0;
        if (this.disposed) return;
        this.displayWidth = w;
        this.displayRatio = ratio;
        this.renderer.setPixelRatio(ratio);
        this.renderer.setSize(w, h);
        this.host.dataset.renderScale = ratio.toFixed(2);
        this.buildHits();
        this.draw();
      });
    });
    this.observer.observe(this.host);
    this.viewportObserver = new IntersectionObserver(([entry]) => {
      this.inViewport = entry.isIntersecting;
      if (this.inViewport) {
        this.breatheUntil = performance.now() + 3000;
        this.draw();
      }
      else {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.lastTime = 0;
      }
    });
    this.viewportObserver.observe(this.host);
    this.reduced.addEventListener("change", this.motionHandler);
    document.addEventListener("visibilitychange", this.visibilityHandler);
  }
  private needsAnimation() {
    return (this.breathing && performance.now() < this.breatheUntil) || this.clock < this.animateUntil ||
      (this.field.mesh.visible && this.field.isAnimating(this.clock));
  }
  private scheduleFrame() {
    if (this.disposed || document.hidden || !this.inViewport || this.reduced.matches || !this.needsAnimation()) {
      this.lastTime = 0;
      return;
    }
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }
  private tick = (now: number) => {
    this.frame = 0;
    if (this.disposed || document.hidden || !this.inViewport || this.reduced.matches || !this.needsAnimation()) {
      this.lastTime = 0;
      return;
    }
    const transitioning = this.clock < this.animateUntil || this.field.isAnimating(this.clock);
    const interval = transitioning ? 1000 / 30 : 1000 / 12;
    if (this.lastTime && now - this.lastTime < interval) {
      this.scheduleFrame();
      return;
    }
    const dt = this.lastTime ? Math.min(0.1, (now - this.lastTime) / 1000) : 0;
    this.lastTime = now;
    this.clock += dt;
    // Slow, subpixel neck breathing reuses the settled shadow. Geometry
    // transitions still refresh it through their final frame.
    if (this.clock - dt < this.animateUntil) this.renderer.shadowMap.needsUpdate = true;
    if (this.clock >= this.retireAt)
      this.rebuildSurface(this.previous, false, this.surfaceFocus);
    this.live?.setTime(this.clock);
    this.field.setTime(this.clock);
    this.draw();
  };
  private draw() {
    if (this.renderer && !this.disposed && !document.hidden && this.inViewport)
      this.renderer.render(this.scene, this.camera);
    this.scheduleFrame();
  }
  private point(i: number): [number, number] {
    const s = 660 / (this.game.n - 1);
    return [50 + (i % this.game.n) * s, 50 + Math.floor(i / this.game.n) * s];
  }
  private project(x: number, y: number, z = 0) {
    const p = new THREE.Vector3(x, -y, z).project(this.camera);
    return [(p.x + 1) / 2, (1 - p.y) / 2];
  }
  private clear(group: THREE.Group) {
    for (const child of [...group.children]) disposeObject(child);
  }
  private disk(
    x: number,
    y: number,
    r: number,
    color: number,
    group = this.marks,
    z = 0.8,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(r, 24),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    mesh.position.set(x, -y, z);
    group.add(mesh);
    return mesh;
  }
  private line(points: number[][], color: number, group = this.hints, z = 1) {
    const geometry = new THREE.BufferGeometry().setFromPoints(
      points.map(([x, y]) => new THREE.Vector3(x, -y, z)),
    );
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 }),
    );
    group.add(line);
  }
  private label(
    text: string,
    x: number,
    y: number,
    z: number,
    color: string,
    size: number,
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.font = "600 78px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.fillText(text, 64, 67);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.markTextures.push(texture);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        depthWrite: false,
        depthTest: false,
      }),
    );
    sprite.position.set(x, -y, z);
    sprite.scale.set(size, size, 1);
    sprite.renderOrder = 4;
    this.marks.add(sprite);
  }
  private rebuildGrid() {
    this.clear(this.fixed);
    this.fixedTextures.forEach((t) => t.dispose());
    this.fixedTextures = [];
    const n = this.game.n,
      s = 660 / (n - 1),
      canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2048;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(2048 / 760, 2048 / 760);
    ctx.fillStyle = "#796141";
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < n; i++) {
      ctx.fillText("ABCDEFGHJKLMNOPQRST"[i], 50 + i * s, 27);
      ctx.fillText(String(n - i), 25, 50 + i * s);
    }
    const stars = n === 9 ? [2, 4, 6] : n === 13 ? [3, 6, 9] : [3, 9, 15];
    for (const x of stars)
      for (const y of stars)
        if (n === 19 || x === y || x + y === n - 1) {
          ctx.beginPath();
          ctx.arc(50 + x * s, 50 + y * s, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    this.fixedTextures.push(texture);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(760, 760),
      createGridMaterial(texture, n),
    );
    mesh.position.set(380, -380, 0.4);
    mesh.renderOrder = 1;
    this.fixed.add(mesh);
    this.size = n;
  }
  private focusedGroup(i: number) {
    return this.game.board[i] ? Math.min(...this.game.group(i).stones) : -1;
  }
  private rebuildSurface(previous: Cell[], animate: boolean, focus: number) {
    this.surfaceFocus = focus;
    if (this.renderer) this.renderer.shadowMap.needsUpdate = true;
    if (this.live) {
      this.live.update(this.game, previous, animate, this.clock, !this.reduced.matches, focus);
    } else {
      this.live = createLivingSurface(
        this.game, previous, animate, this.clock, !this.reduced.matches,
        this.connections, this.surfaces, focus,
      );
      this.scene.add(this.live.mesh);
    }
    this.animateUntil = this.clock;
    this.retireAt = Infinity;
    this.breathing = false;
    for (const state of this.surfaces.values()) {
      const end = state.start + morphDuration;
      if (state.from !== state.to) this.animateUntil = Math.max(this.animateUntil, end);
      if (state.to === 0) this.retireAt = Math.min(this.retireAt, end);
    }
    for (const state of this.connections.values()) {
      const end = state.start + connectionDuration;
      const fromVisibility = state.fromVisibility ?? Number(state.from[0] > 0);
      const toVisibility = state.toVisibility ?? Number(state.to[0] > 0);
      if (fromVisibility !== toVisibility || state.from.some((value, i) => value !== state.to[i]) ||
        (state.cutFrom ?? state.cut) !== state.cut)
        this.animateUntil = Math.max(this.animateUntil, end);
      if (state.to[0] === 0) this.retireAt = Math.min(this.retireAt, end);
      if (toVisibility > 0 && state.to[0] > 0 &&
        this.game.board[state.link.i] === state.link.color &&
        this.game.board[state.link.j] === state.link.color)
        this.breathing = true;
    }
    this.animateUntil = Math.max(this.animateUntil, Number.isFinite(this.retireAt) ? this.retireAt : 0);
  }
  render(game: Go, selected = -1, animate = false, interactive = true) {
    this.breatheUntil = performance.now() + 3000;
    const start = performance.now(),
      same = this.game.n === game.n,
      old = this.previous;
    // Board dimensions invalidate indexed transitions. For the same size,
    // surfaceModel owns reset/retarget/sample semantics, including a seek
    // while another animation is running and reduced-motion changes.
    if (!same) {
      this.connections.clear();
      this.surfaces.clear();
    }
    this.game = game;
    this.selected = selected;
    this.interactive = interactive;
    if (this.size !== game.n) this.rebuildGrid();
    this.clear(this.marks);
    this.clear(this.hints);
    this.markTextures.forEach((t) => t.dispose());
    this.markTextures = [];
    this.rebuildSurface(same ? old : [], animate && same, this.focusedGroup(selected));
    this.field.update(game, this.clock, animate && same, !this.reduced.matches);
    const s = 660 / (game.n - 1),
      chains = groups(game),
      liberties = new Map<number, Set<number>>();
    for (const chain of chains)
      for (const p of chain.liberties) {
        const colors = liberties.get(p) || new Set();
        colors.add(chain.color);
        liberties.set(p, colors);
      }
    for (const [p, colors] of liberties) {
      const [x, y] = this.point(p);
      this.disk(
        x,
        y,
        s * 0.045,
        colors.size === 2 ? 0xb68d52 : colors.has(1) ? 0x41816b : 0xf4f0d7,
      );
    }
    for (const chain of chains) {
      const [x, y] = this.point(chain.anchor);
      this.label(
        String(chain.liberties.size),
        x,
        y,
        s * 0.3 + 1,
        chain.liberties.size === 1
          ? "#b75b32"
          : chain.color === 1
            ? "#d0dbd3"
            : "#4e5b50",
        Math.max(12, s * 0.27),
      );
      if (chain.liberties.size === 1) {
        const [lx, ly] = this.point([...chain.liberties][0]),
          r = s * 0.13;
        this.line(
          [
            [lx, ly - r],
            [lx + r, ly],
            [lx, ly + r],
            [lx - r, ly],
            [lx, ly - r],
          ],
          0xb76c42,
          this.marks,
          1,
        );
      }
    }
    const last = game.history.at(-1)?.move;
    if (last != null && game.board[last]) {
      const [x, y] = this.point(last);
      this.disk(
        x + s * 0.17,
        y + s * 0.15,
        s * 0.028,
        0xc7a16a,
        this.marks,
        s * 0.24,
      );
    }
    this.previous = game.board.slice();
    this.buildHits();
    if (selected >= 0) this.focus(selected);
    this.draw();
    this.host.dataset.renderer = "three-webgl-pbr";
    this.host.dataset.stoneCount = String(game.board.filter(Boolean).length);
    this.host.dataset.renderMs = (performance.now() - start).toFixed(1);
  }
  setInfluenceVisible(visible: boolean) {
    this.field.mesh.visible = visible;
    this.draw();
  }
  focus(i: number) {
    const focus = this.focusedGroup(i);
    this.breatheUntil = performance.now() + 3000;
    if (focus !== this.surfaceFocus) this.rebuildSurface(this.previous, false, focus);
    this.clear(this.hints);
    if (i < 0) {
      this.draw();
      return;
    }
    const s = 660 / (this.game.n - 1),
      [x, y] = this.point(i),
      geo = geography(i, this.game.n);
    const lo = (v: number) => Math.max(50, v - s * 1.6),
      hi = (v: number) => Math.min(710, v + s * 1.6);
    for (const edge of geo.edges) {
      if (edge === "left" || edge === "right") {
        const a = edge === "left" ? 50 : 710;
        this.line(
          [
            [a, lo(y)],
            [a, hi(y)],
          ],
          0xbc9654,
        );
      } else {
        const b = edge === "top" ? 50 : 710;
        this.line(
          [
            [lo(x), b],
            [hi(x), b],
          ],
          0xbc9654,
        );
      }
    }
    if (this.game.board[i]) {
      for (const p of this.game.group(i).liberties) {
        const [a, b] = this.point(p);
        this.disk(a, b, s * 0.085, 0x459879, this.hints);
      }
    } else if (this.interactive && !this.game.ended) {
      const result = analyzeMove(this.game, i),
        ghost = new THREE.Mesh(
          new THREE.SphereGeometry(s * 0.425, 24, 16),
          new THREE.MeshStandardMaterial({
            color: this.game.turn === 1 ? 0x20282c : 0xe9e9e3,
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
            roughness: 0.34,
          }),
        );
      ghost.scale.z = 0.33;
      ghost.position.set(x, -y, s * 0.14);
      this.hints.add(ghost);
      if (result.error)
        this.line(
          [
            [x - 6, y - 6],
            [x + 6, y + 6],
          ],
          0xb35b49,
        );
      for (const p of result.captured) {
        const [a, b] = this.point(p);
        this.line(
          [
            [a - s * 0.12, b - s * 0.12],
            [a + s * 0.12, b + s * 0.12],
          ],
          0xb35b49,
          this.hints,
          s * 0.3,
        );
        this.line(
          [
            [a - s * 0.12, b + s * 0.12],
            [a + s * 0.12, b - s * 0.12],
          ],
          0xb35b49,
          this.hints,
          s * 0.3,
        );
      }
      for (const p of result.atari)
        for (const q of this.game.group(p).liberties)
          if (q !== i) {
            const [a, b] = this.point(q);
            this.disk(a, b, s * 0.075, 0xb76c42, this.hints);
          }
    }
    this.draw();
  }
  private buildHits() {
    const n = this.game.n,
      s = 660 / (n - 1),
      hadFocus = this.hitLayer.contains(document.activeElement);
    if (this.buttons.length !== n * n) {
      this.hitLayer.replaceChildren();
      this.buttons = [];
      this.focusIndex = 0;
      for (let i = 0; i < n * n; i++) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "intersection";
        button.addEventListener("click", () => this.onPlay(i));
        button.addEventListener("pointerenter", (e) => {
          if (e.pointerType !== "touch") {
            this.focus(i);
            this.onInspect(i);
          }
        });
        button.addEventListener("pointerleave", (event) => {
          if (event.pointerType === "touch" ||
            (event.relatedTarget instanceof Node && this.hitLayer.contains(event.relatedTarget))) return;
          this.focus(this.selected);
        });
        button.addEventListener("focus", () => {
          this.focusIndex = i;
          this.focus(i);
          this.onInspect(i);
        });
        button.addEventListener("keydown", (e) => {
          const offsets: Record<string, number> = {
            ArrowLeft: -1,
            ArrowRight: 1,
            ArrowUp: -this.game.n,
            ArrowDown: this.game.n,
          };
          if (e.key in offsets) {
            e.preventDefault();
            const next = Math.max(
              0,
              Math.min(this.buttons.length - 1, i + offsets[e.key]),
            );
            this.buttons[i].tabIndex = -1;
            this.buttons[next].tabIndex = 0;
            this.buttons[next].focus();
          }
        });
        this.buttons.push(button);
        this.hitLayer.append(button);
      }
    }
    this.buttons.forEach((button, i) => {
      const [x, y] = this.point(i),
        [a, b] = this.project(x - s / 2, y - s / 2),
        [c, d] = this.project(x + s / 2, y + s / 2);
      Object.assign(button.style, {
        left: `${a * 100}%`,
        top: `${b * 100}%`,
        width: `${(c - a) * 100}%`,
        height: `${(d - b) * 100}%`,
      });
      button.tabIndex = i === this.focusIndex ? 0 : -1;
      button.setAttribute(
        "aria-label",
        `${coord(i, n)} ${this.game.board[i] === 1 ? "黑棋" : this.game.board[i] === 2 ? "白棋" : "空点"}`,
      );
    });
    if (hadFocus)
      this.buttons[Math.min(this.focusIndex, this.buttons.length - 1)].focus();
  }
  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.resizeFrame);
    this.observer.disconnect();
    this.viewportObserver.disconnect();
    this.reduced.removeEventListener("change", this.motionHandler);
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    this.hitLayer.remove();
    if (this.live) {
      this.scene.remove(this.live.mesh);
      this.live.dispose();
    }
    this.field.dispose();
    disposeObject(this.scene);
    this.fixedTextures.forEach((t) => t.dispose());
    this.markTextures.forEach((t) => t.dispose());
    this.furniture.textures.forEach((t) => t.dispose());
    this.environment.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
