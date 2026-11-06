import Phaser from 'phaser';
import {
  getActive, groupTurnOf, key, distance, neighbors, reachable, moveAp, previewAttack, move, attack, waitTurn, endTurn,
  isPlayerControlled, isSettled, tileAt, commandedPlatoons, commanderOf, platoonOf, platoonTroops, divisionOf, orderInfo, stressLevel, VOCATIVES,
  type BattleState, type Unit, type Hex, type ActionResult, type BattleEvent, type OrderTarget,
} from './game';
import { createBattle } from './encounters';
import { performAiAction } from './ai';
import { shoutOrder } from './commands';
import { FIGURE_ANCHOR, FIGURE_ASPECT, FIGURE_KEYS, figureOf, figureUrl } from './figures';
import { paintGround, type GroundTextures } from './ground';
import { PIECE_HEIGHT, layoutScenery, obstaclePiece, pieceByKey, type Placed } from './decor';
import { GROUND_KEYS, PIECES } from './terrain-pieces';
import { CombatUI, ORDER_GROUPS, previewShout, type Composer, type UIView } from './ui';

/** The HUD was laid out for a 1440×900 screen; that size still sets the default zoom. */
const W = 1440, H = 900, R = 40;
/** Height of a bust on the field, in world pixels; the waist stands just below the hex center. */
const FIGURE_H = 108;
const DX = Math.sqrt(3) * R, DY = R * 1.5;
const MARGIN_X = 140, MARGIN_Y = 130;
/** How far the painted ground extends past the board on each side. */
const TERRAIN_X = 380, TERRAIN_Y = 300;
const SEED = 731;
/** Pause before an AI action at 1× speed. Actions away from the camera skip it. */
const AI_DELAY = 280;
const DRAG_THRESHOLD = 6;
const SPEEDS = [1, 2, 4] as const;
const COLORS = { ally: 0x7caba1, enemy: 0xcb766a, gold: 0xc49a66, bone: 0xe5dec9, stress: 0xe58a5c };
/** The move preview: the path in teal with a dotted trail, the destination in yellow. */
const PATH = { fill: 0x2fae9c, edge: 0x63e0cc, dot: 0xf2dd8a, goal: 0xe9cf5c };
const terrainUrl = (name: string) => `${import.meta.env.BASE_URL}assets/terreno/${name}`;
const closedComposer = (): Composer => ({ step: 'closed', text: '' });
const TEXT_FONT = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
type Pawn = {
  image: Phaser.GameObjects.Image; base: Phaser.GameObjects.Graphics; flag: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text; bar: Phaser.GameObjects.Graphics;
  /** The letter of the order a troop follows. */
  mark: Phaser.GameObjects.Text;
};
type Drag = { x: number; y: number; scrollX: number; scrollY: number; moved: boolean };

export function hexToWorld(hex: Hex) {
  return { x: MARGIN_X + (hex.q + (hex.r & 1) * 0.5) * DX, y: MARGIN_Y + hex.r * DY };
}
/** Nearest board hex to a world point, checking the 3×3 offset neighborhood around the estimate. */
function worldToHex(s: BattleState, x: number, y: number): Hex | undefined {
  const r0 = Math.round((y - MARGIN_Y) / DY);
  let best: Hex | undefined, bestDistance = R;
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    const q0 = Math.round((x - MARGIN_X) / DX - (r & 1) * 0.5);
    for (let q = q0 - 1; q <= q0 + 1; q++) {
      if (!tileAt(s, { q, r })) continue;
      const p = hexToWorld({ q, r }), d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDistance) { bestDistance = d; best = { q, r }; }
    }
  }
  return best;
}
const worldSize = (s: BattleState) => ({ width: 2 * MARGIN_X + (s.width - 0.5) * DX, height: 2 * MARGIN_Y + (s.height - 1) * DY });

export class CombatScene extends Phaser.Scene {
  state!: BattleState;
  ui!: CombatUI;
  view: UIView = { mode: 'move', paused: false, helpOpen: false, busy: false, speed: 2, composer: closedComposer(), message: 'Clique num hexágono para mover. Clique num inimigo para atacar.' };
  private world = { width: W, height: H };
  private pawns = new Map<string, Pawn>();
  private grid!: Phaser.GameObjects.Graphics;
  /** The thin lines of every hex, drawn once; G shows or hides them. */
  private gridLines!: Phaser.GameObjects.Graphics;
  private pathGraphics!: Phaser.GameObjects.Graphics;
  private hoverHex?: Hex;
  private pathMap = new Map<string, Hex[]>();
  private showGrid = true;
  private aiTimer?: Phaser.Time.TimerEvent;
  private pointerTip!: Phaser.GameObjects.Text;
  private activeMarker!: Phaser.GameObjects.Triangle;
  private generation = 0;
  private lastActive = '';
  private lastActor = '';
  private transient = new Set<Phaser.GameObjects.GameObject>();
  /** Zoom relative to the 1440×900 layout scale, kept across window resizes. */
  private zoomFactor = 0.85;
  private drag?: Drag;

