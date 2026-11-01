import {
  attributeScore, checkOrder, commandedPlatoons, commanderOf, distance, divisionOf, isPlayerControlled, leaderClassLabel,
  orderInfo, ORDER_ROUNDS, ORDERS, platoonOf, platoonTroops,
  type BattleState, type Division, type OrderId, type OrderTarget,
} from './game';
import { ENCOUNTER_NAMES } from './encounters';

type BattleUnit = BattleState['units'][number];

export interface UIActions {
  onMode: (mode: 'move' | 'attack') => void;
  onWait: () => void;
  onEnd: () => void;
  onRestart: () => void;
  onPause: () => void;
  onSpeed: () => void;
  onHelp: () => void;
  onCloseHelp: () => void;
  onOrder: (id: OrderId) => void;
  onOrderTarget: (target: OrderTarget) => void;
  /** The order under the cursor or keyboard focus, so the field can show who would hear it. */
  onOrderHover: (id?: OrderId) => void;
}

export interface UIView {
  mode: 'move' | 'attack';
  paused: boolean;
  helpOpen: boolean;
  busy: boolean;
  /** Animation and AI pacing multiplier. */
  speed: 1 | 2 | 4;
  hoveredId?: string;
  message: string;
  /** Who the next order goes to. */
  orderTarget: OrderTarget;
  orderHover?: OrderId;
  preview?: {
    chance: number;
    allowed: boolean;
    reason: string;
    ap: number;
    fatigue: number;
    friendlyRisk: number;
  };
}

const MORALE = ['Em fuga', 'Em pânico', 'Abalado', 'Firme', 'Confiante'] as const;
const assetUrl = (name: string) => `${import.meta.env.BASE_URL}assets/${name}.svg`;
const icon = (name: string, className = '') => `<img class="ui-icon ${className}" src="${assetUrl(name)}" alt="" draggable="false">`;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
/** Queue tokens that fit above the action dock; the rest collapse into a "+N" counter. */
const QUEUE_LIMIT = 8;

const DIVISIONS: Division[] = ['guerreiros', 'arqueiros'];
const TARGETS: OrderTarget[] = ['todos', 'guerreiros', 'arqueiros'];
const TARGET_NAMES: Record<OrderTarget, string> = { todos: 'Todos', guerreiros: 'Guerreiros', arqueiros: 'Arqueiros' };
const troopsWord = (n: number) => `${n} ${n === 1 ? 'tropa' : 'tropas'}`;

/** Who this unit is in the chain of command, e.g. "Guerreiro · segue Duarte · nota 412". */
function roleLine(state: BattleState, unit: BattleUnit): string {
  const score = `nota ${attributeScore(unit)}`;
  if (unit.role === 'leader' && unit.leaderClass) {
    const troops = unit.platoonId ? platoonTroops(state, unit.platoonId).length : 0;
    return `${leaderClassLabel(unit.leaderClass)} · ${troopsWord(troops)} · ${score}`;
  }
  const kind = divisionOf(unit) === 'arqueiros' ? 'Arqueiro' : 'Guerreiro';
  if (commandedPlatoons(state, unit).length) return `${kind} · comando interino · ${score}`;
  const platoon = platoonOf(state, unit);
  if (!platoon) return `${kind} · ${score}`;
  const commander = commanderOf(state, platoon);
  const follows = !commander ? 'sem líder' : commander.role === 'leader' ? `segue ${commander.name}` : `segue ${commander.name} (interino)`;
  return `${kind} · ${follows} · ${score}`;
}

/** The order a troop follows, or what a commander has left to give. */
function orderLine(state: BattleState, unit: BattleUnit): string {
  if (commandedPlatoons(state, unit).length) return `Comanda · ${unit.pl}/${unit.maxPl} PL · alcance ${unit.commandRange} hex`;
  if (unit.role === 'leader') return 'Sem pelotão para comandar.';
  if (unit.order) {
    const label = orderInfo(unit.order.id).label;
    return unit.order.stale ? `Ordem: ${label} · sem notícias do líder, sem bônus` : `Ordem: ${label} · até a rodada ${unit.order.expiresRound}`;
  }
  return commanderOf(state, platoonOf(state, unit)) ? 'Sem ordem: mantém a posição.' : 'Sem comando: luta por conta própria.';
}

/** DOM controls over the Phaser field. Scene updates do not recreate the HUD. */
export class CombatUI {
  private readonly element: HTMLDivElement;
  private readonly nodes = new Map<string, HTMLElement>();
  private readonly queueNodes = new Map<string, HTMLLIElement>();
  private queueOrder = '';
  private readonly moreToken = Object.assign(document.createElement('li'), { className: 'turn-more' });
  private previousModal: HTMLElement | null = null;
  private focusBeforeModal: HTMLElement | null = null;

