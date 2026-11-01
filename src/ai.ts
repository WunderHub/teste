/**
 * Battle AI, from docs/design-combate.md section 10. Pure and deterministic, like the engine.
 *
 * - Troops score every place they can reach this turn (plus the attack they could make from there)
 *   and pick the best. The order they follow shapes the score: each order is a profile of weights.
 * - Commanders (AI leaders and interim commanders) first read the field and give orders, then move
 *   to keep their platoon in command range.
 */
import {
  aim, attack, commandedPlatoons, commanderOf, controllers, distance, divisionOf, endTurn, expectedDamage,
  getActive, hasShot, hitChance, isAlive, issueOrder, move, moveAp, ORDER_BONUS, orderInfo, performSimpleAiAction,
  platoonOf, platoonTroops, previewAttack, reachable, tileAt,
  type ActionResult, type BattleState, type Division, type Hex, type OrderId, type OrderTarget, type Team, type Unit,
} from './game';

/**
 * Weights found by tournaments against the prototype's AI (see src/ai.test.ts). Scores are in "percent of
 * a life": an expected wound of a quarter of the target's life is worth 25.
 */
const WEIGHTS = {
  /** Expected wounds taken next round, scaled by how much the unit values its life. */
  threat: 0.5,
  /** Share of a melee enemy's threat when it must walk before striking (it may pick someone else). */
  reach: 0.8,
  /** Chance to kill: a fall shakes every enemy nearby, so kills are worth far more than their wounds. */
  kill: 90,
  /** Second swing in the same turn, relative to the first. */
  secondSwing: 1.7,
  /** Per ally shoulder to shoulder, up to three. */
  cohesion: 3,
  /** How much an AI leader values its own life, relative to a troop. */
  leader: 2.2,
  /** Side strength ratio under which a leader digs in instead of attacking. */
  weak: 0.7,
  /** Hexes to the enemy beyond which the slow advance still ends before the lines meet. */
  slowAdvance: 14,
};
/** When set, every option the AI weighs is recorded with its score, for tuning and debugging. */
export const AI_TRACE: { on: boolean; rows: Record<string, unknown>[] } = { on: false, rows: [] };
/** How a unit decides: the order it follows, holding position, fighting on its own, or commanding a platoon. */
export type Profile = OrderId | 'manter' | 'livre' | 'comando';

/** One AI step for the active unit: give an order, move, attack, aim or end the turn. */
export function performAiAction(s: BattleState): ActionResult {
  const unit = getActive(s);
  if (!unit || s.outcome !== 'ongoing' || unit.morale === 0 || !s.units.some(u => isAlive(u) && u.team !== unit.team)) {
    return performSimpleAiAction(s);
  }
  if (unit.pl > 0 && commandedPlatoons(s, unit).length) {
    const plan = planOrder(s, unit);
    if (plan) {
      const result = issueOrder(s, plan.id, plan.target);
      if (result.ok) return result;
    }
  }
  const profile = profileOf(s, unit);
  if (profile === 'arqueiros-preparar') return aimOrShoot(s, unit) ?? bestAction(s, unit, 'arqueiros-disparem');
  return bestAction(s, unit, profile);
}

export function profileOf(s: BattleState, unit: Unit): Profile {
  if (commandedPlatoons(s, unit).some(p => platoonTroops(s, p.id).some(t => t.id !== unit.id))) return 'comando';
  if (unit.role === 'leader' || !unit.platoonId) return 'livre';
  const order = unit.order;
  if (order) return order.stale && order.id === 'arqueiros-preparar' ? 'arqueiros-disparem' : order.id;
  // A platoon with nobody left to command it fights on its own instead of freezing in place.
  return commanderOf(s, platoonOf(s, unit)) ? 'manter' : 'livre';
}

// Troops ---------------------------------------------------------------------

