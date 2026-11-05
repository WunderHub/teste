# Planos táticos por texto — implementado

O comandante escreve ordens; o jogo interpreta o texto localmente e mostra a interpretação antes do grito. Não utiliza um modelo de linguagem, API paga ou conexão externa. O vocabulário de ações aceita sinônimos, flexões, acentos e pequenos erros; condições usam as formas descritas abaixo. Não é um interpretador irrestrito de português.

## Exemplos para testar

Escolha o grupo, escreva e confira a prévia. Enter envia; Shift+Enter permite quebrar a linha; Esc cancela.

| Grito | Resultado |
| --- | --- |
| `Se a vida ficar abaixo de 30%, recuem; senão, ataquem o líder` | Cada tropa ferida recua; as demais priorizam atacar o líder inimigo. Custa 4 PL. |
| `Recuem se moral baixa` | Mantém a posição até a própria moral ficar em 2 ou menos, golpeando só quem estiver colado. Volta a aguardar se a moral melhorar. Custa 3 PL. |
| `Quando inimigos no alcance, disparem` | Arqueiros aguardam uma oportunidade de tiro. Após o gatilho, mantêm a ordem de disparar até nova ordem. Custa 2 PL. |
| `Arqueiros, avancem até os inimigos entrarem no alcance, depois disparem` | Avançam devagar enquanto não houver alvo; quando houver, passam a disparar, sem retornar à etapa anterior. Custa 2 PL. |
| `Se vida abaixo de 30% ou moral baixa e não fadiga acima de 70%, recuem` | Recuar quando vida < 30%, ou quando moral baixa **e** fadiga ≤ 70%. A prévia mostra o agrupamento. |
| `Guerreiros, avancem; arqueiros, quando inimigos no alcance, disparem` | Dois grupos recebem planos distintos, totalizando 4 PL. Escolha “Todos”. |
| `Se houver risco de fogo amigo, cessem fogo; senão, disparem` | Arqueiros cessam fogo se existir um alvo ao alcance cujo tiro possa atingir aliados. Custa 2 PL. |

## Sintaxe e condições

- `se/caso CONDIÇÃO, AÇÃO; senão, ALTERNATIVA`: regra recorrente. Também aceita `AÇÃO se CONDIÇÃO` e `AÇÃO enquanto CONDIÇÃO`.
- `quando/assim que CONDIÇÃO, AÇÃO`: transição única; mantém a ação após o primeiro gatilho.
- `AÇÃO até CONDIÇÃO, depois AÇÃO`: transição única entre duas etapas.
- Combine condições com `e`, `ou`, `não`. `e` tem precedência sobre `ou`. Parênteses e condições aninhadas não são suportados.
- Separe ordens para grupos distintos por ponto e vírgula. Dois planos não podem atingir a mesma tropa. Até três cláusulas; 280 caracteres e 55 palavras no total; cada ação individual mantém o limite de 12 palavras.
- Vida/saúde ou fadiga: `abaixo de`, `acima de`, `menor que`, `maior que`, `no máximo`, `no mínimo`, `<`, `>`, `<=`, `>=`, com porcentagem inteira de 0% a 100%. Vida e fadiga são individuais, salvo `vida do líder`.
- `moral baixa/abalada`: moral ≤ 2. Fuga tem prioridade sobre qualquer plano.
- `inimigos perto`: até 2 hex; `inimigos a até 3 hex`: distância geométrica, com número entre 1 e 20.
- `inimigos no alcance`: alvo válido para a arma. Para arcos, considera bloqueios, engajamento e munição; não exige PA/fadiga disponíveis naquele instante.
- `engajados` ou `em combate corpo a corpo`: inimigo adjacente.
- `líder morrer` / `líder cair`: comandante que emitiu o plano morto ou fora do campo. O término do combate tem prioridade.
- `risco de fogo amigo`: existe possível alvo com aliados sujeitos a flecha perdida; não é uma comparação de probabilidades.

## Execução e custo

Cada tropa avalia a condição no início da própria vez, uma vez por rodada. Caminhar para entrar no alcance durante a vez não aciona a próxima etapa até a próxima vez. A posição, a vida e a moral são avaliadas separadamente para cada soldado; o grupo não espera uma decisão coletiva.

Sem alternativa e com condição falsa, a tropa aguarda mantendo a posição: não anda e não ataca à distância, mas golpeia inimigos colados nela (revida). Arqueiro alcançado em corpo a corpo pode recuar até 2 hex, como em qualquer ordem. As reações automáticas de combate seguem as regras existentes. Condições recorrentes podem voltar ao ramo anterior; transições “quando” e “até… depois” não voltam.

O plano substitui a ordem anterior das tropas que o ouviram. O custo é o maior custo entre as alternativas de cada plano; planos de grupos distintos somam. O pagamento ocorre uma vez, ao gritar. Todas as cláusulas são validadas antes de qualquer alteração; erro, incompatibilidade, sobreposição de destinatários ou PL insuficiente não alteram o combate. Repetir o mesmo plano nas mesmas tropas não cobra novamente.

O alcance de comando vale no momento do grito. Quem não ouviu mantém a ordem anterior. Quem ouviu continua executando o plano mesmo fora do alcance. Uma ordem direta posterior cancela o plano.

Substituir uma ordem/plano ainda não assentado mantém as regras de estresse, inclusive enquanto aguarda uma condição. Trocar de ramo automaticamente não gera estresse nem cobra PL. Os bônus da nova ação só passam a valer após o assentamento; manter o mesmo ramo preserva o assentamento e o consumo do bônus de primeiro ataque.

## Interface e limites

A prévia mostra condição interpretada, alternativa, destinatários, custo e tropas sob estresse. O campo aceita várias linhas; o painel mostra quantas tropas têm plano e quantas aguardam. Logo após o grito, só conta como aguardando quem não tem alternativa e cuja condição ainda é falsa. A marca `?` identifica tropas aguardando; após a ativação, aparece a letra da ação. Os atributos da tropa mostram o plano completo.

Comandos vagos como “se puderem”, gatilhos externos como “quando eu mandar”, coordenadas, direções específicas, sequências sem condição de transição, regras de altura e condições desconhecidas são recusados. Não há nova habilidade, “recuperar”, alteração de terreno ou geração de arte nesta implementação.

Arquivos: `src/order-language.ts` interpreta ações; `src/tactics.ts` interpreta, valida e executa planos; `src/commands.ts` mantém a interface pública; `src/ai.ts` consulta o plano antes de agir. Testes em `src/tactics.test.ts`, além das regressões do motor em `src/game.test.ts`.
