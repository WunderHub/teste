import { describe, expect, it } from 'vitest';
import {
  aim, attack, attributeScore, checkOrder, distance, divisionOf, endTurn, getActive, hitChance, INTERIM_COMMAND,
  isPlayerControlled, issueOrder, key, makeLeader, makeTiles, makeUnit, move, neighbors, ORDER_BONUS, ORDERS,
  performSimpleAiAction, platoonTroops, previewAttack, reachable, startBattle, tileAt, waitTurn,
  type BattleState, type OrderId, type Unit,
} from './game';
import { BOARD_HEIGHT, BOARD_WIDTH, createBattle, FIELD_HEIGHT, FIELD_WIDTH } from './encounters';
import { performAiAction } from './ai';

/** A clear arena isolates rule interactions from the encounter's level design. */
function duel(seed = 1, archer = false) {
  const state = createBattle(seed);
  const ally = state.units.find(u => u.id === (archer ? 'nara' : 'iria'))!;
  const enemy = state.units.find(u => u.id === 'raider-1')!;
  state.units = [ally, enemy];
  state.tiles.forEach(tile => { delete tile.obstacle; tile.terrain = 'grass'; });
  ally.pos = { q: 4, r: 4 }; enemy.pos = { q: 10, r: 4 };
  state.queue = [ally.id, enemy.id];
  state.activatedRound = { [ally.id]: state.round };
  state.adjacentThreats = {};
  state.log = [];
  return { state, ally, enemy };
}

function setActive(state: BattleState, unit: Unit) {
  state.queue = [unit.id, ...state.units.filter(u => u.id !== unit.id).map(u => u.id)];
  state.activatedRound[unit.id] = state.round;
}

/** An enemy troop steps next to the leader and lands a certain killing blow. */
function killLeader(state: BattleState, leader: Unit) {
  const killer = state.units.find(u => u.team !== leader.team && u.role === 'troop' && u.weapon.kind === 'melee')!;
  killer.pos = neighbors(leader.pos).find(h => tileAt(state, h) && !tileAt(state, h)!.obstacle && !state.units.some(u => key(u.pos) === key(h)))!;
  leader.hp = 1; leader.headArmor = leader.bodyArmor = 0; killer.meleeSkill = 1000;
  setActive(state, killer);
  expect(attack(state, leader.id).ok).toBe(true);
}

/** Ends turns without acting until the given round starts. */
function skipTo(state: BattleState, round: number) {
  while (state.round < round && state.outcome === 'ongoing') expect(endTurn(state).ok).toBe(true);
}

/** Runs the AI while this unit keeps the turn and returns where it ended up. */
function aiTurn(state: BattleState, unit: Unit) {
  setActive(state, unit);
  const events = [];
  for (let i = 0; i < 6 && getActive(state)?.id === unit.id; i++) events.push(...performAiAction(state).events);
  return events;
}