interface Option { pos: Hex; path: Hex[]; cost: number }
interface Plan { option: Option; target?: Unit; score: number }
interface Context {
  s: BattleState; unit: Unit; profile: Profile;
  enemies: Unit[];
  /** Enemies who can still hurt: alive and not fleeing. */
  fighters: Unit[];
  allies: Unit[];
  commander?: Unit;
  /** Troops this unit commands, when it is a commander. */
  ownTroops: Unit[];
  start: Hex;
  startDistance: number;
  /** Median distance to the enemy across the unit's neighbors in the formation. */
  lineDistance: number;
  /** How much the unit values its own life. */
  self: number;
  /** How closely it follows the order: lower when shaken. */
  obedience: number;
  damageFrom: (enemy: Unit) => number;
}

/** Most hexes each profile lets a troop walk in one turn. */
const MAX_STEPS: Partial<Record<Profile, number>> = { manter: 0, 'linha-defensiva': 1, 'levantar-escudos': 1, 'avanco-devagar': 2 };
/** Weight of the attack this turn, per profile. */
const ATTACK_WEIGHT: Partial<Record<Profile, number>> = { atacar: 1.1, 'avanco-rapido': 1.1, livre: 1.1 };
const OBEDIENCE = [0, 0.5, 0.8, 1, 1.1];

const nearest = (from: Hex, units: Unit[]): number => units.reduce((best, u) => Math.min(best, distance(from, u.pos)), Infinity);
const median = (values: number[]): number => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const pathCost = (s: BattleState, path: Hex[]): number => path.reduce((sum, h) => sum + moveAp(tileAt(s, h)!), 0);

function context(s: BattleState, unit: Unit, profile: Profile): Context {
  const enemies = s.units.filter(u => isAlive(u) && u.team !== unit.team);
  const fighters = enemies.filter(u => u.morale > 0);
  const targets = fighters.length ? fighters : enemies;
  const allies = s.units.filter(u => isAlive(u) && u.team === unit.team && u.id !== unit.id);
  const ownTroops = profile === 'comando'
    ? commandedPlatoons(s, unit).flatMap(p => platoonTroops(s, p.id)).filter(u => u.id !== unit.id && u.morale > 0) : [];
  const mates = profile === 'comando' ? ownTroops
    : allies.filter(u => u.role === 'troop' && u.morale > 0 && u.platoonId === unit.platoonId && divisionOf(u) === divisionOf(unit));
  const startDistance = nearest(unit.pos, targets);
  const lineDistance = mates.length ? median(mates.map(u => nearest(u.pos, targets))) : startDistance;
  let self = unit.role === 'leader' ? (unit.supreme ? 4 : WEIGHTS.leader) : profile === 'comando' ? 1.8 : 1;
  if (unit.morale <= 1) self *= 1.6; else if (unit.morale === 2) self *= 1.25;
  if (unit.hp < unit.maxHp * 0.4) self *= 1.4;
  if (profile === 'avanco-rapido') self *= 0.7; else if (profile === 'atacar' || profile === 'livre') self *= 0.85;
  const damage = new Map<string, number>();
  return {
    s, unit, profile, enemies, fighters, allies, ownTroops, start: unit.pos, startDistance, lineDistance, self,
    commander: unit.role === 'troop' ? commanderOf(s, platoonOf(s, unit)) : undefined,
    obedience: OBEDIENCE[unit.morale],
    damageFrom: enemy => {
      if (!damage.has(enemy.id)) damage.set(enemy.id, expectedDamage(enemy.weapon, unit).hp);
      return damage.get(enemy.id)!;
    },
  };
}

function options(s: BattleState, unit: Unit, profile: Profile): Option[] {
  const stay: Option = { pos: unit.pos, path: [], cost: 0 };
  if (s.movedRound[unit.id] === s.round) return [stay];
  // An archer caught in melee may always step back: it cannot fight there anyway.
  const engagedArcher = unit.weapon.kind === 'ranged' && controllers(s, unit).length > 0;
  const limit = MAX_STEPS[profile] ?? Infinity, maxSteps = engagedArcher ? Math.max(2, limit) : limit;
  if (maxSteps === 0) return [stay];
  const list = [stay];
  for (const path of reachable(s, unit).values()) {
    if (path.length > maxSteps) continue;
    const cost = pathCost(s, path);
    if (profile === 'avanco-devagar' && unit.ap - cost < unit.weapon.ap && !engagedArcher) continue;
    list.push({ pos: path.at(-1)!, path, cost });
  }
  return list;
}

