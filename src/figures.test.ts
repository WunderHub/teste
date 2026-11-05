import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBattle } from './encounters';
import { FIGURE_KEYS, figureKind, figureOf } from './figures';

describe('busts', () => {
  it('gives each unit of the field battle a bust that exists', () => {
    const s = createBattle(731, 'campo-aberto');
    for (const unit of s.units) {
      expect(FIGURE_KEYS).toContain(figureOf(unit));
      expect(existsSync(`public/assets/bustos/${figureOf(unit)}.png`), figureOf(unit)).toBe(true);
    }
  });
  it('shows a shield only on one-handed fighters and the bow on archers', () => {
    const s = createBattle(731, 'campo-aberto');
    for (const unit of s.units) {
      const kind = figureKind(unit);
      if (unit.weapon.kind === 'ranged') expect(kind).toBe('arqueiro');
      else expect(kind).toBe(unit.shield ? 'guerreiro-escudo' : 'guerreiro');
    }
    expect(new Set(s.units.map(figureKind))).toEqual(new Set(['arqueiro', 'guerreiro', 'guerreiro-escudo']));
  });
});
