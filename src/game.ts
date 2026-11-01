/** Pure, deterministic combat rules. Coordinates are odd-r offset (q=column, r=row). */
export interface Hex { q: number; r: number }
export type Team = 'ally' | 'enemy';
/** Only leaders take player commands; troops are always driven by the AI. */
export type Role = 'leader' | 'troop';
export type LeaderClass = 'combate' | 'estrategico' | 'encorajador';
/** Order groups inside a platoon: bows and crossbows are archers, everyone else is a warrior. */
export type Division = 'guerreiros' | 'arqueiros';
export type UnitAsset = 'iria' | 'tome' | 'nara' | 'raider' | 'husk' | 'captain' | 'warlord';
export type EncounterId = 'emboscada' | 'campo-aberto';
export type OrderId = 'avanco-devagar' | 'avanco-rapido' | 'linha-defensiva' | 'levantar-escudos'
  | 'arqueiros-disparem' | 'arqueiros-preparar' | 'atacar';
/** Who an order goes to: one division of the platoon, or both. */
export type OrderTarget = 'todos' | Division;
export interface Tile extends Hex {
  terrain: 'grass' | 'rough';
  obstacle?: 'rocks' | 'ruin' | 'deadtree';
}
export interface Weapon {
  name: string;
  kind: 'melee' | 'ranged';
  minDamage: number;
  maxDamage: number;
  /** Damage multiplier against armor, e.g. 1.1 means 110%. */
  armorDamage: number;
  /** Fraction of regular damage that can penetrate intact armor. */
  penetration: number;
  ap: number;
  fatigue: number;
  range: number;
  accuracy: number;
  ammo?: number;
}
export interface Unit {
  id: string; name: string; team: Team;
  asset: UnitAsset;
  role: Role;
  leaderClass?: LeaderClass;
  /** The player's own character, the faction's Líder Supremo. */
  supreme?: boolean;
  platoonId?: string;
  pos: Hex; hp: number; maxHp: number;
  headArmor: number; maxHeadArmor: number;
  bodyArmor: number; maxBodyArmor: number;
  ap: number; maxAp: number; fatigue: number; maxFatigue: number;
  initiative: number; meleeSkill: number; rangedSkill: number;
  meleeDefense: number; rangedDefense: number; resolve: number;
  /** 0 fleeing, 1 breaking, 2 wavering, 3 steady, 4 confident. */
  morale: 0 | 1 | 2 | 3 | 4;
  weapon: Weapon; dead: boolean; escaped: boolean; waited: boolean;
  /** One-handed fighters carry a shield, which is what "Levantar escudos!" raises. */
  shield: boolean;
  /** Pontos de liderança: leaders and interim commanders spend them on orders. Renewed on each turn. */
  pl: number; maxPl: number;
  /** Hex distance an order reaches. */
  commandRange: number;
  /** Multiplies the bonuses of the orders this unit gives. */
  potency: number;
  /** The order this troop follows. Without one it holds position. */
  order?: TroopOrder;
}
export interface TroopOrder {
  id: OrderId;
  /** Last round the order runs. The division's cooldown ends with it. */
  expiresRound: number;
  potency: number;
  /** Out of the commander's range when the order ran out: the troop keeps following it, without the bonus. */
  stale: boolean;
  /** Atacar!: the first-attack bonus is spent. */
  strikeUsed: boolean;
  /** Arqueiros, preparar disparo!: the aimed target and the round the aim was taken. */
  aimTargetId?: string; aimRound?: number;
}
/** A leader and the troops assigned to them. */
export interface Platoon {
  id: string; team: Team; name: string;
  /** null once the leader falls or leaves the field. */
  leaderId: string | null;
  /** Who gives the orders: the leader, or the interim commander once no leader is left on the side. */
  commanderId: string | null;
  /** First round in which each division can take a new order. */
  readyRound: Record<Division, number>;
  /** The latest order given to each division. */
  lastOrder: Partial<Record<Division, { id: OrderId; expiresRound: number }>>;
}
export type PlatoonSetup = Pick<Platoon, 'id' | 'team' | 'name' | 'leaderId'>;
export interface BattleState {
  encounter: EncounterId;
  /** Board size in hexes. Tiles are stored row by row, so a tile's index is r * width + q. */
  width: number; height: number;
  seed: number; round: number; tiles: Tile[]; units: Unit[]; queue: string[];
  platoons: Platoon[];
  outcome: 'ongoing' | 'victory' | 'defeat'; log: string[];
  /** Why the battle ended: one side was routed, or a supreme leader fell. */
  endReason?: 'rout' | 'supreme';
  rngState: number;
  /** Round in which each unit last moved. The AI moves at most once per round. */
  movedRound: Record<string, number>;
  /** Last round in which anyone struck a blow. */
  lastClashRound: number;
  activatedRound: Record<string, number>;
  waitPenaltyNextRound: Record<string, boolean>;
  adjacentThreats: Record<string, number>;
}
export interface BattleEvent {
  type: 'move' | 'attack' | 'death' | 'flee' | 'turn' | 'info' | 'order';
  unitId?: string; targetId?: string; from?: Hex; to?: Hex; order?: OrderId;
  hit?: boolean; damage?: number; message?: string;
  armorDamage?: number; location?: 'head' | 'body';
}
export interface ActionResult { ok: boolean; message: string; events: BattleEvent[] }
export interface AttackPreview { allowed: boolean; reason: string; chance: number; ap: number; fatigue: number }

