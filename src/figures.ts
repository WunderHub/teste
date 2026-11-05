import type { Unit } from './game';

/**
 * The painted busts that stand for each unit on the field and in the HUD portraits.
 * Built from the layers in arte/bustos-v1 by scripts/compor_bustos.py, one per kind and side.
 * Leaders and spearmen have no art of their own yet, so they wear the warrior bust with the sword and no shield.
 */
export type FigureKind = 'guerreiro-escudo' | 'guerreiro' | 'arqueiro';
export const FIGURE_KINDS: FigureKind[] = ['guerreiro-escudo', 'guerreiro', 'arqueiro'];
export const FIGURE_KEYS = FIGURE_KINDS.flatMap(kind => (['ally', 'enemy'] as const).map(team => `${kind}-${team}`));
/** Where the middle of the body and the waist fall in the image, as shares of its width and height. */
export const FIGURE_ANCHOR = { x: 0.441, y: 0.871 };
/** Width over height of the bust images. */
export const FIGURE_ASPECT = 194 / 240;

export function figureKind(unit: Pick<Unit, 'weapon' | 'shield'>): FigureKind {
  if (unit.weapon.kind === 'ranged') return 'arqueiro';
  return unit.shield ? 'guerreiro-escudo' : 'guerreiro';
}
/** Texture key of the unit's bust. */
export const figureOf = (unit: Pick<Unit, 'weapon' | 'shield' | 'team'>): string => `${figureKind(unit)}-${unit.team}`;
export const figureUrl = (key: string): string => `${import.meta.env.BASE_URL}assets/bustos/${key}.png`;
