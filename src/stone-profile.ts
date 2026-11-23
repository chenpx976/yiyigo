// Rounded stone bodies stay fixed; the shared field blends attached material
// beneath their crowns without overlapping surface shells.
export const stoneProfile = Object.freeze({ radius: .455, height: .35 });
export function ellipsoidDistance(x:number,y:number,z:number,rx:number,ry:number,rz:number) {
 const k0=Math.hypot(x/rx,y/ry,z/rz);
 if(k0<1e-6)return -Math.min(rx,ry,rz);
 return k0*(k0-1)/Math.hypot(x/(rx*rx),y/(ry*ry),z/(rz*rz));
}