function bestAction(s: BattleState, unit: Unit, profile: Profile): ActionResult {
  const ctx = context(s, unit, profile);
  let best: Plan | undefined;
  for (const option of options(s, unit, profile)) {
    const plan = evaluate(ctx, option);
    if (!best || plan.score > best.score + 1e-9) best = plan;
  }
  if (best && best.option.cost > 0) return move(s, best.option.pos);
  if (best?.target) return attack(s, best.target.id);
  return endTurn(s);
}

/** Attacks the unit can still afford this turn with its current PA, fatigue and ammunition. */
function swingsLeft(unit: Unit): number {
  const w = unit.weapon;
  let swings = 0, ap = unit.ap, fatigue = unit.fatigue, ammo = w.ammo ?? Infinity;
  while (swings < 3 && ap >= w.ap && fatigue + w.fatigue <= unit.maxFatigue && ammo > 0) { swings++; ap -= w.ap; fatigue += w.fatigue; ammo--; }
  return swings;
}

/** How much the side gains from killing or wounding this enemy. */
function targetWorth(s: BattleState, target: Unit): number {
  let worth = target.role === 'leader' ? (target.supreme ? 3 : 1.8) : commandedPlatoons(s, target).length ? 1.5 : 1;
  if (target.weapon.kind === 'ranged' && (target.weapon.ammo ?? 1) > 0) worth *= 1.25;
  if (target.morale === 0) worth *= 0.4;
  return worth;
}

/** Expected value of one strike: wounds as a share of the target's life, armor broken and the chance to kill. */
function strikeValue(s: BattleState, unit: Unit, target: Unit, chance: number): number {
  const damage = expectedDamage(unit.weapon, target), worth = targetWorth(s, target);
  return chance / 100 * (damage.hp / target.maxHp * 100 * worth + damage.armor * 0.12 + damage.kill * WEIGHTS.kill * worth);
}

/** Expected share of life lost next round if the unit ends its turn here. */
function threatAt(ctx: Context): number {
  const { s, unit } = ctx;
  const contributions: number[] = [];
  for (const enemy of ctx.fighters) {
    const d = distance(enemy.pos, unit.pos), steps = Math.floor(Math.max(0, enemy.maxAp - enemy.weapon.ap) / 2);
    let weight = 0;
    if (enemy.weapon.kind === 'melee') weight = d === 1 ? 1 : d <= steps + 1 ? WEIGHTS.reach : 0;
    else if ((enemy.weapon.ammo ?? 1) > 0) weight = d <= enemy.weapon.range ? 0.7 : d <= enemy.weapon.range + steps ? 0.35 : 0;
    if (weight) contributions.push(weight * hitChance(s, enemy, unit) / 100 * ctx.damageFrom(enemy));
  }
  contributions.sort((a, b) => b - a);
  const expected = contributions.slice(0, 5).reduce((sum, v) => sum + v, 0);
  return Math.min(expected, unit.hp) / unit.maxHp * 100 + (expected >= unit.hp ? 20 : 0);
}

