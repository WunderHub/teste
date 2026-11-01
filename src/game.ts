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
}
/** A leader and the troops assigned to them. leaderId is null once the leader falls. */
export interface Platoon { id: string; team: Team; name: string; leaderId: string | null }
export interface BattleState {
  encounter: EncounterId;
  /** Board size in hexes. Tiles are stored row by row, so a tile's index is r * width + q. */
  width: number; height: number;
  seed: number; round: number; tiles: Tile[]; units: Unit[]; queue: string[];
  platoons: Platoon[];
  outcome: 'ongoing' | 'victory' | 'defeat'; log: string[];
  rngState: number;
  activatedRound: Record<string, number>;
  waitPenaltyNextRound: Record<string, boolean>;
  adjacentThreats: Record<string, number>;
}
export interface BattleEvent {
  type: 'move' | 'attack' | 'death' | 'flee' | 'turn' | 'info';
  unitId?: string; targetId?: string; from?: Hex; to?: Hex;
  hit?: boolean; damage?: number; message?: string;
  armorDamage?: number; location?: 'head' | 'body';
}
export interface ActionResult { ok: boolean; message: string; events: BattleEvent[] }
export interface AttackPreview { allowed: boolean; reason: string; chance: number; ap: number; fatigue: number }

export const key = ({ q, r }: Hex): string => `${q},${r}`;
const same = (a: Hex, b: Hex): boolean => a.q === b.q && a.r === b.r;
const alive = (u: Unit): boolean => !u.dead && !u.escaped;
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
const adjacentEnemies = (s: BattleState, u: Unit, at = u.pos): Unit[] => s.units.filter(v =>
  alive(v) && v.team !== u.team && distance(v.pos, at) === 1);
const controllers = (s: BattleState, u: Unit, at = u.pos): Unit[] => adjacentEnemies(s, u, at)
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

function hitChance(s: BattleState, unit: Unit, target: Unit): number {
  const melee = unit.weapon.kind === 'melee';
  const attackSkill = (melee ? unit.meleeSkill : unit.rangedSkill) * moraleFactor(unit);
  let defense = (melee ? target.meleeDefense : target.rangedDefense) * moraleFactor(target);
  if (defense > 50) defense = 50 + (defense - 50) / 2;
  const surrounding = melee ? Math.max(0, s.units.filter(v => alive(v) && v.team === unit.team
    && v.weapon.kind === 'melee' && v.morale > 0 && distance(v.pos, target.pos) === 1).length - 1) * 5 : 0;
  const rangePenalty = melee ? 0 : Math.max(0, distance(unit.pos, target.pos) - 2) * 4;
  return Math.round(clamp(attackSkill + unit.weapon.accuracy - defense + surrounding - rangePenalty, 5, 95));
}
export function previewAttack(s: BattleState, unit: Unit, target: Unit): AttackPreview {
  const base = { chance: hitChance(s, unit, target), ap: unit.weapon.ap, fatigue: unit.weapon.fatigue };
  let reason = '';
  if (s.outcome !== 'ongoing') reason = 'O combate terminou.';
  else if (!alive(unit) || !alive(target)) reason = 'Combatente indisponível.';
  else if (unit.team === target.team) reason = 'Escolha um inimigo.';
  else if (unit.morale === 0) reason = 'Em fuga: controle automático.';
  else if (unit.ap < unit.weapon.ap) reason = 'Pontos de ação insuficientes.';
  else if (unit.fatigue + unit.weapon.fatigue > unit.maxFatigue) reason = 'Fadiga alta demais para atacar.';
  else if (unit.weapon.ammo !== undefined && unit.weapon.ammo <= 0) reason = 'Sem flechas.';
  else if (unit.weapon.kind === 'ranged' && controllers(s, unit).length) reason = 'Engajado: não é possível disparar.';
  else if (distance(unit.pos, target.pos) > unit.weapon.range) reason = 'Fora de alcance.';
  else if (unit.weapon.kind === 'ranged' && !clearLine(s, unit.pos, target.pos)) reason = 'Linha de tiro bloqueada.';
  return { ...base, allowed: !reason, reason };
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
  const allies = s.units.some(u => u.team === 'ally' && alive(u));
  const enemies = s.units.some(u => u.team === 'enemy' && alive(u));
  if (allies && enemies) return false;
  s.outcome = allies ? 'victory' : 'defeat';
  s.queue = [];
  emit(s, events, { type: 'info', message: allies ? 'Vitória. O campo é nosso.' : 'Derrota. Nossas tropas caíram.' });
  return true;
}