  constructor(root: HTMLElement, private readonly callbacks: UIActions) {
    this.element = document.createElement('div');
    this.element.className = 'combat-ui';
    this.element.innerHTML = `
      <header class="battle-heading">
        <div class="battle-location"><span class="location-mark" aria-hidden="true">◇</span><div><p class="eyebrow">VALE DO SAL</p><p class="encounter-name" data-ui="encounter">Campo das Salinas</p></div></div>
        <div class="battle-balance" aria-label="Estado do combate">
          <div class="balance-side balance-side--ally"><span class="count-dot"></span><strong data-ui="allies">21</strong><span>aliados</span></div>
          <div class="round-label"><span>RODADA</span><strong data-ui="round">1</strong></div>
          <div class="balance-side balance-side--enemy"><strong data-ui="enemies">21</strong><span>inimigos</span><span class="count-dot"></span></div>
        </div>
        <nav class="battle-tools" aria-label="Opções do combate">
          <button class="tool-button" data-action="speed" title="Velocidade das tropas — V"><span class="speed-symbol" aria-hidden="true">»</span><span class="tool-label" data-ui="speed-label">2×</span></button>
          <button class="tool-button" data-action="help" title="Como jogar" aria-label="Ajuda"><span class="tool-symbol" aria-hidden="true">?</span><span class="tool-label">Ajuda</span></button>
          <button class="tool-button" data-action="pause" title="Pausar ou retomar — Esc"><span class="pause-symbol" data-ui="pause-icon" aria-hidden="true">II</span><span class="tool-label" data-ui="pause-label">Pausar</span></button>
          <button class="tool-button" data-action="restart" title="Reiniciar este combate"><span class="restart-symbol" aria-hidden="true">↻</span><span class="tool-label">Reiniciar</span></button>
        </nav>
      </header>
      <div class="battle-objective"><span class="objective-mark" aria-hidden="true">✧</span> <span data-ui="objective">Vença o bando inimigo.</span></div>
      <section class="combat-log" aria-label="Últimos acontecimentos" aria-live="polite" aria-atomic="false">
        <p data-ui="log-0"></p><p data-ui="log-1"></p><p data-ui="log-2"></p>
      </section>

      <div class="command-stack">
      <section class="command-panel hud-panel" aria-label="Aba de comando" data-ui="command-panel" hidden>
        <div class="command-heading">
          <div><p class="eyebrow">ABA DE COMANDO</p><h2 data-ui="command-name">O pelotão</h2></div>
          <div class="pl-meter" title="Pontos de liderança: pagam as ordens e voltam cheios a cada turno do líder."><span class="resource-label">PL</span><span class="pl-pips" data-ui="pl-pips"></span><strong data-ui="pl-value">6/6</strong></div>
        </div>
        <div class="order-targets" role="group" aria-label="Para quem vai a ordem">
          <kbd title="Trocar o destino da ordem">T</kbd>
          ${TARGETS.map(target => `<button class="target-chip" data-action="order-target" data-target="${target}" aria-pressed="${target === 'todos'}">${TARGET_NAMES[target]}<span data-ui="target-count-${target}">0</span></button>`).join('')}
        </div>
        <ol class="order-list">
          ${ORDERS.map((order, index) => `<li><button class="order-button" data-action="order" data-order="${order.id}"><kbd>${index + 3}</kbd><span class="order-mark" aria-hidden="true">${order.mark}</span><span class="order-label">${order.label}</span><span class="order-cost">${order.pl} PL</span></button></li>`).join('')}
        </ol>
        <div class="order-detail" aria-live="polite"><p data-ui="order-summary"></p><p class="order-check" data-ui="order-check"></p></div>
        <div class="division-status">
          ${DIVISIONS.map(division => `<p data-ui="status-${division}"><strong>${TARGET_NAMES[division]}</strong><span class="status-mark" data-ui="status-mark-${division}"></span><span data-ui="status-text-${division}"></span></p>`).join('')}
          <p class="command-range" data-ui="command-range"></p>
        </div>
      </section>

      <section class="unit-card hud-panel" aria-label="Atributos da unidade ativa" data-ui="active-card">
        <div class="active-portrait"><img data-ui="active-image" src="${assetUrl('iria')}" alt="" draggable="false"><span class="portrait-flourish" aria-hidden="true"></span></div>
        <div class="unit-card-content">
          <div class="unit-name-row"><div><p class="eyebrow" data-ui="active-caption">SEU TURNO</p><h1 data-ui="active-name">Iria</h1></div><span class="morale-chip" data-ui="morale" title="Moral"><span class="morale-mark" aria-hidden="true">◆</span><span data-ui="morale-label">Firme</span></span></div>
          <p class="weapon-name" data-ui="weapon">Escudo e lâmina</p>
          <p class="unit-role" data-ui="role"></p>
          <p class="unit-order" data-ui="order-line"></p>
          <div class="health-line">${icon('heart')}<span class="compact-meter"><span data-ui="hp-fill"></span></span><strong data-ui="hp-value">60 / 60</strong></div>
          <div class="armor-line"><span class="armor-stat" title="Armadura da cabeça">${icon('helmet')}<span data-ui="head-value">25 / 25</span></span><span class="armor-stat" title="Armadura do corpo">${icon('shield')}<span data-ui="body-value">50 / 50</span></span><span class="armor-caption">armadura</span></div>
          <div class="resource-line"><span class="resource-label">PA</span><span class="ap-pips" data-ui="ap-pips" aria-label="Pontos de ação"></span><strong data-ui="ap-value">9/9</strong><span class="resource-divider"></span>${icon('fatigue')}<strong data-ui="fatigue-value">0/80</strong></div>
          <div class="fatigue-track" aria-label="Fadiga"><span data-ui="fatigue-fill"></span></div>
        </div>
      </section>
      </div>

      <section class="turn-order" aria-label="Ordem dos turnos" data-testid="turn-queue">
        <div class="turn-order-caption"><span class="short-rule"></span><span>ORDEM DOS TURNOS</span><span class="short-rule"></span></div>
        <ol class="turn-list" data-ui="queue"></ol>
      </section>

      <section class="action-dock hud-panel" aria-label="Ações de combate">
        <div class="action-intent"><span class="intent-dot" data-ui="intent-dot"></span><span data-ui="intent" aria-live="polite">Escolha um hexágono para mover.</span><span class="grid-hint"><kbd>G</kbd> grade</span></div>
        <div class="action-buttons">
          <button class="action-button" data-action="move" aria-pressed="true" title="Chão comum: 2 PA e +4 fadiga por hexágono. Terreno difícil: 3 PA e +6 fadiga."><kbd>1</kbd>${icon('move')}<span class="action-name">Mover</span><span class="action-cost" data-ui="move-cost">2 PA · +4 fad. / hex</span></button>
          <button class="action-button" data-action="attack" aria-pressed="false"><kbd>2</kbd><img class="ui-icon" data-ui="attack-icon" src="${assetUrl('sword')}" alt="" draggable="false"><span class="action-name">Atacar</span><span class="action-cost" data-ui="attack-cost">4 PA · +10 fad.</span></button>
          <button class="action-button" data-action="wait"><kbd>W</kbd>${icon('wait')}<span class="action-name">Aguardar</span><span class="action-cost">ao fim da fila</span></button>
          <button class="action-button action-button--end" data-action="end"><kbd>ESPAÇO</kbd>${icon('end')}<span class="action-name">Encerrar turno</span><span class="action-cost" data-ui="end-cost">passar a vez</span></button>
        </div>
      </section>

      <aside class="target-card hud-panel" aria-label="Unidade sob o cursor" data-ui="target-card" hidden>
        <div class="target-heading"><img data-ui="target-image" src="${assetUrl('raider')}" alt="" draggable="false"><div><p class="eyebrow" data-ui="target-team">INIMIGO</p><h2 data-ui="target-name">Saqueador</h2><p class="target-morale" data-ui="target-morale">Firme</p></div></div>
        <p class="target-role" data-ui="target-role"></p>
        <p class="target-order" data-ui="target-order"></p>
        <div class="target-stats"><span title="Vida">${icon('heart')}<strong data-ui="target-hp"></strong></span><span title="Armadura da cabeça">${icon('helmet')}<strong data-ui="target-head"></strong></span><span title="Armadura do corpo">${icon('shield')}<strong data-ui="target-body"></strong></span></div>
        <div class="attack-preview" data-ui="preview" hidden><div class="preview-chance"><strong data-ui="preview-chance">75<span>%</span></strong><span>chance de acerto</span></div><p data-ui="preview-reason"></p><div class="preview-cost" data-ui="preview-cost"></div></div>
      </aside>

      <div class="modal-backdrop" data-ui="help-modal" hidden>
        <section class="battle-modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" tabindex="-1">
          <p class="eyebrow">CADERNO DA FACÇÃO</p><h2 id="help-title">Quem comanda é o líder.</h2>
          <p class="modal-lead">Você controla só os líderes, marcados com um estandarte. As tropas do pelotão cumprem as ordens do líder: sem ordem, seguram a posição. O Líder Supremo fica fora das batalhas; se ele cair, a campanha acaba.</p>
          <div class="help-controls"><div><kbd>1</kbd><span><strong>Mover</strong>Clique num hexágono alcançável. O caminho mostra o custo antes de confirmar.</span></div><div><kbd>2</kbd><span><strong>Atacar</strong>Clique num inimigo. Confira alcance, chance de acerto e custos.</span></div><div><kbd>W</kbd><span><strong>Aguardar</strong>Adie sua vez para o fim da fila, uma vez por rodada.</span></div><div><kbd>ESPAÇO</kbd><span><strong>Encerrar turno</strong>Finalize a ativação da unidade atual.</span></div><div><kbd>3–9</kbd><span><strong>Dar uma ordem</strong>Na aba de comando. Custa PL, não PA, e vale por ${ORDER_ROUNDS} rodadas, que são também a recarga.</span></div><div><kbd>T</kbd><span><strong>Para quem</strong>Todos, só guerreiros ou só arqueiros. Só ouve quem está no alcance de comando.</span></div></div>
          <div class="help-notes"><p><span class="help-morale" aria-hidden="true">✥</span><span>Arraste o campo para mover a câmera, use a roda do mouse ou as setas para navegar e <kbd>C</kbd> para centralizar em quem está agindo. <kbd>V</kbd> muda a velocidade das tropas.</span></p><p>${icon('fatigue')} Ações gastam PA e acumulam fadiga. Na primeira ativação de cada rodada, 15 de fadiga são removidos automaticamente.</p><p>${icon('sword')} Sair de um hexágono ameaçado pode provocar um ataque. Arcos não disparam quando o arqueiro está engajado.</p><p>${icon('shield')} Cabeça e corpo têm armaduras separadas. Flechas passam por cima de quem está no caminho; só obstáculos bloqueiam. Se errar, a flecha pode acertar um aliado em contato com o alvo.</p><p><span class="help-morale" aria-hidden="true">◆</span> Perdas e ferimentos afetam a moral. Unidades em fuga procuram uma saída.</p><p><span class="help-morale" aria-hidden="true">✧</span> A letra no ombro de uma tropa mostra a ordem que ela segue. Fora do alcance quando a ordem vence, ela continua cumprindo, mas sem o bônus. Se o líder cair e não houver outro, a tropa de maior nota assume e a batalha segue sozinha.</p></div>
          <div class="modal-footer"><span><kbd>G</kbd> mostrar grade <span class="footer-separator">·</span> <kbd>ESC</kbd> pausar</span><button class="primary-button" data-action="close-help">Voltar ao combate <span aria-hidden="true">→</span></button></div>
        </section>
      </div>
      <div class="modal-backdrop pause-backdrop" data-ui="pause-modal" hidden>
        <section class="battle-modal pause-modal" role="dialog" aria-modal="true" aria-labelledby="pause-title" tabindex="-1"><p class="eyebrow">UM INSTANTE DE SILÊNCIO</p><h2 id="pause-title">Combate pausado</h2><p class="modal-lead">As tropas aguardam suas ordens.</p><button class="primary-button" data-action="pause">Retomar combate <span aria-hidden="true">→</span></button><button class="text-button" data-action="help">Consultar os controles</button></section>
      </div>
      <div class="modal-backdrop" data-ui="outcome-modal" hidden>
        <section class="battle-modal outcome-modal" role="dialog" aria-modal="true" aria-labelledby="outcome-title" tabindex="-1"><div class="outcome-emblem" data-ui="outcome-emblem" aria-hidden="true">◇</div><p class="eyebrow" data-ui="outcome-label">VITÓRIA</p><h2 id="outcome-title" data-ui="outcome-title">O campo é nosso.</h2><p class="modal-lead" data-ui="outcome-description"></p><dl class="outcome-stats"><div><dt>Sobreviventes</dt><dd data-ui="survivors">3</dd></div><div><dt>Caídos</dt><dd data-ui="fallen">0</dd></div><div><dt>Em retirada</dt><dd data-ui="escaped">0</dd></div></dl><button class="primary-button" data-action="restart">Jogar novamente <span aria-hidden="true">↻</span></button><p class="outcome-footnote">O próximo capítulo da facção ainda será escrito.</p></section>
      </div>`;
    root.appendChild(this.element);
    this.element.querySelectorAll<HTMLElement>('[data-ui]').forEach(node => this.nodes.set(node.dataset.ui!, node));
    this.element.addEventListener('click', this.onClick);
    this.element.addEventListener('keydown', this.onKeyDown);
    this.element.addEventListener('pointerover', this.onPointerOver);
    this.element.addEventListener('pointerout', this.onPointerOut);
    this.element.addEventListener('focusin', this.onPointerOver);
    this.element.addEventListener('focusout', this.onPointerOut);
  }

