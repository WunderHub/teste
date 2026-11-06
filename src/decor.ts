import type { Tile } from './game';
import { PIECES, type Piece, type PieceKind } from './terrain-pieces';

/**
 * Where the painted terrain pieces go. Pure and seeded: the same battle always gets the same scenery.
 * Obstacle tiles get a piece that matches what the engine says is there; the forest and loose rocks stay
 * outside the board, so nothing that looks like cover sits on a tile the rules treat as open ground.
 */
export interface Placed { key: string; x: number; y: number; height: number; flip: boolean; alpha?: number }
export interface Rect { left: number; top: number; right: number; bottom: number }

/** On-field height of each kind of piece, in world pixels (a bust is 108). */
export const PIECE_HEIGHT: Record<PieceKind, number> = {
  arvore: 230, 'arvore-seca': 190, arbusto: 70, capim: 34, toco: 48, rocha: 74, tronco: 46, ruina: 92,
};
/** What stands on an obstacle tile, by the engine's obstacle type. */
const OBSTACLE_KINDS: Record<NonNullable<Tile['obstacle']>, PieceKind[]> = {
  deadtree: ['arvore-seca'], rocks: ['rocha'], ruin: ['ruina'],
};

export function makeRandom(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const ofKind = (kinds: PieceKind[]) => PIECES.filter(p => kinds.includes(p.kind));
const hashHex = (q: number, r: number) => ((Math.imul(q, 73856093) ^ Math.imul(r, 19349663)) >>> 0);

/** The piece drawn on an obstacle tile, picked by the tile's position so it never changes between turns. */
export function obstaclePiece(tile: Tile): Piece | undefined {
  if (!tile.obstacle) return undefined;
  const options = ofKind(OBSTACLE_KINDS[tile.obstacle]);
  return options[hashHex(tile.q, tile.r) % options.length];
}

/** Distance from a point to a rectangle (0 inside). */
const outside = (x: number, y: number, r: Rect) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));

/**
 * The forest around the clearing and the loose scenery near its edges.
 * `board` is the playable area; `area` is the whole painted ground.
 */
export function layoutScenery(board: Rect, area: Rect, seed: number): Placed[] {
  const random = makeRandom(seed), placed: Placed[] = [];
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
  const trees = ofKind(['arvore']), low = ofKind(['arbusto', 'rocha', 'tronco', 'toco']), grass = ofKind(['capim']);
  const fits = (x: number, y: number, gap: number) => placed.every(p => Math.hypot(p.x - x, (p.y - y) * 1.4) >= gap);
  // A tree's crown rises above its foot, so trees below the board stand further off to keep the last rows visible.
  const treeClear = (x: number, y: number) => {
    const d = outside(x, y, board);
    if (y > board.bottom) return y - board.bottom > PIECE_HEIGHT.arvore * 0.95 && d > 40;
    return d > 70;
  };
  for (let i = 0; i < 2600 && trees.length; i++) {
    const x = area.left + random() * (area.right - area.left), y = area.top + random() * (area.bottom - area.top);
    if (!treeClear(x, y)) continue;
    // Thicker forest further from the clearing.
    if (random() > 0.35 + outside(x, y, board) / 260) continue;
    if (!fits(x, y, 92)) continue;
    const piece = pick(trees);
    placed.push({ key: piece.key, x, y, height: PIECE_HEIGHT.arvore * (0.85 + random() * 0.3), flip: random() < 0.5 });
  }
  for (let i = 0; i < 900 && low.length; i++) {
    const x = area.left + random() * (area.right - area.left), y = area.top + random() * (area.bottom - area.top);
    const d = outside(x, y, board);
    if (d < 30 || d > 260 || !fits(x, y, 70)) continue;
    const piece = pick(low);
    placed.push({ key: piece.key, x, y, height: PIECE_HEIGHT[piece.kind] * (0.85 + random() * 0.3), flip: random() < 0.5 });
  }
  // Tufts of tall grass on the open field: flat decoration, drawn under the fighters.
  for (let i = 0; i < 260 && grass.length; i++) {
    const x = board.left + random() * (board.right - board.left), y = board.top + random() * (board.bottom - board.top);
    const piece = pick(grass);
    placed.push({ key: piece.key, x, y, height: PIECE_HEIGHT.capim * (0.7 + random() * 0.5), flip: random() < 0.5, alpha: 0.85 });
  }
  return placed;
}

export const pieceByKey = (key: string): Piece | undefined => PIECES.find(p => p.key === key);
