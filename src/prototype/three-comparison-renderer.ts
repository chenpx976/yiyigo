import * as THREE from 'three';
import type { ModelSurface } from '../living-stones';

// The same current production material and packed data, in a separate GL
// context. A/B therefore compares algorithms without changing engines.
export class ThreeComparisonRenderer {
  readonly engine: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera();
  private source: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private board: THREE.Mesh;
  private submits = 0;
  constructor(canvas: HTMLCanvasElement, live: ModelSurface, board: THREE.Mesh) {
    this.engine = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, stencil: false, powerPreference: 'low-power' });
    this.engine.setPixelRatio(1);
    this.engine.setClearColor('#142624');
    this.engine.toneMapping = THREE.ACESFilmicToneMapping;
    this.source = live.mesh.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    const copy = new THREE.Mesh(this.source.geometry, this.source.material);
    copy.frustumCulled = false; copy.renderOrder = 2;
    this.board = board.clone();
    this.scene.add(this.board, copy);
  }
  update(_source: ModelSurface) { /* Shared CPU buffers; each context uploads its own version. */ }
  setCamera(camera: THREE.OrthographicCamera) { this.camera.copy(camera); this.camera.updateMatrixWorld(); }
  setSize(size: number) { this.engine.setSize(size, size, false); }
  render(time: number, motion: boolean) {
    this.source.material.uniforms.uTime.value = time;
    this.source.material.uniforms.uMotion.value = Number(motion);
    this.engine.render(this.scene, this.camera); this.submits++;
  }
  get draws() { return this.submits; }
  get version() { return THREE.REVISION; }
  async ready() { await this.engine.compileAsync(this.scene, this.camera); }
  dispose() { this.engine.dispose(); } // Data/materials are owned by the source.
}