function evaluate(ctx: Context, option: Option): Plan {
  const { s, unit, profile } = ctx;
  // Leaving an enemy's zone of control invites a free strike; the first hit also stops the march.
  let through = 1, risk = 0;
  const departures = option.path.length ? [ctx.start, ...option.path.slice(0, -1)] : [];
  for (const from of departures) {
    for (const enemy of ctx.fighters) {
      if (enemy.weapon.kind !== 'melee' || distance(enemy.pos, from) !== 1) continue;
      const p = hitChance(s, enemy, unit, true) / 100;
      risk += through * p * ctx.damageFrom(enemy);
      through *= 1 - p;
    }
  }
  const saved = { pos: unit.pos, ap: unit.ap, fatigue: unit.fatigue };
  unit.pos = option.pos; unit.ap -= option.cost; unit.fatigue += option.cost * 2;
  try {
    const here = nearest(option.pos, ctx.fighters.length ? ctx.fighters : ctx.enemies);
    let attackValue = 0, target: Unit | undefined;
    const swings = swingsLeft(unit);
    if (swings) {
      const reachableTargets = ctx.enemies.filter(e => distance(e.pos, unit.pos) <= unit.weapon.range && previewAttack(s, unit, e).allowed);
      const closest = nearest(unit.pos, reachableTargets);
      // Orders that say "the nearest enemies" lean toward them; the AI still weighs who is worth hitting.
      const lean = profile === 'atacar' || profile === 'arqueiros-disparem' ? 2 : 0.5;
      for (const enemy of reachableTargets) {
        const value = strikeValue(s, unit, enemy, hitChance(s, unit, enemy)) - (distance(enemy.pos, unit.pos) - closest) * lean;
        if (value > attackValue) { attackValue = value; target = enemy; }
      }
      if (swings >= 2) attackValue *= WEIGHTS.secondSwing;
    }
    const threat = threatAt(ctx), together = cohesion(ctx, option.pos), obeys = compliance(ctx, option, here, Boolean(target));
    const score = through * (ATTACK_WEIGHT[profile] ?? 1) * attackValue
      - ctx.self * (WEIGHTS.threat * threat + risk / unit.maxHp * 100)
      - (1 - through) * 15
      + together
      + ctx.obedience * obeys
      - option.cost * 0.1;
    if (AI_TRACE.on) AI_TRACE.rows.push({ unit: unit.id, pos: `${option.pos.q},${option.pos.r}`, here, target: target?.id,
      attack: +attackValue.toFixed(1), threat: +threat.toFixed(1), risk: +(risk / unit.maxHp * 100).toFixed(1),
      through: +through.toFixed(2), cohesion: +together.toFixed(1), compliance: +obeys.toFixed(1), score: +score.toFixed(1) });
    return { option, target, score };
  } finally {
    unit.pos = saved.pos; unit.ap = saved.ap; unit.fatigue = saved.fatigue;
  }
}

/** Staying shoulder to shoulder, within the commander's reach, and (for archers) away from enemy blades. */
function cohesion(ctx: Context, pos: Hex): number {
  const { unit } = ctx, melee = unit.weapon.kind === 'melee';
  let adjacent = 0, closestAlly = Infinity;
  for (const ally of ctx.allies) {
    if (ally.morale === 0) continue;
    const d = distance(ally.pos, pos);
    if (d === 1) adjacent++;
    closestAlly = Math.min(closestAlly, d);
  }
  let score = (melee ? WEIGHTS.cohesion : WEIGHTS.cohesion / 2) * Math.min(adjacent, 3);
  if (closestAlly > 2 && closestAlly < Infinity) score -= Math.min(18, (closestAlly - 2) * 6);
  if (ctx.commander && distance(ctx.commander.pos, pos) > ctx.commander.commandRange) score -= 8;
  if (!melee) {
    const blades = nearest(pos, ctx.fighters.filter(e => e.weapon.kind === 'melee'));
    score -= blades <= 1 ? 20 : blades === 2 ? 10 : blades === 3 ? 4 : 0;
  }
  return score;
}

/** How well this choice carries out the order (section 6 of the design doc). */
function compliance(ctx: Context, option: Option, here: number, hasTarget: boolean): number {
  const progress = ctx.startDistance - here, stay = option.cost === 0;
  // Only stepping forward past the line counts: a troop already in contact is not pulled back out of it.
  const ahead = (allowance: number) => Math.max(0, Math.min(ctx.startDistance, ctx.lineDistance - allowance) - here);
  switch (ctx.profile) {
    // Atacar! fights like a troop on its own, plus the first-strike bonus the engine adds to the blow.
    case 'livre':
    case 'atacar': return progress * 8 + (hasTarget ? 12 : 0);
    case 'manter': return 0;
    // Stepping past the line is fine when it lands a blow: the advance keeps its PA for exactly that.
    case 'avanco-devagar': return Math.min(progress, 2) * 9 - (hasTarget ? 0 : ahead(1) * 14) + (hasTarget ? 6 : 0);
    case 'avanco-rapido': return progress * 12 + (hasTarget ? 10 : 0);
    case 'linha-defensiva': return (stay ? 5 : 0) - ahead(0) * 18;
    case 'levantar-escudos': return stay ? 10 : 0;
    case 'arqueiros-disparem': return hasTarget ? 25 : Math.max(0, progress) * 6;
    case 'arqueiros-preparar': return 0;
    case 'comando': {
      // Fight with the platoon, keep it within command range, and never walk out ahead of it.
      // A Líder de Combate stands in the line; the others stay one hex behind.
      const { unit } = ctx;
      const inRange = ctx.ownTroops.filter(t => distance(t.pos, option.pos) <= unit.commandRange).length;
      const forward = Math.max(0, ctx.lineDistance + (unit.leaderClass === 'combate' ? 0 : 1) - here);
      return progress * 4 + (hasTarget ? 12 : 0) + inRange - forward * 4;
    }
  }
}

