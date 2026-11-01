# Vale do Sal

Protótipo original de combate tático em hexágonos, feito com **Phaser 3 + TypeScript + Vite**. Três mercenários enfrentam quatro inimigos numa emboscada. Arte vetorial provisória, com bustos sem membros, e interface sobreposta ao próprio campo.

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

- Clique num hexágono iluminado para mover. Passe o cursor antes para ver caminho e custos.
- Clique num inimigo para realizar o ataque básico, respeitando alcance, linha de tiro e recursos.
- **1**: selecionar movimento; **2**: selecionar ataque.
- **W**: aguardar até o fim da fila, uma vez por rodada, preservando os recursos restantes.
- **Espaço**: encerrar o turno. **G**: alternar a grade. **Esc**: pausar ou retomar.
- O botão **Ajuda** explica as regras durante a partida. **Reiniciar** repete o encontro com a mesma semente para comparar estratégias.

Íria usa maça e defesa passiva de escudo; Tomé usa lança; Nara usa arco. A ordem é determinada por iniciativa e fadiga, intercalando aliados e inimigos. Não é possível comandar outra unidade antes de sua ativação.

## Regras deste protótipo

| Ação | PA | Fadiga acumulada |
| --- | ---: | ---: |
| Mover em terreno comum | 2 por hexágono | 4 por hexágono |
| Mover em terreno difícil | 3 por hexágono | 6 por hexágono |
| Ataque básico de maça | 4 | 13 |
| Ataque básico de lança | 4 | 10 |
| Tiro básico de arco | 4 | 15 |

- Cada mercenário dispõe de 9 PA. A primeira ativação de cada rodada renova os PA e reduz automaticamente a fadiga acumulada em 15. Aguardar não repete essa renovação e aplica −25% à iniciativa da próxima rodada.
- **Sem habilidades especiais**, incluindo Recuperar, atordoar, parede de escudos ou tiro mirado. O escudo contribui apenas para defesa passiva.
- Armaduras de cabeça e corpo são independentes. Ataques podem penetrar armadura. A chance básica de atingir a cabeça é 25%, com multiplicador de 1,5 no dano à vida.
- Sair de um hexágono ameaçado por um inimigo corpo a corpo provoca uma reação gratuita. Isso também vale para circular ao redor dele. Acertar a reação interrompe o movimento; o passo tentado já consome recursos.
- Arcos não disparam quando o portador está engajado por um inimigo corpo a corpo. Obstáculos e unidades podem bloquear a linha de tiro. Os arcos iniciais têm flechas ilimitadas; gestão de munição fica para a expansão de equipamentos.
- A moral possui cinco estados: confiante, firme, abalado, à beira do pânico e em fuga. Testes de determinação respondem a ferimentos, perdas e pressão próxima. Combatentes em fuga procuram uma borda automaticamente.
- A partida termina quando todos os integrantes de um lado morrem ou escapam. A IA usa o mesmo motor e os mesmos custos do jogador.

### Aproximações deliberadas

O sistema usa *Battle Brothers* como referência de gênero e regras, com implementação e arte próprias. Não é uma reprodução exata de todas as fórmulas ou exceções do jogo.

O dano usa rolagens independentes para vida e armadura. A penetração sofre redução equivalente a 10% da proteção restante; quando a armadura quebra, aplica-se também a parcela desprotegida excedente. A linha de tiro usa um único raio entre centros, com bloqueio total por obstáculos e unidades. A moral é uma versão reduzida baseada em determinação, vizinhança e eventos. A IA usa prioridades simples para atacar, aproximar e fugir.

Ainda não há altura de terreno, cobertura parcial, dispersão de projéteis, ferimentos permanentes, troca de equipamento, habilidades, campanha, contratação, contratos, economia ou salvamento. O encontro e os equipamentos são fixos. A semente permite repetir o mesmo resultado ao repetir as mesmas ações.

## Organização

- `src/game.ts`: motor de combate determinístico, sem dependência do Phaser ou DOM.
- `src/game.test.ts`: testes de regras e simulações completas.
- `src/scene.ts`: campo em Phaser, seleção de hexágonos, prévias, animações e execução da IA.
- `src/ui.ts` e `src/style.css`: interface em português, atributos, fila, controles, ajuda e resultados.
- `public/assets/`: bustos, obstáculos e ícones SVG originais provisórios.
- `public/fonts/`: fontes locais e respectivas licenças.

O estado de inspeção `window.__combat` existe somente no servidor de desenvolvimento, para testes de integração. A compilação de produção não o expõe.

Referências consultadas: [Combat Mechanics](https://battlebrothers.fandom.com/wiki/Combat_Mechanics), [Attributes](https://battlebrothers.fandom.com/wiki/Attributes), [Damage](https://battlebrothers.fandom.com/wiki/Damage) e [Morale](https://battlebrothers.fandom.com/wiki/Morale).