  update(state: BattleState, view: UIView): void {
    this.hoverOrder = view.orderHover;
    const active = state.units.find(unit => unit.id === state.queue[0]);
    const living = (team: 'ally' | 'enemy') => state.units.filter(unit => unit.team === team && !unit.dead && !unit.escaped);
    this.text('allies', living('ally').length);
    this.text('enemies', living('enemy').length);
    this.text('round', state.round);
    this.text('encounter', ENCOUNTER_NAMES[state.encounter]);
    this.text('speed-label', `${view.speed}×`);
    this.text('pause-label', view.paused ? 'Retomar' : 'Pausar');
    this.text('pause-icon', view.paused ? '▷' : 'II');
    this.element.classList.toggle('is-paused', view.paused);
    this.element.classList.toggle('is-busy', view.busy);
    this.element.dataset.mode = view.mode;
    this.element.dataset.outcome = state.outcome;
    const recentLog = state.log.slice(-3);
    for (let index = 0; index < 3; index++) this.text(`log-${index}`, recentLog[index] ?? '');
    this.text('objective', this.objective(state));

    this.node('active-card').hidden = !active;
    if (active) this.updateActive(state, active, view);
    this.updateQueue(state);
    const canAct = Boolean(active && isPlayerControlled(active) && !view.busy && !view.paused && !view.helpOpen && state.outcome === 'ongoing');
    this.button('move').disabled = !canAct || (active?.ap ?? 0) < 2 || Boolean(active && active.fatigue + 4 > active.maxFatigue);
    this.button('attack').disabled = !canAct || Boolean(active && (active.ap < active.weapon.ap || active.fatigue + active.weapon.fatigue > active.maxFatigue || (active.weapon.kind === 'ranged' && active.weapon.ammo === 0)));
    this.button('wait').disabled = !canAct || Boolean(active?.waited);
    this.button('end').disabled = !canAct;
    this.button('pause').disabled = state.outcome !== 'ongoing';
    const commanding = Boolean(active && isPlayerControlled(active) && state.outcome === 'ongoing' && commandedPlatoons(state, active).length);
    this.node('command-panel').hidden = !commanding;
    if (active && commanding) this.updateCommand(state, active, view, canAct);
    this.button('move').setAttribute('aria-pressed', String(view.mode === 'move'));
    this.button('attack').setAttribute('aria-pressed', String(view.mode === 'attack'));
    this.text('intent', view.message || (view.busy ? 'As tropas se movem…' : view.mode === 'attack' ? 'Escolha um inimigo para atacar.' : 'Clique num hexágono alcançável para mover.'));
    this.node('intent-dot').classList.toggle('is-enemy', active?.team === 'enemy');

    const hovered = state.units.find(unit => unit.id === view.hoveredId && !unit.dead && !unit.escaped);
    const showTarget = Boolean(hovered && hovered.id !== active?.id && state.outcome === 'ongoing');
    this.node('target-card').hidden = !showTarget;
    if (hovered && showTarget) this.updateTarget(state, hovered, view);

    const help = this.node('help-modal');
    const outcome = this.node('outcome-modal');
    const pause = this.node('pause-modal');
    help.hidden = !view.helpOpen;
    outcome.hidden = state.outcome === 'ongoing' || view.helpOpen;
    pause.hidden = !view.paused || view.helpOpen || state.outcome !== 'ongoing';
    if (state.outcome !== 'ongoing') this.updateOutcome(state);
    const modal = !help.hidden ? help : !outcome.hidden ? outcome : !pause.hidden ? pause : null;
    if (modal !== this.previousModal) {
      if (modal) {
        if (!this.previousModal) this.focusBeforeModal = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        modal.querySelector<HTMLElement>('[role="dialog"]')?.focus({ preventScroll: true });
      } else {
        this.focusBeforeModal?.focus({ preventScroll: true });
        this.focusBeforeModal = null;
      }
      this.previousModal = modal;
    }
  }

