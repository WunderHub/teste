import Phaser from 'phaser';
import { createBattle, getActive, key, distance, reachable, moveAp, previewAttack, move, attack, waitTurn, endTurn, performAiAction, type BattleState, type Unit, type Hex, type ActionResult, type BattleEvent } from './game';
import { CombatUI, type UIView } from './ui';

const W = 1440, H = 900, R = 40;
const DX = Math.sqrt(3) * R, DY = R * 1.5;
const COLORS = { ally: 0x7caba1, enemy: 0xcb766a, gold: 0xc49a66, bone: 0xe5dec9 };
type Pawn = { image: Phaser.GameObjects.Image; base: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text; bar: Phaser.GameObjects.Graphics };

export function hexToWorld(hex: Hex) {
  return { x: 218 + (hex.q + (hex.r & 1) * 0.5) * DX, y: 110 + hex.r * DY };
}

export class CombatScene extends Phaser.Scene {
  state!: BattleState;
  ui!: CombatUI;
  view: UIView = { mode: 'move', paused: false, helpOpen: false, busy: false, message: 'Clique num hexágono para mover. Clique num inimigo para atacar.' };
  private pawns = new Map<string, Pawn>();
  private grid!: Phaser.GameObjects.Graphics;
  private pathGraphics!: Phaser.GameObjects.Graphics;
  private hoverHex?: Hex;
  private pathMap = new Map<string, Hex[]>();
  private showGrid = false;
  private aiTimer?: Phaser.Time.TimerEvent;
  private pointerTip!: Phaser.GameObjects.Text;
  private activeMarker!: Phaser.GameObjects.Triangle;
  private generation = 0;
  private lastActive = '';
  private transient = new Set<Phaser.GameObjects.GameObject>();

