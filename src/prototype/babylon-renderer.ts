import * as THREE from 'three';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Constants } from '@babylonjs/core/Engines/constants';
import '@babylonjs/core/Engines/Extensions/engine.rawTexture';
import type { ModelSurface } from '../living-stones';
import { gridLineGLSL } from '../grid-material';

// A diagnostic adapter deliberately consumes the production CPU buffers and
// shader, rather than maintaining a second definition of the stone geometry.
// Three.js remains a CPU-side dependency here; only Babylon submits this view.
export class BabylonBoardRenderer {
  readonly engine: Engine;
  readonly scene: Scene;
  private mesh: Mesh;
  private material: ShaderMaterial;
  private textures = new Map<string, { texture: RawTexture; height: number }>();
  private boardTexture: RawTexture;
  private boardMaterial: ShaderMaterial;
  private submits = 0;
  private bufferLengths = new Map<string, number>();
  constructor(readonly canvas: HTMLCanvasElement, source: ModelSurface, board: Uint8Array, boardSize: number) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false, powerPreference: 'low-power' }, false);
    if (this.engine.webGLVersion !== 2) throw new Error('对比实验需要 WebGL2。');
    this.scene = new Scene(this.engine);
    this.scene.useRightHandedSystem = true;
    this.scene.clearColor = new Color4(0.078, 0.149, 0.141, 1);
    this.scene.activeCamera = new FreeCamera('diagnostic-camera', new Vector3(380, -380, 1000), this.scene);
    const original = (source.mesh.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>).material;
    const fragment = original.fragmentShader
      .replace('#include <packing>', '')
      .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb=ACESFilmicToneMapping(gl_FragColor.rgb);')
      .replace('#include <colorspace_fragment>', 'gl_FragColor=sRGBTransferOETF(gl_FragColor);');
    this.material = new ShaderMaterial('production-field', this.scene, {
      vertexSource: 'precision highp float; attribute vec3 position; uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;\n' + original.vertexShader,
      fragmentSource: 'precision highp float; uniform mat4 viewMatrix;\n' + THREE.ShaderChunk.tonemapping_pars_fragment + THREE.ShaderChunk.colorspace_pars_fragment + fragment,
    }, {
      attributes: ['position', 'aPoint', 'aRange'],
      uniforms: ['modelViewMatrix', 'projectionMatrix', 'viewMatrix', 'uTime', 'uMotion', 'uSpacing', 'uBlack', 'uWhite', 'uRay', 'toneMappingExposure'],
      samplers: ['uData', 'uCrossings'],
    });
    this.material.backFaceCulling = false;
    this.material.setFloat('toneMappingExposure', 1);
    this.material.setVector3('uRay', new Vector3(0, 0, -1));
    for (const name of ['uBlack', 'uWhite']) {
      const color = original.uniforms[name].value as THREE.Color;
      this.material.setVector3(name, new Vector3(color.r, color.g, color.b));
    }
    this.mesh = new Mesh('shared-surface', this.scene);
    this.mesh.material = this.material;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.renderingGroupId = 1;
    this.scene.setRenderingAutoClearDepthStencil(1, false);
    this.boardTexture = RawTexture.CreateRGBATexture(board, boardSize, boardSize, this.scene, false, false, Constants.TEXTURE_BILINEAR_SAMPLINGMODE);
    this.boardMaterial = new ShaderMaterial('board-material', this.scene, {
      vertexSource: 'precision highp float; attribute vec3 position; attribute vec2 uv; uniform mat4 uVP; varying vec2 vUV; void main(){vUV=uv;gl_Position=uVP*vec4(position,1.);}',
      fragmentSource: `precision highp float; varying vec2 vUV; uniform sampler2D board; ${gridLineGLSL} void main(){vec4 wood=texture2D(board,vUV);gl_FragColor=vec4(mix(wood.rgb,vec3(.37647,.29020,.18039),gridLineCoverage(vUV*720.+20.,19.)),1.);}`,
    }, { attributes: ['position', 'uv'], uniforms: ['uVP'], samplers: ['board'] });
    this.boardMaterial.backFaceCulling = false;
    this.boardMaterial.setTexture('board', this.boardTexture);
    const ground = new Mesh('board', this.scene);
    ground.setVerticesData('position', [20,-20,-.1, 740,-20,-.1, 20,-740,-.1, 740,-740,-.1]);
    ground.setVerticesData('uv', [0,0, 1,0, 0,1, 1,1]);
    ground.setIndices([0,2,1, 1,2,3]);
    ground.material = this.boardMaterial;
    ground.alwaysSelectAsActiveMesh = true;
    this.update(source);
  }
  update(source: ModelSurface) {
    const mesh = source.mesh.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    const count = mesh.geometry.drawRange.count;
    const vertexCount = count / 6 * 4;
    for (const [name, size] of [['position', 3], ['aPoint', 2], ['aRange', 2]] as const) {
      const values = mesh.geometry.getAttribute(name).array.slice(0, vertexCount * size) as Float32Array;
      if (this.mesh.isVerticesDataPresent(name) && this.bufferLengths.get(name) === values.length)
        this.mesh.updateVerticesData(name, values, false, false);
      else this.mesh.setVerticesData(name, values, true, size);
      this.bufferLengths.set(name, values.length);
    }
    this.mesh.setIndices(Array.from(mesh.geometry.index!.array.slice(0, count)), vertexCount);
    this.mesh.setEnabled(count > 0);
    for (const name of ['uData', 'uCrossings']) {
      const data = mesh.material.uniforms[name].value as THREE.DataTexture;
      let entry = this.textures.get(name);
      if (!entry || entry.height !== data.image.height) {
        entry?.texture.dispose();
        entry = { height: data.image.height, texture: RawTexture.CreateRGBATexture(data.image.data as Float32Array, 1024, data.image.height, this.scene, false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT) };
        this.textures.set(name, entry);
        this.material.setTexture(name, entry.texture);
      } else entry.texture.update(data.image.data as Float32Array);
    }
    this.material.setFloat('uSpacing', mesh.material.uniforms.uSpacing.value);
  }
  setCamera(camera: THREE.OrthographicCamera) {
    camera.updateMatrixWorld();
    this.material.setMatrix('modelViewMatrix', Matrix.FromArray(camera.matrixWorldInverse.elements));
    this.material.setMatrix('viewMatrix', Matrix.FromArray(camera.matrixWorldInverse.elements));
    this.material.setMatrix('projectionMatrix', Matrix.FromArray(camera.projectionMatrix.elements));
    const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.boardMaterial.setMatrix('uVP', Matrix.FromArray(vp.elements));
  }
  render(time: number, motion: boolean) {
    this.material.setFloat('uTime', time);
    this.material.setFloat('uMotion', motion ? 1 : 0);
    this.scene.render();
    this.submits++;
  }
  get draws() { return this.submits; }
  setSize(size: number) { this.engine.setSize(size, size, true); }
  get version() { return Engine.Version; }
  async ready() { await this.scene.whenReadyAsync(); }
  dispose() {
    for (const { texture } of this.textures.values()) texture.dispose();
    this.boardTexture.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}
