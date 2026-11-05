"""Monta os bustos do jogo a partir das camadas pintadas em arte/bustos-v1.

Cada variante (guerreiro com escudo, guerreiro sem escudo, arqueiro) é montada uma vez por lado,
com a cor do lado aplicada só no tecido da armadura e na face do escudo. A luz pintada é mantida:
a cor é multiplicada pelo brilho de cada pixel em relação ao brilho médio da área tingida.

Uso: python3 scripts/compor_bustos.py   (precisa do Pillow)
Saída: public/assets/bustos/<variante>-<lado>.png
"""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'arte' / 'bustos-v1'
OUT = ROOT / 'public' / 'assets' / 'bustos'
# Cores de teste da revisão de 02/11. A paleta definitiva das facções ainda está em aberto.
CORES = {'ally': '#2e5274', 'enemy': '#842e24'}
# Altura final do PNG: cerca de 2,3 vezes a altura da peça no campo, para o zoom máximo.
ALTURA = 240


def layer(name: str) -> Image.Image:
    return Image.open(SRC / f'{name}.png').convert('RGBA')


def dye(src: Image.Image, mask: Image.Image, hex_color: str) -> Image.Image:
    """Recolore a área da máscara mantendo a luz pintada (mesma regra da página de revisão)."""
    rgb = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    px, m = src.load(), mask.convert('L').load()
    w, h = src.size
    total = lum = 0.0
    for y in range(h):
        for x in range(w):
            weight = m[x, y] / 255
            if weight > 0:
                r, g, b, _ = px[x, y]
                total += weight
                lum += weight * (0.3 * r + 0.59 * g + 0.11 * b) / 255
    ref = lum / max(total, 1e-6)
    out = src.copy()
    o = out.load()
    for y in range(h):
        for x in range(w):
            weight = m[x, y] / 255 * 0.9
            if not weight:
                continue
            r, g, b, a = px[x, y]
            k = (0.3 * r + 0.59 * g + 0.11 * b) / 255 / ref
            o[x, y] = tuple(round(c * (1 - weight) + min(1, t * k) * 255 * weight) for c, t in zip((r, g, b), rgb)) + (a,)
    return out


def place(canvas: Image.Image, im: Image.Image, scale: float, angle: float, cx: float, cy: float) -> None:
    """Escala, gira (graus, sentido anti-horário) e centraliza a peça em (cx, cy)."""
    piece = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    piece = piece.rotate(angle, resample=Image.BICUBIC, expand=True)
    canvas.alpha_composite(piece, (round(cx - piece.width / 2), round(cy - piece.height / 2)))


def main() -> None:
    fit = json.loads((SRC / 'encaixe.json').read_text())
    size, (bx, by) = tuple(fit['canvas']), fit['busto_em']
    layout = fit['layout']
    base, armour = layer('busto-base'), layer('armadura-leve')
    variants = {
        'guerreiro-escudo': layout['guerreiro'],
        'guerreiro': {'behind': layout['guerreiro']['behind'], 'front': [p for p in layout['guerreiro']['front'] if p[0] != 'escudo']},
        'arqueiro': layout['arqueiro'],
    }
    pieces = {n: layer(n) for n in ('espada', 'escudo', 'arco', 'aljava')}
    figures: dict[str, Image.Image] = {}
    for side, color in CORES.items():
        dyed = {'armour': dye(armour, Image.open(SRC / 'mascara-tecido.png'), color),
                'escudo': dye(pieces['escudo'], Image.open(SRC / 'mascara-escudo.png'), color)}
        for name, parts in variants.items():
            canvas = Image.new('RGBA', size)
            for n, s, a, x, y in parts['behind']:
                place(canvas, pieces[n], s, a, x, y)
            canvas.alpha_composite(base, (bx, by))
            canvas.alpha_composite(dyed['armour'], (bx, by))
            for n, s, a, x, y in parts['front']:
                place(canvas, dyed.get(n, pieces[n]), s, a, x, y)
            figures[f'{name}-{side}'] = canvas
    # The same crop for every figure keeps the waist on the same line, so they all stand on the hex alike.
    boxes = [im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox() for im in figures.values()]
    left, top = min(b[0] for b in boxes), min(b[1] for b in boxes)
    right, bottom = max(b[2] for b in boxes), max(b[3] for b in boxes)
    scale = ALTURA / (bottom - top)
    OUT.mkdir(parents=True, exist_ok=True)
    for key, im in figures.items():
        crop = im.crop((left, top, right, bottom))
        crop.resize((round(crop.width * scale), ALTURA), Image.LANCZOS).save(OUT / f'{key}.png', optimize=True)
    # Where the body's middle and waist fall, as a share of the image: the game's anchor for the figure.
    center = (bx + base.width / 2 - left) / (right - left)
    waist = (by + base.height - top) / (bottom - top)
    print(f'{len(figures)} bustos em {OUT.relative_to(ROOT)}; tamanho {round((right - left) * scale)}x{ALTURA};'
          f' âncora (meio do corpo, cintura) = ({center:.3f}, {waist:.3f})')


if __name__ == '__main__':
    main()
