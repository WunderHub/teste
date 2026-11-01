# Direção de arte — Vale do Sal

O próprio repositório é a fonte da arte e da interface. Figma não faz parte do fluxo atual. Os assets são originais; Battle Brothers permanece como referência de gênero e atmosfera, sem reutilização de sprites ou interface.

## Linguagem visual

- Fantasia medieval sombria em uma região de salinas: terra verde acinzentada, sal envelhecido, ferro gasto, couro e tecido desbotado.
- Personagens em busto, apenas cabeça e torso, sem mãos, braços ou pernas.
- Rostos com proporções mais contidas, luz superior esquerda, sombras quentes e contorno escuro fino.
- Malha, rebites, correias e placas diferenciam materiais. Evitar detalhes que dependam de texto minúsculo para identificar unidades.
- Aliados com tecido verde azulado; adversários com couro ferrugem e máscaras pálidas. Estandartes, bases e marcadores preservam a identificação além da cor.
- Líderes com crista, guarnições metálicas e insígnia no peito. A função continua indicada pelo estandarte do motor.
- Interface dentro do campo. Preservar aba de comando, fila e prévias táticas das versões atuais.

## Assets e renderização

Os sete bustos SVG em `public/assets/` usam 90×110; os três obstáculos usam 100×100. Eles têm transparência e gradientes locais, sem dependências externas. Manter os nomes permite reutilizar a arte tanto no Phaser como nos retratos HTML. Não mudar origem, hitbox ou escala da cena ao substituir uma ilustração sem testar a seleção no campo.

`src/terrain-art.ts` desenha terra, trilhas, vegetação, grãos e pedras em uma textura, gerada uma vez por encontro. A semente visual é separada da aleatoriedade do combate. O chão não precisa ser redesenhado a cada frame. As marcas de sal indicam terreno difícil, sem substituir os custos ou a grade do motor.

## Validação visual

Conferir 1440×900 e 1024×640, zoom mínimo e máximo, bustos em filas próximas, terreno difícil, líderes, seleção e aba de comando. A arte deve continuar legível com 20 tropas e um líder por lado. Mudanças gráficas não devem alterar combate, ordens, IA ou a simetria do encontro.

Próximas etapas possíveis: variantes de rosto e vestimenta por tropa, armas indicadas junto ao busto e animações de impacto mais expressivas. Elas ainda não fazem parte desta revisão.