export const key = ({ q, r }: Hex): string => `${q},${r}`;
const same = (a: Hex, b: Hex): boolean => a.q === b.q && a.r === b.r;
const alive = (u: Unit): boolean => !u.dead && !u.escaped;
export const isAlive = alive;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const cube = (h: Hex): [number, number, number] => {
  const x = h.q - (h.r - (h.r & 1)) / 2;
  return [x, -x - h.r, h.r];
};
export function distance(a: Hex, b: Hex): number {
  const ac = cube(a), bc = cube(b);
  return Math.max(...ac.map((v, i) => Math.abs(v - bc[i])));
}
export function neighbors(h: Hex): Hex[] {
  const offsets = h.r & 1
    ? [[1, 0], [-1, 0], [0, -1], [1, -1], [0, 1], [1, 1]]
    : [[1, 0], [-1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
  return offsets.map(([q, r]) => ({ q: h.q + q, r: h.r + r }));
}
function roll(s: BattleState, low: number, high: number): number {
  let n = s.rngState;
  n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
  s.rngState = n >>> 0;
  return low + Math.floor((s.rngState / 4294967296) * (high - low + 1));
}
export const tileAt = (s: BattleState, h: Hex): Tile | undefined =>
  h.q >= 0 && h.q < s.width && h.r >= 0 && h.r < s.height ? s.tiles[h.r * s.width + h.q] : undefined;
const occupant = (s: BattleState, h: Hex): Unit | undefined => s.units.find(u => alive(u) && same(u.pos, h));
/** AP cost to enter a tile; movement fatigue is always twice this. */
export const moveAp = (tile: Tile): number => tile.terrain === 'rough' ? 3 : 2;
const moraleFactor = (u: Unit): number => u.morale === 4 ? 1.1 : 0.7 + u.morale * 0.1;
export const adjacentEnemies = (s: BattleState, u: Unit, at = u.pos): Unit[] => s.units.filter(v =>
  alive(v) && v.team !== u.team && distance(v.pos, at) === 1);
/** Enemies whose zone of control holds this hex: adjacent, armed for melee and not fleeing. */
export const controllers = (s: BattleState, u: Unit, at = u.pos): Unit[] => adjacentEnemies(s, u, at)
  .filter(v => v.weapon.kind === 'melee' && v.morale > 0);

export function getActive(s: BattleState): Unit | undefined {
  return s.units.find(u => u.id === s.queue[0] && alive(u));
}

/** Dijkstra uses actual terrain costs; movement fatigue is always twice its AP cost. */
export function reachable(s: BattleState, unit: Unit): Map<string, Hex[]> {
  const paths = new Map<string, Hex[]>();
  if (!alive(unit) || s.outcome !== 'ongoing') return paths;
  const occupied = new Set(s.units.filter(u => alive(u) && u.id !== unit.id).map(u => key(u.pos)));
  const best = new Map<string, number>([[key(unit.pos), 0]]);
  const pending: { hex: Hex; cost: number; path: Hex[] }[] = [{ hex: unit.pos, cost: 0, path: [] }];
  while (pending.length) {
    pending.sort((a, b) => a.cost - b.cost);
    const current = pending.shift()!;
    if (current.cost !== best.get(key(current.hex))) continue;
    for (const hex of neighbors(current.hex)) {
      const k = key(hex), tile = tileAt(s, hex);
      if (!tile || tile.obstacle || occupied.has(k)) continue;
      const cost = current.cost + moveAp(tile);
      if (cost > unit.ap || unit.fatigue + cost * 2 > unit.maxFatigue || cost >= (best.get(k) ?? Infinity)) continue;
      const path = [...current.path, hex];
      best.set(k, cost); paths.set(k, path); pending.push({ hex, cost, path });
    }
  }
  return paths;
}

function roundedHex(values: number[]): Hex {
  const rounded = values.map(Math.round);
  const errors = rounded.map((v, i) => Math.abs(v - values[i]));
  const largest = errors.indexOf(Math.max(...errors));
  rounded[largest] = -rounded[(largest + 1) % 3] - rounded[(largest + 2) % 3];
  return { q: rounded[0] + (rounded[2] - (rounded[2] & 1)) / 2, r: rounded[2] };
}
/** Prototype LOS: solid obstacles and standing units fully block a single center ray. */
function clearLine(s: BattleState, from: Hex, to: Hex): boolean {
  const length = distance(from, to), a = cube(from), b = cube(to);
  for (let i = 1; i < length; i++) {
    const hex = roundedHex(a.map((v, axis) => v + (b[axis] - v) * i / length));
    if (tileAt(s, hex)?.obstacle || occupant(s, hex)) return false;
  }
  return true;
}

/** The order a troop follows, if it still carries its bonus. */
const bonusOrder = (u: Unit, id: OrderId): TroopOrder | undefined =>
  u.order && !u.order.stale && u.order.id === id ? u.order : undefined;
/** Defense granted by the target's order: the defensive line against melee, raised shields against both. */
export function orderDefense(target: Unit, melee: boolean): number {
  const line = bonusOrder(target, 'linha-defensiva'), shields = bonusOrder(target, 'levantar-escudos');
  return (line && melee ? ORDER_BONUS.linha * line.potency : 0) + (shields && target.shield ? ORDER_BONUS.escudos * shields.potency : 0);
}
/** Attack granted by the attacker's order. Reaction strikes never use it. */
export function orderAttack(s: BattleState, unit: Unit, target: Unit, reaction = false): number {
  if (reaction) return 0;
  const charge = bonusOrder(unit, 'atacar'), aim = bonusOrder(unit, 'arqueiros-preparar');
  const aimed = aim && unit.weapon.kind === 'ranged' && aim.aimTargetId === target.id && aim.aimRound !== undefined && aim.aimRound < s.round;
  return (charge && !charge.strikeUsed ? ORDER_BONUS.atacar * charge.potency : 0) + (aimed ? ORDER_BONUS.mira * aim.potency : 0);
}
export function hitChance(s: BattleState, unit: Unit, target: Unit, reaction = false): number {
  const melee = unit.weapon.kind === 'melee';
  const attackSkill = (melee ? unit.meleeSkill : unit.rangedSkill) * moraleFactor(unit) + orderAttack(s, unit, target, reaction);
  let defense = (melee ? target.meleeDefense : target.rangedDefense) * moraleFactor(target) + orderDefense(target, melee);
  if (defense > 50) defense = 50 + (defense - 50) / 2;
  const surrounding = melee ? Math.max(0, s.units.filter(v => alive(v) && v.team === unit.team
    && v.weapon.kind === 'melee' && v.morale > 0 && distance(v.pos, target.pos) === 1).length - 1) * 5 : 0;
  const rangePenalty = melee ? 0 : Math.max(0, distance(unit.pos, target.pos) - 2) * 4;
  return Math.round(clamp(attackSkill + unit.weapon.accuracy - defense + surrounding - rangePenalty, 5, 95));
}
/** Why this unit cannot strike the target, or '' when it can. Costs are checked only when asked. */
function strikeBlocker(s: BattleState, unit: Unit, target: Unit, checkCosts: boolean): string {
  if (s.outcome !== 'ongoing') return 'O combate terminou.';
  if (!alive(unit) || !alive(target)) return 'Combatente indisponível.';
  if (unit.team === target.team) return 'Escolha um inimigo.';
  if (unit.morale === 0) return 'Em fuga: controle automático.';
  if (checkCosts && unit.ap < unit.weapon.ap) return 'Pontos de ação insuficientes.';
  if (checkCosts && unit.fatigue + unit.weapon.fatigue > unit.maxFatigue) return 'Fadiga alta demais para atacar.';
  if (unit.weapon.ammo !== undefined && unit.weapon.ammo <= 0) return 'Sem flechas.';
  if (unit.weapon.kind === 'ranged' && controllers(s, unit).length) return 'Engajado: não é possível disparar.';
  if (distance(unit.pos, target.pos) > unit.weapon.range) return 'Fora de alcance.';
  if (unit.weapon.kind === 'ranged' && !clearLine(s, unit.pos, target.pos)) return 'Linha de tiro bloqueada.';
  return '';
}
export function previewAttack(s: BattleState, unit: Unit, target: Unit): AttackPreview {
  const reason = strikeBlocker(s, unit, target, true);
  return { chance: hitChance(s, unit, target), ap: unit.weapon.ap, fatigue: unit.weapon.fatigue, allowed: !reason, reason };
}
/** True when a ranged unit has a clear shot at the target right now, whatever its PA. */
export const hasShot = (s: BattleState, unit: Unit, target: Unit): boolean =>
  unit.weapon.kind === 'ranged' && !strikeBlocker(s, unit, target, false);

/** Average outcome of one hit, mirroring resolveStrike: 25% head, 75% body, damage sampled across the weapon's range. */
export function expectedDamage(weapon: Weapon, target: Unit): { hp: number; armor: number; kill: number } {
  const samples = 5;
  let hp = 0, armor = 0, kill = 0;
  for (const [head, weight] of [[true, 0.25], [false, 0.75]] as const) {
    const current = head ? target.headArmor : target.bodyArmor;
    for (let i = 0; i < samples; i++) {
      const raw = weapon.minDamage + (weapon.maxDamage - weapon.minDamage) * i / (samples - 1);
      const absorbed = Math.min(current, Math.floor(raw * weapon.armorDamage));
      const left = current - absorbed;
      const penetration = Math.max(0, raw * weapon.penetration - left * 0.1);
      const overflow = left === 0 ? Math.max(0, raw * (1 - weapon.penetration) - absorbed) : 0;
      const damage = Math.floor((penetration + overflow) * (head ? 1.5 : 1));
      hp += weight * Math.min(damage, target.hp) / samples;
      armor += weight * absorbed / samples;
      if (damage >= target.hp) kill += weight / samples;
    }
  }
  return { hp, armor, kill };
}

function emit(s: BattleState, events: BattleEvent[], event: BattleEvent): void {
  events.push(event);
  if (event.message) {
    s.log.push(event.message);
    if (s.log.length > 100) s.log.splice(0, s.log.length - 100);
  }
}
const reject = (message: string): ActionResult => ({ ok: false, message, events: [] });
const done = (events: BattleEvent[], message = ''): ActionResult => ({ ok: true, message: message || events.at(-1)?.message || '', events });

function checkOutcome(s: BattleState, events: BattleEvent[]): boolean {
  if (s.outcome !== 'ongoing') return true;
  // A supreme leader's death ends the battle on the spot: for the player, it ends the campaign.
  const supreme = s.units.find(u => u.supreme && u.dead);
  if (supreme) {
    s.outcome = supreme.team === 'ally' ? 'defeat' : 'victory';
    s.endReason = 'supreme';
    s.queue = [];
    emit(s, events, { type: 'info', message: supreme.team === 'ally'
      ? `Derrota. ${supreme.name} caiu, e com ele a campanha.` : `Vitória. ${supreme.name}, o líder supremo inimigo, caiu.` });
    return true;
  }
  const allies = s.units.some(u => u.team === 'ally' && alive(u));
  const enemies = s.units.some(u => u.team === 'enemy' && alive(u));
  if (allies && enemies) return false;
  s.outcome = allies ? 'victory' : 'defeat';
  s.endReason = 'rout';
  s.queue = [];
  emit(s, events, { type: 'info', message: allies ? 'Vitória. O campo é nosso.' : 'Derrota. Nossas tropas caíram.' });
  return true;
}

/** A commander who falls or leaves the field stops giving orders; the side may need an interim commander. */
function releaseCommand(s: BattleState, unit: Unit, events: BattleEvent[]): void {
  let released = false;
  for (const platoon of s.platoons) {
    if (platoon.leaderId === unit.id) {
      platoon.leaderId = null;
      emit(s, events, { type: 'info', unitId: unit.id, message: `${platoon.name} ficou sem líder.` });
    }
    if (platoon.commanderId === unit.id) { platoon.commanderId = null; released = true; }
  }
  if (released && !unit.supreme) appointInterim(s, unit.team, unit.pos, events);
}

/**
 * With no leader alive on the side, the troop with the highest attribute score takes command of every
 * platoon left without one. It is AI-only. Handing troops to another living leader comes in phase 4.
 */
function appointInterim(s: BattleState, team: Team, near: Hex, events: BattleEvent[]): void {
  const orphaned = s.platoons.filter(p => p.team === team && !p.commanderId);
  if (!orphaned.length || s.units.some(u => u.team === team && u.role === 'leader' && alive(u))) return;
  const candidates = s.units.filter(u => u.team === team && u.role === 'troop' && alive(u) && u.morale > 0);
  if (!candidates.length) return;
  candidates.sort((a, b) => attributeScore(b) - attributeScore(a) || b.resolve - a.resolve
    || distance(a.pos, near) - distance(b.pos, near) || a.id.localeCompare(b.id));
  const chosen = candidates[0];
  chosen.maxPl = INTERIM_COMMAND.pl; chosen.commandRange = INTERIM_COMMAND.range; chosen.potency = INTERIM_COMMAND.potency;
  if (s.activatedRound[chosen.id] !== s.round) chosen.pl = 0;
  for (const platoon of orphaned) platoon.commanderId = chosen.id;
  emit(s, events, { type: 'info', unitId: chosen.id, message: `${chosen.name} assume o comando interino.` });
}

/** Morale events use Resolve, nearby allies/enemies and wounds; no campaign mood or perks yet. */
function moraleCheck(s: BattleState, unit: Unit, positive: boolean, events: BattleEvent[], woundPenalty = 0): void {
  if (!alive(unit) || (positive ? unit.morale >= 4 || unit.morale === 0 : unit.morale === 0)) return;
  const friendly = s.units.filter(v => alive(v) && v.team === unit.team && v.id !== unit.id && distance(v.pos, unit.pos) === 1).length;
  const hostile = adjacentEnemies(s, unit).length;
  const resolve = unit.resolve * Math.min(1, moraleFactor(unit));
  const chance = clamp(resolve + 3 * friendly - 3 * hostile - woundPenalty, 0, 95);
  const succeeds = roll(s, 1, 100) <= chance;
  if (positive ? !succeeds : succeeds) return;
  unit.morale = clamp(unit.morale + (positive ? 1 : -1), 0, 4) as Unit['morale'];
  const labels = ['em fuga', 'à beira do pânico', 'abalado', 'estável', 'confiante'];
  emit(s, events, { type: unit.morale === 0 ? 'flee' : 'info', unitId: unit.id,
    message: `${unit.name} está ${labels[unit.morale]}.` });
  if (unit.morale === 0 && s.queue[0] !== unit.id && s.queue.includes(unit.id)) {
    s.queue = [...s.queue.filter(id => id !== unit.id), unit.id];
  }
}

function resolveStrike(s: BattleState, unit: Unit, target: Unit, events: BattleEvent[], reaction = false): boolean {
  const chance = hitChance(s, unit, target, reaction), hit = roll(s, 1, 100) <= chance;
  s.lastClashRound = s.round;
  if (!hit) {
    emit(s, events, { type: 'attack', unitId: unit.id, targetId: target.id, hit: false, damage: 0,
      message: `${unit.name} ${reaction ? 'reage, mas erra' : 'erra o ataque contra'} ${target.name}.` });
    return false;
  }
  const head = roll(s, 1, 100) <= 25;
  const armorKey = head ? 'headArmor' : 'bodyArmor';
  const raw = roll(s, unit.weapon.minDamage, unit.weapon.maxDamage);
  const armorRoll = roll(s, unit.weapon.minDamage, unit.weapon.maxDamage);
  const armorDamage = Math.min(target[armorKey], Math.floor(armorRoll * unit.weapon.armorDamage));
  target[armorKey] -= armorDamage;
  // Documented prototype approximation: penetration minus 10% of remaining armor;
  // if protection breaks, add the unprotected part left after armor damage dealt.
  const penetration = Math.max(0, raw * unit.weapon.penetration - target[armorKey] * 0.1);
  const overflow = target[armorKey] === 0 ? Math.max(0, raw * (1 - unit.weapon.penetration) - armorDamage) : 0;
  const damage = Math.min(target.hp, Math.max(0, Math.floor((penetration + overflow) * (head ? 1.5 : 1))));
  target.hp -= damage;
  emit(s, events, { type: 'attack', unitId: unit.id, targetId: target.id, hit: true, damage, armorDamage,
    location: head ? 'head' : 'body', message: `${unit.name} ${reaction ? 'intercepta' : 'atinge'} ${target.name}${head ? ' na cabeça' : ''}: −${damage} vida, −${armorDamage} armadura.` });
  if (target.hp <= 0) {
    target.dead = true;
    s.queue = s.queue.filter(id => id !== target.id);
    emit(s, events, { type: 'death', unitId: target.id, message: `${target.name} caiu.` });
    releaseCommand(s, target, events);
    for (const other of s.units.filter(alive)) {
      if (distance(other.pos, target.pos) <= 6) moraleCheck(s, other, other.team !== target.team, events);
    }
  } else if (damage >= 15) {
    moraleCheck(s, target, false, events, 40 * (1 - target.hp / target.maxHp));
  }
  checkOutcome(s, events);
  return true;
}

function activate(s: BattleState, events: BattleEvent[]): void {
  const unit = getActive(s);
  if (!unit) return;
  if (s.activatedRound[unit.id] !== s.round) {
    s.activatedRound[unit.id] = s.round;
    unit.ap = unit.maxAp;
    unit.pl = unit.maxPl;
    unit.fatigue = Math.max(0, unit.fatigue - 15);
    s.adjacentThreats[unit.id] = adjacentEnemies(s, unit).length;
    if (unit.morale === 0 && !controllers(s, unit).length && roll(s, 1, 100) <= clamp(unit.resolve * 0.7, 0, 95)) {
      unit.morale = 2;
      emit(s, events, { type: 'info', unitId: unit.id, message: `${unit.name} recobra a coragem, ainda abalado.` });
    }
  }
  emit(s, events, { type: 'turn', unitId: unit.id, message: `Turno de ${unit.name}.` });
}

/**
 * At the start of a round, orders that ran out end for troops within their commander's range.
 * Troops out of range get no news: they keep following the order, without its bonus.
 */
function expireOrders(s: BattleState): void {
  for (const unit of s.units) {
    if (!unit.order || !alive(unit) || unit.order.expiresRound >= s.round) continue;
    const commander = commanderOf(s, platoonOf(s, unit));
    if (commander && distance(commander.pos, unit.pos) <= commander.commandRange) delete unit.order;
    else unit.order.stale = true;
  }
}

function startRound(s: BattleState, events: BattleEvent[]): void {
  if (checkOutcome(s, events)) return;
  s.round++;
  expireOrders(s);
  // A side whose commanders were all fleeing when the last leader fell gets a commander once someone holds.
  for (const team of ['ally', 'enemy'] as const) appointInterim(s, team, { q: 0, r: 0 }, events);
  const initiative = (u: Unit): number => Math.max(0, u.initiative - u.fatigue) * (s.waitPenaltyNextRound[u.id] ? 0.75 : 1) - (u.morale === 0 ? 1000 : 0);
  // Ties go to a coin flip fixed by the seed and the round, so neither side always moves first.
  const coin = (u: Unit): number => {
    let h = (s.seed ^ Math.imul(s.round, 0x9e3779b1)) >>> 0;
    for (let i = 0; i < u.id.length; i++) h = Math.imul(h ^ u.id.charCodeAt(i), 0x01000193) >>> 0;
    return h;
  };
  s.queue = s.units.filter(alive).sort((a, b) => initiative(b) - initiative(a) || coin(a) - coin(b) || a.id.localeCompare(b.id)).map(u => u.id);
  for (const unit of s.units) unit.waited = false;
  s.waitPenaltyNextRound = {};
  emit(s, events, { type: 'info', message: `Rodada ${s.round}.` });
  activate(s, events);
}

function normalizeQueue(s: BattleState, events: BattleEvent[], priorActive?: string): void {
  if (checkOutcome(s, events)) return;
  s.queue = s.queue.filter(id => s.units.some(u => u.id === id && alive(u)));
  if (!s.queue.length) startRound(s, events);
  else if (priorActive && s.queue[0] !== priorActive) activate(s, events);
}

export function move(s: BattleState, to: Hex): ActionResult {
  return moveInternal(s, to, false);
}
function moveInternal(s: BattleState, to: Hex, fleeing: boolean): ActionResult {
  const unit = getActive(s);
  if (!unit || s.outcome !== 'ongoing') return reject('Não há um turno ativo.');
  if (unit.morale === 0 && !fleeing) return reject('Em fuga: controle automático.');
  const path = reachable(s, unit).get(key(to));
  if (!path?.length) return reject('Destino bloqueado ou recursos insuficientes.');
  const events: BattleEvent[] = [];
  for (const next of path) {
    if (!alive(unit) || s.outcome !== 'ongoing') break;
    const cost = moveAp(tileAt(s, next)!);
    if (unit.ap < cost || unit.fatigue + cost * 2 > unit.maxFatigue || occupant(s, next)) break;
    unit.ap -= cost; unit.fatigue += cost * 2;
    let intercepted = false;
    for (const enemy of controllers(s, unit)) {
      if (resolveStrike(s, enemy, unit, events, true)) { intercepted = true; break; }
    }
    if (intercepted || !alive(unit)) break;
    const from = { ...unit.pos };
    unit.pos = { ...next };
    s.movedRound[unit.id] = s.round;
    // Walking spoils an archer's aim.
    if (unit.order?.aimTargetId) { delete unit.order.aimTargetId; delete unit.order.aimRound; }
    emit(s, events, { type: 'move', unitId: unit.id, from, to: { ...next }, message: `${unit.name} avança.` });
    // A new adjacent opponent can shake a stationary combatant's morale.
    if (!fleeing) {
      for (const enemy of adjacentEnemies(s, unit)) {
        const threats = adjacentEnemies(s, enemy).length;
        if (threats > (s.adjacentThreats[enemy.id] ?? 0)) {
          s.adjacentThreats[enemy.id] = threats;
          moraleCheck(s, enemy, false, events);
        }
      }
    }
  }
  normalizeQueue(s, events, unit.id);
  return done(events, events.length ? undefined : 'Movimento interrompido.');
}

export function attack(s: BattleState, targetId: string): ActionResult {
  const unit = getActive(s), target = s.units.find(u => u.id === targetId);
  if (!unit || !target) return reject('Escolha um alvo válido.');
  const preview = previewAttack(s, unit, target);
  if (!preview.allowed) return reject(preview.reason);
  unit.ap -= unit.weapon.ap; unit.fatigue += unit.weapon.fatigue;
  if (unit.weapon.ammo !== undefined) unit.weapon.ammo--;
  const events: BattleEvent[] = [];
  resolveStrike(s, unit, target, events);
  if (unit.order?.id === 'atacar' && !unit.order.stale) unit.order.strikeUsed = true;
  normalizeQueue(s, events, unit.id);
  return done(events);
}

export function waitTurn(s: BattleState): ActionResult {
  const unit = getActive(s);
  if (!unit || s.outcome !== 'ongoing') return reject('Não há um turno ativo.');
  if (unit.morale === 0) return reject('Em fuga: controle automático.');
  if (unit.waited) return reject('Esta unidade já esperou nesta rodada.');
  unit.waited = true;
  s.waitPenaltyNextRound[unit.id] = true;
  s.queue.push(s.queue.shift()!);
  const events: BattleEvent[] = [];
  emit(s, events, { type: 'info', unitId: unit.id, message: `${unit.name} espera; iniciativa reduzida em 25% na próxima rodada.` });
  activate(s, events);
  return done(events);
}

export function endTurn(s: BattleState): ActionResult {
  const unit = getActive(s);
  if (!unit || s.outcome !== 'ongoing') return reject('Não há um turno ativo.');
  s.queue.shift();
  const events: BattleEvent[] = [];
  normalizeQueue(s, events, unit.id);
  return done(events, `${unit.name} encerrou o turno.`);
}

const edgeDistance = (s: BattleState, p: Hex): number => Math.min(p.q, s.width - 1 - p.q, p.r, s.height - 1 - p.r);
function escape(s: BattleState, unit: Unit): ActionResult {
  unit.escaped = true;
  s.queue = s.queue.filter(id => id !== unit.id);
  const events: BattleEvent[] = [];
  emit(s, events, { type: 'flee', unitId: unit.id, message: `${unit.name} foge do campo.` });
  releaseCommand(s, unit, events);
  for (const ally of s.units.filter(u => alive(u) && u.team === unit.team && distance(u.pos, unit.pos) <= 6)) moraleCheck(s, ally, false, events);
  normalizeQueue(s, events, unit.id);
  return done(events);
}

/**
 * The prototype's first AI: attack the best target in reach, otherwise walk toward the closest enemy.
 * It ignores orders. It still drives fleeing units, and it is the yardstick the new AI (src/ai.ts) must beat.
 */
export function performSimpleAiAction(s: BattleState): ActionResult {
  const unit = getActive(s);
  if (!unit || s.outcome !== 'ongoing') return reject('O combate terminou.');
  const enemies = s.units.filter(u => alive(u) && u.team !== unit.team);
  if (!enemies.length) {
    const events: BattleEvent[] = []; checkOutcome(s, events); return done(events);
  }
  if (unit.morale === 0) {
    if (edgeDistance(s, unit.pos) === 0) return escape(s, unit);
    const routes = [...reachable(s, unit).values()];
    routes.sort((a, b) => edgeDistance(s, a.at(-1)!) - edgeDistance(s, b.at(-1)!)
      || Math.min(...enemies.map(e => distance(e.pos, b.at(-1)!))) - Math.min(...enemies.map(e => distance(e.pos, a.at(-1)!)))
      || a.length - b.length);
    const route = routes.find(p => edgeDistance(s, p.at(-1)!) < edgeDistance(s, unit.pos));
    if (route) return moveInternal(s, route.at(-1)!, true);
    return endTurn(s);
  }
  const targets = enemies.filter(e => previewAttack(s, unit, e).allowed);
  targets.sort((a, b) => {
    const score = (u: Unit) => previewAttack(s, unit, u).chance + (1 - u.hp / u.maxHp) * 25;
    return score(b) - score(a) || a.hp - b.hp;
  });
  if (targets[0]) return attack(s, targets[0].id);
  // An exhausted fighter holds position instead of spending remaining stamina on pointless steps.
  if (unit.fatigue + unit.weapon.fatigue > unit.maxFatigue || unit.ap < 2 || (unit.weapon.ammo !== undefined && unit.weapon.ammo <= 0)) return endTurn(s);
  const nearestNow = Math.min(...enemies.map(e => distance(unit.pos, e.pos)));
  const routes = reachable(s, unit);
  let chosen: Hex | undefined, best = -Infinity;
  for (const path of routes.values()) {
    const pos = path.at(-1)!;
    const cost = path.reduce((sum, h) => sum + moveAp(tileAt(s, h)!), 0);
    const candidate = { ...unit, pos, ap: unit.ap - cost, fatigue: unit.fatigue + cost * 2 };
    const canAttack = enemies.some(e => previewAttack(s, candidate, e).allowed);
    const closest = Math.min(...enemies.map(e => distance(pos, e.pos)));
    const leavingEngagement = unit.weapon.kind === 'ranged' && controllers(s, unit).length > 0 && !controllers(s, candidate).length;
    const improved = closest < nearestNow || canAttack || leavingEngagement;
    if (!improved) continue;
    const score = (canAttack ? 100 : 0) + (leavingEngagement ? 20 : 0) - closest * 10 + candidate.ap * 0.1;
    if (score > best) { best = score; chosen = pos; }
  }
  return chosen ? move(s, chosen) : endTurn(s);
}

/** Subclass numbers from docs/design-combate.md, section 3: attribute scale, PL per turn, command range and order potency. */
const LEADER_CLASSES: Record<LeaderClass, { label: string; attributes: number; pl: number; range: number; potency: number }> = {
  combate: { label: 'Líder de Combate', attributes: 1.2, pl: 6, range: 5, potency: 1 },
  estrategico: { label: 'Líder Estratégico', attributes: 0.85, pl: 12, range: 9, potency: 1.5 },
  encorajador: { label: 'Líder Encorajador', attributes: 1, pl: 9, range: 7, potency: 1 },
};
export const INTERIM_COMMAND = { pl: 6, range: 5, potency: 1 };
const BASE_ATTRIBUTES = ['hp', 'maxFatigue', 'resolve', 'initiative', 'meleeSkill', 'rangedSkill', 'meleeDefense', 'rangedDefense'] as const;

export const leaderClassLabel = (leaderClass: LeaderClass): string => LEADER_CLASSES[leaderClass].label;
export const divisionOf = (u: Unit): Division => u.weapon.kind === 'ranged' ? 'arqueiros' : 'guerreiros';
/** The player commands only their own leaders, and only while those leaders hold their nerve. */
export const isPlayerControlled = (u: Unit): boolean => u.team === 'ally' && u.role === 'leader' && alive(u) && u.morale > 0;
export const platoonOf = (s: BattleState, u: Unit): Platoon | undefined => s.platoons.find(p => p.id === u.platoonId);
export const platoonTroops = (s: BattleState, platoonId: string): Unit[] =>
  s.units.filter(u => alive(u) && u.role === 'troop' && u.platoonId === platoonId);
/** Who gives this platoon its orders right now, if anyone. */
export function commanderOf(s: BattleState, platoon: Platoon | undefined): Unit | undefined {
  const commander = platoon?.commanderId ? s.units.find(u => u.id === platoon.commanderId) : undefined;
  return commander && alive(commander) ? commander : undefined;
}
/** The platoons this unit commands: its own as a leader, or every orphaned one as an interim commander. */
export const commandedPlatoons = (s: BattleState, u: Unit): Platoon[] => s.platoons.filter(p => p.commanderId === u.id);

// Orders ---------------------------------------------------------------------

export interface OrderInfo {
  id: OrderId; label: string;
  /** The letter shown over troops that follow this order. */
  mark: string;
  pl: number; targets: OrderTarget[]; summary: string;
}
/** Bonuses before the commander's potency. */
export const ORDER_BONUS = { linha: 10, escudos: 8, atacar: 10, mira: 15 };
/** An order runs for the round it is given plus the next two; the division's cooldown ends with it. */
export const ORDER_ROUNDS = 3;
const EVERYONE: OrderTarget[] = ['todos', 'guerreiros', 'arqueiros'];
export const ORDERS: readonly OrderInfo[] = [
  { id: 'avanco-devagar', label: 'Avanço devagar!', mark: 'D', pl: 2, targets: EVERYONE,
    summary: 'Avançam até 2 hexágonos por turno, sem sair da linha e guardando PA para atacar.' },
  { id: 'avanco-rapido', label: 'Avanço rápido!', mark: 'R', pl: 3, targets: EVERYONE,
    summary: 'Gastam os PA para fechar a distância. A formação fica solta.' },
  { id: 'linha-defensiva', label: 'Formar linha defensiva!', mark: 'L', pl: 3, targets: ['todos', 'guerreiros'],
    summary: `+${ORDER_BONUS.linha} de defesa corpo a corpo. Seguram a linha e não perseguem.` },
  { id: 'levantar-escudos', label: 'Levantar escudos!', mark: 'E', pl: 4, targets: ['todos', 'guerreiros'],
    summary: `+${ORDER_BONUS.escudos} de defesa corpo a corpo e à distância para quem tem escudo. Andam no máximo 1 hexágono.` },
  { id: 'arqueiros-disparem', label: 'Arqueiros, disparem!', mark: 'T', pl: 2, targets: ['arqueiros'],
    summary: 'Atiram no alvo que mais vale a flecha ao alcance. Sem alvo, andam até ter linha de tiro.' },
  { id: 'arqueiros-preparar', label: 'Arqueiros, preparar disparo!', mark: 'M', pl: 3, targets: ['arqueiros'],
    summary: `Miram um turno sem atirar. Depois, +${ORDER_BONUS.mira} de ataque à distância no alvo mirado. Andar perde a mira.` },
  { id: 'atacar', label: 'Atacar!', mark: 'A', pl: 4, targets: EVERYONE,
    summary: `Partem para cima do inimigo. +${ORDER_BONUS.atacar} no primeiro ataque de cada tropa durante a ordem.` },
];
export const orderInfo = (id: OrderId): OrderInfo => ORDERS.find(order => order.id === id)!;
export const TARGET_LABELS: Record<OrderTarget, string> = { todos: 'todos', guerreiros: 'guerreiros', arqueiros: 'arqueiros' };
const divisionsOf = (target: OrderTarget): Division[] => target === 'todos' ? ['guerreiros', 'arqueiros'] : [target];

export interface OrderCheck {
  allowed: boolean; reason: string;
  /** The target the order would go to: archer orders always go to the archers. */
  target: OrderTarget;
  /** Troops in range that would take the order. */
  troops: Unit[];
  cost: number;
}
/** Whether this unit can give the order now, and who would hear it. */
export function checkOrder(s: BattleState, unit: Unit, id: OrderId, wanted: OrderTarget): OrderCheck {
  const info = orderInfo(id), target = info.targets.length === 1 ? info.targets[0] : wanted;
  const platoons = commandedPlatoons(s, unit), divisions = divisionsOf(target);
  const troops = platoons.flatMap(p => platoonTroops(s, p.id)).filter(u =>
    u.id !== unit.id && divisions.includes(divisionOf(u)) && distance(u.pos, unit.pos) <= unit.commandRange);
  const waiting = divisions.map(d => ({ d, round: Math.max(0, ...platoons.map(p => p.readyRound[d])) })).filter(w => w.round > s.round);
  let reason = '';
  if (s.outcome !== 'ongoing') reason = 'O combate terminou.';
  else if (!alive(unit) || !platoons.length) reason = 'Só quem comanda um pelotão dá ordens.';
  else if (unit.morale === 0) reason = 'Em fuga: não consegue comandar.';
  else if (!info.targets.includes(target)) reason = `Esta ordem não vale para ${TARGET_LABELS[target]}.`;
  else if (waiting.length) reason = new Set(waiting.map(w => w.round)).size === 1
    ? `Recarga: ${waiting.map(w => TARGET_LABELS[w.d]).join(' e ')} livres na rodada ${waiting[0].round}.`
    : `Recarga: ${waiting.map(w => `${TARGET_LABELS[w.d]} livres na rodada ${w.round}`).join(', ')}.`;
  else if (unit.pl < info.pl) reason = 'Pontos de liderança insuficientes.';
  else if (!troops.length) reason = 'Nenhuma tropa desta divisão no alcance de comando.';
  return { allowed: !reason, reason, target, troops, cost: info.pl };
}
/** The active commander gives an order. It costs PL, not PA, and starts the division's cooldown. */
export function issueOrder(s: BattleState, id: OrderId, wanted: OrderTarget = 'todos'): ActionResult {
  const unit = getActive(s);
  if (!unit) return reject('Não há um turno ativo.');
  const check = checkOrder(s, unit, id, wanted);
  if (!check.allowed) return reject(check.reason);
  const info = orderInfo(id), expiresRound = s.round + ORDER_ROUNDS - 1;
  unit.pl -= info.pl;
  for (const platoon of commandedPlatoons(s, unit)) for (const division of divisionsOf(check.target)) {
    platoon.readyRound[division] = expiresRound + 1;
    platoon.lastOrder[division] = { id, expiresRound };
  }
  for (const troop of check.troops) troop.order = { id, expiresRound, potency: unit.potency, stale: false, strikeUsed: false };
  const events: BattleEvent[] = [];
  emit(s, events, { type: 'order', unitId: unit.id, order: id,
    message: `${unit.name}: "${info.label}" para ${TARGET_LABELS[check.target]} (${check.troops.length} ${check.troops.length === 1 ? 'tropa' : 'tropas'}).` });
  return done(events);
}
/** An archer under "preparar disparo" spends the turn aiming at one enemy in its line of fire. */
export function aim(s: BattleState, targetId: string): ActionResult {
  const unit = getActive(s), target = s.units.find(u => u.id === targetId);
  if (!unit || !target) return reject('Escolha um alvo válido.');
  if (!unit.order || unit.order.id !== 'arqueiros-preparar' || unit.weapon.kind !== 'ranged') return reject('Só arqueiros com a ordem de preparar disparo miram.');
  const reason = strikeBlocker(s, unit, target, false);
  if (reason) return reject(reason);
  unit.order.aimTargetId = target.id; unit.order.aimRound = s.round;
  const events: BattleEvent[] = [], message = `${unit.name} mira em ${target.name}.`;
  emit(s, events, { type: 'info', unitId: unit.id, targetId: target.id, message });
  s.queue.shift();
  normalizeQueue(s, events, unit.id);
  return done(events, message);
}
/** Nota de atributo: the sum of the eight base attributes, without equipment or wounds. */
export function attributeScore(u: Unit): number {
  return u.maxHp + u.maxFatigue + u.resolve + u.initiative + u.meleeSkill + u.rangedSkill + u.meleeDefense + u.rangedDefense;
}

export function makeUnit(id: string, name: string, team: Team, asset: UnitAsset, pos: Hex,
  weapon: Weapon, stats: Partial<Unit>): Unit {
  const u: Unit = { id, name, team, asset, role: 'troop', pos, weapon: { ...weapon }, hp: 60, maxHp: 60,
    headArmor: 40, maxHeadArmor: 40, bodyArmor: 60, maxBodyArmor: 60,
    ap: 9, maxAp: 9, fatigue: 0, maxFatigue: 90, initiative: 85,
    meleeSkill: 60, rangedSkill: 45, meleeDefense: 5, rangedDefense: 4, resolve: 48,
    morale: 3, dead: false, escaped: false, waited: false, shield: false, pl: 0, maxPl: 0, commandRange: 0, potency: 1, ...stats };
  u.maxHp = u.hp; u.maxHeadArmor = u.headArmor; u.maxBodyArmor = u.bodyArmor;
  return u;
}
/** The subclass scales the eight base attributes; stats are the standard values before that. */
export function makeLeader(id: string, name: string, team: Team, asset: UnitAsset, pos: Hex, weapon: Weapon,
  leaderClass: LeaderClass, stats: Partial<Unit>, supreme = false): Unit {
  const info = LEADER_CLASSES[leaderClass];
  const u = makeUnit(id, name, team, asset, pos, weapon, { ...stats, role: 'leader', leaderClass, ...(supreme ? { supreme } : {}),
    pl: info.pl, maxPl: info.pl, commandRange: info.range, potency: info.potency });
  for (const attribute of BASE_ATTRIBUTES) u[attribute] = Math.round(u[attribute] * info.attributes);
  u.maxHp = u.hp;
  return u;
}
export function makeTiles(width: number, height: number, terrain: (q: number, r: number) => Tile['terrain'] = () => 'grass'): Tile[] {
  const tiles: Tile[] = [];
  for (let r = 0; r < height; r++) for (let q = 0; q < width; q++) tiles.push({ q, r, terrain: terrain(q, r) });
  return tiles;
}

export interface BattleSetup {
  encounter: EncounterId; width: number; height: number;
  tiles: Tile[]; units: Unit[]; platoons?: PlatoonSetup[];
}
export function startBattle(seed: number, setup: BattleSetup): BattleState {
  const { encounter, width, height, tiles, units } = setup;
  const platoons: Platoon[] = (setup.platoons ?? []).map(p => ({ ...p, commanderId: p.leaderId,
    readyRound: { guerreiros: 0, arqueiros: 0 }, lastOrder: {} }));
  if (tiles.length !== width * height || tiles.some((t, i) => t.q !== i % width || t.r !== Math.floor(i / width)))
    throw new Error('Tiles must cover the board row by row.');
  const normalizedSeed = seed >>> 0 || 1;
  const s: BattleState = { encounter, width, height, seed: normalizedSeed, rngState: normalizedSeed, round: 0, tiles, units, platoons,
    queue: [], outcome: 'ongoing', log: [], activatedRound: {}, waitPenaltyNextRound: {}, adjacentThreats: {},
    movedRound: {}, lastClashRound: 0 };
  for (const u of units) s.adjacentThreats[u.id] = adjacentEnemies(s, u).length;
  startRound(s, []);
  return s;
}
