import {
  makeLeader, makeTiles, makeUnit, startBattle,
  type BattleSetup, type BattleState, type EncounterId, type Hex, type Tile, type Unit, type Weapon,
} from './game';

/** Board size of the original 3 against 4 ambush, kept as the fixture for rule tests. */
export const BOARD_WIDTH = 15;
export const BOARD_HEIGHT = 9;
/** Board size of the 20 against 20 field battle. */
export const FIELD_WIDTH = 30;
export const FIELD_HEIGHT = 20;

export const ENCOUNTER_NAMES: Record<EncounterId, string> = {
  emboscada: 'Emboscada na vereda',
  'campo-aberto': 'Campo das Salinas',
};

const mace: Weapon = { name: 'Maça de vigília', kind: 'melee', minDamage: 30, maxDamage: 45,
  armorDamage: 1.1, penetration: 0.4, ap: 4, fatigue: 13, range: 1, accuracy: 0 };
const spear: Weapon = { name: 'Lança de ferro', kind: 'melee', minDamage: 25, maxDamage: 35,
  armorDamage: 0.8, penetration: 0.25, ap: 4, fatigue: 10, range: 1, accuracy: 20 };
const bow: Weapon = { name: 'Arco de freixo', kind: 'ranged', minDamage: 35, maxDamage: 50,
  armorDamage: 0.65, penetration: 0.35, ap: 4, fatigue: 15, range: 6, accuracy: 0 };
const cleaver: Weapon = { name: 'Lâmina lascada', kind: 'melee', minDamage: 28, maxDamage: 40,
  armorDamage: 0.85, penetration: 0.25, ap: 4, fatigue: 12, range: 1, accuracy: 0 };
/** The field battle's raiders carry a heavier blade than the ambush ones, so both armies hit about as hard. */
const raidBlade: Weapon = { name: 'Cutelo de saque', kind: 'melee', minDamage: 32, maxDamage: 46,
  armorDamage: 0.95, penetration: 0.35, ap: 4, fatigue: 12, range: 1, accuracy: 0 };
const longsword: Weapon = { name: 'Espada da fundação', kind: 'melee', minDamage: 35, maxDamage: 50,
  armorDamage: 0.9, penetration: 0.3, ap: 4, fatigue: 12, range: 1, accuracy: 5 };
const warAxe: Weapon = { name: 'Machado de guerra', kind: 'melee', minDamage: 32, maxDamage: 52,
  armorDamage: 1.2, penetration: 0.3, ap: 4, fatigue: 14, range: 1, accuracy: 0 };

export function createBattle(seed = 17431, encounter: EncounterId = 'emboscada'): BattleState {
  return startBattle(seed, encounter === 'campo-aberto' ? openField() : ambush());
}

function placeObstacles(tiles: Tile[], width: number, obstacles: [number, number, Tile['obstacle']][]): void {
  for (const [q, r, obstacle] of obstacles) tiles[r * width + q].obstacle = obstacle;
}

function ambush(): BattleSetup {
  const tiles = makeTiles(BOARD_WIDTH, BOARD_HEIGHT, (q, r) =>
    ((q === 6 || q === 7) && r >= 3 && r <= 5) || (r === 7 && q > 9) ? 'rough' : 'grass');
  placeObstacles(tiles, BOARD_WIDTH, [
    [1, 1, 'deadtree'], [5, 1, 'rocks'], [7, 2, 'ruin'], [6, 6, 'ruin'],
    [9, 6, 'rocks'], [12, 1, 'deadtree'], [12, 7, 'deadtree'], [2, 7, 'rocks'],
  ]);
  const units = [
    makeUnit('iria', 'Íria', 'ally', 'iria', { q: 3, r: 3 }, mace,
      { hp: 68, headArmor: 80, bodyArmor: 110, meleeSkill: 69, meleeDefense: 18, rangedDefense: 15, resolve: 65, initiative: 98 }),
    makeUnit('tome', 'Tomé', 'ally', 'tome', { q: 3, r: 5 }, spear,
      { hp: 62, headArmor: 55, bodyArmor: 80, meleeSkill: 64, meleeDefense: 10, resolve: 57, initiative: 108 }),
    makeUnit('nara', 'Nara', 'ally', 'nara', { q: 2, r: 4 }, bow,
      { hp: 52, headArmor: 30, bodyArmor: 45, meleeSkill: 38, rangedSkill: 78, resolve: 55, initiative: 118 }),
    makeUnit('raider-1', 'Saqueador', 'enemy', 'raider', { q: 8, r: 3 }, cleaver,
      { hp: 54, headArmor: 35, bodyArmor: 55, meleeSkill: 57, resolve: 42, initiative: 82 }),
    makeUnit('husk-1', 'Penitente', 'enemy', 'husk', { q: 9, r: 5 }, cleaver,
      { hp: 65, headArmor: 20, bodyArmor: 35, meleeSkill: 53, resolve: 46, initiative: 72 }),
    makeUnit('husk-2', 'Flagelante', 'enemy', 'husk', { q: 9, r: 2 }, spear,
      { hp: 55, headArmor: 25, bodyArmor: 40, meleeSkill: 50, resolve: 40, initiative: 78 }),
    makeUnit('raider-bow', 'Arqueiro proscrito', 'enemy', 'raider', { q: 11, r: 4 }, bow,
      { hp: 45, headArmor: 15, bodyArmor: 30, rangedSkill: 63, resolve: 38, initiative: 92 }),
  ];
  return { encounter: 'emboscada', width: BOARD_WIDTH, height: BOARD_HEIGHT, tiles, units };
}

