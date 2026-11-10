export interface PointDisplayRange { start: number; count: number; spacing: number }

export function displaySpacing(count: number, ranges?: PointDisplayRange[]): Float32Array | null {
  if (!ranges?.length) return null;
  let end=0;
  for (const r of ranges) {
    if (!Number.isInteger(r.start) || !Number.isInteger(r.count) || r.start!==end || r.count<=0 || !Number.isFinite(r.spacing) || r.spacing<=0 || r.spacing>10) return null;
    end+=r.count;
  }
  if(end!==count) return null; // A bad display hint must never hide real points.
  const values=new Float32Array(count);
  for(const r of ranges) values.fill(r.spacing,r.start,r.start+r.count);
  return values;
}

export function intensityLimits(attribute: {count:number;getX:(i:number)=>number} | undefined): [number,number] {
  if(!attribute) return [0,1];
  const values:number[]=[]; const step=Math.max(1,Math.ceil(attribute.count/12000));
  for(let i=0;i<attribute.count;i+=step) {const v=attribute.getX(i);if(Number.isFinite(v))values.push(v);}
  values.sort((a,b)=>a-b);
  if(!values.length)return [0,1];
  const low=values[Math.floor((values.length-1)*.02)],high=values[Math.floor((values.length-1)*.98)];
  return high>low ? [low,high] : [low-1,high+1];
}
