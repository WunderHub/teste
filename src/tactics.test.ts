import { describe, expect, it } from 'vitest';
import { createBattle } from './encounters';
import { distance, getActive, issueOrder, divisionOf, neighbors, ORDERS, tileAt, type ActionResult, type BattleState, type Unit } from './game';
import { parseOrder, parseShout, shoutOrder, checkShout } from './commands';
import { evaluateCondition, updateTactic } from './tactics';
import { performAiAction } from './ai';

function field() {
  const s = createBattle(731, 'campo-aberto');
  const leader = getActive(s)!;
  const troops = s.units.filter(u => u.team === leader.team && u.role === 'troop');
  const warrior = troops.find(u => divisionOf(u) === 'guerreiros')!;
  const archer = troops.find(u => divisionOf(u) === 'arqueiros')!;
  const enemy = s.units.find(u => u.team !== leader.team && u.role === 'troop')!;
  const active = (u: Unit) => { s.queue = [u.id, ...s.queue.filter(id => id !== u.id)]; s.activatedRound[u.id] = s.round; };
  return { s, leader, troops, warrior, archer, enemy, active };
}
function read(text: string) {
  const p = parseShout(text);
  expect(p.ok, JSON.stringify(p)).toBe(true);
  if (!p.ok) throw Error(p.message);
  return p.directives[0];
}

/** A free, walkable hex next to the unit. */
function free(s: BattleState, unit: Unit) {
  const hex = neighbors(unit.pos).find(h => { const t = tileAt(s, h); return t && !t.obstacle && !s.units.some(u => u.pos.q === h.q && u.pos.r === h.r); });
  if (!hex) throw Error('no free hex');
  return hex;
}
/** Runs AI steps while the unit holds the turn and returns everything that happened. */
function runTurn(s: BattleState, unit: Unit, active: (u: Unit) => void) {
  active(unit);
  const events: ActionResult['events'] = [];
  for (let i = 0; i < 10 && getActive(s)?.id === unit.id; i++) events.push(...performAiAction(s).events);
  return events;
}

describe('tactical language', () => {
  it('preserves every published action example through the public plan reader', () => {
    for (const info of ORDERS) for (const example of info.examples)
      expect(read(example).yes.id, example).toBe(info.id);
    expect(read('Arqueiros e guerreiros, avancem').yes.vocative).toBe('todos');
    expect(read('Recuem se estiverem com menos de 30% de vida').condition).toMatchObject({ kind: 'hp', value: 30, op: '<' });
    expect(read('Se não houver inimigos no alcance, avancem').condition).toMatchObject({ kind: 'not', child: { kind: 'range' } });
  });
  it('recognizes verb stems and refuses ambiguous suffix conditions', () => {
    expect(parseOrder('Aproximando')).toMatchObject({ ok: true, id: 'avanco-devagar' });
    expect(parseOrder('Avancem se puderem')).toMatchObject({ ok: false, problem: 'condicao' });
    expect(parseShout('Avancem se puderem')).toMatchObject({ ok: false });
    expect(read('Ataquem se estiverem perto').condition).toEqual({ kind: 'near', value: 2 });
  });
  it.each(['Não se mexam!', 'Ninguém se mexe!', 'Cubram-se!', 'Recuem até mim!', 'Preparar, apontar, fogo!'])('preserves existing phrase %s', text => {
    expect(parseShout(text)).toMatchObject({ ok: true });
  });
  it('parses a recurring health rule, preserving enemy focus and threshold', () => {
    expect(read('Guerreiros, se a vida ficar abaixo de 30%, recuem; senão, ataquem o líder')).toMatchObject({
      once: false, condition: { kind: 'hp', value: 30, op: '<', leader: false },
      yes: { id: 'recuar', vocative: 'guerreiros' }, no: { id: 'atacar', focus: 'lider' },
    });
    expect(read('Se vida <= 30%, então recuem').condition).toMatchObject({ op: '<=' });
  });
  it('parses until/then as a single latched transition', () => {
    expect(read('Arqueiros, avancem até os inimigos entrarem no alcance, depois disparem')).toMatchObject({
      once: true, condition: { kind: 'range' }, no: { id: 'avanco-devagar' }, yes: { id: 'arqueiros-disparem' },
    });
  });
  it('combines AND before OR and negates conditions explicitly', () => {
    const { s, warrior, leader } = field();
    const d = read('Se vida abaixo de 30% ou moral baixa e não fadiga acima de 70%, recuem');
    warrior.hp = warrior.maxHp; warrior.morale = 2; warrior.fatigue = warrior.maxFatigue;
    expect(evaluateCondition(d.condition!, s, warrior, leader.id)).toBe(false);
    warrior.fatigue = 0;
    expect(evaluateCondition(d.condition!, s, warrior, leader.id)).toBe(true);
    warrior.hp = 1; warrior.fatigue = warrior.maxFatigue;
    expect(evaluateCondition(d.condition!, s, warrior, leader.id)).toBe(true);
  });
  it.each([
    'Se vida abaixo de 130%, recuem', 'Quando eu mandar, ataquem', 'Avancem depois recuem',
    'Avancem até a montanha', 'Se terreno elevado, ataquem', 'Se vida abaixo de 30%, recuem; senão',
    'Se vida abaixo de 30%, se moral baixa, recuem', 'Avancem por 3 turnos', 'Recuem para floresta', 'Ataquem líder e arqueiros', 'Avancem pela direita',
  ])('rejects unsupported meaning instead of discarding it: %s', text => {
    expect(parseShout(text)).toMatchObject({ ok: false });
  });
});