  constructor() { super('Combat'); }
  preload() {
    this.load.svg('death', `${import.meta.env.BASE_URL}assets/death.svg`, { scale: 2 });
    for (const key of FIGURE_KEYS) this.load.image(key, figureUrl(key));
    for (const key of GROUND_KEYS) this.load.image(key, terrainUrl(`${key}.jpg`));
    for (const piece of PIECES) this.load.image(piece.key, terrainUrl(`${piece.key}.png`));
  }
  create() {
    this.state = createBattle(SEED, 'campo-aberto');
    this.world = worldSize(this.state);
    this.createTerrain();
    this.gridLines = this.add.graphics().setDepth(0);
    this.drawGridLines(); this.gridLines.setVisible(this.showGrid);
    this.grid = this.add.graphics().setDepth(1);
    this.pathGraphics = this.add.graphics().setDepth(2);
    this.activeMarker = this.add.triangle(0, 0, 0, 0, 12, 0, 6, 7, COLORS.gold).setDepth(1300);
    this.pointerTip = this.add.text(0, 0, '', { fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#e5dec9', backgroundColor: '#18211e', padding: { x: 12, y: 8 }, lineSpacing: 4 }).setDepth(1500).setVisible(false);
    this.ui = new CombatUI(document.getElementById('hud')!, {
      onMode: mode => { if (this.playerCanAct()) { this.view.mode = mode; this.view.message = mode === 'move' ? 'Escolha um hexágono iluminado.' : 'Escolha um inimigo. Passe o cursor para conferir a chance de acerto.'; this.refresh(); } },
      onWait: () => { if (this.playerCanAct()) void this.execute(() => waitTurn(this.state)); },
      onEnd: () => { if (this.playerCanAct()) void this.execute(() => endTurn(this.state)); },
      onRestart: () => this.restartBattle(),
      onPause: () => this.togglePause(),
      onSpeed: () => this.cycleSpeed(),
      onHelp: () => { this.view.helpOpen = true; this.refresh(); },
      onCloseHelp: () => { this.view.helpOpen = false; this.refresh(); this.scheduleAi(); },
      onCompose: () => this.openComposer(),
      onComposeGroup: group => this.chooseGroup(group),
      onComposeText: text => { this.view.composer.text = text; this.view.composer.warning = undefined; this.drawGrid(); this.ui.update(this.state, this.view); },
      onComposeSubmit: text => this.submitOrder(text),
      onComposeCancel: () => this.closeComposer(),
    });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.pointerDown(pointer));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.pointerMove(pointer));
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => this.pointerUp(pointer));
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => this.zoomAt(pointer.x, pointer.y, dy > 0 ? 1 / 1.12 : 1.12));
    this.input.on('gameout', () => { this.drag = undefined; this.clearHover(); });
    this.input.mouse?.disableContextMenu();
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => this.keyboard(event));
    this.scale.on('resize', this.resize, this);
    this.applySpeed();
    this.resize(); this.focusOn(this.playerLeader() ?? getActive(this.state)); this.refresh(); this.scheduleAi();
    if (import.meta.env.DEV) (window as unknown as { __combat: CombatScene }).__combat = this;
  }

  // Camera ------------------------------------------------------------------
  private zoomLimits() {
    const base = Math.min(this.scale.width / W, this.scale.height / H);
    const fit = Math.min(this.scale.width / this.world.width, this.scale.height / this.world.height);
    return { base, min: Math.min(base, fit * 0.95), max: base * 1.6 };
  }
  private resize() {
    const { base, min, max } = this.zoomLimits(), cam = this.cameras.main;
    const center = { x: cam.scrollX + cam.width / 2, y: cam.scrollY + cam.height / 2 };
    cam.setZoom(clamp(base * this.zoomFactor, min, max));
    cam.centerOn(center.x, center.y); this.clampCamera();
  }
  /** Clamps a camera center so the view stays on the painted ground (or centers on it when zoomed far out). */
  private clampCenter(x: number, y: number) {
    const cam = this.cameras.main, viewW = cam.width / cam.zoom, viewH = cam.height / cam.zoom;
    const left = -TERRAIN_X, right = this.world.width + TERRAIN_X, top = -TERRAIN_Y, bottom = this.world.height + TERRAIN_Y;
    return {
      x: viewW >= right - left ? (left + right) / 2 : clamp(x, left + viewW / 2, right - viewW / 2),
      y: viewH >= bottom - top ? (top + bottom) / 2 : clamp(y, top + viewH / 2, bottom - viewH / 2),
    };
  }
  private clampCamera() {
    const cam = this.cameras.main, center = this.clampCenter(cam.scrollX + cam.width / 2, cam.scrollY + cam.height / 2);
    cam.setScroll(center.x - cam.width / 2, center.y - cam.height / 2);
  }
  private zoomAt(screenX: number, screenY: number, factor: number) {
    const cam = this.cameras.main, { base, min, max } = this.zoomLimits();
    const zoom = clamp(cam.zoom * factor, min, max);
    // Keep the world point under the cursor in place while zooming.
    const worldX = cam.scrollX + cam.width / 2 + (screenX - cam.width / 2) / cam.zoom;
    const worldY = cam.scrollY + cam.height / 2 + (screenY - cam.height / 2) / cam.zoom;
    cam.setZoom(zoom); this.zoomFactor = zoom / base;
    cam.setScroll(worldX - (screenX - cam.width / 2) / zoom - cam.width / 2, worldY - (screenY - cam.height / 2) / zoom - cam.height / 2);
    this.clampCamera(); this.pointerTip.setVisible(false);
  }
  private panBy(dx: number, dy: number) {
    const cam = this.cameras.main;
    cam.setScroll(cam.scrollX + dx / cam.zoom, cam.scrollY + dy / cam.zoom); this.clampCamera();
  }
  private focusOn(unit?: Unit, animate = false) {
    if (!unit) return;
    const p = hexToWorld(unit.pos), cam = this.cameras.main, target = this.clampCenter(p.x, p.y - 20);
    if (animate) cam.pan(target.x, target.y, 320, 'Sine.easeInOut', true);
    else cam.centerOn(target.x, target.y);
  }
  /** True when the hex sits inside the visible field, away from the HUD-covered edges. */
  private onScreen(hex: Hex, margin = 0) {
    const p = hexToWorld(hex), view = this.cameras.main.worldView;
    return p.x > view.left - margin && p.x < view.right + margin && p.y > view.top - margin && p.y < view.bottom + margin;
  }
  private playerLeader() {
    return this.state.units.find(isPlayerControlled);
  }

  /** The painted ground, the forest around the clearing and the pieces standing on obstacle tiles. */
  private createTerrain() {
    const left = -TERRAIN_X, top = -TERRAIN_Y;
    const width = Math.ceil(this.world.width + 2 * TERRAIN_X), height = Math.ceil(this.world.height + 2 * TERRAIN_Y);
    // Painted a little sharper than the world, within a texture size every desktop GPU takes.
    const resolution = Math.min(1.4, 4096 / width, 4096 / height);
    const texture = this.textures.createCanvas('terrain', Math.round(width * resolution), Math.round(height * resolution))!;
    const source = (key: string) => this.textures.get(key).getSourceImage() as HTMLImageElement;
    const textures: GroundTextures = { grass: source('chao-grama'), dirt: source('chao-terra'), stones: source('chao-pedras') };
    // A worn trail crosses the field from the lower left to the upper right.
    const sx = width / 2200, sy = height / 1500, at = (x: number, y: number): [number, number] => [left + x * sx, top + y * sy];
    paintGround(texture.context, textures, {
      width: texture.width, height: texture.height, resolution, originX: left, originY: top, tileSize: 320,
      rough: this.state.tiles.filter(t => t.terrain === 'rough').map(hexToWorld), hexRadius: R,
      trail: [at(90, 1190), at(440, 900), at(610, 1030), at(960, 780), at(1320, 530), at(1500, 740), at(2200, 450)],
      seed: SEED,
    });
    // Darker toward the edges, where the forest closes in.
    const ctx = texture.context, cx = texture.width / 2, cy = texture.height / 2, radius = Math.max(cx, cy);
    const shade = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, radius * 1.1);
    shade.addColorStop(0, 'rgba(14,20,10,0)'); shade.addColorStop(1, 'rgba(14,20,10,.6)');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, texture.width, texture.height);
    texture.refresh(); this.add.image(left, top, 'terrain').setOrigin(0).setScale(1 / resolution).setDepth(-10);

    this.createShadowTexture();
    const board = {
      left: hexToWorld({ q: 0, r: 0 }).x - DX / 2, right: hexToWorld({ q: this.state.width - 1, r: 1 }).x + DX / 2,
      top: MARGIN_Y - R, bottom: MARGIN_Y + (this.state.height - 1) * DY + R,
    };
    const area = { left, top, right: this.world.width + TERRAIN_X, bottom: this.world.height + TERRAIN_Y };
    for (const item of layoutScenery(board, area, SEED)) this.placePiece(item);
    for (const tile of this.state.tiles) {
      const piece = obstaclePiece(tile);
      if (!piece) continue;
      const p = hexToWorld(tile);
      this.placePiece({ key: piece.key, x: p.x, y: p.y + 14, height: PIECE_HEIGHT[piece.kind], flip: ((tile.q * 7 + tile.r) & 1) === 1 });
    }
  }
  /** A soft dark ellipse, laid under fighters and scenery so they sit on the ground. */
  private createShadowTexture() {
    if (this.textures.exists('sombra')) return;
    const texture = this.textures.createCanvas('sombra', 128, 64)!, ctx = texture.context;
    ctx.setTransform(1, 0, 0, 0.5, 0, 0);
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(10,14,8,0.85)'); gradient.addColorStop(0.5, 'rgba(10,14,8,0.5)'); gradient.addColorStop(1, 'rgba(10,14,8,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
    texture.refresh();
  }
  private placePiece(item: Placed) {
    const piece = pieceByKey(item.key);
    if (!piece) return;
    const width = item.height * piece.aspect, flat = piece.kind === 'capim';
    if (!flat) {
      // The light comes from the upper left, so shadows fall a little to the right.
      const spread = piece.kind === 'arvore' || piece.kind === 'arvore-seca' ? 0.75 : 1.05;
      this.add.image(item.x + width * 0.08, item.y - 2, 'sombra').setDisplaySize(width * spread, Math.min(width * spread * 0.32, 46)).setAlpha(0.55).setDepth(-5);
    }
    this.add.image(item.x, item.y, piece.key).setOrigin(item.flip ? 1 - piece.anchorX : piece.anchorX, piece.anchorY)
      .setDisplaySize(width, item.height).setFlipX(item.flip).setAlpha(item.alpha ?? 1).setDepth(flat ? -4 : 100 + item.y);
  }
  /** Every hex edge once, so shared edges are not drawn twice as bright. */
  private drawGridLines() {
    const seen = new Set<string>();
    this.gridLines.clear().lineStyle(1, COLORS.bone, 0.17);
    for (const tile of this.state.tiles) {
      const p = hexToWorld(tile), corners = [0, 1, 2, 3, 4, 5].map(i => { const a = (i * 60 - 30) * Math.PI / 180; return { x: p.x + R * Math.cos(a), y: p.y + R * Math.sin(a) }; });
      corners.forEach((a, i) => {
        const b = corners[(i + 1) % 6], id = [a, b].map(c => `${Math.round(c.x)},${Math.round(c.y)}`).sort().join('|');
        if (seen.has(id)) return;
        seen.add(id); this.gridLines.lineBetween(a.x, a.y, b.x, b.y);
      });
    }
  }
  private hex(graphics: Phaser.GameObjects.Graphics, hex: Hex, color: number, alpha: number, stroke = 0.3, width = 1, edge = color) {
    const p = hexToWorld(hex), points: Phaser.Geom.Point[] = [];
    for (let i = 0; i < 6; i++) { const a = (i * 60 - 30) * Math.PI / 180; points.push(new Phaser.Geom.Point(p.x + (R - 2) * Math.cos(a), p.y + (R - 2) * Math.sin(a))); }
    if (alpha > 0) graphics.fillStyle(color, alpha).fillPoints(points, true);
    if (stroke > 0) graphics.lineStyle(width, edge, stroke).strokePoints(points, true);
  }
  /** A pennant over the head marks leaders, so the player can find the units they command. */
  private drawPennant(graphics: Phaser.GameObjects.Graphics, x: number, y: number, team: Unit['team']) {
    // Taller than the busts, so the flag flies over the heads of the row behind instead of against their cloth.
    graphics.lineStyle(2.5, 0x2a2318, 1).lineBetween(x + 27, y - 30, x + 27, y - 134);
    graphics.fillStyle(COLORS[team], 1).fillTriangle(x + 28, y - 134, x + 62, y - 123, x + 28, y - 112);
    graphics.lineStyle(2, COLORS.gold, 1).strokeTriangle(x + 28, y - 134, x + 62, y - 123, x + 28, y - 112);
    graphics.fillStyle(COLORS.gold, 1).fillCircle(x + 27, y - 135, 3);
  }
  private syncPawns() {
    const active = getActive(this.state);
    for (const unit of this.state.units) {
      let pawn = this.pawns.get(unit.id); const p = hexToWorld(unit.pos);
      if (!pawn) {
        pawn = { image: this.add.image(p.x, p.y + 7, figureOf(unit)), base: this.add.graphics(), flag: this.add.graphics(), label: this.add.text(p.x, p.y + 23, '', { fontFamily: 'Arial', fontSize: '12px', color: '#e5dec9', stroke: '#20271e', strokeThickness: 4 }).setOrigin(0.5, 0), bar: this.add.graphics(),
          mark: this.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: '11px', fontStyle: 'bold', color: '#e2c99f', backgroundColor: '#18211ee6', padding: { x: 4, y: 1 } }).setOrigin(0.5).setVisible(false) };
        this.pawns.set(unit.id, pawn);
      }
      pawn.base.clear(); pawn.bar.clear(); pawn.flag.clear(); pawn.mark.setVisible(false);
      if (unit.escaped) { pawn.image.setVisible(false); pawn.label.setVisible(false); continue; }
      pawn.image.setVisible(true).setPosition(p.x, p.y + 7).setDepth(100 + p.y);
      if (unit.dead) { pawn.image.setTexture('death').setOrigin(0.5, 0.94).setDisplaySize(62, 76).setAlpha(0.65).setDepth(5); pawn.label.setVisible(false); continue; }
      if (unit.order && unit.morale > 0) {
        // Faded while the order settles; a "!" while the troop is under stress.
        // Worn on the shoulder, just above the own sprite: the rows in front never cover that spot.
        const stressed = stressLevel(this.state, unit) > 0;
        pawn.mark.setText(`${orderInfo(unit.order.id).mark}${stressed ? '!' : ''}`).setPosition(p.x - 23, p.y - 40).setDepth(101 + p.y).setVisible(true)
          .setAlpha(isSettled(this.state, unit.order) || stressed ? 1 : 0.55).setColor(stressed ? '#f0a07c' : unit.team === 'ally' ? '#e2c99f' : '#e8a596');
      }
      if (unit.tactic?.waiting && unit.morale > 0) {
        pawn.mark.setText('?').setPosition(p.x - 23, p.y - 40).setDepth(101 + p.y).setVisible(true).setAlpha(0.8).setColor('#e2c99f');
      }
      pawn.image.setTexture(figureOf(unit)).setOrigin(FIGURE_ANCHOR.x, FIGURE_ANCHOR.y).setDisplaySize(FIGURE_H * FIGURE_ASPECT, FIGURE_H)
        .setAlpha(unit.morale === 0 ? 0.68 : 1);
      const selected = unit.id === active?.id, hovered = unit.id === this.view.hoveredId, leader = unit.role === 'leader';
      const color = selected ? COLORS.gold : COLORS[unit.team];
      pawn.base.setDepth(4).fillStyle(0x131b15, 0.5).fillEllipse(p.x, p.y + 6, 72, 28);
      pawn.base.lineStyle(selected ? 3 : 1.5, color, selected || hovered ? 1 : 0.65).strokeEllipse(p.x, p.y + 5, 68, 23);
      if (selected || leader) pawn.base.lineStyle(1, leader ? COLORS.gold : color, leader && !selected ? 0.55 : 0.25).strokeEllipse(p.x, p.y + 5, 77, 31);
      if (leader) this.drawPennant(pawn.flag.setDepth(101 + p.y), p.x, p.y, unit.team);
      pawn.label.setPosition(p.x, p.y + 23).setDepth(1100).setText(unit.name).setVisible(selected || hovered || leader);
      if (selected || hovered || unit.hp < unit.maxHp) {
        pawn.bar.setDepth(1100).fillStyle(0x17201a, 0.95).fillRect(p.x - 22, p.y + 18, 44, 3);
        pawn.bar.fillStyle(COLORS[unit.team], 0.95).fillRect(p.x - 22, p.y + 18, 44 * unit.hp / unit.maxHp, 3);
      }
      if (unit.weapon.kind === 'ranged') pawn.base.fillStyle(COLORS[unit.team], 0.8).fillTriangle(p.x + 25, p.y - 1, p.x + 34, p.y + 3, p.x + 25, p.y + 7);
    }
    this.activeMarker.setVisible(!!active && this.state.outcome === 'ongoing');
    if (active) { const p = hexToWorld(active.pos); this.activeMarker.setPosition(p.x, p.y - (active.role === 'leader' ? 146 : 106)); }
  }
  refresh() {
    const active = getActive(this.state);
    if (active?.id !== this.lastActive) {
      this.lastActive = active?.id ?? '';
      const hasShot = active?.weapon.kind === 'ranged' && this.state.units.some(u => u.team !== active.team && previewAttack(this.state, active, u).allowed);
      this.view.mode = hasShot ? 'attack' : 'move';
      this.hoverHex = undefined; this.view.hoveredId = undefined; this.view.preview = undefined; this.view.composer = closedComposer();
      if (active) this.view.message = active.morale === 0 ? `${active.name} está em fuga.`
        : isPlayerControlled(active) ? `Sua vez · ${active.name}. Dê ordens (Enter), mova-se ou escolha um alvo.`
        : active.team === 'ally' ? `${active.name} ${active.order ? `cumpre: ${orderInfo(active.order.id).label}`
          : commanderOf(this.state, platoonOf(this.state, active)) ? 'segura a posição…' : 'age por conta própria…'}` : `${active.name} está agindo…`;
      if (active && isPlayerControlled(active) && !this.onScreen(active.pos, -160)) this.focusOn(active, true);
    }
    this.pathMap = active && this.playerCanAct() ? reachable(this.state, active) : new Map();
    if (!this.view.busy) this.syncPawns();
    this.drawGrid(); this.ui.update(this.state, this.view);
  }
  private drawGrid() {
    this.grid.clear(); this.pathGraphics.clear(); const active = getActive(this.state);
    if (!active || this.state.outcome !== 'ongoing' || this.view.paused || this.view.helpOpen) return;
    if (this.playerCanAct() && this.view.mode === 'move') for (const tile of this.state.tiles) if (this.pathMap.has(key(tile))) this.hex(this.grid, tile, COLORS.bone, 0.09, 0);
    this.hex(this.grid, active.pos, COLORS.gold, 0.08, 0.75, 2);
    if (isPlayerControlled(active) && commandedPlatoons(this.state, active).length) this.drawCommand(active);
    if (this.playerCanAct() && this.view.mode === 'attack') for (const enemy of this.state.units.filter(u => u.team !== active.team && !u.dead && !u.escaped)) {
      if (previewAttack(this.state, active, enemy).allowed) this.hex(this.grid, enemy.pos, COLORS.enemy, 0.13, 0.7, 2);
    }
    const path = this.hoverHex && this.pathMap.get(key(this.hoverHex));
    if (path && this.view.mode === 'move' && !this.view.hoveredId) {
      // Teal hexes along the way, a dotted trail between their centers and the destination in yellow.
      const g = this.pathGraphics;
      for (const step of path.slice(0, -1)) this.hex(g, step, PATH.fill, 0.34, 0.85, 1.5, PATH.edge);
      this.hex(g, this.hoverHex!, PATH.goal, 0.26, 1, 2.5);
      let previous = hexToWorld(active.pos);
      for (const step of path) {
        const p = hexToWorld(step), length = Math.hypot(p.x - previous.x, p.y - previous.y), dots = Math.max(1, Math.round(length / 11));
        for (let i = 1; i < dots; i++) g.fillStyle(PATH.dot, 0.95).fillCircle(previous.x + (p.x - previous.x) * i / dots, previous.y + (p.y - previous.y) * i / dots, 2);
        g.fillStyle(PATH.dot, 1).fillCircle(p.x, p.y, step === path[path.length - 1] ? 6 : 4.5);
        previous = p;
      }
    }
  }
  /** The command range outline and, while an order is under the cursor, who would hear it and who is too far. */
  private drawCommand(leader: Unit) {
    const range = leader.commandRange;
    this.grid.lineStyle(1.5, COLORS.gold, 0.5);
    for (const tile of this.state.tiles) {
      if (distance(tile, leader.pos) > range) continue;
      const p = hexToWorld(tile);
      for (const next of neighbors(tile)) {
        if (distance(next, leader.pos) <= range) continue;
        // The shared edge sits across the line between the two centers, 30° to each side.
        const n = hexToWorld(next), angle = Math.atan2(n.y - p.y, n.x - p.x), r = R - 1;
        this.grid.lineBetween(p.x + r * Math.cos(angle - Math.PI / 6), p.y + r * Math.sin(angle - Math.PI / 6),
          p.x + r * Math.cos(angle + Math.PI / 6), p.y + r * Math.sin(angle + Math.PI / 6));
      }
    }
    const composer = this.view.composer;
    if (composer.step !== 'text' || !composer.group || !this.playerCanAct()) return;
    // While the order is written: gold for who would take it, orange for who it would stress, red for who is too far to hear.
    const check = previewShout(this.state, leader, composer).check;
    const target = check?.target ?? composer.group, divisions = target === 'todos' ? ['guerreiros', 'arqueiros'] : [target];
    const changing = new Set(check?.allowed ? check.changing.map(u => u.id) : []), sudden = new Set(check?.allowed ? check.sudden.map(u => u.id) : []);
    for (const platoon of commandedPlatoons(this.state, leader)) for (const troop of platoonTroops(this.state, platoon.id)) {
      if (troop.id === leader.id || !divisions.includes(divisionOf(troop))) continue;
      if (distance(troop.pos, leader.pos) > range) this.hex(this.grid, troop.pos, COLORS.enemy, 0.05, 0.45, 1.5);
      else if (sudden.has(troop.id)) this.hex(this.grid, troop.pos, COLORS.stress, 0.16, 0.9, 2);
      else if (changing.has(troop.id)) this.hex(this.grid, troop.pos, COLORS.gold, 0.16, 0.85, 2);
      else this.hex(this.grid, troop.pos, COLORS.gold, 0.05, 0.35, 1.5);
    }
  }

  // Orders: "Dar ordens" opens the choice of who hears it, then a box for the words the leader shouts.
  private commanding() {
    const active = getActive(this.state);
    return this.playerCanAct() && !!active && commandedPlatoons(this.state, active).length > 0;
  }
  private openComposer() {
    if (!this.commanding()) return;
    const composer = this.view.composer;
    if (composer.step === 'text') { this.ui.focusComposer(); return; }
    this.view.composer = composer.step === 'group' ? closedComposer() : { step: 'group', text: '' };
    this.view.message = this.view.composer.step === 'group' ? 'Para quem é a ordem? 1 guerreiros, 2 arqueiros, 3 todos.' : '';
    this.drawGrid(); this.ui.update(this.state, this.view);
  }
  private chooseGroup(group: OrderTarget) {
    if (!this.commanding()) return;
    // The box starts with the group's name, as the leader would call it.
    this.view.composer = { step: 'text', group, text: `${VOCATIVES[group]}, ` };
    this.view.message = 'Escreva a ordem e aperte Enter para gritar.';
    this.drawGrid(); this.ui.update(this.state, this.view);
  }
  private closeComposer() {
    if (this.view.composer.step === 'closed') return;
    this.view.composer = closedComposer();
    this.view.message = '';
    this.drawGrid(); this.ui.update(this.state, this.view);
  }
  private submitOrder(text: string) {
    const group = this.view.composer.group;
    if (!this.commanding() || !group) return;
    const result = shoutOrder(this.state, text, group);
    if (!result.ok) {
      // The troops did not follow: the box stays open with their answer, and no PL was spent.
      this.view.composer = { ...this.view.composer, text, warning: result.message };
      this.view.message = result.message;
      this.ui.update(this.state, this.view);
      return;
    }
    this.view.composer = closedComposer();
    void this.execute(() => result);
  }
  private playerCanAct() {
    const active = getActive(this.state);
    return !!active && isPlayerControlled(active) && this.state.outcome === 'ongoing' && !this.view.busy && !this.view.paused && !this.view.helpOpen;
  }
  private atPointer(pointer: Phaser.Input.Pointer): { hex?: Hex; unit?: Unit; x: number; y: number } {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const unit = this.state.units.filter(u => !u.dead && !u.escaped).sort((a, b) => b.pos.r - a.pos.r).find(u => {
      const p = hexToWorld(u.pos); return Math.abs(p.x - world.x) < 34 && world.y > p.y - 88 && world.y < p.y + 13;
    });
    return { hex: unit?.pos ?? worldToHex(this.state, world.x, world.y), unit, x: world.x, y: world.y };
  }

  // Pointer: a press that moves becomes a camera drag; a press that stays put is a click.
  private pointerDown(pointer: Phaser.Input.Pointer) {
    const cam = this.cameras.main;
    this.drag = { x: pointer.x, y: pointer.y, scrollX: cam.scrollX, scrollY: cam.scrollY, moved: false };
  }
  private pointerMove(pointer: Phaser.Input.Pointer) {
    if (this.drag && pointer.isDown) {
      const dx = pointer.x - this.drag.x, dy = pointer.y - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      const cam = this.cameras.main;
      this.drag.moved = true; this.pointerTip.setVisible(false); this.game.canvas.style.cursor = 'grabbing';
      cam.setScroll(this.drag.scrollX - dx / cam.zoom, this.drag.scrollY - dy / cam.zoom); this.clampCamera();
      return;
    }
    this.hover(pointer);
  }
  private pointerUp(pointer: Phaser.Input.Pointer) {
    const drag = this.drag; this.drag = undefined;
    if (!drag) return;
    if (drag.moved) { this.game.canvas.style.cursor = 'default'; this.hover(pointer); return; }
    this.click(pointer);
  }
  private hover(pointer: Phaser.Input.Pointer) {
    if (this.view.busy || this.view.helpOpen || this.view.paused) return;
    const hit = this.atPointer(pointer); this.hoverHex = hit.hex; this.view.hoveredId = hit.unit?.id; this.view.preview = undefined;
    const active = getActive(this.state); let tip = '';
    if (active && hit.unit && active.team !== hit.unit.team && this.playerCanAct()) {
      this.view.preview = previewAttack(this.state, active, hit.unit);
      tip = this.view.preview.allowed ? `${hit.unit.name} · ${this.view.preview.chance}% de acerto\n${this.view.preview.ap} PA · +${this.view.preview.fatigue} fadiga` : this.view.preview.reason;
      if (this.view.preview.allowed && this.view.preview.friendlyRisk > 0) tip += `\nRisco de acertar aliado: ${this.view.preview.friendlyRisk}%`;
    } else if (hit.hex && !hit.unit && this.playerCanAct()) {
      const tile = tileAt(this.state, hit.hex), path = this.pathMap.get(key(hit.hex));
      if (tile?.obstacle) tip = 'Obstáculo · bloqueia passagem e visão';
      else if (path && this.view.mode === 'move') {
        const ap = path.reduce((sum, step) => sum + moveAp(tileAt(this.state, step)!), 0);
        tip = `Mover · ${path.length} ${path.length === 1 ? 'hexágono' : 'hexágonos'}\n${ap} PA · +${ap * 2} fadiga`;
        const departures = [active!.pos, ...path.slice(0, -1)];
        if (this.state.units.some(u => u.team !== active?.team && !u.dead && !u.escaped && u.weapon.kind === 'melee' && u.morale > 0 && departures.some(pos => distance(pos, u.pos) === 1))) tip += '\nEste caminho pode provocar um ataque.';
      }
    }
    // The tooltip lives in the world, so it is scaled back to a constant on-screen size.
    const cam = this.cameras.main, bounds = cam.worldView, scale = 1 / cam.zoom;
    this.pointerTip.setText(tip).setVisible(!!tip).setScale(scale);
    this.pointerTip.setPosition(
      Math.min(hit.x + 24 * scale, bounds.right - this.pointerTip.displayWidth - 18 * scale),
      Math.max(bounds.top + 80 * scale, Math.min(hit.y + 24 * scale, bounds.bottom - 240 * scale - this.pointerTip.displayHeight)));
    this.game.canvas.style.cursor = hit.unit && active && hit.unit.team !== active.team ? 'crosshair' : hit.hex && this.pathMap.has(key(hit.hex)) ? 'pointer' : 'default';
    this.syncPawns(); this.drawGrid(); this.ui.update(this.state, this.view);
  }
  private clearHover() {
    this.hoverHex = undefined; this.view.hoveredId = undefined; this.view.preview = undefined; this.pointerTip?.setVisible(false);
    if (this.ui && !this.view.busy) { this.syncPawns(); this.drawGrid(); this.ui.update(this.state, this.view); }
  }
  private click(pointer: Phaser.Input.Pointer) {
    if (!this.playerCanAct()) return;
    if (pointer.button === 2) { this.view.mode = 'move'; this.refresh(); return; }
    const hit = this.atPointer(pointer), active = getActive(this.state)!;
    if (hit.unit && hit.unit.team !== active.team) void this.execute(() => attack(this.state, hit.unit!.id));
    else if (hit.hex && !hit.unit && this.view.mode === 'move') void this.execute(() => move(this.state, hit.hex!));
    else if (hit.unit && hit.unit.id !== active.id) {
      const commander = commanderOf(this.state, platoonOf(this.state, hit.unit));
      this.view.message = hit.unit.role === 'troop' && hit.unit.team === 'ally'
        ? `${hit.unit.name} é uma tropa: ${commander ? `cumpre as ordens de ${commander.name}. Use a aba de comando.` : 'luta por conta própria.'}`
        : `${hit.unit.name} aguardará sua vez na ordem dos turnos.`;
      this.ui.update(this.state, this.view);
    }
  }
  private keyboard(event: KeyboardEvent) {
    if (event.repeat && !event.code.startsWith('Arrow')) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      if (this.view.helpOpen) { this.view.helpOpen = false; this.refresh(); this.scheduleAi(); }
      else if (this.view.composer.step !== 'closed') this.closeComposer();
      else this.togglePause();
      return;
    }
    if (event.code === 'KeyG') { this.showGrid = !this.showGrid; this.gridLines.setVisible(this.showGrid); return; }
    const pan: Record<string, [number, number]> = { ArrowLeft: [-160, 0], ArrowRight: [160, 0], ArrowUp: [0, -160], ArrowDown: [0, 160] };
    if (pan[event.code]) { event.preventDefault(); this.panBy(...pan[event.code]); return; }
    if (event.code === 'Equal' || event.code === 'NumpadAdd') { this.zoomAt(this.scale.width / 2, this.scale.height / 2, 1.12); return; }
    if (event.code === 'Minus' || event.code === 'NumpadSubtract') { this.zoomAt(this.scale.width / 2, this.scale.height / 2, 1 / 1.12); return; }
    if (event.code === 'KeyC') { this.focusOn(getActive(this.state), true); return; }
    if (event.code === 'KeyV') { this.cycleSpeed(); return; }
    if (!this.playerCanAct()) return;
    if (event.code === 'Enter' || event.code === 'NumpadEnter') { event.preventDefault(); this.openComposer(); return; }
    // Choosing who hears the order: 1 guerreiros, 2 arqueiros, 3 todos.
    const digit = /^(?:Digit|Numpad)([1-3])$/.exec(event.code);
    if (this.view.composer.step === 'group') {
      if (digit) { event.preventDefault(); this.chooseGroup(ORDER_GROUPS[Number(digit[1]) - 1]); }
      return;
    }
    if (event.code === 'Digit1') { this.view.mode = 'move'; this.refresh(); }
    if (event.code === 'Digit2') { this.view.mode = 'attack'; this.refresh(); }
    if (event.code === 'KeyW') { event.preventDefault(); void this.execute(() => waitTurn(this.state)); }
    if (event.code === 'Space' && target.tagName !== 'BUTTON') { event.preventDefault(); void this.execute(() => endTurn(this.state)); }
  }
  private cycleSpeed() {
    this.view.speed = SPEEDS[(SPEEDS.indexOf(this.view.speed) + 1) % SPEEDS.length];
    this.applySpeed(); this.ui.update(this.state, this.view);
  }
  private applySpeed() {
    this.tweens.timeScale = this.view.speed; this.time.timeScale = this.view.speed;
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
    this.state = createBattle(SEED, 'campo-aberto'); this.lastActive = ''; this.lastActor = '';
    this.view = { mode: 'move', paused: false, helpOpen: false, busy: false, speed: this.view.speed, composer: closedComposer(),
      message: `Uma nova tentativa. Conduza ${this.playerLeader()?.name ?? 'o pelotão'} à vitória.` };
    this.pointerTip.setVisible(false); this.focusOn(this.playerLeader()); this.refresh(); this.scheduleAi();
  }
  private async execute(action: () => ActionResult) {
    if (this.view.busy || this.state.outcome !== 'ongoing') return;
    const generation = this.generation, actor = getActive(this.state)?.id ?? '', result = action();
    this.view.message = result.message; this.pointerTip.setVisible(false);
    if (!result.ok) { this.ui.update(this.state, this.view); return; }
    this.lastActor = actor; this.view.composer = closedComposer();
    this.view.busy = true; this.grid.clear(); this.pathGraphics.clear(); this.ui.update(this.state, this.view);
    for (const event of result.events) { if (generation !== this.generation) return; await this.animateEvent(event); }
    if (generation !== this.generation) return;
    this.view.busy = false; this.refresh(); this.scheduleAi();
  }
  /**
   * A group turn: the AI plays the platoon's members one after another, and their marches play together, so a platoon
   * moving takes about the time of one troop. It stops at the first blow, shout or flight, which then plays on its own.
   */
  private async executeGroup(platoonId: string) {
    if (this.view.busy || this.state.outcome !== 'ongoing') return;
    const generation = this.generation, marches = new Map<string, BattleEvent[]>(), rest: BattleEvent[] = [];
    let message = '', played = 0;
    for (let step = 0; step < 400 && !rest.length; step++) {
      const active = getActive(this.state);
      if (!active || this.state.outcome !== 'ongoing' || isPlayerControlled(active) || groupTurnOf(this.state, active)?.id !== platoonId) break;
      const result = performAiAction(this.state);
      if (!result.ok) {
        if (!played) { this.view.message = result.message; this.ui.update(this.state, this.view); return; }
        break;
      }
      played++;
      this.lastActor = active.id; message = result.message ?? message;
      for (const event of result.events) {
        if (event.type === 'move' && !rest.length && event.unitId) marches.set(event.unitId, [...(marches.get(event.unitId) ?? []), event]);
        else if (event.type !== 'turn' && event.type !== 'info') rest.push(event);
      }
    }
    this.view.message = message; this.pointerTip.setVisible(false); this.view.composer = closedComposer();
    this.view.busy = true; this.grid.clear(); this.pathGraphics.clear(); this.ui.update(this.state, this.view);
    await Promise.all([...marches.values()].map(async steps => { for (const event of steps) { if (generation !== this.generation) return; await this.animateEvent(event); } }));
    for (const event of rest) { if (generation !== this.generation) return; await this.animateEvent(event); }
    if (generation !== this.generation) return;
    this.view.busy = false; this.refresh(); this.scheduleAi();
  }
  private async animateEvent(event: BattleEvent) {
    const pawn = event.unitId ? this.pawns.get(event.unitId) : undefined;
    if (event.type === 'order' && pawn && event.order) {
      const leader = this.state.units.find(u => u.id === event.unitId)!;
      if (!this.onScreen(leader.pos, 120)) return;
      await this.shout(leader, event.words ?? orderInfo(event.order).call);
      return;
    }
    if (event.type === 'move' && pawn && event.to) {
      const p = hexToWorld(event.to); pawn.base.clear(); pawn.bar.clear(); pawn.flag.clear(); pawn.label.setVisible(false);
      // Off-camera movement resolves instantly so a 40-unit round does not crawl.
      if (!this.onScreen(event.to, 120) && (!event.from || !this.onScreen(event.from, 120))) { pawn.image.setPosition(p.x, p.y + 7).setDepth(100 + p.y); return; }
      await new Promise<void>(resolve => this.tweens.add({ targets: pawn.image, x: p.x, y: p.y + 7, duration: 120, ease: 'Sine.easeInOut', onComplete: () => { pawn.image.setDepth(100 + p.y); resolve(); } }));
    }
    if (event.type === 'attack' && pawn && event.targetId) {
      const targetPawn = this.pawns.get(event.targetId); if (!targetPawn) return;
      const attacker = this.state.units.find(u => u.id === event.unitId)!, target = this.state.units.find(u => u.id === event.targetId)!;
      if (!this.onScreen(attacker.pos, 120) && !this.onScreen(target.pos, 120)) return;
      const a = { x: pawn.image.x, y: pawn.image.y - 7 }, b = { x: targetPawn.image.x, y: targetPawn.image.y - 7 };
      if (attacker.weapon.kind === 'ranged') {
        // A stray arrow glances off the enemy it missed and drops onto the friend beside it.
        const start = event.stray && event.from ? hexToWorld(event.from) : a;
        const arrow = this.add.rectangle(start.x, start.y - 38, 19, 2, event.stray ? 0xe0b46a : COLORS.bone).setRotation(Math.atan2(b.y - start.y, b.x - start.x)).setDepth(1400);
        this.transient.add(arrow);
        await new Promise<void>(resolve => this.tweens.add({ targets: arrow, x: b.x, y: b.y - 38, duration: event.stray ? 160 : 210, onComplete: () => { arrow.destroy(); this.transient.delete(arrow); resolve(); } }));
      } else await new Promise<void>(resolve => this.tweens.add({ targets: pawn.image, x: a.x + (b.x - a.x) * 0.25, y: a.y + 7 + (b.y - a.y) * 0.15, duration: 95, yoyo: true, onComplete: () => resolve() }));
      if (event.hit) { targetPawn.image.setTint(0xe39d89); this.time.delayedCall(130, () => targetPawn.image.clearTint()); }
      const text = this.add.text(b.x, b.y - 100, event.hit ? event.damage ? `−${event.damage}` : 'ARMADURA' : 'ERROU', { fontFamily: 'Arial', fontSize: event.damage ? '25px' : '15px', fontStyle: 'bold', color: event.hit ? '#edaa93' : '#d7d7c5', stroke: '#1a2119', strokeThickness: 4 }).setOrigin(0.5).setDepth(1600);
      this.transient.add(text);
      this.tweens.add({ targets: text, y: b.y - 137, alpha: 0, duration: 1050, delay: 170, onComplete: () => { text.destroy(); this.transient.delete(text); } });
      if (event.stray) {
        const tag = this.add.text(b.x, b.y - 124, 'FLECHA PERDIDA', { fontFamily: 'Arial', fontSize: '13px', fontStyle: 'bold', color: '#e0b46a', stroke: '#1a2119', strokeThickness: 4 }).setOrigin(0.5).setDepth(1600);
        this.transient.add(tag);
        this.tweens.add({ targets: tag, y: b.y - 161, alpha: 0, duration: 1050, delay: 420, onComplete: () => { tag.destroy(); this.transient.delete(tag); } });
      }
    }
  }
  /** A leader calls an order: the words rise over the leader and a ring sweeps out to the command range. */
  private shout(leader: Unit, words: string) {
    const p = hexToWorld(leader.pos), color = leader.team === 'ally' ? '#e2c99f' : '#efb3a3';
    const ring = this.add.graphics().setDepth(3), sweep = { radius: 30, alpha: 0.7 };
    // The player's own words, wrapped so a long shout stays over the leader.
    const text = this.add.text(p.x, p.y - 138, words, { fontFamily: TEXT_FONT, fontSize: '24px', fontStyle: 'bold', color, stroke: '#151b19', strokeThickness: 5,
      align: 'center', wordWrap: { width: 440 } }).setOrigin(0.5, 1).setDepth(1600);
    this.transient.add(ring); this.transient.add(text);
    const radius = Math.max(60, leader.commandRange * DX);
    this.tweens.add({ targets: sweep, radius, alpha: 0, duration: 650, ease: 'Sine.easeOut',
      onUpdate: () => ring.clear().lineStyle(3, COLORS.gold, sweep.alpha).strokeCircle(p.x, p.y, sweep.radius),
      onComplete: () => { ring.destroy(); this.transient.delete(ring); } });
    this.tweens.add({ targets: text, y: p.y - 162, alpha: 0, duration: 900, delay: 1300, onComplete: () => { text.destroy(); this.transient.delete(text); } });
    return new Promise<void>(resolve => this.time.delayedCall(420, resolve));
  }
  /** Runs the next AI step. Units the player cannot command (troops, enemies, fleeing leaders) all go through here. */
  private scheduleAi() {
    this.aiTimer?.remove(); const active = getActive(this.state);
    if (!active || this.state.outcome !== 'ongoing' || this.view.busy || this.view.paused || this.view.helpOpen || isPlayerControlled(active)) return;
    const delay = !this.onScreen(active.pos, 60) ? 30 : active.id === this.lastActor ? AI_DELAY * 0.3 : AI_DELAY;
    const group = groupTurnOf(this.state, active);
    this.aiTimer = this.time.delayedCall(delay, () => {
      if (this.view.paused || this.view.helpOpen || this.view.busy) return;
      void (group ? this.executeGroup(group.id) : this.execute(() => performAiAction(this.state)));
    });
  }
}
