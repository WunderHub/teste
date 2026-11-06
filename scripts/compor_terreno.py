"""Prepara o kit de terreno pintado (arte/terreno-v1) para o jogo.

Entrada, em arte/terreno-v1:
  chao-grama.jpg, chao-terra.jpg, chao-pedras.jpg   texturas de chão geradas, vistas de cima
  prancha-*.png                                     pranchas de peças com fundo já transparente
Saída:
  public/assets/terreno/chao-*.jpg   texturas sem emenda, 1024 px
  public/assets/terreno/<peça>.png   cada peça recortada e reduzida
  src/terrain-pieces.ts              lista das peças, com proporção e ponto de apoio no chão

Uso: python3 scripts/compor_terreno.py   (precisa de Pillow e numpy)
"""
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'arte' / 'terreno-v1'
OUT = ROOT / 'public' / 'assets' / 'terreno'
TS = ROOT / 'src' / 'terrain-pieces.ts'

GROUND = ['chao-grama', 'chao-terra', 'chao-pedras']
GROUND_SIZE = 1024

# Peças de cada prancha, na ordem de leitura (linhas de cima para baixo, cada linha da esquerda para a direita).
# Cada entrada é (nome do arquivo, tipo usado pelo jogo). None descarta a peça.
SHEETS = {
    # A segunda árvore saiu cortada, sem tronco: fica de fora.
    'prancha-arvores': [('arvore-1', 'arvore'), None, ('arvore-2', 'arvore'), ('arvore-3', 'arvore'), ('arvore-seca', 'arvore-seca')],
    'prancha-arbustos': [('arbusto-1', 'arbusto'), ('arbusto-2', 'arbusto'), ('capim-1', 'capim'), ('capim-2', 'capim'), ('toco', 'toco')],
    'prancha-rochas': [('rocha-1', 'rocha'), ('rocha-2', 'rocha'), ('rocha-3', 'rocha'), ('tronco-1', 'tronco'), ('tronco-2', 'tronco')],
    'prancha-ruinas': [('ruina-1', 'ruina'), ('ruina-2', 'ruina'), ('ruina-3', 'ruina')],
}
# Altura máxima do PNG de cada tipo: cerca de duas vezes a altura no campo, para o zoom máximo.
MAX_HEIGHT = {'arvore': 480, 'arvore-seca': 400, 'arbusto': 170, 'capim': 90, 'toco': 120, 'rocha': 180, 'tronco': 120, 'ruina': 210}
KINDS = ['arvore', 'arvore-seca', 'arbusto', 'capim', 'toco', 'rocha', 'tronco', 'ruina']


def flatten(im: Image.Image, strength: float = 0.85) -> Image.Image:
    """Tira as manchas grandes de claro e escuro, que denunciariam a repetição da textura no campo.

    O jogo pinta suas próprias variações amplas por cima, com ruído.
    """
    a = np.asarray(im.convert('RGB'), dtype=np.float32)
    blur = np.asarray(im.convert('RGB').filter(ImageFilter.GaussianBlur(im.width / 10)), dtype=np.float32)
    mean = a.reshape(-1, 3).mean(axis=0)
    return Image.fromarray(np.uint8(np.clip(a - (blur - mean) * strength, 0, 255) + 0.5))