  destroy(): void {
    this.element.removeEventListener('click', this.onClick);
    this.element.removeEventListener('keydown', this.onKeyDown);
    this.element.removeEventListener('pointerover', this.onPointerOver);
    this.element.removeEventListener('pointerout', this.onPointerOut);
    this.element.removeEventListener('focusin', this.onPointerOver);
    this.element.removeEventListener('focusout', this.onPointerOut);
    this.element.remove();
  }

  private updateActive(state: BattleState, unit: BattleUnit, view: UIView): void {
    this.image('active-image', unit.asset);
    this.text('active-name', unit.name);
    this.text('active-caption', unit.team === 'enemy' ? 'TURNO INIMIGO' : unit.morale === 0 ? 'EM RETIRADA'
      : !isPlayerControlled(unit) ? 'TROPA ALIADA' : view.busy ? 'EM AÇÃO' : 'SEU TURNO');
    this.text('weapon', unit.shield ? `${unit.weapon.name} · escudo` : unit.weapon.name);
    this.text('role', roleLine(state, unit));
    this.text('order-line', orderLine(state, unit));
    this.text('morale-label', MORALE[unit.morale]);
    this.node('morale').dataset.morale = String(unit.morale);
    this.node('morale').title = `Moral: ${MORALE[unit.morale]}`;
    this.text('hp-value', `${unit.hp} / ${unit.maxHp}`);
    this.node('hp-fill').style.width = `${clamp(unit.hp / Math.max(1, unit.maxHp) * 100, 0, 100)}%`;
    this.text('head-value', `${unit.headArmor} / ${unit.maxHeadArmor}`);
    this.text('body-value', `${unit.bodyArmor} / ${unit.maxBodyArmor}`);
    this.text('ap-value', `${unit.ap}/${unit.maxAp}`);
    this.text('fatigue-value', `${unit.fatigue}/${unit.maxFatigue}`);
    this.node('fatigue-fill').style.width = `${clamp(unit.fatigue / Math.max(1, unit.maxFatigue) * 100, 0, 100)}%`;
    this.node('fatigue-fill').classList.toggle('is-high', unit.fatigue >= unit.maxFatigue * .75);
    const pips = this.node('ap-pips');
    if (pips.children.length !== unit.maxAp) pips.replaceChildren(...Array.from({ length: unit.maxAp }, () => document.createElement('i')));
    Array.from(pips.children).forEach((pip, index) => pip.classList.toggle('is-spent', index >= unit.ap));
    pips.setAttribute('aria-label', `${unit.ap} de ${unit.maxAp} pontos de ação`);
    this.text('attack-cost', `${unit.weapon.ap} PA · +${unit.weapon.fatigue} fad.${unit.weapon.kind === 'ranged' && unit.weapon.ammo !== undefined ? ` · ${unit.weapon.ammo} flechas` : ''}`);
    const attackImage = this.node('attack-icon') as HTMLImageElement;
    const attackSrc = assetUrl(unit.weapon.kind === 'ranged' ? 'bow' : 'sword');
    if (attackImage.getAttribute('src') !== attackSrc) attackImage.src = attackSrc;
    this.node('active-card').dataset.team = unit.team;
  }

