import { createCanvas } from '@napi-rs/canvas';
export async function renderArrows():Promise<string[]> {
  const base=createCanvas(144,144),ctx=base.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(62,52,20,60);ctx.beginPath();ctx.moveTo(72,16);ctx.lineTo(32,64);ctx.lineTo(112,64);ctx.closePath();ctx.fill();
  const out:string[]=[];
  for(let k=0;k<8;k++){const c=createCanvas(144,144),g=c.getContext('2d');g.save();g.translate(72,72);g.rotate(k*Math.PI/4);g.drawImage(base, -72,-72);g.restore();out.push((await c.encode('png')).toString('base64'));}
  return out;
}
export async function renderOfflineMap():Promise<[string,string]> {
  const c=createCanvas(288,288),ctx=c.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,288,288);ctx.strokeStyle='#202020';ctx.lineWidth=1;
  for(let p=0;p<=288;p+=30){ctx.beginPath();ctx.moveTo(p,0);ctx.lineTo(p,288);ctx.stroke();ctx.beginPath();ctx.moveTo(0,p);ctx.lineTo(288,p);ctx.stroke();}
  const half=async(y:number)=>{const h=createCanvas(288,144);h.getContext('2d').drawImage(c,0,y,288,144,0,0,288,144);return(await h.encode('png')).toString('base64');};
  return [await half(0),await half(144)];
}
