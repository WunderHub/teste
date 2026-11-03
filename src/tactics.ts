/** Deterministic tactical plans. Parsing and validation are pure; a shout is committed only after every clause passes. */
import { checkOrder, commandedPlatoons, distance, divisionOf, getActive, hasShot, isAlive,
  issueOrder, orderInfo, ORDER_SETTLE_ROUNDS, STRESS, strayCandidates,
  type ActionResult, type BattleState, type OrderCheck, type OrderTarget, type Unit } from './game';
import { focusLabel, MAX_SHOUT_LENGTH, parseOrder, resolveGroup, type ParsedOrder } from './order-language';

type Action = Extract<ParsedOrder, { ok: true }>;
type Condition =
  | { kind: 'and' | 'or'; children: Condition[] }
  | { kind: 'not'; child: Condition }
  | { kind: 'hp' | 'fatigue'; leader: boolean; op: '<' | '<=' | '>' | '>='; value: number }
  | { kind: 'near'; value: number }
  | { kind: 'range' | 'engaged' | 'morale' | 'leader-dead' | 'friendly-risk' };
export interface Directive {
  yes: Action; no?: Action; condition?: Condition; once: boolean; label: string;
}
export interface TacticalPlan extends Directive {
  commanderId: string; potency: number; signature: string;
  givenRound: number; settledRound: number; chain: number;
  evaluatedRound?: number; latched?: boolean; waiting?: boolean;
}
type ParsedShout = { ok: true; directives: Directive[] } | { ok: false; message: string };
const clean = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ');
const trim = (s: string) => s.trim().replace(/^[,;:\s]+|[,;:.!\s]+$/g, '').trim();
const bad = (message: string): never => { throw new Error(message); };
const actionName = (a: Action) => `${orderInfo(a.id).label}${a.focus ? ` ${focusLabel(a.focus)}` : ''}`;

