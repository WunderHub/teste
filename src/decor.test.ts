import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBattle } from './encounters';
import { PIECE_SIZE, layoutScenery, obstaclePiece, pieceByKey } from './decor';
import { GROUND_KEYS, PIECES } from './terrain-pieces';

const board = { left: 0, top: 0, right: 2000, bottom: 1200 };
const area = { left: -500, top: -400, right: 2500, bottom: 1600 };

describe('painted terrain', () => {
  it('has a file for every ground texture and piece', () => {
    for (const key of GROUND_KEYS) expect(existsSync(`public/assets/terreno/${key}.jpg`), key).toBe(true);
    for (const piece of PIECES) expect(existsSync(`public/assets/terreno/${piece.key}.png`), piece.key).toBe(true);
  });
  it('puts the matching piece on every obstacle, the same one every time', () => {
    const state = createBattle(731, 'campo-aberto');
    const kinds = { deadtree: 'arvore-seca', rocks: 'rocha', ruin: 'ruina' } as const;
    for (const tile of state.tiles.filter(t => t.obstacle)) {
      const piece = obstaclePiece(tile);
      expect(piece?.kind).toBe(kinds[tile.obstacle!]);
      expect(obstaclePiece(tile)).toBe(piece);
    }
  });
  it('keeps trees and other tall scenery off the board, and the same seed gives the same scenery', () => {
    const scenery = layoutScenery(board, area, 731);
    expect(scenery).toEqual(layoutScenery(board, area, 731));
    expect(scenery.filter(p => pieceByKey(p.key)?.kind === 'arvore').length).toBeGreaterThan(20);
    for (const item of scenery) {
      const kind = pieceByKey(item.key)!.kind;
      if (kind === 'capim') continue;
      const inside = item.x > board.left && item.x < board.right && item.y > board.top && item.y < board.bottom;
      expect(inside, `${item.key} at ${Math.round(item.x)},${Math.round(item.y)}`).toBe(false);
      // A tree below the board stands far enough that its crown does not cover the last row.
      if (kind === 'arvore' && item.y > board.bottom) expect(item.y - item.height).toBeGreaterThan(board.bottom - PIECE_SIZE.arvore.height * 0.4);
    }
  });
});