  /** The command tab: PL, who hears the order, the seven orders and what each division is doing. */
  private updateCommand(state: BattleState, leader: BattleUnit, view: UIView, canAct: boolean): void {
    const platoons = commandedPlatoons(state, leader);
    const troops = platoons.flatMap(platoon => platoonTroops(state, platoon.id)).filter(unit => unit.id !== leader.id);
    const inRange = troops.filter(unit => distance(unit.pos, leader.pos) <= leader.commandRange);
    this.text('command-name', platoons.map(platoon => platoon.name).join(' · '));
    const pips = this.node('pl-pips');
    if (pips.children.length !== leader.maxPl) pips.replaceChildren(...Array.from({ length: leader.maxPl }, () => document.createElement('i')));
    Array.from(pips.children).forEach((pip, index) => pip.classList.toggle('is-spent', index >= leader.pl));
    pips.setAttribute('aria-label', `${leader.pl} de ${leader.maxPl} pontos de liderança`);
    this.text('pl-value', `${leader.pl}/${leader.maxPl}`);

    for (const target of TARGETS) {
      const inTarget = (unit: BattleUnit) => target === 'todos' || divisionOf(unit) === target;
      const total = troops.filter(inTarget).length, near = inRange.filter(inTarget).length;
      this.text(`target-count-${target}`, near === total ? total : `${near}/${total}`);
      const chip = this.element.querySelector<HTMLButtonElement>(`button[data-target="${target}"]`)!;
      chip.title = `${near} de ${troopsWord(total)} no alcance de comando`;
      chip.setAttribute('aria-pressed', String(view.orderTarget === target));
      chip.disabled = !canAct;
    }
    for (const order of ORDERS) {
      const button = this.element.querySelector<HTMLButtonElement>(`button[data-order="${order.id}"]`)!;
      const check = checkOrder(state, leader, order.id, view.orderTarget);
      button.disabled = !canAct;
      button.setAttribute('aria-disabled', String(!check.allowed));
      button.classList.toggle('is-hovered', view.orderHover === order.id);
      button.classList.toggle('is-running', platoons.some(platoon => DIVISIONS.some(division => {
        const last = platoon.lastOrder[division];
        return last?.id === order.id && last.expiresRound >= state.round;
      })));
      button.title = check.allowed ? `${order.summary} Vai para ${TARGET_NAMES[check.target].toLowerCase()}: ${troopsWord(check.troops.length)} no alcance.` : `${order.summary} ${check.reason}`;
    }

    const hovered = view.orderHover ? ORDERS.find(order => order.id === view.orderHover) : undefined;
    if (hovered) {
      const check = checkOrder(state, leader, hovered.id, view.orderTarget);
      this.text('order-summary', hovered.summary);
      this.text('order-check', check.allowed ? `Vai para ${TARGET_NAMES[check.target].toLowerCase()}: ${troopsWord(check.troops.length)} no alcance · ${hovered.pl} PL.` : check.reason);
      this.node('order-check').classList.toggle('is-blocked', !check.allowed);
    } else {
      this.text('order-summary', `Ordens custam PL, não PA, e valem por ${ORDER_ROUNDS} rodadas. A divisão só recebe outra quando a anterior acaba.`);
      this.text('order-check', '');
    }

    for (const division of DIVISIONS) {
      const members = troops.filter(unit => divisionOf(unit) === division);
      const last = platoons.map(platoon => platoon.lastOrder[division]).find(entry => entry && entry.expiresRound >= state.round);
      this.node(`status-${division}`).hidden = !members.length;
      this.text(`status-mark-${division}`, last ? orderInfo(last.id).mark : '·');
      const following = members.filter(unit => unit.order).length;
      this.text(`status-text-${division}`, last ? `${orderInfo(last.id).label} · até a rodada ${last.expiresRound}`
        : following ? `${following} ainda seguem a última ordem, sem bônus` : 'Sem ordem: mantêm a posição');
      this.node(`status-mark-${division}`).classList.toggle('is-idle', !last);
    }
    this.text('command-range', `Alcance de comando ${leader.commandRange} hex · ${inRange.length} de ${troopsWord(troops.length)} ao alcance`);
  }

