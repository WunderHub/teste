import Phaser from 'phaser';
import { PIECES } from './pieces';
import { FIGURE_ANCHOR, FIGURE_ASPECT } from '../figures';
import './style.css';

/** Isolated art study: no BattleState, orders, AP, damage or persistence. */
const W = 1600, H = 1000, R = 63, DX = Math.sqrt(3) * R, DY = 1.5 * R * .72;
type Cell = { q: number; r: number };
type Piece = { key: string; x: number; y: number; height: number; cell?: Cell; image?: Phaser.GameObjects.Image };
type Pawn = { name: string; key: string; cell: Cell; start: Cell; image?: Phaser.GameObjects.Image; base?: Phaser.GameObjects.Graphics; shadow?: Phaser.GameObjects.Ellipse };
const at = (c: Cell) => ({ x: 367 + (c.q + (c.r & 1) * .5) * DX, y: 335 + c.r * DY });
const same = (a: Cell, b: Cell) => a.q === b.q && a.r === b.r;
const cells = Array.from({ length: 48 }, (_, i) => ({ q: i % 8, r: Math.floor(i / 8) }));
const neighbors = (c: Cell) => cells.filter(v => Math.hypot((at(v).x - at(c).x) / DX, (at(v).y - at(c).y) / DY) < 1.15 && !same(c, v));
const initial = [
  { name: 'Duarte', key: 'guerreiro-ally', q: 2, r: 3 },
  { name: 'Bento', key: 'guerreiro-escudo-ally', q: 1, r: 4 },
  { name: 'Nestor', key: 'arqueiro-ally', q: 1, r: 2 },
  { name: 'Saqueador', key: 'guerreiro-enemy', q: 5, r: 1 },
  { name: 'Vigia', key: 'arqueiro-enemy', q: 6, r: 3 },
  { name: 'Escudeiro', key: 'guerreiro-escudo-enemy', q: 4, r: 4 },
];
const landscapes: Piece[] = [
  {key:'arvore-1',x:289,y:350,height:322,cell:{q:0,r:0}},
  {key:'arvore-3',x:1330,y:374,height:322},
  {key:'arvore-2',x:1390,y:620,height:390},
  {key:'arvore-seca',x:188,y:646,height:290},
  {key:'arvore-2',x:220,y:1000,height:370},
  {key:'arvore-3',x:1270,y:1060,height:340},
  {key:'ruina-2',x:925,y:314,height:152,cell:{q:5,r:0}},
  {key:'ruina-1',x:1087,y:370,height:125,cell:{q:7,r:0}},
  {key:'ruina-3',x:1128,y:471,height:75,cell:{q:7,r:2}},
  {key:'rocha-1',x:399,y:472,height:124,cell:{q:0,r:2}},
  {key:'rocha-2',x:1190,y:639,height:106,cell:{q:7,r:4}},
  {key:'rocha-3',x:865,y:792,height:108},
  {key:'rocha-1',x:90,y:440,height:120},
  {key:'rocha-3',x:1440,y:810,height:130},
  {key:'tronco-1',x:558,y:298,height:83},
  {key:'tronco-2',x:415,y:811,height:85},
  {key:'toco',x:1172,y:305,height:64},
  {key:'arbusto-1',x:345,y:347,height:76},
  {key:'arbusto-2',x:452,y:336,height:58},
  {key:'arbusto-1',x:1010,y:292,height:68},
  {key:'arbusto-2',x:1214,y:457,height:73},
  {key:'arbusto-1',x:1147,y:734,height:74},
  {key:'arbusto-2',x:582,y:798,height:66},
  {key:'arbusto-1',x:719,y:799,height:46},
  {key:'capim-2',x:446,y:510,height:39},
  {key:'capim-1',x:1078,y:489,height:33},
  {key:'capim-2',x:974,y:772,height:41},
  {key:'capim-1',x:572,y:327,height:34},
  {key:'capim-2',x:394,y:738,height:38},
];