/** A leader who falls or leaves the field stops leading. Succession rules come in a later phase. */
function releasePlatoon(s: BattleState, unit: Unit, events: BattleEvent[]): void {
  const platoon = s.platoons.find(p => p.leaderId === unit.id);
  if (!platoon) return;
  platoon.leaderId = null;
  emit(s, events, { type: 'info', unitId: unit.id, message: `${platoon.name} ficou sem líder.` });
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
  const chance = hitChance(s, unit, target), hit = roll(s, 1, 100) <= chance;
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
    releasePlatoon(s, target, events);
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
    unit.fatigue = Math.max(0, unit.fatigue - 15);
    s.adjacentThreats[unit.id] = adjacentEnemies(s, unit).length;
    if (unit.morale === 0 && !controllers(s, unit).length && roll(s, 1, 100) <= clamp(unit.resolve * 0.7, 0, 95)) {
      unit.morale = 2;
      emit(s, events, { type: 'info', unitId: unit.id, message: `${unit.name} recobra a coragem, ainda abalado.` });
    }
  }
  emit(s, events, { type: 'turn', unitId: unit.id, message: `Turno de ${unit.name}.` });
}

function startRound(s: BattleState, events: BattleEvent[]): void {
  if (checkOutcome(s, events)) return;
  s.round++;
  const initiative = (u: Unit): number => Math.max(0, u.initiative - u.fatigue) * (s.waitPenaltyNextRound[u.id] ? 0.75 : 1) - (u.morale === 0 ? 1000 : 0);
  s.queue = s.units.filter(alive).sort((a, b) => initiative(b) - initiative(a) || a.id.localeCompare(b.id)).map(u => u.id);
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
  releasePlatoon(s, unit, events);
  for (const ally of s.units.filter(u => alive(u) && u.team === unit.team && distance(u.pos, unit.pos) <= 6)) moraleCheck(s, ally, false, events);
  normalizeQueue(s, events, unit.id);
  return done(events);
}

/** One finite action. May drive either faction for deterministic full-battle simulations. */
export function performAiAction(s: BattleState): ActionResult {
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

const LEADER_CLASSES: Record<LeaderClass, { label: string; attributes: number }> = {
  combate: { label: 'Líder de Combate', attributes: 1.2 },
  estrategico: { label: 'Líder Estratégico', attributes: 0.85 },
  encorajador: { label: 'Líder Encorajador', attributes: 1 },
};
const BASE_ATTRIBUTES = ['hp', 'maxFatigue', 'resolve', 'initiative', 'meleeSkill', 'rangedSkill', 'meleeDefense', 'rangedDefense'] as const;

export const leaderClassLabel = (leaderClass: LeaderClass): string => LEADER_CLASSES[leaderClass].label;
export const divisionOf = (u: Unit): Division => u.weapon.kind === 'ranged' ? 'arqueiros' : 'guerreiros';
/** The player commands only their own leaders, and only while those leaders hold their nerve. */
export const isPlayerControlled = (u: Unit): boolean => u.team === 'ally' && u.role === 'leader' && alive(u) && u.morale > 0;
export const platoonOf = (s: BattleState, u: Unit): Platoon | undefined => s.platoons.find(p => p.id === u.platoonId);
export const platoonTroops = (s: BattleState, platoonId: string): Unit[] =>
  s.units.filter(u => alive(u) && u.role === 'troop' && u.platoonId === platoonId);
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
    morale: 3, dead: false, escaped: false, waited: false, ...stats };
  u.maxHp = u.hp; u.maxHeadArmor = u.headArmor; u.maxBodyArmor = u.bodyArmor;
  return u;
}
/** The subclass scales the eight base attributes; stats are the standard values before that. */
export function makeLeader(id: string, name: string, team: Team, asset: UnitAsset, pos: Hex, weapon: Weapon,
  leaderClass: LeaderClass, stats: Partial<Unit>, supreme = false): Unit {
  const u = makeUnit(id, name, team, asset, pos, weapon, { ...stats, role: 'leader', leaderClass, ...(supreme ? { supreme } : {}) });
  for (const attribute of BASE_ATTRIBUTES) u[attribute] = Math.round(u[attribute] * LEADER_CLASSES[leaderClass].attributes);
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
  tiles: Tile[]; units: Unit[]; platoons?: Platoon[];
}
export function startBattle(seed: number, setup: BattleSetup): BattleState {
  const { encounter, width, height, tiles, units, platoons = [] } = setup;
  if (tiles.length !== width * height || tiles.some((t, i) => t.q !== i % width || t.r !== Math.floor(i / width)))
    throw new Error('Tiles must cover the board row by row.');
  const normalizedSeed = seed >>> 0 || 1;
  const s: BattleState = { encounter, width, height, seed: normalizedSeed, rngState: normalizedSeed, round: 0, tiles, units, platoons,
    queue: [], outcome: 'ongoing', log: [], activatedRound: {}, waitPenaltyNextRound: {}, adjacentThreats: {} };
  for (const u of units) s.adjacentThreats[u.id] = adjacentEnemies(s, u).length;
  startRound(s, []);
  return s;
}