  private objective(state: BattleState): string {
    const leader = state.units.find(unit => isPlayerControlled(unit));
    if (leader) return `Vença o bando inimigo. Você comanda ${leader.name}; as tropas cumprem as ordens dele.`;
    const interim = state.platoons.filter(platoon => platoon.team === 'ally').map(platoon => commanderOf(state, platoon)).find(Boolean);
    if (interim && interim.role === 'troop') return `Sem líder em campo. ${interim.name} assumiu o comando e a batalha segue sozinha.`;
    return 'Sem líder em campo: a batalha segue sozinha.';
  }

  private updateQueue(state: BattleState): void {
    const queued = state.queue.map(id => state.units.find(unit => unit.id === id)).filter((unit): unit is BattleUnit => Boolean(unit && !unit.dead && !unit.escaped));
    const units = queued.slice(0, QUEUE_LIMIT), hidden = queued.length - units.length;
    const order = `${units.map(unit => unit.id).join('|')}+${hidden}`;
    const list = this.node('queue');
    for (let index = 0; index < units.length; index++) {
      const unit = units[index];
      let token = this.queueNodes.get(unit.id);
      if (!token) {
        token = document.createElement('li');
        token.className = 'turn-token';
        token.dataset.unitId = unit.id;
        token.innerHTML = '<span class="turn-current">AGORA</span><div class="turn-portrait"><img alt="" draggable="false"></div><span class="turn-name"></span><span class="turn-health"><i></i></span>';
        this.queueNodes.set(unit.id, token);
      }
      token.dataset.team = unit.team;
      token.classList.toggle('is-current', index === 0);
      token.classList.toggle('is-leader', unit.role === 'leader');
      token.classList.toggle('is-fleeing', unit.morale === 0);
      token.setAttribute('aria-current', index === 0 ? 'step' : 'false');
      token.title = `${unit.name} · ${unit.team === 'ally' ? 'Aliado' : 'Inimigo'} · ${unit.hp}/${unit.maxHp} vida · ${MORALE[unit.morale]}`;
      const image = token.querySelector<HTMLImageElement>('img')!;
      if (image.getAttribute('src') !== assetUrl(unit.asset)) image.src = assetUrl(unit.asset);
      const name = token.querySelector<HTMLElement>('.turn-name')!;
      if (name.textContent !== unit.name) name.textContent = unit.name;
      token.querySelector<HTMLElement>('.turn-health i')!.style.width = `${clamp(unit.hp / Math.max(1, unit.maxHp) * 100, 0, 100)}%`;
    }
    if (order !== this.queueOrder) {
      this.moreToken.textContent = `+${hidden}`;
      this.moreToken.title = `Mais ${hidden} ${hidden === 1 ? 'combatente' : 'combatentes'} nesta rodada`;
      list.replaceChildren(...units.map(unit => this.queueNodes.get(unit.id)!), ...(hidden ? [this.moreToken] : []));
      this.queueOrder = order;
    }
  }

