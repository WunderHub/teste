// Gerado por scripts/compor_terreno.py a partir de arte/terreno-v1. Não editar à mão.
export type PieceKind = 'arvore' | 'arvore-seca' | 'arbusto' | 'capim' | 'toco' | 'rocha' | 'tronco' | 'ruina';
/** A painted terrain piece: width over height, and where its foot touches the ground, as shares of the image. */
export interface Piece { key: string; kind: PieceKind; aspect: number; anchorX: number; anchorY: number }
export const GROUND_KEYS = ['chao-grama', 'chao-terra', 'chao-pedras'] as const;
export const PIECES: Piece[] = [
  { key: 'arvore-1', kind: 'arvore', aspect: 1.106, anchorX: 0.502, anchorY: 0.944 },
  { key: 'arvore-2', kind: 'arvore', aspect: 1.044, anchorX: 0.517, anchorY: 0.944 },
  { key: 'arvore-3', kind: 'arvore', aspect: 1.025, anchorX: 0.499, anchorY: 0.944 },
  { key: 'arvore-seca', kind: 'arvore-seca', aspect: 0.955, anchorX: 0.457, anchorY: 0.965 },
  { key: 'arbusto-1', kind: 'arbusto', aspect: 1.241, anchorX: 0.529, anchorY: 0.947 },
  { key: 'arbusto-2', kind: 'arbusto', aspect: 1.235, anchorX: 0.536, anchorY: 0.941 },
  { key: 'capim-1', kind: 'capim', aspect: 1.000, anchorX: 0.491, anchorY: 0.956 },
  { key: 'capim-2', kind: 'capim', aspect: 1.167, anchorX: 0.500, anchorY: 0.956 },
  { key: 'toco', kind: 'toco', aspect: 1.267, anchorX: 0.477, anchorY: 0.958 },
  { key: 'rocha-1', kind: 'rocha', aspect: 1.283, anchorX: 0.427, anchorY: 0.961 },
  { key: 'rocha-2', kind: 'rocha', aspect: 1.272, anchorX: 0.446, anchorY: 0.961 },
  { key: 'rocha-3', kind: 'rocha', aspect: 1.383, anchorX: 0.527, anchorY: 0.978 },
  { key: 'tronco-1', kind: 'tronco', aspect: 1.817, anchorX: 0.471, anchorY: 0.745 },
  { key: 'tronco-2', kind: 'tronco', aspect: 1.375, anchorX: 0.516, anchorY: 0.736 },
  { key: 'ruina-1', kind: 'ruina', aspect: 1.324, anchorX: 0.478, anchorY: 0.730 },
  { key: 'ruina-2', kind: 'ruina', aspect: 1.881, anchorX: 0.493, anchorY: 0.764 },
  { key: 'ruina-3', kind: 'ruina', aspect: 1.690, anchorX: 0.493, anchorY: 0.736 },
];