describe('plans in battle', () => {
  it('charges the highest branch once; independently selects a branch for each soldier', () => {
    const { s, leader, warrior, troops } = field();
    const other = troops.find(u => u !== warrior && divisionOf(u) === 'guerreiros')!;
    const result = shoutOrder(s, 'Se vida abaixo de 30%, recuem; senão, ataquem o líder', 'guerreiros');
    expect(result.ok, result.message).toBe(true); expect(leader.pl).toBe(2);
    expect(checkShout(s, leader, 'Se vida abaixo de 25%, recuem; senão, ataquem', 'guerreiros')).toMatchObject({ ok: false, message: expect.stringContaining('plano custa 4') });
    warrior.hp = 1;
    updateTactic(s, warrior); updateTactic(s, other);
    expect(warrior.order?.id).toBe('recuar'); expect(other.order).toMatchObject({ id: 'atacar', focus: 'lider' });
    warrior.hp = warrior.maxHp;
    updateTactic(s, warrior); expect(warrior.order?.id).toBe('recuar');
    s.round++; updateTactic(s, warrior);
    expect(warrior.order?.id).toBe('atacar'); expect(leader.pl).toBe(2); expect(warrior.stress).toBeUndefined();
  });
  it('waits in place, starting no fight, until a suffix condition becomes true', () => {
    const { s, leader, warrior, active } = field();
    expect(shoutOrder(s, 'Recuem se vida abaixo de 30%', 'guerreiros').ok).toBe(true);
    const pos = { ...warrior.pos }, hp = s.units.map(u => u.hp);
    active(warrior); const result = performAiAction(s);
    expect(result.ok).toBe(true); expect(getActive(s)?.id).not.toBe(warrior.id);
    expect(warrior.pos).toEqual(pos); expect(s.units.map(u => u.hp)).toEqual(hp);
    expect(warrior.tactic?.waiting).toBe(true); expect(warrior.order).toBeUndefined();
    s.round++; warrior.hp = 1; updateTactic(s, warrior);
    expect(warrior.order?.id).toBe('recuar'); expect(leader.pl).toBe(3);
  });
  it('holds position and fights back against an adjacent enemy while waiting', () => {
    const { s, warrior, enemy, active } = field();
    expect(shoutOrder(s, 'Recuem se vida abaixo de 30%', 'guerreiros').ok).toBe(true);
    enemy.pos = free(s, warrior);
    const pos = { ...warrior.pos }, events = runTurn(s, warrior, active);
    expect(warrior.pos).toEqual(pos);
    expect(events.some(e => e.type === 'attack' && e.unitId === warrior.id && e.targetId === enemy.id)).toBe(true);
    expect(warrior.tactic?.waiting).toBe(true); expect(warrior.order).toBeUndefined();
  });
  it('does not shoot at range while waiting for the condition', () => {
    const { s, archer, enemy, active } = field();
    s.tiles.forEach(t => delete t.obstacle);
    expect(shoutOrder(s, 'Disparem quando inimigos a até 2 hex', 'arqueiros').ok).toBe(true);
    enemy.pos = { q: archer.pos.q + 4, r: archer.pos.r };
    expect(s.units.some(u => u !== enemy && distance(u.pos, enemy.pos) === 0)).toBe(false);
    const pos = { ...archer.pos }, events = runTurn(s, archer, active);
    expect(archer.pos).toEqual(pos);
    expect(events.some(e => e.type === 'attack' && e.unitId === archer.id)).toBe(false);
  });
  it('counts as waiting right after the shout only without an alternative and with a false condition', () => {
    const { s, warrior } = field();
    expect(shoutOrder(s, 'Se vida abaixo de 30%, recuem; senão, ataquem', 'guerreiros').ok).toBe(true);
    expect(warrior.tactic?.waiting).toBe(false);
    const other = field();
    expect(shoutOrder(other.s, 'Recuem se vida abaixo de 30%', 'guerreiros').ok).toBe(true);
    expect(other.warrior.tactic?.waiting).toBe(true);
    const hurt = field();
    hurt.warrior.hp = 1;
    expect(shoutOrder(hurt.s, 'Recuem se vida abaixo de 30%', 'guerreiros').ok).toBe(true);
    expect(hurt.warrior.tactic?.waiting).toBe(false);
  });
  it('latches WHEN but re-evaluates IF on subsequent rounds', () => {
    for (const [word, latched] of [['Quando', true], ['Se', false]] as const) {
      const { s, warrior } = field();
      expect(shoutOrder(s, `${word} moral baixa, recuem`, 'guerreiros').ok).toBe(true);
      warrior.morale = 2; updateTactic(s, warrior); expect(warrior.order?.id).toBe('recuar');
      warrior.morale = 3; s.round++; updateTactic(s, warrior);
      expect(Boolean(warrior.order)).toBe(latched);
    }
  });
  it('moves then fires once targets enter range, without returning to advance', () => {
    const { s, archer, enemy } = field();
    s.tiles.forEach(t => delete t.obstacle);
    expect(shoutOrder(s, 'Avancem até inimigos no alcance, depois disparem', 'arqueiros').ok).toBe(true);
    updateTactic(s, archer); expect(archer.order?.id).toBe('avanco-devagar');
    enemy.pos = { q: archer.pos.q + 3, r: archer.pos.r };
    s.round++; updateTactic(s, archer); expect(archer.order?.id).toBe('arqueiros-disparem');
    enemy.pos = { q: 28, r: 18 }; s.round++; updateTactic(s, archer);
    expect(archer.order?.id).toBe('arqueiros-disparem');
  });
  it('validates all clauses before spending or replacing anything', () => {
    const { s } = field();
    for (const text of ['Guerreiros, ataquem; arqueiros, preparem disparo', 'Guerreiros, avancem; arqueiros, subam a colina',
      'Todos, avancem; arqueiros, fogo', 'Se vida abaixo de 30%, guerreiros recuem; senão, arqueiros disparem']) {
      const before = JSON.stringify(s);
      expect(shoutOrder(s, text, 'todos').ok, text).toBe(false);
      expect(JSON.stringify(s), text).toBe(before);
    }
  });
  it('accepts separate divisions atomically and previews the same cost/recipients', () => {
    const { s, leader, warrior, archer } = field();
    const text = 'Guerreiros, avancem; arqueiros, quando inimigos no alcance, disparem';
    const preview = checkShout(s, leader, text, 'todos');
    expect(preview).toMatchObject({ ok: true, check: { cost: 4 } });
    expect(shoutOrder(s, text, 'todos').ok).toBe(true); expect(leader.pl).toBe(2);
    expect(warrior.order?.id).toBe('avanco-devagar'); expect(archer.tactic?.condition).toEqual({ kind: 'range' });
  });
  it('does not redirect an archer-only action from warriors to archers', () => {
    const { s } = field(); const before = JSON.stringify(s);
    expect(shoutOrder(s, 'Disparem se inimigos no alcance', 'guerreiros').ok).toBe(false);
    expect(issueOrder(s, 'arqueiros-disparem', 'guerreiros').ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });
  it('respects command range, rejects duplicate plans and cancels a plan with a direct order', () => {
    const { s, leader, warrior, archer } = field();
    archer.pos = { q: 29, r: 19 };
    const text = 'Se moral baixa, recuem';
    expect(shoutOrder(s, text, 'todos').ok).toBe(true); expect(archer.tactic).toBeUndefined();
    const before = JSON.stringify(s); expect(shoutOrder(s, text, 'todos').ok).toBe(false); expect(JSON.stringify(s)).toBe(before);
    expect(issueOrder(s, 'manter-posicao', 'guerreiros').ok).toBe(true);
    expect(warrior.tactic).toBeUndefined(); expect(warrior.order?.id).toBe('manter-posicao'); expect(leader.pl).toBe(2);
  });
  it('preserves stress across repeated replacement of unsettled pending plans', () => {
    const { s, leader, warrior } = field();
    issueOrder(s, 'avanco-devagar', 'guerreiros');
    leader.pl = 6;
    expect(shoutOrder(s, 'Se moral baixa, recuem', 'guerreiros').ok).toBe(true);
    expect(warrior.stress?.level).toBe(1);
    leader.pl = 6;
    expect(shoutOrder(s, 'Se vida abaixo de 30%, recuem', 'guerreiros').ok).toBe(true);
    expect(warrior.stress?.level).toBe(2);
    expect(issueOrder(s, 'manter-posicao', 'guerreiros').ok).toBe(true);
    expect(warrior.stress?.level).toBe(3);
  });
  it('keeps an active branch settled and does not refill its first-strike bonus each AI step', () => {
    const { s, warrior } = field();
    shoutOrder(s, 'Se vida acima de 30%, ataquem', 'guerreiros');
    updateTactic(s, warrior); warrior.order!.strikeUsed = true;
    const settled = warrior.order!.settledRound;
    s.round++; updateTactic(s, warrior);
    expect(warrior.order).toMatchObject({ settledRound: settled, strikeUsed: true });
  });
  it('evaluates leader health and friendly-fire risk from battle state', () => {
    const { s, leader, archer, warrior, enemy } = field();
    const hp = read('Se vida do líder abaixo de 50%, protejam o líder').condition!;
    expect(evaluateCondition(hp, s, warrior, leader.id)).toBe(false);
    leader.hp = 1; expect(evaluateCondition(hp, s, warrior, leader.id)).toBe(true);
    const fire = read('Se houver risco de fogo amigo, cessem fogo').condition!;
    s.units = [leader, archer, warrior, enemy]; s.tiles.forEach(t => delete t.obstacle);
    archer.pos = { q: 5, r: 4 }; enemy.pos = { q: 8, r: 4 }; warrior.pos = { q: 8, r: 5 };
    expect(evaluateCondition(fire, s, archer, leader.id)).toBe(true);
    warrior.pos = { q: 1, r: 1 }; expect(evaluateCondition(fire, s, archer, leader.id)).toBe(false);
  });
  it('does not override fleeing with a pending plan', () => {
    const { s, warrior, active } = field();
    shoutOrder(s, 'Quando vida abaixo de 10%, ataquem', 'guerreiros');
    warrior.morale = 0; active(warrior);
    expect(updateTactic(s, warrior)).toBe(false);
    expect(performAiAction(s).ok).toBe(true);
  });
  it('checks range against blockers and engagement, not just geometric distance', () => {
    const { s, archer, enemy, leader } = field();
    s.units = [leader, archer, enemy]; s.tiles.forEach(t => delete t.obstacle);
    archer.pos = { q: 5, r: 4 }; enemy.pos = { q: 8, r: 4 }; archer.ap = 0;
    const c = read('Quando inimigos no alcance, disparem').condition!;
    expect(evaluateCondition(c, s, archer, leader.id)).toBe(true);
    s.tiles.find(t => t.q === 6 && t.r === 4)!.obstacle = 'rocks';
    expect(evaluateCondition(c, s, archer, leader.id)).toBe(false);
    s.tiles.forEach(t => delete t.obstacle); enemy.pos = { q: 6, r: 4 };
    expect(evaluateCondition(c, s, archer, leader.id)).toBe(false);
  });
});
