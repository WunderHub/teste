# Vale do Sal

Protótipo original de combate tático em hexágonos, feito com **Phaser 3 + TypeScript + Vite**. No Campo das Salinas, Duarte e seu pelotão de 20 tropas enfrentam o bando do Senhor da Guerra, também com 20. Você comanda só o líder; as tropas cumprem as ordens dele, pela IA. O Líder Supremo, personagem do jogador, fica fora da batalha: se ele cair em campo, a campanha acaba. Arte vetorial provisória, com bustos sem membros, e interface sobreposta ao próprio campo.

O design completo do combate (líderes, pelotões, ordens e turnos em grupo) está em [`docs/design-combate.md`](docs/design-combate.md). Esta versão implementa as fases 1 e 2 dele.

## Próxima direção visual e de terreno

As decisões aprovadas sobre corpo inteiro **sem base**, aparência modular, expressões, oclusão e geração de terreno baseada no mapa global estão em [docs/direcao-visual-terreno.md](docs/direcao-visual-terreno.md), com referências visuais. Essa especificação descreve a próxima etapa; não altera as funcionalidades atuais descritas abaixo.

## Executar no navegador

Requer Node.js 22 ou superior.

```bash
npm ci
npm run dev
```

Abra o endereço local indicado pelo Vite, normalmente `http://localhost:5173`. Esse endereço pertence à máquina em que o comando foi executado. Em um ambiente remoto, é necessário encaminhar a porta 5173 para acessá-lo de outro computador.

```bash
npm test          # testes determinísticos do motor de combate
npm run build    # verifica TypeScript e gera dist/
npm run preview  # serve a versão compilada
```

`dist/` contém apenas arquivos estáticos. Não exige servidor de aplicação, conta, API, conexão com Figma ou Magnific. Nenhum comando acima publica ou reconfigura o ambiente de nuvem.

## Jogar

- Você controla só os líderes, marcados com um estandarte. As tropas cumprem a ordem do líder; sem ordem, seguram a posição.
- **3** a **9**: dar uma das sete ordens da aba de comando. **T**: escolher para quem ela vai (todos, só guerreiros ou só arqueiros). Passe o cursor numa ordem para ver o efeito e quem vai ouvi-la; o contorno dourado no campo é o alcance de comando.
- Clique num hexágono iluminado para mover. Passe o cursor antes para ver caminho e custos.
- Clique num inimigo para realizar o ataque básico, respeitando alcance, linha de tiro e recursos.
- **1**: selecionar movimento; **2**: selecionar ataque.
- **W**: aguardar até o fim da fila, uma vez por rodada, preservando os recursos restantes.
- **Espaço**: encerrar o turno. **G**: alternar a grade. **Esc**: pausar ou retomar.
- Câmera: arraste o campo, use a roda do mouse (ou **+** e **−**) para zoom, as setas para andar e **C** para centralizar em quem está agindo.
- **V** ou o botão **»** mudam a velocidade das tropas (1×, 2× ou 4×). Ações longe da câmera acontecem na hora.
- O botão **Ajuda** explica as regras durante a partida. **Reiniciar** repete o encontro com a mesma semente para comparar estratégias.

Cada lado tem 1 líder, 14 guerreiros (maça ou lança do nosso lado, cutelo ou lança do outro) e 6 arqueiros, em bloco: escudos na frente, lanças atrás, arcos no fundo e o líder no meio, todos dentro do alcance de comando. Maça e cutelo são de uma mão, então quem os usa carrega escudo. Os dois líderes são Líderes de Combate, com atributos 20% acima do padrão. Os dois lados são espelhados, com o mesmo terreno e o mesmo poder de fogo. O cartão de cada combatente mostra a subclasse, o líder que ele segue, a ordem que cumpre e a nota de atributo (soma dos oito atributos base). A ordem dos turnos é determinada por iniciativa e fadiga, intercalando aliados e inimigos; empates são decididos por sorteio fixo da semente. Quando o último líder de um lado cai, a tropa de maior nota assume o comando interino, sempre pela IA, e a batalha segue sozinha.

