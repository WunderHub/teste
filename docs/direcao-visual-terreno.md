# Direção aprovada: personagens e terreno

Este documento registra as decisões do usuário posteriores ao protótipo. É uma especificação para a próxima etapa, não uma declaração de funcionalidades implementadas. O motor atual continua descrito em [design-combate.md](design-combate.md). Onde houver diferença visual, a direção abaixo substitui a antiga proposta de bustos no campo.

## Personagens

- Usar personagens de corpo inteiro no campo, sem base, pedestal ou plataforma artificial. Os pés ficam sobre o terreno.
- Centralizar o ponto de apoio entre os pés no centro do hexágono ocupado, considerando a altura desse hexágono.
- Movimento como peça de tabuleiro, sem animações corporais por enquanto.
- Apenas aparências masculinas no combate nesta etapa.
- Corpo-base: adulto, calvo, sem barba, pele clara e lisa. Cobrir a região íntima com roupa simples e opaca; a referência usa calção de linho. Isso não introduz um sistema de equipamentos.
- Fixar tamanho, proporções, pose e encaixes; variar aparência, não dimensões corporais. Escala final e perspectiva no jogo ainda precisam ser validadas.
- Direção original, pintada e detalhada, conforme as referências; não copiar sprites de Battle Brothers.

### Variação modular futura

Combinar identidades de rosto, tonalidades de pele, cabelos, barbas e tatuagens, mantendo os mesmos encaixes. Variações de torso poderão respeitar o mesmo volume e proporções. Não produzir agora roupas, armaduras ou armas como parte deste kit corporal.

Quando equipamentos forem tratados, eles poderão ocultar cabelo e/ou barba conforme cobrirem o alto da cabeça, maxilar ou rosto inteiro. As máscaras e regras exatas ficam para essa etapa posterior.

### Expressões

Cada identidade de rosto deverá possuir dois conjuntos de expressões: um associado à saúde e outro à moral. A expressão exibida será a da condição mais impactante. Não misturar duas expressões incompatíveis no mesmo rosto.

Ainda precisam ser aprovados: quantidade e lista final de expressões, limites de saúde, graus comparáveis de impacto entre saúde e moral, desempates e estabilidade das transições. Dor leve/intensa/crítica e os estados atuais de moral são propostas de trabalho, não parâmetros já aprovados. O retrato ampliado pode ajudar na leitura; validar sua apresentação junto da escala das peças.

## Visibilidade durante a escolha do movimento

Priorizar a leitura do terreno, caminho e destino. Reduzir a opacidade somente de elementos que efetivamente encubram essa informação na tela: por exemplo, uma copa ou uma figura em primeiro plano. Proximidade do caminho, facção ou simples entrada no modo de movimento não justificam transparência.

Manter perceptível a ocupação dos hexágonos. Restaurar a opacidade ao deixar de haver obstrução ou ao concluir/cancelar a escolha. O alcance exato da transparência (objeto inteiro ou região oclusora) e sua intensidade ainda precisam de validação visual. Não aplicar esmaecimento global.

## Terreno condicionado pelo mapa global

O encontro usa as características do local e do entorno no mapa global. Relevo e vegetação são fatores independentes e combináveis: floresta próxima de montanhas deve gerar vegetação e relevo elevado juntos.

A aleatoriedade varia a composição dentro dessas características; não escolhe um ambiente sem relação com o local. Uma semente reproduz o mesmo mapa com os mesmos parâmetros e versão do gerador. A ponderação de proximidade no mapa global ainda será definida quando esse sistema existir.

Escopo inicial: solo, obstáculos naturais, ruínas e elevações. Sem construções completas. Rochas, árvores, troncos, arbustos e fragmentos de ruínas compõem o conjunto; distinguir decoração de elementos com efeito em movimento/visão.

### Altura: regras aprovadas

- Cada hexágono tem altura inteira entre **−10 e +10**, inclusive.
- **0 é o nível de referência**. Altura negativa não significa automaticamente água, buraco ou terreno intransponível.
- Esse intervalo é o limite disponível, **não uma distribuição aleatória independente por hexágono**, nem uma exigência de usar os extremos em cada mapa.
- Formar superfícies contínuas: planícies, vales, colinas, platôs e escarpas. Áreas próximas normalmente compartilham alturas iguais ou próximas.
- Tipo e intensidade do relevo vêm do local do encontro. Planícies variam pouco; regiões montanhosas admitem variação maior.
- **Sem rampas como peças visuais.** Usar patamares e bordas de terra/rocha. Desenhar faces de desnível nas fronteiras de alturas, não paredes entre células de mesma altura.