  private updateTarget(state: BattleState, unit: BattleUnit, view: UIView): void {
    this.image('target-image', unit.asset);
    this.text('target-name', unit.name);
    this.text('target-role', roleLine(state, unit));
    this.text('target-order', orderLine(state, unit));
    this.text('target-team', unit.team === 'enemy' ? 'INIMIGO' : 'ALIADO');
    this.text('target-morale', MORALE[unit.morale]);
    this.text('target-hp', `${unit.hp}/${unit.maxHp}`);
    this.text('target-head', `${unit.headArmor}`);
    this.text('target-body', `${unit.bodyArmor}`);
    this.node('target-card').dataset.team = unit.team;
    this.node('preview').hidden = !view.preview || unit.team === 'ally';
    if (view.preview && unit.team === 'enemy') {
      this.text('preview-chance', `${Math.round(view.preview.chance)}%`);
      const risk = view.preview.allowed && view.preview.friendlyRisk > 0;
      this.text('preview-reason', view.preview.reason || (risk ? `Se errar, a flecha pode acertar um aliado colado no alvo: ${view.preview.friendlyRisk}% de risco.`
        : view.preview.allowed ? 'Alvo ao alcance.' : 'Este ataque não está disponível.'));
      this.text('preview-cost', `${view.preview.ap} PA · +${view.preview.fatigue} fadiga`);
      this.node('preview').classList.toggle('is-blocked', !view.preview.allowed);
      this.node('preview').classList.toggle('is-risky', risk);
    }
  }