def seamless(im: Image.Image) -> Image.Image:
    """Mistura a imagem com ela mesma deslocada meia volta: as bordas passam a continuar do lado oposto."""
    a = np.asarray(im.convert('RGB'), dtype=np.float32)
    h, w, _ = a.shape
    shifted = np.roll(a, (h // 2, w // 2), axis=(0, 1))
    # Peso 1 nas bordas (onde a versão deslocada não tem emenda) e 0 no meio (onde a original não tem).
    ex = np.abs(np.linspace(-1, 1, w))[None, :]
    ey = np.abs(np.linspace(-1, 1, h))[:, None]
    edge = np.clip((np.maximum(ex, ey) - 0.45) / 0.45, 0, 1)
    m = (edge * edge * (3 - 2 * edge))[..., None]
    return Image.fromarray(np.uint8(a * (1 - m) + shifted * m + 0.5))


def components(alpha: np.ndarray, step: int = 4, grow: int = 9):
    """Peças separadas de uma prancha: grupos de pixels opacos, ligados após um pequeno inchaço.

    Devolve (caixa, máscara) de cada peça; a máscara, em escala reduzida, separa a peça das vizinhas
    quando as caixas se sobrepõem.
    """
    small = Image.fromarray(alpha).resize((alpha.shape[1] // step, alpha.shape[0] // step), Image.BILINEAR)
    mask = np.asarray(small.point(lambda v: 255 if v > 24 else 0).filter(ImageFilter.MaxFilter(grow))) > 0
    h, w = mask.shape
    seen = np.zeros_like(mask)
    labels = np.zeros(mask.shape, dtype=np.int32)
    boxes = []
    for y in range(h):
        for x in range(w):
            if not mask[y, x] or seen[y, x]:
                continue
            q = deque([(y, x)])
            seen[y, x] = True
            label = len(boxes) + 1
            pixels = []
            x0 = x1 = x
            y0 = y1 = y
            count = 0
            while q:
                cy, cx = q.popleft()
                count += 1
                pixels.append((cy, cx))
                x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
                for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            if count > h * w * 0.004:
                ys, xs = zip(*pixels)
                labels[ys, xs] = label
                boxes.append(((x0 * step, y0 * step, (x1 + 1) * step, (y1 + 1) * step), label))
    # Ordem de leitura: agrupa em linhas pelo centro vertical.
    boxes.sort(key=lambda b: (b[0][1] + b[0][3]) / 2)
    rows, row = [], []
    for b in boxes:
        if row and (b[0][1] + b[0][3]) / 2 - (row[-1][0][1] + row[-1][0][3]) / 2 > (row[-1][0][3] - row[-1][0][1]) * 0.6:
            rows.append(row)
            row = []
        row.append(b)
    if row:
        rows.append(row)
    full = Image.fromarray(np.uint8(labels)).resize((alpha.shape[1], alpha.shape[0]), Image.NEAREST)
    full = np.asarray(full)
    return [(box, full == label) for r in rows for box, label in sorted(r, key=lambda b: b[0][0])]


def anchor(alpha: np.ndarray, lying: bool = False):
    """Ponto de apoio no chão, como fração da imagem.

    Peças em pé (árvores, rochas, arbustos): a base, onde acaba o grosso dos pixels, no centro dessa base.
    Peças deitadas (troncos, muros): o meio da peça, entre o centro e a base, para o pedaço inteiro ocupar o hexágono.
    """
    ys, xs = np.nonzero(alpha > 128)
    h, w = alpha.shape
    foot = np.percentile(ys, 99.2)
    if lying:
        return float(np.mean(xs) / w), float(min(1.0, (np.mean(ys) + foot) / 2 / h))
    base = ys > foot - h * 0.1
    return float(np.mean(xs[base]) / w), float(min(1.0, (foot + 2) / h))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name in GROUND:
        im = Image.open(SRC / f'{name}.jpg')
        seamless(flatten(im)).resize((GROUND_SIZE, GROUND_SIZE), Image.LANCZOS).save(OUT / f'{name}.jpg', quality=86, optimize=True)
        print(f'{name}.jpg')
    pieces = []
    for sheet, names in SHEETS.items():
        im = Image.open(SRC / f'{sheet}.png').convert('RGBA')
        alpha = np.asarray(im.getchannel('A'))
        boxes = components(alpha)
        if len(boxes) != len(names):
            print(f'aviso: {sheet} tem {len(boxes)} peças, esperadas {len(names)}')
        for (box, own), entry in zip(boxes, names):
            if entry is None:
                continue
            key, kind = entry
            # Só os pixels desta peça: o que for de uma vizinha dentro da caixa fica transparente.
            piece = np.asarray(im).copy()
            piece[..., 3] = np.where(own, piece[..., 3], 0)
            piece = Image.fromarray(piece, 'RGBA')
            crop = piece.crop(box)
            crop = crop.crop(crop.getbbox())
            scale = min(1.0, MAX_HEIGHT[kind] / crop.height)
            crop = crop.resize((round(crop.width * scale), round(crop.height * scale)), Image.LANCZOS)
            ax, ay = anchor(np.asarray(crop.getchannel('A')), lying=kind in ('tronco', 'ruina'))
            crop.save(OUT / f'{key}.png', optimize=True)
            pieces.append((key, kind, crop.width / crop.height, ax, ay))
            print(f'{key}.png  {crop.width}x{crop.height}  apoio {ax:.2f},{ay:.2f}')
    kinds = ' | '.join(f"'{k}'" for k in KINDS)
    lines = [
        '// Gerado por scripts/compor_terreno.py a partir de arte/terreno-v1. Não editar à mão.',
        f'export type PieceKind = {kinds};',
        '/** A painted terrain piece: width over height, and where its foot touches the ground, as shares of the image. */',
        'export interface Piece { key: string; kind: PieceKind; aspect: number; anchorX: number; anchorY: number }',
        f"export const GROUND_KEYS = [{', '.join(repr(g) for g in GROUND)}] as const;",
        'export const PIECES: Piece[] = [',
        *[f"  {{ key: '{k}', kind: '{kind}', aspect: {a:.3f}, anchorX: {ax:.3f}, anchorY: {ay:.3f} }}," for k, kind, a, ax, ay in pieces],
        '];',
        '',
    ]
    TS.write_text('\n'.join(lines), encoding='utf-8')
    print(TS.relative_to(ROOT))


if __name__ == '__main__':
    main()