describe('hexes and movement', () => {
  it('uses symmetric adjacency on even and odd rows', () => {
    for (const pos of [{ q: 4, r: 4 }, { q: 4, r: 5 }]) {
      expect(neighbors(pos)).toHaveLength(6);
      for (const next of neighbors(pos)) {
        expect(distance(pos, next)).toBe(1);
        expect(neighbors(next)).toContainEqual(pos);
      }
    }
    expect(distance({ q: 2, r: 2 }, { q: 7, r: 6 })).toBe(7);
  });

  it('charges the complete path and excludes obstacles, units and board edges', () => {
    const { state, ally, enemy } = duel();
    enemy.pos = { q: 10, r: 7 };
    state.tiles.find(t => t.q === 5 && t.r === 4)!.obstacle = 'rocks';
    const paths = reachable(state, ally);
    expect(paths.has('5,4')).toBe(false);
    expect(paths.has(key(enemy.pos))).toBe(false);
    expect([...paths.keys()].some(k => k.startsWith('-'))).toBe(false);
    const target = { q: 6, r: 4 }, path = paths.get(key(target))!;
    expect(path).toHaveLength(3);
    expect(path).not.toContainEqual({ q: 5, r: 4 });
    expect(move(state, target).ok).toBe(true);
    expect(ally.pos).toEqual(target);
    expect(ally.ap).toBe(3);
    expect(ally.fatigue).toBe(12);
  });

  it('rough ground costs 3 PA and 6 fatigue; an unaffordable move changes nothing', () => {
    const { state, ally } = duel();
    const rough = state.tiles.find(t => t.q === 5 && t.r === 4)!;
    rough.terrain = 'rough';
    expect(move(state, rough).ok).toBe(true);
    expect([ally.ap, ally.fatigue]).toEqual([6, 6]);
    ally.fatigue = ally.maxFatigue - 3;
    const snapshot = JSON.stringify(state);
    expect(move(state, { q: 6, r: 4 }).ok).toBe(false);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('leaving an enemy-controlled hex can be intercepted even while staying adjacent', () => {
    const { state, ally, enemy } = duel(1);
    enemy.pos = { q: 5, r: 4 };
    enemy.meleeSkill = 1000;
    enemy.weapon.minDamage = enemy.weapon.maxDamage = 5;
    const destination = { q: 4, r: 5 };
    expect(distance(destination, enemy.pos)).toBe(1);
    const result = move(state, destination);
    expect(result.events.some(e => e.type === 'attack' && e.unitId === enemy.id && e.hit)).toBe(true);
    expect(ally.pos).toEqual({ q: 4, r: 4 });
    expect([ally.ap, ally.fatigue]).toEqual([7, 4]);
  });

  it('a missed reaction allows movement and a fleeing enemy exerts no control', () => {
    const { state, ally, enemy } = duel(16000);
    enemy.pos = { q: 5, r: 4 }; enemy.meleeSkill = 1000;
    const result = move(state, { q: 4, r: 5 });
    expect(result.events.some(e => e.type === 'attack' && !e.hit)).toBe(true);
    expect(ally.pos).toEqual({ q: 4, r: 5 });
    enemy.morale = 0;
    expect(move(state, { q: 5, r: 5 }).events.some(e => e.type === 'attack')).toBe(false);
  });
});

describe('turn resources and order', () => {
  it('waiting keeps remaining resources, permits only one wait and penalizes next-round initiative', () => {
    const { state, ally, enemy } = duel();
    ally.initiative = 110; enemy.initiative = 95;
    ally.ap = 5; ally.fatigue = 10;
    expect(waitTurn(state).ok).toBe(true);
    expect(getActive(state)?.id).toBe(enemy.id);
    expect(endTurn(state).ok).toBe(true);
    expect(getActive(state)?.id).toBe(ally.id);
    expect([ally.ap, ally.fatigue]).toEqual([5, 10]);
    expect(waitTurn(state).ok).toBe(false);
    endTurn(state);
    expect(state.round).toBe(2);
    expect(getActive(state)?.id).toBe(enemy.id);
    expect(ally.waited).toBe(false);
    endTurn(state);
    expect(getActive(state)?.id).toBe(ally.id);
    expect([ally.ap, ally.fatigue]).toEqual([9, 0]);
  });

  it('renews PA and reduces fatigue by exactly 15 only on the first activation of a round', () => {
    const { state, ally, enemy } = duel();
    ally.initiative = 200; enemy.initiative = 50;
    ally.ap = 1; ally.fatigue = 35;
    endTurn(state); endTurn(state);
    expect(getActive(state)?.id).toBe(ally.id);
    expect([ally.ap, ally.fatigue]).toEqual([9, 20]);
    waitTurn(state); endTurn(state);
    expect([ally.ap, ally.fatigue]).toEqual([9, 20]);
  });

  it('spends PA and fatigue on a missed attack but rejects unaffordable attacks atomically', () => {
    const { state, ally, enemy } = duel(16000);
    enemy.pos = { q: 5, r: 4 }; ally.meleeSkill = 1000;
    const result = attack(state, enemy.id);
    expect(result.events[0].hit).toBe(false);
    expect([ally.ap, ally.fatigue]).toEqual([5, 13]);
    ally.ap = 3;
    const snapshot = JSON.stringify(state);
    expect(attack(state, enemy.id).ok).toBe(false);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe('attacks, armor and line of sight', () => {
  it.each([[1, 'head', 15], [42, 'body', 10]] as const)(
    'seed %i hits %s: penetration hurts through intact armor and head damage is multiplied',
    (seed, location, expectedDamage) => {
      const { state, ally, enemy } = duel(seed);
      enemy.pos = { q: 5, r: 4 };
      ally.meleeSkill = 1000; ally.weapon.minDamage = ally.weapon.maxDamage = 40; ally.weapon.armorDamage = 1;
      enemy.meleeDefense = 0; enemy.headArmor = enemy.bodyArmor = 100;
      const before = enemy.hp;
      const strike = attack(state, enemy.id).events.find(e => e.type === 'attack')!;
      expect(strike).toMatchObject({ hit: true, location, damage: expectedDamage, armorDamage: 40 });
      expect(enemy.hp).toBe(before - expectedDamage);
      expect(enemy[location === 'head' ? 'headArmor' : 'bodyArmor']).toBe(60);
      expect(enemy[location === 'head' ? 'bodyArmor' : 'headArmor']).toBe(100);
    },
  );

  it('unarmored targets take regular weapon damage rather than only the penetrating fraction', () => {
    const { state, ally, enemy } = duel(42);
    enemy.pos = { q: 5, r: 4 }; enemy.headArmor = enemy.bodyArmor = 0;
    ally.meleeSkill = 1000; ally.weapon.minDamage = ally.weapon.maxDamage = 30;
    expect(attack(state, enemy.id).events[0]).toMatchObject({ damage: 30, armorDamage: 0, location: 'body' });
  });

  it('clamps chance at 5–95% and grants the spear its accuracy advantage', () => {
    const { state, ally, enemy } = duel();
    enemy.pos = { q: 5, r: 4 };
    ally.meleeSkill = 0; enemy.meleeDefense = 1000;
    expect(previewAttack(state, ally, enemy).chance).toBe(5);
    ally.meleeSkill = 1000; enemy.meleeDefense = 0;
    expect(previewAttack(state, ally, enemy).chance).toBe(95);
    ally.meleeSkill = 50;
    const normal = previewAttack(state, ally, enemy).chance;
    ally.weapon.accuracy = 20;
    expect(previewAttack(state, ally, enemy).chance).toBe(normal + 20);
  });

  it('arrows fly over combatants but not through obstacles, beyond range, or during melee engagement', () => {
    const { state, ally, enemy } = duel(1, true);
    enemy.pos = { q: 8, r: 4 };
    expect(previewAttack(state, ally, enemy).allowed).toBe(true);
    const obstruction = state.tiles.find(t => t.q === 6 && t.r === 4)!;
    obstruction.obstacle = 'ruin';
    expect(previewAttack(state, ally, enemy).reason).toMatch(/Linha de tiro/);
    delete obstruction.obstacle;
    state.units.push({ ...ally, id: 'between', pos: { q: 6, r: 4 } }, { ...enemy, id: 'in-front', pos: { q: 7, r: 4 } });
    expect(previewAttack(state, ally, enemy)).toMatchObject({ allowed: true, friendlyRisk: 0 });
    state.units.splice(2);
    enemy.pos = { q: 12, r: 4 };
    expect(previewAttack(state, ally, enemy).reason).toMatch(/alcance/);
    enemy.pos = { q: 5, r: 4 };
    expect(previewAttack(state, ally, enemy).reason).toMatch(/Engajado/);
  });

  /** Friends of the shooter placed in contact with the target, on free hexes around it. */
  const contact = (state: BattleState, shooter: Unit, target: Unit, count: number): Unit[] => {
    const free = neighbors(target.pos).filter(h => tileAt(state, h) && !tileAt(state, h)!.obstacle
      && !state.units.some(u => key(u.pos) === key(h)));
    const friends = free.slice(0, count).map((pos, i): Unit => ({ ...shooter, id: `friend-${i}`, name: `Amigo ${i}`,
      weapon: { ...shooter.weapon }, pos }));
    state.units.push(...friends);
    return friends;
  };

  it('a missed arrow can strike a friend in contact with the target: 35% per friend, up to 70%', () => {
    const { state, ally, enemy } = duel(1, true);
    enemy.pos = { q: 8, r: 4 };
    ally.rangedSkill = -1000;
    expect(previewAttack(state, ally, enemy)).toMatchObject({ chance: 5, friendlyRisk: 0 });
    contact(state, ally, enemy, 1);
    expect(previewAttack(state, ally, enemy).friendlyRisk).toBe(33);
    contact(state, ally, enemy, 2);
    expect(previewAttack(state, ally, enemy).friendlyRisk).toBe(67);
  });

  it('only friends in contact take stray arrows, and only after a miss', () => {
    const { state, ally, enemy } = duel(17431, true);
    enemy.pos = { q: 8, r: 4 };
    ally.rangedSkill = -1000;
    const friends = contact(state, ally, enemy, 2);
    for (const u of [enemy, ...friends]) { u.hp = u.maxHp = 100000; u.resolve = 1000; }
    let strays = 0, clean = 0;
    for (let shot = 0; shot < 60; shot++) {
      setActive(state, ally);
      ally.ap = ally.maxAp; ally.fatigue = 0;
      const before = friends.map(f => f.hp + f.headArmor + f.bodyArmor);
      const events = attack(state, enemy.id).events.filter(e => e.type === 'attack');
      const stray = events.filter(e => e.stray);
      if (events[0].hit) { expect(stray).toHaveLength(0); continue; }
      if (stray.length) strays++; else clean++;
      expect(stray.length).toBeLessThanOrEqual(1);
      for (const e of stray) {
        expect(e).toMatchObject({ unitId: ally.id, hit: true, from: enemy.pos });
        expect(friends.map(f => f.id)).toContain(e.targetId);
      }
      friends.forEach((f, i) => {
        expect(f.hp + f.headArmor + f.bodyArmor < before[i]).toBe(stray.some(e => e.targetId === f.id));
      });
    }
    // 70% of misses go astray here: both outcomes show up over sixty shots.
    expect(strays).toBeGreaterThan(20);
    expect(clean).toBeGreaterThan(5);
  });

  it('melee blows never go astray', () => {
    const { state, ally, enemy } = duel(1);
    enemy.pos = { q: 5, r: 4 };
    ally.meleeSkill = -1000;
    contact(state, ally, enemy, 2);
    expect(previewAttack(state, ally, enemy).friendlyRisk).toBe(0);
    expect(attack(state, enemy.id).events.some(e => e.stray)).toBe(false);
  });

  it('supports optional ammunition without imposing it on the prototype loadouts', () => {
    const { state, ally, enemy } = duel(42, true);
    enemy.pos = { q: 8, r: 4 };
    expect(ally.weapon.ammo).toBeUndefined();
    ally.weapon.ammo = 1;
    expect(attack(state, enemy.id).ok).toBe(true);
    expect(ally.weapon.ammo).toBe(0);
    expect(previewAttack(state, ally, enemy).reason).toBe('Sem flechas.');
  });
});

describe('morale and encounter outcomes', () => {
  it('a substantial injury can trigger flight; a fleeing ally loses ordinary control', () => {
    const { state, ally, enemy } = duel(42);
    enemy.pos = { q: 5, r: 4 };
    enemy.meleeSkill = 1000; enemy.weapon.minDamage = enemy.weapon.maxDamage = 20;
    ally.headArmor = ally.bodyArmor = 0; ally.resolve = 0; ally.morale = 1;
    setActive(state, enemy);
    expect(attack(state, ally.id).ok).toBe(true);
    expect(ally.morale).toBe(0);
    setActive(state, ally);
    expect(attack(state, enemy.id).ok).toBe(false);
    expect(move(state, { q: 3, r: 4 }).ok).toBe(false);
    expect(waitTurn(state).ok).toBe(false);
  });

  it.each(['ally', 'enemy'] as const)('escaping the last %s ends combat with the appropriate result', team => {
    const { state, ally, enemy } = duel();
    const fleeing = team === 'ally' ? ally : enemy;
    fleeing.pos = { q: 0, r: 4 }; fleeing.morale = 0;
    setActive(state, fleeing);
    expect(performAiAction(state).ok).toBe(true);
    expect(fleeing.escaped).toBe(true);
    expect(state.outcome).toBe(team === 'ally' ? 'defeat' : 'victory');
    expect(state.queue).toEqual([]);
  });

  it.each(['ally', 'enemy'] as const)('killing the last %s resolves combat immediately', team => {
    const { state, ally, enemy } = duel(42);
    enemy.pos = { q: 5, r: 4 };
    const victim = team === 'ally' ? ally : enemy, killer = team === 'ally' ? enemy : ally;
    victim.hp = 1; victim.headArmor = victim.bodyArmor = 0; killer.meleeSkill = 1000;
    setActive(state, killer);
    expect(attack(state, victim.id).ok).toBe(true);
    expect(victim.dead).toBe(true);
    expect(state.outcome).toBe(team === 'ally' ? 'defeat' : 'victory');
    expect(attack(state, victim.id).ok).toBe(false);
  });

  it('the initial encounter has three mercenaries, four opponents and a valid connected board', () => {
    const state = createBattle();
    expect(state.units.filter(u => u.team === 'ally')).toHaveLength(3);
    expect(state.units.filter(u => u.team === 'enemy')).toHaveLength(4);
    expect(state.tiles).toHaveLength(BOARD_WIDTH * BOARD_HEIGHT);
    expect(new Set(state.units.map(u => key(u.pos))).size).toBe(7);
    for (const unit of state.units) expect(state.tiles.find(t => key(t) === key(unit.pos))?.obstacle).toBeUndefined();
  });

  it('two remaining archers can resolve a duel even when standing next to each other', () => {
    const { state, ally, enemy } = duel(42, true);
    enemy.weapon = { ...ally.weapon };
    enemy.rangedSkill = 70;
    enemy.pos = { q: 5, r: 4 };
    expect(previewAttack(state, ally, enemy).allowed).toBe(true);
    let actions = 0;
    while (state.outcome === 'ongoing' && actions++ < 200) {
      expect(performAiAction(state).ok).toBe(true);
    }
    expect(state.outcome).not.toBe('ongoing');
    expect(actions).toBeLessThan(200);
  });

  it.each([1, 2, 5, 42, 731, 17431])('AI completes a deterministic battle for seed %i without stalled turns', seed => {
    const run = () => {
      const state = createBattle(seed);
      let actions = 0;
      while (state.outcome === 'ongoing' && actions < 600) {
        expect(performAiAction(state).ok).toBe(true);
        actions++;
        for (const unit of state.units) {
          expect(unit.ap).toBeGreaterThanOrEqual(0);
          expect(unit.fatigue).toBeLessThanOrEqual(unit.maxFatigue);
          expect(unit.hp).toBeGreaterThanOrEqual(0);
        }
      }
      expect(state.outcome).not.toBe('ongoing');
      expect(actions).toBeLessThan(600);
      return state;
    };
    expect(run()).toEqual(run());
  });
});

describe('leaders, platoons and the field battle', () => {
  const sword = { name: 'Espada', kind: 'melee' as const, minDamage: 30, maxDamage: 40, armorDamage: 1, penetration: 0.3, ap: 4, fatigue: 12, range: 1, accuracy: 0 };
  const base = { hp: 60, maxFatigue: 90, resolve: 50, initiative: 100, meleeSkill: 60, rangedSkill: 40, meleeDefense: 10, rangedDefense: 5, headArmor: 50, bodyArmor: 80 };

  it('the field battle fields one leader and twenty troops per side on a valid board', () => {
    const state = createBattle(1, 'campo-aberto');
    expect([state.width, state.height]).toEqual([FIELD_WIDTH, FIELD_HEIGHT]);
    expect(state.tiles).toHaveLength(FIELD_WIDTH * FIELD_HEIGHT);
    for (const team of ['ally', 'enemy'] as const) {
      const leaders = state.units.filter(u => u.team === team && u.role === 'leader');
      const platoon = state.platoons.find(p => p.team === team)!;
      expect(leaders).toHaveLength(1);
      expect(platoon.leaderId).toBe(leaders[0].id);
      expect(leaders[0].platoonId).toBe(platoon.id);
      const troops = platoonTroops(state, platoon.id);
      expect(troops).toHaveLength(20);
      expect(troops.filter(u => divisionOf(u) === 'arqueiros')).toHaveLength(6);
      expect(state.units.filter(u => u.team === team && u.role === 'troop').every(u => u.platoonId === platoon.id)).toBe(true);
    }
    // The Líder Supremo stays home: the faction sends Duarte, a Líder de Combate.
    expect(state.units.filter(u => u.supreme)).toEqual([]);
    expect(state.units.find(u => u.id === 'duarte')).toMatchObject({ role: 'leader', leaderClass: 'combate', maxPl: 6, commandRange: 5 });
    expect(new Set(state.units.map(u => key(u.pos))).size).toBe(state.units.length);
    for (const unit of state.units) {
      expect(tileAt(state, unit.pos)).toBeDefined();
      expect(tileAt(state, unit.pos)?.obstacle).toBeUndefined();
    }
  });

  it('the player commands only their own leaders, and only while those leaders hold', () => {
    const state = createBattle(1, 'campo-aberto');
    expect(state.units.filter(isPlayerControlled).map(u => u.id)).toEqual(['duarte']);
    const leader = state.units.find(u => u.id === 'duarte')!;
    leader.morale = 0;
    expect(isPlayerControlled(leader)).toBe(false);
    leader.morale = 3; leader.dead = true;
    expect(isPlayerControlled(leader)).toBe(false);
  });

  it('the attribute score sums the eight base attributes and ignores wounds and armor', () => {
    const unit = makeUnit('t', 'Tropa', 'ally', 'iria', { q: 0, r: 0 }, sword, base);
    expect(attributeScore(unit)).toBe(60 + 90 + 50 + 100 + 60 + 40 + 10 + 5);
    unit.hp = 12; unit.headArmor = 0;
    expect(attributeScore(unit)).toBe(415);
  });

  it('the leader subclass scales the base attributes but not armor', () => {
    const combat = makeLeader('c', 'C', 'ally', 'captain', { q: 0, r: 0 }, sword, 'combate', base);
    const strategist = makeLeader('e', 'E', 'ally', 'captain', { q: 0, r: 0 }, sword, 'estrategico', base);
    const encourager = makeLeader('n', 'N', 'ally', 'captain', { q: 0, r: 0 }, sword, 'encorajador', base);
    expect([combat.maxHp, combat.hp, combat.meleeSkill, combat.initiative]).toEqual([72, 72, 72, 120]);
    expect([strategist.maxHp, strategist.meleeSkill, strategist.meleeDefense]).toEqual([51, 51, 9]);
    expect(attributeScore(encourager)).toBe(415);
    expect([combat.maxHeadArmor, combat.maxBodyArmor]).toEqual([50, 80]);
    expect([combat.role, combat.leaderClass]).toEqual(['leader', 'combate']);
  });

  it('tiles are looked up by row and column, and a setup must list them row by row', () => {
    const state = createBattle(1, 'campo-aberto');
    expect(tileAt(state, { q: 29, r: 19 })).toMatchObject({ q: 29, r: 19 });
    expect(tileAt(state, { q: 30, r: 0 })).toBeUndefined();
    expect(tileAt(state, { q: -1, r: 3 })).toBeUndefined();
    const tiles = makeTiles(3, 2).reverse();
    expect(() => startBattle(1, { encounter: 'campo-aberto', width: 3, height: 2, tiles, units: [] })).toThrow();
  });

  it('when the last leader falls, the troop with the best attribute score takes interim command', () => {
    const state = createBattle(1, 'campo-aberto');
    const leader = state.units.find(u => u.id === 'duarte')!;
    killLeader(state, leader);
    expect(leader.dead).toBe(true);
    const platoon = state.platoons.find(p => p.team === 'ally')!;
    expect(platoon.leaderId).toBeNull();
    expect(state.log).toContain('O pelotão de Duarte ficou sem líder.');
    expect(state.units.some(isPlayerControlled)).toBe(false);
    const best = Math.max(...platoonTroops(state, platoon.id).map(attributeScore));
    const interim = state.units.find(u => u.id === platoon.commanderId)!;
    expect(interim.role).toBe('troop');
    expect(attributeScore(interim)).toBe(best);
    expect([interim.maxPl, interim.commandRange, interim.potency]).toEqual([INTERIM_COMMAND.pl, INTERIM_COMMAND.range, INTERIM_COMMAND.potency]);
    expect(state.log).toContain(`${interim.name} assume o comando interino.`);
    // The interim commander gives orders like a leader, with its own PL, but the player never controls it.
    setActive(state, interim); interim.pl = interim.maxPl;
    expect(isPlayerControlled(interim)).toBe(false);
    expect(issueOrder(state, 'linha-defensiva', 'guerreiros').ok).toBe(true);
    expect(interim.pl).toBe(INTERIM_COMMAND.pl - 3);
  });

  it.each(['ally', 'enemy'] as const)('a supreme %s leader who falls in the field ends the battle at once', team => {
    const state = createBattle(1, 'campo-aberto');
    const leader = state.units.find(u => u.team === team && u.role === 'leader')!;
    leader.supreme = true;
    killLeader(state, leader);
    expect(state.outcome).toBe(team === 'ally' ? 'defeat' : 'victory');
    expect(state.endReason).toBe('supreme');
    expect(state.queue).toEqual([]);
    expect(state.log.at(-1)).toBe(team === 'ally' ? 'Derrota. Duarte caiu, e com ele a campanha.'
      : 'Vitória. Senhor da Guerra, o líder supremo inimigo, caiu.');
    expect(state.platoons.find(p => p.team === team)!.commanderId).toBeNull();
  });

  it('a supreme leader who flees the field does not end the battle', () => {
    const state = createBattle(1, 'campo-aberto');
    const leader = state.units.find(u => u.id === 'duarte')!;
    leader.supreme = true; leader.pos = { q: 0, r: 1 }; leader.morale = 0;
    setActive(state, leader);
    expect(performAiAction(state).ok).toBe(true);
    expect(leader.escaped).toBe(true);
    expect(state.outcome).toBe('ongoing');
  });

  it('fleeing uses the edges of the current board, not the ambush size', () => {
    const state = createBattle(1, 'campo-aberto');
    const runner = state.units.find(u => u.id === 'inimigo-arco-1')!;
    runner.pos = { q: FIELD_WIDTH - 1, r: 10 }; runner.morale = 0;
    setActive(state, runner);
    expect(performAiAction(state).ok).toBe(true);
    expect(runner.escaped).toBe(true);
  });

  it.each([3, 731])('AI completes the field battle for seed %i without stalled turns', seed => {
    const run = () => {
      const state = createBattle(seed, 'campo-aberto');
      let actions = 0;
      while (state.outcome === 'ongoing' && actions < 3000) {
        expect(performAiAction(state).ok).toBe(true);
        actions++;
      }
      expect(state.outcome).not.toBe('ongoing');
      expect(actions).toBeLessThan(3000);
      return state;
    };
    expect(run()).toEqual(run());
  }, 20000);
});

describe('orders and the command tab', () => {
  const field = () => {
    const state = createBattle(1, 'campo-aberto');
    const leader = state.units.find(u => u.id === 'duarte')!;
    setActive(state, leader); leader.pl = leader.maxPl;
    const troops = platoonTroops(state, leader.platoonId!);
    return { state, leader, troops, warriors: troops.filter(u => divisionOf(u) === 'guerreiros'), archers: troops.filter(u => divisionOf(u) === 'arqueiros') };
  };

  it('Duarte acts first and every troop of the pelotão starts inside his command range', () => {
    const state = createBattle(1, 'campo-aberto');
    const leader = getActive(state)!;
    expect(leader.id).toBe('duarte');
    expect(leader.pl).toBe(6);
    expect(platoonTroops(state, 'pelotao-duarte').every(u => distance(u.pos, leader.pos) <= leader.commandRange)).toBe(true);
    expect(checkOrder(state, leader, 'atacar', 'todos')).toMatchObject({ allowed: true, cost: 4 });
  });

  it('an order costs PL, reaches the chosen division in range and lasts three rounds', () => {
    const { state, leader, warriors, archers } = field();
    const result = issueOrder(state, 'linha-defensiva', 'guerreiros');
    expect(result.ok).toBe(true);
    expect(result.events[0]).toMatchObject({ type: 'order', unitId: 'duarte', order: 'linha-defensiva' });
    expect(result.message).toBe('Duarte: "Formar linha defensiva!" para guerreiros (14 tropas).');
    expect(leader.pl).toBe(3);
    expect(leader.ap).toBe(leader.maxAp);
    expect(warriors.every(u => u.order?.id === 'linha-defensiva' && u.order.expiresRound === state.round + 2)).toBe(true);
    expect(archers.every(u => !u.order)).toBe(true);
    expect(leader.order).toBeUndefined();
    const platoon = state.platoons.find(p => p.id === 'pelotao-duarte')!;
    expect(platoon.readyRound).toEqual({ guerreiros: state.round + 3, arqueiros: 0 });
  });

  it('a division on cooldown, a wrong target, missing PL or nobody in range blocks the order', () => {
    const { state, leader, archers } = field();
    expect(issueOrder(state, 'atacar', 'guerreiros').ok).toBe(true);
    expect(issueOrder(state, 'avanco-rapido', 'todos')).toMatchObject({ ok: false, message: 'Recarga: guerreiros livres na rodada 4.' });
    expect(issueOrder(state, 'linha-defensiva', 'arqueiros')).toMatchObject({ ok: false, message: 'Esta ordem não vale para arqueiros.' });
    expect(issueOrder(state, 'arqueiros-preparar', 'arqueiros')).toMatchObject({ ok: false, message: 'Pontos de liderança insuficientes.' });
    leader.pl = 6;
    archers.forEach((archer, i) => { archer.pos = { q: 25 - (i % 2), r: 1 + i }; });
    expect(issueOrder(state, 'arqueiros-disparem', 'todos')).toMatchObject({ ok: false, message: 'Nenhuma tropa desta divisão no alcance de comando.' });
    expect(leader.pl).toBe(6);
    const troop = platoonTroops(state, 'pelotao-duarte')[0];
    setActive(state, troop);
    expect(issueOrder(state, 'atacar', 'todos')).toMatchObject({ ok: false, message: 'Só quem comanda um pelotão dá ordens.' });
  });

  it('archer orders always go to the archers; troops out of range keep their old order', () => {
    const { state, warriors, archers } = field();
    const far = archers[0];
    far.pos = { q: 1, r: 18 };
    const result = issueOrder(state, 'arqueiros-disparem', 'todos');
    expect(result.message).toBe('Duarte: "Arqueiros, disparem!" para arqueiros (5 tropas).');
    expect(archers.filter(u => u.order?.id === 'arqueiros-disparem')).toHaveLength(5);
    expect(far.order).toBeUndefined();
    expect(warriors.every(u => !u.order)).toBe(true);
  });

  it('PL refill on the leader\'s next turn; orders end in range and go stale out of range', () => {
    const { state, leader, warriors } = field();
    expect(issueOrder(state, 'linha-defensiva', 'guerreiros').ok).toBe(true);
    const near = warriors[0], far = warriors[1];
    far.pos = { q: 1, r: 18 };
    skipTo(state, 2);
    while (getActive(state)!.id !== leader.id) endTurn(state);
    expect(leader.pl).toBe(leader.maxPl);
    skipTo(state, 4);
    expect(near.order).toBeUndefined();
    expect(far.order).toMatchObject({ id: 'linha-defensiva', stale: true });
    expect(checkOrder(state, leader, 'atacar', 'guerreiros').reason).not.toMatch(/Recarga/);
  });

  describe('order bonuses', () => {
    const order = (unit: Unit, id: OrderId, extra: Partial<NonNullable<Unit['order']>> = {}) => {
      unit.order = { id, expiresRound: 99, potency: 1, stale: false, strikeUsed: false, ...extra };
    };
    const melee = () => {
      const { state, ally, enemy } = duel(5);
      enemy.pos = { q: 5, r: 4 };
      ally.meleeSkill = 60; enemy.meleeSkill = 60; ally.meleeDefense = enemy.meleeDefense = 10;
      return { state, ally, enemy };
    };

    it('Formar linha defensiva! adds melee defense, scaled by the commander\'s potency, and nothing against arrows', () => {
      const { state, ally, enemy } = melee();
      const base = hitChance(state, enemy, ally);
      order(ally, 'linha-defensiva');
      expect(hitChance(state, enemy, ally)).toBe(base - ORDER_BONUS.linha);
      order(ally, 'linha-defensiva', { potency: 1.5 });
      expect(hitChance(state, enemy, ally)).toBe(base - 15);
      order(ally, 'linha-defensiva', { stale: true });
      expect(hitChance(state, enemy, ally)).toBe(base);
      const { state: shot, ally: archer, enemy: target } = duel(5, true);
      const arrow = hitChance(shot, archer, target);
      order(target, 'linha-defensiva');
      expect(hitChance(shot, archer, target)).toBe(arrow);
    });

    it('Levantar escudos! only helps those who carry a shield, in melee and against arrows', () => {
      const { state, ally, enemy } = melee();
      const base = hitChance(state, enemy, ally);
      order(ally, 'levantar-escudos');
      ally.shield = false;
      expect(hitChance(state, enemy, ally)).toBe(base);
      ally.shield = true;
      expect(hitChance(state, enemy, ally)).toBe(base - ORDER_BONUS.escudos);
      const { state: shot, ally: archer, enemy: target } = duel(5, true);
      const arrow = hitChance(shot, archer, target);
      order(target, 'levantar-escudos'); target.shield = true;
      expect(hitChance(shot, archer, target)).toBe(arrow - ORDER_BONUS.escudos);
    });

    it('Atacar! boosts each troop\'s first attack only, and never a reaction strike', () => {
      const { state, ally, enemy } = melee();
      enemy.hp = enemy.maxHp = 500;
      const base = hitChance(state, ally, enemy);
      order(ally, 'atacar');
      expect(hitChance(state, ally, enemy)).toBe(base + ORDER_BONUS.atacar);
      expect(hitChance(state, ally, enemy, true)).toBe(base);
      expect(attack(state, enemy.id).ok).toBe(true);
      expect(ally.order?.strikeUsed).toBe(true);
      // The blow may shake morale, so compare against the same moment without the order.
      const spent = hitChance(state, ally, enemy);
      delete ally.order;
      expect(hitChance(state, ally, enemy)).toBe(spent);
    });

    it('Arqueiros, preparar disparo!: aiming takes the turn, pays off next round and walking spoils it', () => {
      const { state, ally: archer, enemy } = duel(5, true);
      enemy.pos = { q: 8, r: 4 };
      const base = hitChance(state, archer, enemy);
      expect(aim(state, enemy.id)).toMatchObject({ ok: false, message: 'Só arqueiros com a ordem de preparar disparo miram.' });
      order(archer, 'arqueiros-preparar');
      const result = aim(state, enemy.id);
      expect(result).toMatchObject({ ok: true, message: `${archer.name} mira em ${enemy.name}.` });
      expect(getActive(state)?.id).not.toBe(archer.id);
      expect(hitChance(state, archer, enemy)).toBe(base);
      state.round++;
      expect(hitChance(state, archer, enemy)).toBe(base + ORDER_BONUS.mira);
      setActive(state, archer); archer.ap = archer.maxAp;
      expect(move(state, { q: 3, r: 4 }).ok).toBe(true);
      expect(archer.order?.aimTargetId).toBeUndefined();
      expect(hitChance(state, archer, { ...enemy, pos: { q: 8, r: 4 } })).toBeLessThan(base + ORDER_BONUS.mira);
    });
  });

  it('the seven orders have distinct hotkey letters and costs between 2 and 4 PL', () => {
    expect(ORDERS).toHaveLength(7);
    expect(new Set(ORDERS.map(o => o.mark)).size).toBe(7);
    expect(ORDERS.every(o => o.pl >= 2 && o.pl <= 4)).toBe(true);
    expect(ORDERS.filter(o => o.targets.length === 1).map(o => o.id)).toEqual(['arqueiros-disparem', 'arqueiros-preparar']);
  });
});

describe('the troop AI follows orders', () => {
  const field = (id?: OrderId, target: 'todos' | 'guerreiros' | 'arqueiros' = 'todos') => {
    const state = createBattle(1, 'campo-aberto');
    const leader = state.units.find(u => u.id === 'duarte')!;
    setActive(state, leader);
    if (id) expect(issueOrder(state, id, target).ok).toBe(true);
    const warrior = state.units.find(u => u.id === 'aliado-1')!;
    return { state, leader, warrior, start: { ...warrior.pos } };
  };

  it('without an order, troops hold position', () => {
    const { state, warrior, start } = field();
    aiTurn(state, warrior);
    expect(warrior.pos).toEqual(start);
  });

  it.each([
    ['linha-defensiva', 0, 1],
    ['levantar-escudos', 0, 1],
    ['avanco-devagar', 1, 2],
    ['avanco-rapido', 3, 9],
    ['atacar', 3, 9],
  ] as const)('under %s a front warrior moves between %i and %i hexes on a quiet field', (id, min, max) => {
    const { state, warrior, start } = field(id);
    aiTurn(state, warrior);
    expect(distance(start, warrior.pos)).toBeGreaterThanOrEqual(min);
    expect(distance(start, warrior.pos)).toBeLessThanOrEqual(max);
  });

  it('archers told to shoot take a clear shot in range', () => {
    const { state } = field('arqueiros-disparem');
    const archer = state.units.find(u => u.id === 'aliado-arco-1')!;
    const enemy = state.units.find(u => u.id === 'inimigo-2')!;
    enemy.pos = { q: archer.pos.q, r: archer.pos.r - 4 };
    expect(previewAttack(state, archer, enemy).allowed).toBe(true);
    const events = aiTurn(state, archer);
    expect(events.some(e => e.type === 'attack' && e.unitId === archer.id)).toBe(true);
  });

  it.each([
    ['holds fire when a miss would likely hit friends fighting the target', -1000, 2, false],
    ['still shoots when the risk to a friend in contact is small', 1000, 1, true],
  ] as const)('an archer told to shoot %s', (_, skill, friends, shoots) => {
    const { state } = field('arqueiros-disparem');
    const archer = state.units.find(u => u.id === 'aliado-arco-1')!;
    const enemy = state.units.find(u => u.id === 'inimigo-2')!;
    enemy.pos = { q: archer.pos.q, r: archer.pos.r - 4 };
    archer.rangedSkill = skill;
    const free = neighbors(enemy.pos).filter(h => tileAt(state, h) && !tileAt(state, h)!.obstacle
      && !state.units.some(u => key(u.pos) === key(h)));
    state.units.filter(u => u.team === 'ally' && u.role === 'troop' && u.weapon.kind === 'melee').slice(0, friends)
      .forEach((u, i) => { u.pos = free[i]; });
    expect(previewAttack(state, archer, enemy).allowed).toBe(true);
    const events = aiTurn(state, archer);
    expect(events.some(e => e.type === 'attack' && e.unitId === archer.id && e.targetId === enemy.id)).toBe(shoots);
    expect(events.some(e => e.stray)).toBe(false);
  });

  it('the AI leader gives orders before the troops move', () => {
    const state = createBattle(1, 'campo-aberto');
    const leader = getActive(state)!;
    const result = performAiAction(state);
    expect(result.events[0]).toMatchObject({ type: 'order', unitId: leader.id });
  });

  it('the new AI beats the old one from both sides of the field', () => {
    const play = (seed: number, newSide: 'ally' | 'enemy') => {
      const state = createBattle(seed, 'campo-aberto');
      for (let actions = 0; state.outcome === 'ongoing' && actions < 8000; actions++) {
        (getActive(state)!.team === newSide ? performAiAction : performSimpleAiAction)(state);
      }
      return state.outcome === (newSide === 'ally' ? 'victory' : 'defeat');
    };
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // Today the new AI wins 17 of these 20; the bar leaves room for tuning without letting it slip back.
    expect(seeds.filter(seed => play(seed, 'ally')).length).toBeGreaterThanOrEqual(7);
    expect(seeds.filter(seed => play(seed, 'enemy')).length).toBeGreaterThanOrEqual(7);
  }, 120000);
});
