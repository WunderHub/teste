/** Baked once per battle: textured earth, soft vegetation patches and weathered tracks. */
export function paintGround(ctx: CanvasRenderingContext2D, width: number, height: number) {
  let seed = 23761;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const area = width * height / 3300000;
  ctx.fillStyle = '#42483a'; ctx.fillRect(0, 0, width, height);
  // Gradients avoid the flat, visibly repeated ellipses of the first blockout.
  for (let i = 0; i < 150 * area; i++) {
    const x = random() * width, y = random() * height, r = 60 + random() * 220;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, i % 3 ? 'rgba(124,115,76,.19)' : 'rgba(23,44,34,.36)');
    gradient.addColorStop(1, 'rgba(60,70,48,0)');
    ctx.fillStyle = gradient; ctx.fillRect(x-r, y-r, r*2, r*2);
  }
  const sx = width / 2200, sy = height / 1500;
  const road = () => { ctx.beginPath(); ctx.moveTo(-40, height * .82); ctx.bezierCurveTo(440*sx,900*sy,610*sx,1030*sy,960*sx,780*sy); ctx.bezierCurveTo(1320*sx,530*sy,1500*sx,740*sy,width+50,height*.3); };
  ctx.lineCap = 'round';
  for (let w=132;w>=48;w-=12) { ctx.lineWidth=w;ctx.strokeStyle='rgba(137,121,82,.035)';road();ctx.stroke(); }
  ctx.save(); ctx.translate(0, 17); ctx.lineWidth=2;ctx.strokeStyle='rgba(37,39,27,.22)'; road();ctx.stroke();ctx.restore();
  ctx.save(); ctx.translate(0, -17); ctx.lineWidth=3;road();ctx.stroke();ctx.restore();
  // Small seamless grain is cheap to repeat across a large, zoomable battlefield.
  const grain = document.createElement('canvas'); grain.width=256; grain.height=256;
  const gc = grain.getContext('2d')!, pixels=gc.createImageData(256,256);
  for(let i=0;i<pixels.data.length;i+=4) { const light=random()>.52;pixels.data[i]=light?207:14;pixels.data[i+1]=light?198:24;pixels.data[i+2]=light?158:19;pixels.data[i+3]=Math.floor(random()*28); }
  gc.putImageData(pixels,0,0);ctx.fillStyle=ctx.createPattern(grain,'repeat')!;ctx.fillRect(0,0,width,height);
  for(let i=0;i<4200*area;i++) {
    const x=random()*width,y=random()*height,h=2+random()*10;
    ctx.strokeStyle=i%4===0?'rgba(174,164,112,.3)':'rgba(26,44,30,.32)';ctx.lineWidth=.65+random()*.5;
    ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(x-3,y-h*.65,x-5,y-h);
    ctx.moveTo(x,y);ctx.quadraticCurveTo(x+1,y-h*.5,x+3,y-h*1.2);
    ctx.moveTo(x,y);ctx.lineTo(x+5,y-h*.45);ctx.stroke();
  }
  for(let i=0;i<1700*area;i++) {
    const x=random()*width,y=random()*height,r=.5+random()*2.8;
    ctx.fillStyle='rgba(19,29,21,.28)';ctx.beginPath();ctx.ellipse(x+1,y+1,r*1.4,r*.65,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=i%3?'rgba(175,173,143,.3)':'rgba(82,87,64,.7)';ctx.beginPath();ctx.moveTo(x-r,y);ctx.lineTo(x,y-r*.7);ctx.lineTo(x+r,y-.2);ctx.lineTo(x+r*.5,y+r*.4);ctx.closePath();ctx.fill();
  }
  const shade=ctx.createRadialGradient(width*.45,height*.4,width*.1,width*.5,height*.5,Math.max(width,height)*.7);
  shade.addColorStop(0,'rgba(8,20,17,0)');shade.addColorStop(1,'rgba(8,20,17,.42)');ctx.fillStyle=shade;ctx.fillRect(0,0,width,height);
}