class Study extends Phaser.Scene {
  private mode: 'study' | 'base' = 'study';
  private gridOn = false;
  private zoomFactor = 1;
  private pawns: Pawn[] = initial.map(p => ({ ...p, cell: {q:p.q,r:p.r}, start: {q:p.q,r:p.r} }));
  private selected = 0;
  private scenery: Piece[] = landscapes.map(p => ({ ...p }));
  private ground!: Phaser.GameObjects.Image;
  private light!: Phaser.GameObjects.Image;
  private groundShadows!: Phaser.GameObjects.Image;
  private grid!: Phaser.GameObjects.Graphics;
  private path!: Phaser.GameObjects.Graphics;
  private hovered?: Cell;
  private alpha = new Map<string, { width: number; height: number; pixels: Uint8ClampedArray }>();
  private blocked = new Set(landscapes.flatMap(p => p.cell ? [`${p.cell.q},${p.cell.r}`] : []));
  preload() {
    for (const p of PIECES) this.load.image(p.key, `${import.meta.env.BASE_URL}assets/estudo/${p.key}.png`);
    for (const key of ['chao-grama','chao-terra','chao-pedras']) this.load.image(key, `${import.meta.env.BASE_URL}assets/estudo/${key}.jpg`);
    for (const key of new Set(initial.map(p => p.key))) this.load.image(key, `${import.meta.env.BASE_URL}assets/bustos/${key}.png`);
    this.load.on('loaderror', () => { document.getElementById('status')!.textContent = 'Não foi possível carregar parte do cenário. Recarregue a página.'; });
  }
  create() {
    this.makeGround();
    this.makeShadows();
    this.ground = this.add.image(0,0,'ground-study').setOrigin(0).setDepth(-10);
    this.groundShadows = this.add.image(0,0,'shadows').setOrigin(0).setDepth(-5);
    this.grid = this.add.graphics().setDepth(-2);
    this.path = this.add.graphics().setDepth(-1);
    for (const item of this.scenery) {
      const spec = PIECES.find(p => p.key === item.key)!;
      const p = item.cell ? at(item.cell) : item;
      item.x = p.x; item.y = p.y;
      item.image = this.add.image(p.x,p.y,item.key).setOrigin(spec.anchorX,spec.anchorY).setDisplaySize(item.height * spec.aspect,item.height).setDepth(p.y);
    }
    for (const p of this.pawns) {
      p.shadow = this.add.ellipse(0,0,88,25,0x111a15,.38).setDepth(-3);
      p.base = this.add.graphics();
      p.image = this.add.image(0,0,p.key).setOrigin(FIGURE_ANCHOR.x,FIGURE_ANCHOR.y).setDisplaySize(132 * FIGURE_ASPECT,132);
    }
    this.makeLight();
    this.light = this.add.image(0,0,'light').setOrigin(0).setDepth(2000).setBlendMode(Phaser.BlendModes.MULTIPLY).setAlpha(.75);
    this.refresh(); this.fit();
    this.scale.on('resize', () => this.fit());
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const world = this.cameras.main.getWorldPoint(pointer.x,pointer.y);
      this.hovered = cells.find(c => this.insideHex(world.x,world.y,c));
      this.drawPath();
    });
    this.input.on('gameout', () => { this.hovered = undefined; this.drawPath(); });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button !== 0) return;
      const world = this.cameras.main.getWorldPoint(pointer.x,pointer.y);
      const hits = this.pawns.map((p,i) => ({p,i})).sort((a,b) => at(b.p.cell).y - at(a.p.cell).y);
      const hit = hits.find(({p}) => this.opaqueAt(p.image!,world.x,world.y));
      if (hit) { this.selected = hit.i; this.refresh(); this.drawPath(); return; }
      const cell = cells.find(c => this.insideHex(world.x,world.y,c));
      if (!cell || !this.route(cell).length) return;
      this.pawns[this.selected].cell = {...cell};
      this.hovered = undefined; this.refresh(); this.drawPath();
      document.getElementById('status')!.textContent = `${this.pawns[this.selected].name} foi movido para ${cell.q + 1}, ${cell.r + 1}.`;
    });
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.addEventListener('click', () => {
      this.mode = button.dataset.mode as 'study' | 'base';
      document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.setAttribute('aria-pressed',String(b === button)));
      document.getElementById('description')!.textContent = this.mode === 'study' ? 'Terra exposta, vegetação agrupada e luz de fim de tarde.' : 'Solo uniforme, cores originais e sombras simples. Mesma composição para comparar.';
      this.refresh(); this.drawPath();
    }));
    document.getElementById('grid')!.addEventListener('click', () => this.toggleGrid());
    this.input.keyboard?.on('keydown-G', () => this.toggleGrid());
    document.getElementById('plus')!.addEventListener('click', () => this.zoom(.15));
    document.getElementById('minus')!.addEventListener('click', () => this.zoom(-.15));
    this.input.on('wheel', (_p:unknown,_o:unknown,_dx:number,dy:number) => this.zoom(dy > 0 ? -.08 : .08));
    document.getElementById('reset')!.addEventListener('click', () => {
      for (const p of this.pawns) p.cell = {...p.start};
      this.selected = 0; this.hovered = undefined; this.zoomFactor = 1; this.fit(); this.refresh(); this.drawPath();
    });
    document.getElementById('status')!.textContent = 'Estudo carregado. Selecione um busto e clique no terreno para movê-lo.';
  }
  private zoom(delta:number) { this.zoomFactor = Phaser.Math.Clamp(this.zoomFactor + delta,.85,1.45); this.fit(); }
  private fit() {
    const camera = this.cameras.main;
    camera.setZoom(Math.max(this.scale.width/W,this.scale.height/H) * this.zoomFactor).centerOn(W/2,H/2);
    document.getElementById('zoom')!.textContent = `${Math.round(this.zoomFactor * 100)}%`;
    (document.getElementById('minus') as HTMLButtonElement).disabled = this.zoomFactor <= .85;
    (document.getElementById('plus') as HTMLButtonElement).disabled = this.zoomFactor >= 1.45;
  }
  private toggleGrid() { this.gridOn = !this.gridOn; document.getElementById('grid')!.setAttribute('aria-pressed',String(this.gridOn)); this.drawGrid(); }
  private hex(g:Phaser.GameObjects.Graphics,c:Cell,color:number,alpha:number,fill=0) {
    const p=at(c),points=Array.from({length:6},(_,i)=>({x:p.x+R*Math.cos(Math.PI/180*(i*60-30)),y:p.y+R*.72*Math.sin(Math.PI/180*(i*60-30))}));
    if(fill)g.fillStyle(color,fill).fillPoints(points,true);
    g.lineStyle(1.2,color,alpha).strokePoints(points,true);
  }
  private insideHex(x:number,y:number,c:Cell) {
    const p=at(c),dx=Math.abs(x-p.x),dy=Math.abs(y-p.y)/.72;
    return dx<=DX/2 && dy<=R && dy+dx/Math.sqrt(3)<=R;
  }
  private drawGrid() {
    this.grid.clear();
    if(this.gridOn)for(const c of cells)this.hex(this.grid,c,0xc9bfa0,.28);
    this.hex(this.grid,this.pawns[this.selected].cell,0xe7cb8c,.8,.08);
  }
  private route(to:Cell):Cell[] {
    const start=this.pawns[this.selected].cell, queue:Cell[][]=[[start]],visited=new Set([`${start.q},${start.r}`]);
    if(same(start,to))return [];
    for(let i=0;i<queue.length;i++)for(const c of neighbors(queue[i].at(-1)!)) {
      const key=`${c.q},${c.r}`;
      if(visited.has(key)||this.blocked.has(key)||this.pawns.some(p=>same(p.cell,c)))continue;
      const path=[...queue[i],c]; if(same(c,to))return path;
      visited.add(key);queue.push(path);
    }
    return [];
  }
  private drawPath() {
    this.path.clear();
    const route=this.hovered?this.route(this.hovered):[];
    for(const c of route.slice(1))this.hex(this.path,c,0xb6cebd,.8,.12);
    if(route.length){this.path.lineStyle(2,0xe3cc91,.9);this.path.strokePoints(route.map(at),false);const end=at(route.at(-1)!);this.path.fillStyle(0xf3dfad).fillCircle(end.x,end.y,5);}
    // Test actual opaque pixels, including foliage edges. Transparent padding never hides a piece.
    const samples: {x:number;y:number}[] = [];
    for(let i=1;i<route.length;i++) {
      const a=at(route[i-1]),b=at(route[i]);
      for(let step=1;step<=10;step++)samples.push({x:a.x+(b.x-a.x)*step/10,y:a.y+(b.y-a.y)*step/10});
    }
    for(const item of this.scenery)item.image!.setAlpha(samples.some(p=>item.y>p.y+18&&this.opaqueAt(item.image!,p.x,p.y))?.32:1);
    for(const pawn of this.pawns)pawn.image!.setAlpha(samples.some(p=>at(pawn.cell).y>p.y+15&&this.opaqueAt(pawn.image!,p.x,p.y))?.35:1);
  }
  private opaqueAt(image:Phaser.GameObjects.Image,x:number,y:number):boolean {
    const bounds=image.getBounds();if(!bounds.contains(x,y))return false;
    const key=image.texture.key;
    if(!this.alpha.has(key)) {
      const source=image.texture.getSourceImage() as HTMLImageElement;
      const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
      const c=canvas.getContext('2d',{willReadFrequently:true})!;c.drawImage(source,0,0);
      this.alpha.set(key,{width:source.width,height:source.height,pixels:c.getImageData(0,0,source.width,source.height).data});
    }
    const mask=this.alpha.get(key)!,sx=Math.floor((x-bounds.x)/bounds.width*mask.width),sy=Math.floor((y-bounds.y)/bounds.height*mask.height);
    return sx>=0&&sy>=0&&sx<mask.width&&sy<mask.height&&mask.pixels[(sy*mask.width+sx)*4+3]>64;
  }

  private refresh() {
    const study=this.mode==='study';this.ground.setTexture(study?'ground-study':'ground-base');
    this.groundShadows.setAlpha(study?1:.16);this.light.setVisible(study);
    for(const item of this.scenery)item.image!.setTint(study?0xd8cbb0:0xffffff);
    this.pawns.forEach((p,i)=>{
      const pos=at(p.cell),ally=p.key.endsWith('ally'),color=ally?0x678e93:0xa35c47;
      p.shadow!.setPosition(pos.x+13,pos.y+7).setAlpha(study?.45:.25);
      p.base!.clear().setDepth(pos.y-1).fillStyle(0x1c251f,.92).fillEllipse(pos.x,pos.y,78,25)
        .lineStyle(i===this.selected?2:1.1,i===this.selected?0xd4b87d:color,.85).strokeEllipse(pos.x,pos.y,78,25);
      p.image!.setPosition(pos.x,pos.y-2).setDepth(pos.y).setTint(study?0xd9cbb3:0xffffff);
    });
    const selected=this.pawns[this.selected];document.getElementById('selected-name')!.textContent=selected.name;
    (document.querySelector('.selection img') as HTMLImageElement).src=`${import.meta.env.BASE_URL}assets/bustos/${selected.key}.png`;
    this.drawGrid();
  }
  private makeGround() {
    const grass=this.textures.get('chao-grama').getSourceImage() as HTMLImageElement;
    const dirt=this.textures.get('chao-terra').getSourceImage() as HTMLImageElement;
    const stone=this.textures.get('chao-pedras').getSourceImage() as HTMLImageElement;
    const make=(key:string)=>{const t=this.textures.createCanvas(key,W,H)!;return {t,c:t.context};};
    const {t:base,c:b}=make('ground-base');
    for(let y=0;y<H;y+=520)for(let x=0;x<W;x+=520)b.drawImage(grass,x,y,520,520);base.refresh();
    const {t,c}=make('ground-study');
    for(let y=0;y<H;y+=760)for(let x=0;x<W;x+=760)c.drawImage(dirt,x,y,760,760);
    c.fillStyle='rgba(74,65,46,.27)';c.fillRect(0,0,W,H);
    // Broad masks restore readable masses without adding a pebble to every cell.
    const patches=[[130,270,430,1],[1430,270,480,1],[180,920,450,1],[1300,950,480,1],[820,210,290,.8],[430,530,155,.7],[1050,690,200,.75]];
    const layer=document.createElement('canvas');layer.width=W;layer.height=H;const lc=layer.getContext('2d')!;
    for(let y=0;y<H;y+=690)for(let x=0;x<W;x+=690)lc.drawImage(grass,x,y,690,690);
    lc.globalCompositeOperation='destination-in';
    const mask=document.createElement('canvas');mask.width=W;mask.height=H;const mc=mask.getContext('2d')!;
    for(const [x,y,r,a] of patches){const g=mc.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,`rgba(0,0,0,${a})`);g.addColorStop(.45,`rgba(0,0,0,${a*.9})`);g.addColorStop(1,'transparent');mc.fillStyle=g;mc.fillRect(x-r,y-r,2*r,2*r);}
    lc.drawImage(mask,0,0);c.drawImage(layer,0,0);
    c.save();c.globalAlpha=.26;c.beginPath();c.ellipse(1000,395,195,90,-.3,0,Math.PI*2);c.clip();c.drawImage(stone,790,280,440,270);c.restore();
    // A warm clearing separates the route from cooler shaded edges.
    const warmth=c.createRadialGradient(680,460,30,750,540,580);warmth.addColorStop(0,'rgba(210,174,99,.16)');warmth.addColorStop(1,'rgba(30,45,35,.35)');c.fillStyle=warmth;c.fillRect(0,0,W,H);t.refresh();
  }
  private makeShadows() {
    const texture=this.textures.createCanvas('shadows',W,H)!,c=texture.context;
    for(const item of this.scenery){
      const spec=PIECES.find(p=>p.key===item.key)!,p=item.cell?at(item.cell):item;
      const source=this.textures.get(item.key).getSourceImage() as HTMLImageElement;
      const silhouette=document.createElement('canvas');silhouette.width=source.width;silhouette.height=source.height;const s=silhouette.getContext('2d')!;
      s.drawImage(source,0,0);s.globalCompositeOperation='source-in';s.fillStyle='#142018';s.fillRect(0,0,source.width,source.height);
      const scale=item.height/source.height;
      c.save();c.translate(p.x,p.y);c.transform(scale,0,-scale*.68,-scale*.27,0,0);c.globalAlpha=.34;c.filter='blur(5px)';c.drawImage(silhouette,-source.width*spec.anchorX,-source.height*spec.anchorY);c.restore();
      const r=item.height*.29;c.save();c.translate(p.x,p.y+5);c.scale(1,.32);const shade=c.createRadialGradient(0,0,0,0,0,r);shade.addColorStop(0,'rgba(12,21,14,.44)');shade.addColorStop(1,'transparent');c.fillStyle=shade;c.fillRect(-r,-r,r*2,r*2);c.restore();
    }texture.refresh();
  }
  private makeLight() {
    const t=this.textures.createCanvas('light',W,H)!,c=t.context;
    const g=c.createRadialGradient(660,410,100,800,500,900);g.addColorStop(0,'#fff2d8');g.addColorStop(.5,'#e4dcc6');g.addColorStop(.82,'#78867b');g.addColorStop(1,'#394a42');c.fillStyle=g;c.fillRect(0,0,W,H);t.refresh();
  }
}
new Phaser.Game({ type:Phaser.AUTO,parent:'study',backgroundColor:'#20271d',scale:{mode:Phaser.Scale.RESIZE,width:window.innerWidth,height:window.innerHeight},render:{antialias:true,pixelArt:false},audio:{noAudio:true},scene:[Study] });