  constructor() { super('Combat'); }
  preload() {
    for (const name of ['iria', 'tome', 'nara', 'raider', 'husk', 'rocks', 'ruin', 'deadtree', 'death'])
      this.load.svg(name, `${import.meta.env.BASE_URL}assets/${name}.svg`, { scale: 2 });
  }
  create() {
    this.state = createBattle(731);
    this.createTerrain();
    this.grid = this.add.graphics().setDepth(1);
    this.pathGraphics = this.add.graphics().setDepth(2);
    for (const tile of this.state.tiles) {
      const p = hexToWorld(tile);
      if (tile.obstacle) this.add.image(p.x, p.y + 12, tile.obstacle).setDisplaySize(100, 100).setOrigin(0.5, 0.9).setDepth(100 + p.y);
    }
    this.activeMarker = this.add.triangle(0, 0, 0, 0, 12, 0, 6, 7, COLORS.gold).setDepth(1300);
    this.pointerTip = this.add.text(0, 0, '', { fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#e5dec9', backgroundColor: '#18211e', padding: { x: 12, y: 8 }, lineSpacing: 4 }).setDepth(1500).setVisible(false);
    this.ui = new CombatUI(document.getElementById('hud')!, {
      onMode: mode => { if (this.playerCanAct()) { this.view.mode = mode; this.view.message = mode === 'move' ? 'Escolha um hexágono iluminado.' : 'Escolha um inimigo. Passe o cursor para conferir a chance de acerto.'; this.refresh(); } },
      onWait: () => { if (this.playerCanAct()) void this.execute(() => waitTurn(this.state)); },
      onEnd: () => { if (this.playerCanAct()) void this.execute(() => endTurn(this.state)); },
      onRestart: () => this.restartBattle(),
      onPause: () => this.togglePause(),
      onHelp: () => { this.view.helpOpen = true; this.refresh(); },
      onCloseHelp: () => { this.view.helpOpen = false; this.refresh(); this.scheduleAi(); },
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.hover(pointer));
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.click(pointer));
    this.input.on('gameout', () => this.clearHover());
    this.input.mouse?.disableContextMenu();
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => this.keyboard(event));
    this.scale.on('resize', this.resize, this);
    this.resize(); this.refresh(); this.scheduleAi();
    if (import.meta.env.DEV) (window as unknown as { __combat: CombatScene }).__combat = this;
  }
  private resize() {
    this.cameras.main.setZoom(Math.min(this.scale.width / W, this.scale.height / H)).centerOn(W / 2, H / 2);
  }

  private createTerrain() {
    const texture = this.textures.createCanvas('terrain', 2200, 1500)!;
    const ctx = texture.context;
    let seed = 23761;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    ctx.fillStyle = '#414737'; ctx.fillRect(0, 0, 2200, 1500);
    const colors = ['#494d3c', '#3b4435', '#50513e', '#535541', '#394233'];
    for (let i = 0; i < 130; i++) {
      ctx.fillStyle = colors[i % colors.length]; ctx.globalAlpha = 0.4 + random() * 0.3;
      ctx.beginPath(); ctx.ellipse(random() * 2200, random() * 1500, 45 + random() * 180, 15 + random() * 65, random(), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.strokeStyle = '#555640'; ctx.lineWidth = 92; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(90, 1190); ctx.bezierCurveTo(440, 900, 610, 1030, 960, 780); ctx.bezierCurveTo(1320, 530, 1500, 740, 2200, 450); ctx.stroke();
    ctx.strokeStyle = '#5f6048'; ctx.lineWidth = 31; ctx.globalAlpha = 0.3; ctx.stroke(); ctx.globalAlpha = 1;
    for (let i = 0; i < 22000; i++) {
      const x = random() * 2200, y = random() * 1500;
      ctx.fillStyle = i % 3 === 0 ? '#1a2119' : '#a2a185'; ctx.globalAlpha = 0.035 + random() * 0.08;
      ctx.fillRect(x, y, 1 + random() * 2, 1);
    }
    for (let i = 0; i < 1500; i++) {
      const x = random() * 2200, y = random() * 1500, h = 3 + random() * 9;
      ctx.globalAlpha = 0.18 + random() * 0.28; ctx.strokeStyle = i % 2 ? '#a0a27a' : '#242c22'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x - 3, y - h * 0.7); ctx.lineTo(x, y); ctx.lineTo(x + 2, y - h); ctx.moveTo(x, y); ctx.lineTo(x + 5, y - h * 0.5); ctx.stroke();
    }
    for (let i = 0; i < 650; i++) {
      ctx.globalAlpha = 0.17 + random() * 0.2; ctx.fillStyle = '#bab59a';
      ctx.beginPath(); ctx.ellipse(random() * 2200, random() * 1500, 1 + random() * 3, 1 + random(), random(), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const shade = ctx.createRadialGradient(1100, 750, 240, 1100, 750, 1050);
    shade.addColorStop(0, 'rgba(10,20,15,0)'); shade.addColorStop(1, 'rgba(10,20,15,.5)');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, 2200, 1500);
    texture.refresh(); this.add.image(-380, -300, 'terrain').setOrigin(0).setDepth(-10);
    for (const [x, y, asset, size] of [[40, 300, 'deadtree', 150], [1315, 220, 'rocks', 110], [1380, 680, 'deadtree', 160], [100, 790, 'rocks', 125]] as const)
      this.add.image(x, y, asset).setDisplaySize(size, size).setAlpha(0.9).setDepth(y - 50);
    for (const tile of this.state.tiles.filter(t => t.terrain === 'rough' && !t.obstacle)) {
      const p = hexToWorld(tile), g = this.add.graphics().setDepth(-1);
      g.fillStyle(0xaba68b, 0.14).fillEllipse(p.x, p.y, 66, 35); g.lineStyle(1, 0xc0b99b, 0.28);
      for (let i = 0; i < 7; i++) { const x = p.x - 25 + random() * 50, y = p.y - 12 + random() * 24; g.lineBetween(x, y, x + 3 + random() * 4, y - 1); }
    }
  }
  private hex(graphics: Phaser.GameObjects.Graphics, hex: Hex, color: number, alpha: number, stroke = 0.3, width = 1) {
    const p = hexToWorld(hex), points: Phaser.Geom.Point[] = [];
    for (let i = 0; i < 6; i++) { const a = (i * 60 - 30) * Math.PI / 180; points.push(new Phaser.Geom.Point(p.x + (R - 2) * Math.cos(a), p.y + (R - 2) * Math.sin(a))); }
    graphics.fillStyle(color, alpha).fillPoints(points, true);
    graphics.lineStyle(width, color, stroke).strokePoints(points, true);
  }
  private syncPawns() {
    const active = getActive(this.state);
    for (const unit of this.state.units) {
      let pawn = this.pawns.get(unit.id); const p = hexToWorld(unit.pos);
      if (!pawn) {
        pawn = { image: this.add.image(p.x, p.y + 7, unit.asset).setOrigin(0.5, 0.94).setDisplaySize(82, 100), base: this.add.graphics(), label: this.add.text(p.x, p.y + 23, '', { fontFamily: 'Arial', fontSize: '12px', color: '#e5dec9', stroke: '#20271e', strokeThickness: 4 }).setOrigin(0.5, 0), bar: this.add.graphics() };
        this.pawns.set(unit.id, pawn);
      }
      pawn.base.clear(); pawn.bar.clear();
      if (unit.escaped) { pawn.image.setVisible(false); pawn.label.setVisible(false); continue; }
      pawn.image.setVisible(true).setPosition(p.x, p.y + 7).setDepth(100 + p.y);
      if (unit.dead) { pawn.image.setTexture('death').setDisplaySize(62, 76).setAlpha(0.65).setDepth(5); pawn.label.setVisible(false); continue; }
      pawn.image.setTexture(unit.asset).setDisplaySize(82, 100).setAlpha(unit.morale === 0 ? 0.68 : 1);
      const selected = unit.id === active?.id, hovered = unit.id === this.view.hoveredId;
      const color = selected ? COLORS.gold : COLORS[unit.team];
      pawn.base.setDepth(4).fillStyle(0x131b15, 0.5).fillEllipse(p.x, p.y + 6, 72, 28);
      pawn.base.lineStyle(selected ? 3 : 1.5, color, selected || hovered ? 1 : 0.65).strokeEllipse(p.x, p.y + 5, 68, 23);
      if (selected) pawn.base.lineStyle(1, color, 0.25).strokeEllipse(p.x, p.y + 5, 77, 31);
      pawn.label.setPosition(p.x, p.y + 23).setDepth(1100).setText(unit.name).setVisible(selected || hovered);
      if (selected || hovered || unit.hp < unit.maxHp) {
        pawn.bar.setDepth(1100).fillStyle(0x17201a, 0.95).fillRect(p.x - 22, p.y + 18, 44, 3);
        pawn.bar.fillStyle(COLORS[unit.team], 0.95).fillRect(p.x - 22, p.y + 18, 44 * unit.hp / unit.maxHp, 3);
      }
      if (unit.weapon.kind === 'ranged') pawn.base.fillStyle(COLORS[unit.team], 0.8).fillTriangle(p.x + 25, p.y - 1, p.x + 34, p.y + 3, p.x + 25, p.y + 7);
    }
    this.activeMarker.setVisible(!!active && this.state.outcome === 'ongoing');
    if (active) { const p = hexToWorld(active.pos); this.activeMarker.setPosition(p.x, p.y - 106); }
  }
  refresh() {
    const active = getActive(this.state);
    if (active?.id !== this.lastActive) {
      this.lastActive = active?.id ?? '';
      const hasShot = active?.weapon.kind === 'ranged' && this.state.units.some(u => u.team !== active.team && previewAttack(this.state, active, u).allowed);
      this.view.mode = hasShot ? 'attack' : 'move';
      this.hoverHex = undefined; this.view.hoveredId = undefined; this.view.preview = undefined;
      if (active) this.view.message = active.morale === 0 ? `${active.name} está em fuga.` : active.team === 'enemy' ? `${active.name} está agindo…` : `Sua vez · ${active.name}. Mova-se ou escolha um alvo.`;
    }
    this.pathMap = active && this.playerCanAct() ? reachable(this.state, active) : new Map();
    if (!this.view.busy) this.syncPawns();
    this.drawGrid(); this.ui.update(this.state, this.view);
  }
  private drawGrid() {
    this.grid.clear(); this.pathGraphics.clear(); const active = getActive(this.state);
    if (this.showGrid) for (const tile of this.state.tiles) this.hex(this.grid, tile, tile.obstacle ? 0xc0b29a : 0xb9c4ac, 0, 0.14);
    if (!active || this.state.outcome !== 'ongoing' || this.view.paused || this.view.helpOpen) return;
    if (this.playerCanAct() && this.view.mode === 'move') for (const tile of this.state.tiles) if (this.pathMap.has(key(tile))) this.hex(this.grid, tile, COLORS.ally, 0.055, 0.24);
    this.hex(this.grid, active.pos, COLORS.gold, 0.08, 0.75, 2);
    if (this.playerCanAct() && this.view.mode === 'attack') for (const enemy of this.state.units.filter(u => u.team !== active.team && !u.dead && !u.escaped)) {
      if (previewAttack(this.state, active, enemy).allowed) this.hex(this.grid, enemy.pos, COLORS.enemy, 0.13, 0.7, 2);
    }
    const path = this.hoverHex && this.pathMap.get(key(this.hoverHex));
    if (path && this.view.mode === 'move' && !this.view.hoveredId) {
      this.pathGraphics.lineStyle(2, COLORS.gold, 0.8); let previous = hexToWorld(active.pos);
      for (const step of path) { const p = hexToWorld(step); this.pathGraphics.lineBetween(previous.x, previous.y, p.x, p.y); this.pathGraphics.fillStyle(COLORS.gold, 1).fillCircle(p.x, p.y, 3); previous = p; }
      this.hex(this.pathGraphics, this.hoverHex!, COLORS.gold, 0.12, 0.9, 2);
    }
  }
  private playerCanAct() {
    const active = getActive(this.state);
    return !!active && active.team === 'ally' && active.morale > 0 && this.state.outcome === 'ongoing' && !this.view.busy && !this.view.paused && !this.view.helpOpen;
  }
  private atPointer(pointer: Phaser.Input.Pointer): { hex?: Hex; unit?: Unit; x: number; y: number } {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const unit = this.state.units.filter(u => !u.dead && !u.escaped).sort((a, b) => b.pos.r - a.pos.r).find(u => {
      const p = hexToWorld(u.pos); return Math.abs(p.x - world.x) < 34 && world.y > p.y - 88 && world.y < p.y + 13;
    });
    const closest = this.state.tiles.map(t => ({ tile: t, d: Math.hypot(hexToWorld(t).x - world.x, hexToWorld(t).y - world.y) })).sort((a, b) => a.d - b.d)[0];
    return { hex: unit?.pos ?? (closest?.d < R ? closest.tile : undefined), unit, x: world.x, y: world.y };
  }
  private hover(pointer: Phaser.Input.Pointer) {
    if (this.view.busy || this.view.helpOpen || this.view.paused) return;
    const hit = this.atPointer(pointer); this.hoverHex = hit.hex; this.view.hoveredId = hit.unit?.id; this.view.preview = undefined;
    const active = getActive(this.state); let tip = '';
    if (active && hit.unit && active.team !== hit.unit.team && this.playerCanAct()) {
      this.view.preview = previewAttack(this.state, active, hit.unit);
      tip = this.view.preview.allowed ? `${hit.unit.name} · ${this.view.preview.chance}% de acerto\n${this.view.preview.ap} PA · +${this.view.preview.fatigue} fadiga` : this.view.preview.reason;
    } else if (hit.hex && !hit.unit && this.playerCanAct()) {
      const tile = this.state.tiles.find(t => key(t) === key(hit.hex!)), path = this.pathMap.get(key(hit.hex));
      if (tile?.obstacle) tip = 'Obstáculo · bloqueia passagem e visão';
      else if (path && this.view.mode === 'move') {
        const ap = path.reduce((sum, step) => sum + moveAp(this.state.tiles.find(t => key(t) === key(step))!), 0);
        tip = `Mover · ${path.length} ${path.length === 1 ? 'hexágono' : 'hexágonos'}\n${ap} PA · +${ap * 2} fadiga`;
        const departures = [active!.pos, ...path.slice(0, -1)];
        if (this.state.units.some(u => u.team !== active?.team && !u.dead && !u.escaped && u.weapon.kind === 'melee' && u.morale > 0 && departures.some(pos => distance(pos, u.pos) === 1))) tip += '\nEste caminho pode provocar um ataque.';
      }
    }
    this.pointerTip.setText(tip).setVisible(!!tip);
    const bounds = this.cameras.main.worldView;
    this.pointerTip.setPosition(Math.min(hit.x + 24, bounds.right - this.pointerTip.width - 18), Math.max(bounds.top + 80, Math.min(hit.y + 24, 690 - this.pointerTip.height)));
    this.game.canvas.style.cursor = hit.unit && active && hit.unit.team !== active.team ? 'crosshair' : hit.hex && this.pathMap.has(key(hit.hex)) ? 'pointer' : 'default';
    this.syncPawns(); this.drawGrid(); this.ui.update(this.state, this.view);
  }
  private clearHover() {
    this.hoverHex = undefined; this.view.hoveredId = undefined; this.view.preview = undefined; this.pointerTip?.setVisible(false);
    if (this.ui && !this.view.busy) { this.syncPawns(); this.drawGrid(); this.ui.update(this.state, this.view); }
  }
  private click(pointer: Phaser.Input.Pointer) {
    if (!this.playerCanAct()) return;
    if (pointer.rightButtonDown()) { this.view.mode = 'move'; this.refresh(); return; }
    const hit = this.atPointer(pointer), active = getActive(this.state)!;
    if (hit.unit && hit.unit.team !== active.team) void this.execute(() => attack(this.state, hit.unit!.id));
    else if (hit.hex && !hit.unit && this.view.mode === 'move') void this.execute(() => move(this.state, hit.hex!));
    else if (hit.unit && hit.unit.id !== active.id) { this.view.message = `${hit.unit.name} aguardará sua vez na ordem dos turnos.`; this.ui.update(this.state, this.view); }
  }
  private keyboard(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if (event.code === 'Escape') { event.preventDefault(); if (this.view.helpOpen) { this.view.helpOpen = false; this.refresh(); this.scheduleAi(); } else this.togglePause(); return; }
    if (event.code === 'KeyG') { this.showGrid = !this.showGrid; this.drawGrid(); return; }
    if (!this.playerCanAct()) return;
    if (event.code === 'Digit1') { this.view.mode = 'move'; this.refresh(); }
    if (event.code === 'Digit2') { this.view.mode = 'attack'; this.refresh(); }
    if (event.code === 'KeyW') { event.preventDefault(); void this.execute(() => waitTurn(this.state)); }
    if (event.code === 'Space' && target.tagName !== 'BUTTON') { event.preventDefault(); void this.execute(() => endTurn(this.state)); }
  }
  private togglePause() {
    if (this.state.outcome !== 'ongoing') return;
    this.view.paused = !this.view.paused;
    this.time.paused = this.view.paused;
    if (this.view.paused) this.tweens.pauseAll(); else this.tweens.resumeAll();
    this.pointerTip.setVisible(false); this.refresh(); this.scheduleAi();
  }
  private restartBattle() {
    this.generation++; this.aiTimer?.remove(); this.tweens.killAll();
    this.time.paused = false;
    for (const item of this.transient) item.destroy();
    this.transient.clear();
    for (const pawn of this.pawns.values()) pawn.image.clearTint();
    this.state = createBattle(731); this.lastActive = '';
    this.view = { mode: 'move', paused: false, helpOpen: false, busy: false, message: 'Uma nova tentativa. Conduza os três mercenários à vitória.' };
    this.pointerTip.setVisible(false); this.refresh(); this.scheduleAi();
  }
  private async execute(action: () => ActionResult) {
    if (this.view.busy || this.state.outcome !== 'ongoing') return;
    const generation = this.generation, result = action();
    this.view.message = result.message; this.pointerTip.setVisible(false);
    if (!result.ok) { this.ui.update(this.state, this.view); return; }
    this.view.busy = true; this.grid.clear(); this.pathGraphics.clear(); this.ui.update(this.state, this.view);
    for (const event of result.events) { if (generation !== this.generation) return; await this.animateEvent(event); }
    if (generation !== this.generation) return;
    this.view.busy = false; this.refresh(); this.scheduleAi();
  }
  private async animateEvent(event: BattleEvent) {
    const pawn = event.unitId ? this.pawns.get(event.unitId) : undefined;
    if (event.type === 'move' && pawn && event.to) {
      const p = hexToWorld(event.to); pawn.base.clear(); pawn.bar.clear(); pawn.label.setVisible(false);
      await new Promise<void>(resolve => this.tweens.add({ targets: pawn.image, x: p.x, y: p.y + 7, duration: 150, ease: 'Sine.easeInOut', onComplete: () => { pawn.image.setDepth(100 + p.y); resolve(); } }));
    }
    if (event.type === 'attack' && pawn && event.targetId) {
      const targetPawn = this.pawns.get(event.targetId); if (!targetPawn) return;
      const attacker = this.state.units.find(u => u.id === event.unitId)!;
      const a = { x: pawn.image.x, y: pawn.image.y - 7 }, b = { x: targetPawn.image.x, y: targetPawn.image.y - 7 };
      if (attacker.weapon.kind === 'ranged') {
        const arrow = this.add.rectangle(a.x, a.y - 38, 19, 2, COLORS.bone).setRotation(Math.atan2(b.y - a.y, b.x - a.x)).setDepth(1400);
        this.transient.add(arrow);
        await new Promise<void>(resolve => this.tweens.add({ targets: arrow, x: b.x, y: b.y - 38, duration: 210, onComplete: () => { arrow.destroy(); this.transient.delete(arrow); resolve(); } }));
      } else await new Promise<void>(resolve => this.tweens.add({ targets: pawn.image, x: a.x + (b.x - a.x) * 0.25, y: a.y + 7 + (b.y - a.y) * 0.15, duration: 95, yoyo: true, onComplete: () => resolve() }));
      if (event.hit) { targetPawn.image.setTint(0xe39d89); this.time.delayedCall(130, () => targetPawn.image.clearTint()); }
      const text = this.add.text(b.x, b.y - 100, event.hit ? event.damage ? `−${event.damage}` : 'ARMADURA' : 'ERROU', { fontFamily: 'Arial', fontSize: event.damage ? '25px' : '15px', fontStyle: 'bold', color: event.hit ? '#edaa93' : '#d7d7c5', stroke: '#1a2119', strokeThickness: 4 }).setOrigin(0.5).setDepth(1600);
      this.transient.add(text);
      this.tweens.add({ targets: text, y: b.y - 137, alpha: 0, duration: 1050, delay: 170, onComplete: () => { text.destroy(); this.transient.delete(text); } });
    }
  }
  private scheduleAi() {
    this.aiTimer?.remove(); const active = getActive(this.state);
    if (!active || this.state.outcome !== 'ongoing' || this.view.busy || this.view.paused || this.view.helpOpen || (active.team === 'ally' && active.morale !== 0)) return;
    this.aiTimer = this.time.delayedCall(650, () => { if (!this.view.paused && !this.view.helpOpen && !this.view.busy) void this.execute(() => performAiAction(this.state)); });
  }
}