### Movimento humano padrão

A travessia entre dois hexágonos vizinhos só é possível, quanto à altura, quando:

`abs(alturaDestino - alturaOrigem) <= 1`

A regra vale tanto para subida quanto para descida. Ocupação, obstáculos, pontos de ação e outras restrições continuam sendo verificações separadas.

| Travessia | Regra de altura |
|---|---|
| 0 → 0 | Permitida |
| 0 → 1 ou 1 → 0 | Permitida |
| −3 → −2 ou −2 → −3 | Permitida |
| 0 → 2 ou 2 → 0 | Bloqueada diretamente |
| −1 → 1 | Bloqueada diretamente |
| 0 → 1 → 2 | Possível por dois passos entre vizinhos |

Diferenças maiores que 1 podem existir no mapa: representam bordas intransponíveis diretamente para humanos. Procurar rota alternativa. Não achatar todas as escarpas para satisfazer a regra de movimento.

Ainda não estão definidos custos adicionais de subida/descida, vantagem de combate por altura, queda, alcance ou visibilidade entre níveis. Não inventar esses efeitos ao implementar o relevo.

### Sequência recomendada do gerador

1. Receber semente e características ambientais do encontro.
2. Construir um campo contínuo de relevo e convertê-lo em alturas inteiras dentro dos limites.
3. Distribuir solos e transições de forma coerente com relevo e vegetação.
4. Posicionar agrupamentos naturais de obstáculos e, quando pertinente, ruínas.
5. Escolher e validar áreas de implantação e conexões usando a regra humana de altura e os obstáculos.
6. Corrigir ou regenerar situações inválidas de forma determinística e limitada.

Não exigir mapas espelhados como regra futura. Critérios exatos de equilíbrio e conectividade devem ser definidos para cada tipo de encontro. Enquanto o mapa global não existir, um perfil de ambiente selecionado manualmente pode servir como entrada de teste, sem simular uma integração inexistente.

## Referências visuais e suas limitações

As imagens são estudos conceituais, **não sprites prontos, tiles com encaixes garantidos ou capturas do jogo**. Não colocá-las diretamente como mapas funcionais. Transparência, perspectiva, escala, recorte e encaixes precisam ser produzidos e verificados na etapa de assets.

- [Rosto-base](referencias/rosto-base.png): identidade e acabamento aprovados como ponto de partida.
- [Corpo-base](referencias/corpo-base.png): proposta corporal com cobertura de linho. O fundo/brilho da imagem não pertence ao asset final.
- [Comparação no campo](referencias/comparacao-no-campo.png): o usuário escolheu **sem base** e gostou do estilo do terreno. Há bases residuais, posicionamentos imprecisos, variações de cabelo/pele e exemplos de oclusão que não constituem aprovação desses detalhes. Aplicar as regras textuais acima.
- [Kit de floresta em encosta](referencias/kit-floresta-encosta.png): estilo aprovado para solos, árvores, rochas e troncos. **As rampas da prancha foram explicitamente rejeitadas**. Não reproduzi-las. Ruínas ainda precisam de um kit original próprio.

Figma saiu do fluxo. Não usar Magnific nesta etapa sem nova instrução. O repositório concentra a especificação e as referências para colaboração entre assistentes.

## Próxima etapa e validação

Produzir e aprovar assets separados antes de substituir a arte do jogo. Validar uma cena pequena com hexágonos adjacentes, peças sem base, oclusão condicional e patamares. Depois implementar a geração e a navegação.

Verificar: alturas inteiras e limites, repetibilidade por semente, áreas contínuas, pouca variação em planícies, mistura floresta/montanha, regras de subida e descida (inclusive alturas negativas), rotas alternativas, posições iniciais livres e acessíveis, pés centralizados e sem flutuação, visibilidade em zoom e com 20 tropas mais um líder por lado.

Esta entrega documental não implementa o gerador, expressões, novos personagens ou elevações no motor, e não publica uma nova versão do jogo ou do ambiente.