function condition(text: string): Condition {
  const s = trim(clean(text)).replace(/^que /, '');
  const personal = s.match(/^(?:estiverem|ficarem|tiverem|estiver|ficar|tiver) (?:com )?(menos de|mais de|no maximo|no minimo) (\d{1,3}\s*%) (?:de )?(vida|saude|fadiga)$/);
  if (personal) return condition(`${personal[3]} ${personal[1]} ${personal[2]}`);
  if (/^(?:houver|existir|existirem) (?:um |os? )?inimigos? (?:no|ao|em) alcance$/.test(s)) return { kind: 'range' };
  if (!s) return bad('Falta a condição que as tropas devem observar.');
  if (s.includes(' ou ')) return { kind: 'or', children: s.split(' ou ').map(condition) };
  if (s.includes(' e ')) return { kind: 'and', children: s.split(' e ').map(condition) };
  if (s.startsWith('nao ')) return { kind: 'not', child: condition(s.slice(4)) };
  const value = s.match(/^(?:(?:a |sua |minha )?(vida|saude|fadiga)( do lider)?)(?: (?:ficar|ficarem|estiver|estiverem|cair|cair abaixo|for|chegar))? (abaixo de|menor que|menos de|acima de|maior que|mais de|no maximo|no minimo|<=|>=|<|>) (\d{1,3})\s*%$/);
  if (value) {
    const n = Number(value[4]);
    if (n > 100) return bad('Use uma porcentagem entre 0% e 100%.');
    const op = /^(abaixo|menor|menos|<$)/.test(value[3]) ? '<' : /^(acima|maior|mais|>$)/.test(value[3]) ? '>' : /^(no maximo|<=)/.test(value[3]) ? '<=' : '>=';
    if (value[1] === 'fadiga' && value[2]) return bad('A condição de fadiga é individual; use "fadiga acima de 70%".');
    return { kind: value[1] === 'fadiga' ? 'fatigue' : 'hp', leader: Boolean(value[2]), op, value: n };
  }
  if (/^(?:o |nosso )?lider (?:morrer|cair|estiver morto)$/.test(s)) return { kind: 'leader-dead' };
  if (/^(?:(?:a |sua )?moral (?:ficar |estiver |for )?(?:baixa|abalada)|(?:estiverem |ficarem )?(?:abalados|em panico))$/.test(s)) return { kind: 'morale' };
  if (/^(?:estiverem |ficarem )?(?:engajados|em combate corpo a corpo)$/.test(s)) return { kind: 'engaged' };
  if (/^(?:houver |existir )?(?:risco de fogo amigo|risco de acertar aliados)$/.test(s)) return { kind: 'friendly-risk' };
  if (/^(?:(?:os? |um )?inimigos? |eles )?(?:(?:estiverem|estiver|entrarem|entrar|chegarem|chegar) )?(?:no|ao|em) alcance$/.test(s)) return { kind: 'range' };
  if (/^(?:(?:os? |um )?inimigos? |eles )?(?:(?:estiverem|estiver|chegarem|chegar|ficarem) )?perto$/.test(s)) return { kind: 'near', value: 2 };
  const near = s.match(/^(?:(?:os? |um )?inimigos? |eles )?(?:(?:estiverem|estiver|chegarem|chegar) )?a (?:ate )?(\d{1,2}) hex(?:agonos?)?$/);
  if (near && Number(near[1]) > 0 && Number(near[1]) <= 20) return { kind: 'near', value: Number(near[1]) };
  return bad(`Condição não reconhecida: "${text}". Use vida abaixo de 30%, moral baixa, inimigos no alcance ou a até 3 hex.`);
}
function conditionName(c: Condition): string {
  if (c.kind === 'and' || c.kind === 'or') return `(${c.children.map(conditionName).join(c.kind === 'and' ? ' E ' : ' OU ')})`;
  if (c.kind === 'not') return `não (${conditionName(c.child)})`;
  if (c.kind === 'hp' || c.kind === 'fatigue') return `${c.kind === 'hp' ? 'vida' : 'fadiga'} ${c.leader ? 'do líder' : 'da própria tropa'} ${c.op} ${c.value}%`;
  if (c.kind === 'near') return `inimigo a até ${c.value} hex`;
  return { range: 'inimigo no alcance da arma, com linha livre', engaged: 'inimigo adjacente', morale: 'moral abalada (2 ou menos)', 'leader-dead': 'líder morto ou fora do campo', 'friendly-risk': 'possível tiro com risco de acertar aliados' }[c.kind];
}
function readAction(text: string, group?: OrderTarget): Action {
  const s = trim(text).replace(/^(?:ent[aã]o)\s+/i, '').replace(/\b(n[aã]o|ningu[eé]m) se (?=mex|mov)/gi, '$1 ');
  // Do not let the synonym reader discard a temporal clause, quantity or unsupported destination.
  if (/\b(se|quando|caso|enquanto|depois|antes|entao|senao|ate|somente|apenas)\b/.test(clean(s)) && !/^recu\w* ate mim[!.]?$/i.test(clean(s)))
    return bad('Separe as etapas com "até [condição], depois [ação]". Condições aninhadas ainda não são suportadas.');
  if (/\d|[%<>=]/.test(s)) return bad('Números precisam fazer parte de uma condição explícita.');
  if (/\b(esquerda|esquerdo|direita|direito)\b/.test(clean(s))) return bad('Direções específicas ainda não são suportadas; use avançar, recuar ou flanquear.');
  const a = parseOrder(s);
  if (!a.ok) return bad(a.message);
  if (group && a.vocative && group !== a.vocative && a.vocative !== 'todos') return bad('As alternativas de um plano precisam chamar o mesmo grupo.');
  return { ...a, vocative: a.vocative ?? group };
}
function directive(text: string): Directive {
  let s = trim(clean(text)).replace(/\b(nao|ninguem) se (?=mex|mov)/g, '$1 ').replace(/-se\b/g, '');
  s = s.replace(/^(?:arqueiros e guerreiros|guerreiros e arqueiros)(?=[,:\s])/, 'todos');
  const vocative = s.match(/^(guerreiros|arqueiros|todos|infantaria|soldados)[,:]?\s+/);
  const group: OrderTarget | undefined = vocative ? vocative[1] === 'infantaria' ? 'guerreiros' : vocative[1] === 'soldados' ? 'todos' : vocative[1] as OrderTarget : undefined;
  if (vocative) s = s.slice(vocative[0].length);
  let yes: Action, no: Action | undefined, c: Condition | undefined, once = false;
  const until = s.match(/^(.+?)\s+ate(?: que)?\s+(.+?)[,;]?\s+(?:e )?depois\s+(.+)$/);
  const prefix = s.match(/^(se|caso|quando|assim que)\s+(.+?)(?:,|\s+entao\s+)\s*(.+)$/);
  if (until) {
    no = readAction(until[1], group); c = condition(until[2]); yes = readAction(until[3], group); once = true;
  } else if (prefix) {
    c = condition(prefix[2]); once = prefix[1] === 'quando' || prefix[1] === 'assim que';
    const branches = prefix[3].split(/\s*[,;]?\s*\bsenao\b\s*[,;]?\s*/);
    if (branches.length > 2) return bad('Use uma alternativa "senão" por plano.');
    yes = readAction(branches[0], group);
    if (branches[1] !== undefined) no = readAction(branches[1], group);
  } else {
    const suffix = s.match(/^(.+?)\s+(se|caso|quando|enquanto)\s+(.+)$/);
    if (suffix) { yes = readAction(suffix[1], group); c = condition(suffix[3]); once = suffix[2] === 'quando'; }
    else yes = readAction(s, group);
  }
  if (no?.vocative && yes.vocative && no.vocative !== yes.vocative) return bad('Use o mesmo grupo nas duas alternativas.');
  const called = yes.vocative ?? no?.vocative;
  if (called) { yes.vocative = called; if (no) no.vocative = called; }
  const label = c ? `${once ? 'Quando' : 'Se'} ${conditionName(c)}: ${actionName(yes)}${no ? `; ${once ? 'até lá' : 'senão'}: ${actionName(no)}` : '; condição falsa: aguardar sem agir'}${once ? ' (transição única)' : ''}` : actionName(yes);
  return { yes, no, condition: c, once, label };
}
export function parseShout(text: string): ParsedShout {
  if (text.length > MAX_SHOUT_LENGTH || text.trim().split(/\s+/).length > 55) return { ok: false, message: `Use até ${MAX_SHOUT_LENGTH} caracteres e 55 palavras por plano.` };
  try {
    // Semicolons separate independent groups; a semicolon before "senão" belongs to the same plan.
    const parts = clean(text).split(/;(?!\s*(?:senao\b|(?:e )?depois\b))\s*/);
    if (parts.length > 3 || parts.some(p => !p.trim())) return bad('Use de um a três planos, separados por ponto e vírgula.');
    return { ok: true, directives: parts.map(directive) };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

export function evaluateCondition(c: Condition, s: BattleState, u: Unit, commanderId: string): boolean {
  if (c.kind === 'and') return c.children.every(x => evaluateCondition(x, s, u, commanderId));
  if (c.kind === 'or') return c.children.some(x => evaluateCondition(x, s, u, commanderId));
  if (c.kind === 'not') return !evaluateCondition(c.child, s, u, commanderId);
  const leader = s.units.find(x => x.id === commanderId);
  if (c.kind === 'hp' || c.kind === 'fatigue') {
    const subject = c.leader ? leader : u;
    if (!subject) return false;
    const value = c.kind === 'hp' ? subject.hp / subject.maxHp * 100 : subject.fatigue / subject.maxFatigue * 100;
    return c.op === '<' ? value < c.value : c.op === '<=' ? value <= c.value : c.op === '>' ? value > c.value : value >= c.value;
  }
  if (c.kind === 'leader-dead') return !leader || !isAlive(leader);
  if (c.kind === 'morale') return u.morale <= 2;
  const enemies = s.units.filter(v => isAlive(v) && v.team !== u.team);
  if (c.kind === 'near') return enemies.some(v => distance(u.pos, v.pos) <= c.value);
  if (c.kind === 'engaged') return enemies.some(v => distance(u.pos, v.pos) === 1);
  const inRange = enemies.filter(v => u.weapon.kind === 'ranged' ? hasShot(s, u, v) : distance(u.pos, v.pos) === 1);
  return c.kind === 'range' ? inRange.length > 0 : inRange.some(v => strayCandidates(s, u, v).length > 0);
}

interface CheckedPlan { directive: Directive; check: OrderCheck; signature: string }
export function checkShout(s: BattleState, leader: Unit, text: string, picked: OrderTarget):
  { ok: true; plans: CheckedPlan[]; check: OrderCheck; label: string } | { ok: false; message: string } {
  const parsed = parseShout(text);
  if (!parsed.ok) return parsed;
  const plans: CheckedPlan[] = [], occupied = new Set<string>();
  for (const d of parsed.directives) {
    const group = resolveGroup(d.yes, picked);
    if ('error' in group) return { ok: false, message: group.error };
    // Both branches must have the same recipients, including implicit archer-only actions.
    const actions = [d.yes, ...(d.no ? [d.no] : [])];
    const restrictions = actions.map(a => orderInfo(a.id).targets).filter(ts => !ts.includes('todos'));
    let target = group.target;
    if (target === 'todos' && restrictions.length) target = restrictions[0][0];
    if (actions.some(a => !orderInfo(a.id).targets.includes(target))) return { ok: false, message: 'As ações do plano não são compatíveis com o grupo escolhido.' };
    const signature = JSON.stringify({ d, target, commanderId: leader.id });
    // A conditional plan replaces a standing order even when its first action is the same.
    const checks = actions.map(a => checkOrder(s, { ...leader, pl: Infinity }, a.id, target, a.focus));
    for (const check of checks) if (!check.allowed && !check.reason.includes('já cumprem')) return { ok: false, message: check.reason };
    const first = checks[0];
    const changing = d.condition ? first.troops.filter(u => u.tactic?.signature !== signature) : first.changing;
    if (!changing.length) return { ok: false, message: 'As tropas no alcance já cumprem esse plano.' };
    if (first.troops.some(u => occupied.has(u.id))) return { ok: false, message: 'Dois planos chamam as mesmas tropas. Separe guerreiros e arqueiros ou use "senão".' };
    first.troops.forEach(u => occupied.add(u.id));
    const sudden = changing.filter(u => {
      const previous = u.order ?? u.tactic;
      return previous && s.round < previous.settledRound && (d.condition || u.order?.id !== d.yes.id);
    });
    plans.push({ directive: d, signature, check: { ...first, allowed: true, reason: '', changing, sudden, cost: Math.max(...checks.map(c => c.cost)) } });
  }
  const cost = plans.reduce((n, p) => n + p.check.cost, 0);
  if (cost > leader.pl) return { ok: false, message: `Pontos de liderança insuficientes: o plano custa ${cost} e restam ${leader.pl}.` };
  const check: OrderCheck = { allowed: true, reason: '', target: picked, cost,
    troops: plans.flatMap(p => p.check.troops), changing: plans.flatMap(p => p.check.changing), sudden: plans.flatMap(p => p.check.sudden) };
  return { ok: true, plans, check, label: plans.map(p => `${p.check.target}: ${p.directive.label}`).join(' | ') };
}
export function shoutOrder(s: BattleState, text: string, picked: OrderTarget): ActionResult {
  const leader = getActive(s);
  if (!leader) return { ok: false, message: 'Não há um turno ativo.', events: [] };
  const checked = checkShout(s, leader, text, picked);
  if (!checked.ok) return { ok: false, message: `${checked.message} Nenhum PL gasto.`, events: [] };
  const events: ActionResult['events'] = [];
  for (const { directive: d, check, signature } of checked.plans) {
    if (!d.condition) { events.push(...issueOrder(s, d.yes.id, check.target, { focus: d.yes.focus, words: text.trim() }).events); continue; }
    leader.pl -= check.cost;
    for (const u of check.changing) {
      const chain = check.sudden.includes(u) ? (u.order?.chain ?? u.tactic?.chain ?? 0) + 1 : 0;
      if (chain) u.stress = { level: Math.min(STRESS.max, chain), round: s.activatedRound[u.id] === s.round ? s.round + 1 : s.round };
      u.tactic = { ...structuredClone(d), signature, commanderId: leader.id, potency: leader.potency, waiting: true, givenRound: s.round, settledRound: s.round + 1 + ORDER_SETTLE_ROUNDS, chain };
      delete u.order;
    }
    for (const p of commandedPlatoons(s, leader)) for (const div of ['guerreiros', 'arqueiros'] as const) {
      if (check.changing.some(u => u.platoonId === p.id && divisionOf(u) === div)) delete p.lastOrder[div];
    }
    const message = `${leader.name}: "${text}" (${check.changing.length} tropas receberam um plano; ${check.cost} PL).`;
    events.push({ type: 'order', unitId: leader.id, order: d.yes.id, words: text, message });
    s.log.push(message);
    if (s.log.length > 100) s.log.splice(0, s.log.length - 100);
  }
  return { ok: true, message: events.length === 1 ? events[0].message ?? checked.label : checked.label, events };
}
/** Evaluate once per activation round, never once per animation/AI step. No extra PL or stress on planned transitions. */
export function updateTactic(s: BattleState, u: Unit): boolean {
  const p = u.tactic;
  if (!p || u.morale === 0) return false;
  if (p.evaluatedRound !== s.round) {
    p.evaluatedRound = s.round;
    const matched = Boolean(p.latched || (p.condition && evaluateCondition(p.condition, s, u, p.commanderId)));
    if (matched && p.once) p.latched = true;
    const action = matched ? p.yes : p.no;
    p.waiting = !action;
    if (!action) delete u.order;
    else if (u.order?.id !== action.id || u.order.focus !== action.focus) {
      u.order = { id: action.id, focus: action.focus, givenRound: s.round, settledRound: s.round + 1 + ORDER_SETTLE_ROUNDS,
        potency: p.potency, chain: p.chain, strikeUsed: false };
    }
  }
  return Boolean(p.waiting);
}