/** "Preparar disparo": aim one turn, then shoot the aimed enemy with the bonus. Undefined when there is no shot. */
function aimOrShoot(s: BattleState, unit: Unit): ActionResult | undefined {
  const order = unit.order!;
  const aimed = order.aimTargetId ? s.units.find(u => u.id === order.aimTargetId) : undefined;
  if (aimed && order.aimRound !== undefined) {
    if (order.aimRound === s.round) return endTurn(s);
    if (hasShot(s, unit, aimed)) return previewAttack(s, unit, aimed).allowed ? attack(s, aimed.id) : endTurn(s);
  }
  const shots = s.units.filter(u => isAlive(u) && u.team !== unit.team && hasShot(s, unit, u));
  if (!shots.length) return undefined;
  const closest = nearest(unit.pos, shots);
  let best: Unit | undefined, bestValue = -Infinity;
  for (const enemy of shots) {
    if (distance(enemy.pos, unit.pos) > closest + 1) continue;
    const chance = Math.min(95, hitChance(s, unit, enemy) + ORDER_BONUS.mira * order.potency);
    const value = strikeValue(s, unit, enemy, chance);
    if (value > bestValue) { bestValue = value; best = enemy; }
  }
  return aim(s, best!.id);
}

// Commanders -----------------------------------------------------------------

interface OrderPlan { id: OrderId; target: OrderTarget }
const ADVANCES: OrderId[] = ['avanco-devagar', 'avanco-rapido', 'atacar'];

/** Fighting strength of a side: life and armor weighted by skill and morale. */
function sidePower(s: BattleState, team: Team): number {
  return s.units.filter(u => isAlive(u) && u.team === team && u.morale > 0).reduce((sum, u) => {
    const skill = u.weapon.kind === 'melee' ? u.meleeSkill : u.rangedSkill * 0.85;
    return sum + (u.hp + (u.headArmor + u.bodyArmor) / 3) * skill / 60 * (0.7 + 0.1 * u.morale);
  }, 0);
}
const armedArchers = (units: Unit[]): Unit[] => units.filter(u => u.weapon.kind === 'ranged' && u.morale > 0 && (u.weapon.ammo ?? 1) > 0);

/**
 * Leader AI, version 1: rules with scores. Reads strength, distance, archers and morale, picks an order
 * per division, and gives one order to everyone when both divisions want the same thing.
 */
