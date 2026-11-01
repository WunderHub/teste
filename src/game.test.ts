import { describe, expect, it } from 'vitest';
import {
  attack, BOARD_HEIGHT, BOARD_WIDTH, createBattle, distance, endTurn, getActive,
  key, move, neighbors, performAiAction, previewAttack, reachable, waitTurn,
  type BattleState, type Unit,
} from './game';

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

  it('blocks shots through obstacles and units, beyond range, or during melee engagement', () => {
    const { state, ally, enemy } = duel(1, true);
    enemy.pos = { q: 8, r: 4 };
    expect(previewAttack(state, ally, enemy).allowed).toBe(true);
    const obstruction = state.tiles.find(t => t.q === 6 && t.r === 4)!;
    obstruction.obstacle = 'ruin';
    expect(previewAttack(state, ally, enemy).reason).toMatch(/Linha de tiro/);
    delete obstruction.obstacle;
    const cover: Unit = { ...ally, id: 'cover', pos: { q: 6, r: 4 } };
    state.units.push(cover);
    expect(previewAttack(state, ally, enemy).allowed).toBe(false);
    state.units.pop();
    enemy.pos = { q: 12, r: 4 };
    expect(previewAttack(state, ally, enemy).reason).toMatch(/alcance/);
    enemy.pos = { q: 5, r: 4 };
    expect(previewAttack(state, ally, enemy).reason).toMatch(/Engajado/);
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