  private updateOutcome(state: BattleState): void {
    const victory = state.outcome === 'victory';
    const allies = state.units.filter(unit => unit.team === 'ally');
    const supreme = state.endReason === 'supreme' ? state.units.find(unit => unit.supreme && unit.dead) : undefined;
    this.text('outcome-label', victory ? 'VITÓRIA' : supreme ? 'FIM DA CAMPANHA' : 'DERROTA');
    this.text('outcome-title', victory ? 'O campo é nosso.' : supreme ? 'A facção perdeu sua cabeça.' : 'O vale cobra seu preço.');
    this.text('outcome-description', supreme
      ? victory ? `${supreme.name}, líder supremo do inimigo, caiu. O bando não se reergue sem ele.`
        : `${supreme.name}, o Líder Supremo, caiu em campo. Sem ele, a facção se desfaz.`
      : victory ? 'O bando inimigo caiu ou fugiu. A facção conquistou o campo.' : 'Nossas tropas caíram ou deixaram o campo. O vale pertence ao inimigo, por ora.');
    this.text('survivors', allies.filter(unit => !unit.dead && !unit.escaped).length);
    this.text('fallen', allies.filter(unit => unit.dead).length);
    this.text('escaped', allies.filter(unit => unit.escaped).length);
    this.node('outcome-modal').dataset.result = state.outcome;
  }

  private node(name: string): HTMLElement {
    return this.nodes.get(name)!;
  }

  private text(name: string, value: string | number): void {
    const node = this.node(name);
    const content = String(value);
    if (node.textContent !== content) node.textContent = content;
  }

  private image(name: string, asset: string): void {
    const node = this.node(name) as HTMLImageElement;
    const src = assetUrl(asset);
    if (node.getAttribute('src') !== src) node.src = src;
  }

  private button(action: string): HTMLButtonElement {
    return this.element.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)!;
  }

  private onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-action]') : null;
    if (!target || target.disabled) return;
    switch (target.dataset.action) {
      case 'move': this.callbacks.onMode('move'); break;
      case 'attack': this.callbacks.onMode('attack'); break;
      case 'wait': this.callbacks.onWait(); break;
      case 'end': this.callbacks.onEnd(); break;
      case 'restart': this.callbacks.onRestart(); break;
      case 'pause': this.callbacks.onPause(); break;
      case 'speed': this.callbacks.onSpeed(); break;
      case 'help': this.callbacks.onHelp(); break;
      case 'close-help': this.callbacks.onCloseHelp(); break;
      case 'order': this.callbacks.onOrder(target.dataset.order as OrderId); break;
      case 'order-target': this.callbacks.onOrderTarget(target.dataset.target as OrderTarget); break;
    }
  };

  private hoverOrder?: OrderId;
  private setHoverOrder(node: EventTarget | null): void {
    const button = node instanceof Element ? node.closest<HTMLButtonElement>('button[data-order]') : null;
    const id = button && !button.disabled ? button.dataset.order as OrderId : undefined;
    if (id === this.hoverOrder) return;
    this.hoverOrder = id;
    this.callbacks.onOrderHover(id);
  }
  private onPointerOver = (event: Event): void => this.setHoverOrder(event.target);
  private onPointerOut = (event: Event): void => this.setHoverOrder((event as PointerEvent | FocusEvent).relatedTarget);

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLButtonElement && (event.key === ' ' || event.key === 'Enter')) event.stopPropagation();
    if (event.key !== 'Tab' || !this.previousModal) return;
    const buttons = Array.from(this.previousModal.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    if (!buttons.length) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && (document.activeElement === first || !buttons.includes(document.activeElement as HTMLButtonElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !buttons.includes(document.activeElement as HTMLButtonElement))) {
      event.preventDefault();
      first.focus();
    }
  };
}