export function planOrder(s: BattleState, commander: Unit): OrderPlan | undefined {
  const platoons = commandedPlatoons(s, commander);
  const troops = platoons.flatMap(p => platoonTroops(s, p.id)).filter(u => u.id !== commander.id && u.morale > 0);
  const enemies = s.units.filter(u => isAlive(u) && u.team !== commander.team && u.morale > 0);
  if (!troops.length || !enemies.length) return undefined;
  const ready = (d: Division) => platoons.every(p => p.readyRound[d] <= s.round);
  const reachable = (d: Division) => troops.some(u => divisionOf(u) === d && distance(u.pos, commander.pos) <= commander.commandRange);
  const warriors = troops.filter(u => divisionOf(u) === 'guerreiros'), archers = troops.filter(u => divisionOf(u) === 'arqueiros');
  const ours = s.units.filter(u => isAlive(u) && u.team === commander.team);
  const power = sidePower(s, commander.team) / Math.max(1, sidePower(s, enemies[0].team));
  const archerEdge = armedArchers(ours).length - armedArchers(enemies).length;
  const quiet = s.round - s.lastClashRound;

  let warriorWish: OrderId | undefined;
  if (warriors.length && ready('guerreiros') && reachable('guerreiros')) {
    const dist = median(warriors.map(u => nearest(u.pos, enemies)));
    const engaged = warriors.filter(u => controllers(s, u).length).length / warriors.length;
    const shields = warriors.filter(u => u.shield).length / warriors.length;
    const arrows = armedArchers(enemies).filter(e => warriors.some(u => distance(u.pos, e.pos) <= e.weapon.range + 2)).length;
    // Enemies that marched this round or the last are coming: contact is near even from afar.
    const marching = enemies.filter(e => (s.movedRound[e.id] ?? 0) >= s.round - 1).length / enemies.length;
    // An order lasts three rounds, so the leader commits to what the platoon will need when the lines meet.
    const contactSoon = engaged > 0 || dist <= 7 || (marching >= 0.4 && dist <= 11);
    const hold: OrderId = arrows >= 3 && shields >= 0.4 && engaged === 0 ? 'levantar-escudos' : 'linha-defensiva';
    if (contactSoon) warriorWish = power < WEIGHTS.weak ? hold : 'atacar';
    // Nobody has struck a blow in a while: someone has to move, or the battle never ends.
    else if (quiet >= 4) warriorWish = 'avanco-rapido';
    // Outshot: close the distance before the arrows do their work. Outshooting them: let them come.
    else if (archerEdge <= -2) warriorWish = 'avanco-rapido';
    else if (archerEdge >= 2 || power < WEIGHTS.weak) warriorWish = hold;
    else warriorWish = dist >= WEIGHTS.slowAdvance ? 'avanco-devagar' : 'atacar';
  }

  let archerWish: OrderId | undefined;
  if (archers.length && ready('arqueiros') && reachable('arqueiros')) {
    const range = Math.max(...archers.map(u => u.weapon.range));
    const inReach = enemies.some(e => archers.some(u => distance(u.pos, e.pos) <= range + 2));
    const platoonOrder = platoons[0]?.lastOrder.guerreiros;
    const warriorsMode = warriorWish ?? (platoonOrder && platoonOrder.expiresRound >= s.round ? platoonOrder.id : undefined);
    if (!inReach) archerWish = warriorsMode && ADVANCES.includes(warriorsMode) ? 'avanco-devagar' : undefined;
    else {
      const gap = Math.min(...archers.map(u => nearest(u.pos, enemies.filter(e => e.weapon.kind === 'melee'))));
      const chances = archers.flatMap(u => {
        const shots = enemies.filter(e => hasShot(s, u, e));
        if (!shots.length) return [];
        const close = nearest(u.pos, shots);
        return [Math.max(...shots.filter(e => distance(e.pos, u.pos) === close).map(e => hitChance(s, u, e)))];
      });
      const chance = chances.length ? chances.reduce((a, b) => a + b, 0) / chances.length : 0;
      const aimed = Math.min(95, chance + ORDER_BONUS.mira * commander.potency);
      // Aiming trades a turn of shooting for a bonus on the next two: worth it at long range, while the enemy is still far.
      archerWish = chances.length && gap >= 6 && 4 * aimed > 6 * chance ? 'arqueiros-preparar' : 'arqueiros-disparem';
    }
  }

  const affordable = (id: OrderId) => orderInfo(id).pl <= commander.pl;
  if (warriorWish && warriorWish === archerWish && orderInfo(warriorWish).targets.includes('todos') && affordable(warriorWish)) {
    return { id: warriorWish, target: 'todos' };
  }
  if (warriorWish && affordable(warriorWish)) return { id: warriorWish, target: 'guerreiros' };
  if (archerWish && affordable(archerWish)) return { id: archerWish, target: 'arqueiros' };
  return undefined;
}