## Regras deste protótipo

| Ação | PA | Fadiga acumulada |
| --- | ---: | ---: |
| Mover em terreno comum | 2 por hexágono | 4 por hexágono |
| Mover em terreno difícil | 3 por hexágono | 6 por hexágono |
| Ataque básico de maça | 4 | 13 |
| Ataque básico de lança | 4 | 10 |
| Ataque básico de cutelo de saque | 4 | 12 |
| Ataque básico de espada (Duarte) | 4 | 12 |
| Ataque básico de machado (Senhor da Guerra) | 4 | 14 |
| Tiro básico de arco | 4 | 15 |

- Cada combatente dispõe de 9 PA. A primeira ativação de cada rodada renova os PA e reduz automaticamente a fadiga acumulada em 15. Aguardar não repete essa renovação e aplica −25% à iniciativa da próxima rodada.
- **Sem habilidades especiais**, como Recuperar ou atordoar. O que muda o combate são as ordens (abaixo); o escudo só conta com a ordem de levantar escudos.
- Armaduras de cabeça e corpo são independentes. Ataques podem penetrar armadura. A chance básica de atingir a cabeça é 25%, com multiplicador de 1,5 no dano à vida.
- Sair de um hexágono ameaçado por um inimigo corpo a corpo provoca uma reação gratuita. Isso também vale para circular ao redor dele. Acertar a reação interrompe o movimento; o passo tentado já consome recursos.
- Arcos não disparam quando o portador está engajado por um inimigo corpo a corpo. Flechas passam por cima de quem estiver no caminho, aliado ou inimigo; só obstáculos bloqueiam a linha de tiro. Se a flecha errar e houver aliados do atirador em contato com o alvo, ela pode acertar um deles: 35% por aliado em contato, no máximo 70%. A ficha do alvo e a dica do mouse mostram esse risco. Os arcos iniciais têm flechas ilimitadas; gestão de munição fica para a expansão de equipamentos.
- A moral possui cinco estados: confiante, firme, abalado, à beira do pânico e em fuga. Testes de determinação respondem a ferimentos, perdas e pressão próxima. Combatentes em fuga procuram uma borda automaticamente.
- A partida termina quando todos os integrantes de um lado morrem ou escapam, ou na hora em que um Líder Supremo cai em campo. Fugir não conta como queda. A IA usa o mesmo motor e os mesmos custos do jogador.

### Ordens

Ordens custam PL (pontos de liderança), não PA. O Líder de Combate tem 6 PL por turno e alcance de comando de 5 hexágonos; o comandante interino também. Uma ordem vale pela rodada em que é dada e pelas duas seguintes, e a divisão que a recebeu só aceita outra quando ela acaba. Quem está fora do alcance não ouve a ordem nova; se uma ordem vence com a tropa fora do alcance, ela continua cumprindo, mas sem o bônus. A letra no ombro de cada tropa mostra a ordem que ela segue.

| Tecla | Ordem | PL | Para quem | Efeito |
| :---: | --- | ---: | --- | --- |
| 3 | Avanço devagar! (D) | 2 | todos ou uma divisão | Avançam até 2 hexágonos por turno, sem sair da linha. |
| 4 | Avanço rápido! (R) | 3 | todos ou uma divisão | Gastam os PA para fechar a distância. |
| 5 | Formar linha defensiva! (L) | 3 | todos ou guerreiros | +10 de defesa corpo a corpo; seguram a linha. |
| 6 | Levantar escudos! (E) | 4 | todos ou guerreiros | +8 de defesa corpo a corpo e à distância para quem tem escudo; andam no máximo 1 hexágono. |
| 7 | Arqueiros, disparem! (T) | 2 | arqueiros | Atiram por cima da linha no alvo que mais vale a flecha e seguram o tiro quando o risco de acertar um aliado não compensa; sem alvo, andam até ter linha de tiro. |
| 8 | Arqueiros, preparar disparo! (M) | 3 | arqueiros | Miram um turno sem atirar; depois, +15 de ataque no alvo mirado. Andar perde a mira. |
| 9 | Atacar! (A) | 4 | todos ou uma divisão | Partem para cima; +10 no primeiro ataque de cada tropa durante a ordem. |