const ALLY_NAMES = ['Bento', 'Clara', 'Davi', 'Elisa', 'Fausto', 'Gaspar', 'Hilda', 'Inês', 'Joana', 'Lino',
  'Marta', 'Nestor', 'Otília', 'Pedro', 'Quitéria', 'Rufino', 'Sancha', 'Tadeu', 'Úrsula', 'Vicente'];

/**
 * 1 leader and 20 troops per side (14 warriors and 6 archers), the ideal ratio from docs/design-combate.md.
 * The armies are fixed: a private generator varies stats, so every restart fields the same people.
 * The faction sends Duarte, a regular leader: the Líder Supremo stays out of battle unless nothing else is left.
 */
/** Mirror image across the board's vertical center line. Odd rows sit half a hex to the right, so they shift one less. */
const mirror = ({ q, r }: Hex): Hex => ({ q: FIELD_WIDTH - 1 - q - (r & 1), r });

function openField(): BattleSetup {
  // Each side's half mirrors the other, so neither army starts with better cover or a shorter march.
  const roughLeft = ({ q, r }: Hex) => (q >= 13 && q <= 14 && r >= 8 && r <= 11) || (r >= 18 && q >= 10 && q <= 14);
  const tiles = makeTiles(FIELD_WIDTH, FIELD_HEIGHT, (q, r) => roughLeft({ q, r }) || roughLeft(mirror({ q, r })) ? 'rough' : 'grass');
  const half: [number, number, Tile['obstacle']][] = [
    [3, 2, 'deadtree'], [2, 17, 'rocks'], [11, 9, 'rocks'], [12, 16, 'ruin'], [13, 3, 'rocks'], [14, 13, 'deadtree'],
  ];
  placeObstacles(tiles, FIELD_WIDTH, [...half, ...half.map(([q, r, o]): [number, number, Tile['obstacle']] => [mirror({ q, r }).q, r, o])]);
  let seed = 2026;
  const vary = (base: number, spread: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return base + Math.round((seed / 4294967296 * 2 - 1) * spread);
  };
  const troop = (archer: boolean): Partial<Unit> => ({
    hp: vary(60, 6), maxFatigue: vary(90, 6), resolve: vary(50, 7), initiative: vary(95, 10),
    meleeSkill: archer ? vary(42, 5) : vary(58, 5), rangedSkill: archer ? vary(60, 5) : vary(35, 5),
    meleeDefense: vary(6, 3), rangedDefense: vary(5, 3),
    headArmor: archer ? vary(25, 5) : vary(45, 8), bodyArmor: archer ? vary(40, 5) : vary(70, 10),
  });
  // A compact block that fits the Líder de Combate's 5-hex command range: shields in front, spears behind,
  // archers at the back and the leader in the middle of them.
  const warriorAt = (i: number): Hex => ({ q: i % 2 ? 8 : 9, r: 6 + (i >> 1) });
  const archerRows = [6, 7, 8, 10, 11, 12];
  const leaderAt: Hex = { q: 7, r: 9 };
  const units: Unit[] = [
    makeLeader('duarte', 'Duarte', 'ally', 'captain', leaderAt, longsword, 'combate',
      { hp: 60, maxFatigue: 90, resolve: 55, initiative: 95, meleeSkill: 60, rangedSkill: 35, meleeDefense: 10, rangedDefense: 8,
        headArmor: 90, bodyArmor: 120, platoonId: 'pelotao-duarte' }),
    makeLeader('senhor-da-guerra', 'Senhor da Guerra', 'enemy', 'warlord', mirror(leaderAt), warAxe, 'combate',
      { hp: 60, maxFatigue: 90, resolve: 52, initiative: 92, meleeSkill: 60, rangedSkill: 35, meleeDefense: 9, rangedDefense: 7,
        headArmor: 85, bodyArmor: 115, platoonId: 'bando-senhor' }),
  ];
  // Mace and blade are one-handed, so those fighters carry a shield; spears and bows take both hands.
  const deploy = (team: 'ally' | 'enemy', id: string, name: string, asset: Unit['asset'], pos: Hex, weapon: Weapon, archer: boolean) =>
    units.push(makeUnit(id, name, team, asset, pos, weapon,
      { ...troop(archer), shield: weapon === mace || weapon === raidBlade, platoonId: team === 'ally' ? 'pelotao-duarte' : 'bando-senhor' }));
  for (let i = 0; i < 14; i++) {
    deploy('ally', `aliado-${i + 1}`, ALLY_NAMES[i], i % 2 ? 'tome' : 'iria', warriorAt(i), i % 2 ? spear : mace, false);
    deploy('enemy', `inimigo-${i + 1}`, `${i % 2 ? 'Penitente' : 'Saqueador'} ${i + 1}`, i % 2 ? 'husk' : 'raider',
      mirror(warriorAt(i)), i % 2 ? spear : raidBlade, false);
  }
  archerRows.forEach((r, i) => {
    deploy('ally', `aliado-arco-${i + 1}`, ALLY_NAMES[14 + i], 'nara', { q: 6, r }, bow, true);
    deploy('enemy', `inimigo-arco-${i + 1}`, `Arqueiro proscrito ${i + 1}`, 'raider', mirror({ q: 6, r }), bow, true);
  });
  return {
    encounter: 'campo-aberto', width: FIELD_WIDTH, height: FIELD_HEIGHT, tiles, units,
    platoons: [
      { id: 'pelotao-duarte', team: 'ally', name: 'O pelotão de Duarte', leaderId: 'duarte' },
      { id: 'bando-senhor', team: 'enemy', name: 'O bando do Senhor da Guerra', leaderId: 'senhor-da-guerra' },
    ],
  };
}
