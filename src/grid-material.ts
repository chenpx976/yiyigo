import * as THREE from 'three';

// Grid lines are evaluated at the actual framebuffer resolution instead of
// filtering a raster line through a canvas texture, mipmaps and the viewport.
export const gridLineGLSL = `
float gridLineCoverage(vec2 p,float size){
 float spacing=660./(size-1.);
 vec2 nearest=abs(mod(p-50.+spacing*.5,spacing)-spacing*.5);
 float rectangle=max(max(50.-p.x,p.x-710.),max(50.-p.y,p.y-710.));
 float distance=max(min(nearest.x,nearest.y)-.45,rectangle-.45);
 float footprint=max(max(fwidth(p.x),fwidth(p.y)),.0001);
 return clamp(.5-distance/footprint,0.,1.);
}
`;

export function createGridMaterial(labels: THREE.Texture, n: number) {
  return new THREE.ShaderMaterial({
    uniforms: { labels: { value: labels }, boardSize: { value: n }, gridColor: { value: new THREE.Color(0x5c452b) } },
    vertexShader: 'varying vec2 vUV; void main(){vUV=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec2 vUV; uniform sampler2D labels; uniform float boardSize; uniform vec3 gridColor;
    ${gridLineGLSL}
    void main(){
     vec4 label=texture2D(labels,vUV);
     float grid=gridLineCoverage(vUV*760.,boardSize)*.72;
     float alpha=label.a+grid*(1.-label.a);
     vec3 color=(label.rgb*label.a+gridColor*grid*(1.-label.a))/max(alpha,.00001);
     gl_FragColor=vec4(color,alpha);
     #include <tonemapping_fragment>
     #include <colorspace_fragment>
    }`,
    transparent: true, depthWrite: false,
  });
}