Os bônus são multiplicados pela potência de quem manda (1× para o Líder de Combate). Reações a quem sai de um hexágono ameaçado não usam o bônus de ataque.

### A IA

Cada tropa pontua todas as opções do turno (ficar ou ir para cada hexágono alcançável, atacando ou não) pelo dano esperado, chance de matar, valor do alvo (líderes e arqueiros valem mais), risco de levar ataques e reações, coesão com o resto da linha e o quanto a opção cumpre a ordem recebida. Arqueiros descontam o risco de a flecha errar e acertar um aliado em contato com o alvo, e seguram o tiro quando esse risco pesa mais que o tiro. Ordens limitam o que a tropa pode fazer: na linha defensiva ela anda no máximo 1 hexágono, no avanço devagar no máximo 2. O líder inimigo e o comandante interino escolhem ordens olhando distância, contato, força relativa e duelo de arqueiros. A IA antiga, que só atacava o mais próximo, continua no motor como régua: a nova precisa vencê-la dos dois lados do mapa, e os testes conferem isso.

### Aproximações deliberadas

O sistema usa *Battle Brothers* como referência de gênero e regras, com implementação e arte próprias. Não é uma reprodução exata de todas as fórmulas ou exceções do jogo.

O dano usa rolagens independentes para vida e armadura. A penetração sofre redução equivalente a 10% da proteção restante; quando a armadura quebra, aplica-se também a parcela desprotegida excedente. A linha de tiro usa um único raio entre centros, bloqueado só por obstáculos. A moral é uma versão reduzida baseada em determinação, vizinhança e eventos. Tropas em fuga ainda usam a IA antiga, que só procura a borda.

Ainda não há altura de terreno, cobertura parcial, dispersão de projéteis além da flecha perdida em aliados colados no alvo, ferimentos permanentes, troca de equipamento, habilidades, campanha, contratação, contratos, economia ou salvamento. O encontro e os equipamentos são fixos. A semente permite repetir o mesmo resultado ao repetir as mesmas ações.

## Organização

- `src/game.ts`: motor de combate determinístico, sem dependência do Phaser ou DOM. Inclui líderes, subclasses, pelotões, nota de atributo, ordens, PL e comando interino.
- `src/ai.ts`: a IA das tropas e dos líderes que o jogador não controla.
- `src/encounters.ts`: os encontros. O Campo das Salinas (20 contra 20) é o que o jogo abre; a emboscada original de 3 contra 4 continua como base dos testes de regras.
- `src/game.test.ts`: testes de regras e simulações completas.
- `src/scene.ts`: campo em Phaser, seleção de hexágonos, prévias, animações e execução da IA.
- `src/ui.ts` e `src/style.css`: interface em português, atributos, fila, controles, ajuda e resultados.
- `public/assets/`: bustos, obstáculos e ícones SVG originais provisórios.
- `public/fonts/`: fontes locais e respectivas licenças.
- `docs/design-combate.md`: design do combate com líderes, pelotões e ordens. As fases 1 e 2 estão implementadas; as outras ainda não.

O estado de inspeção `window.__combat` existe somente no servidor de desenvolvimento, para testes de integração. A compilação de produção não o expõe.

Referências consultadas: [Combat Mechanics](https://battlebrothers.fandom.com/wiki/Combat_Mechanics), [Attributes](https://battlebrothers.fandom.com/wiki/Attributes), [Damage](https://battlebrothers.fandom.com/wiki/Damage) e [Morale](https://battlebrothers.fandom.com/wiki/Morale).
