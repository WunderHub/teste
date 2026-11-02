/**
 * Shouted orders: the player types what the leader yells and this reader turns it into one of the orders in
 * ORDERS. It is the game's own reader, with no outside service: a word list with synonyms, accents ignored,
 * small typos forgiven and a few rules to tell orders apart. When the shout is unclear, too long or asks for
 * two things at once, the troops do not understand it and no PL is spent.
 */
import {
  issueOrder, orderInfo, ORDERS, TARGET_LABELS,
  type ActionResult, type BattleState, type OrderFocus, type OrderId, type OrderTarget,
} from './game';

/** Longest shout the troops follow, in words, not counting the group named at the start. */
export const MAX_SHOUT_WORDS = 12;
/** Longest text the order box takes. */
export const MAX_SHOUT_LENGTH = 90;

type Concept =
  | 'avancar' | 'rapido' | 'devagar' | 'atacar' | 'bater' | 'cima' | 'focar'
  | 'linha' | 'formar' | 'defender' | 'escudo' | 'levantar' | 'cobrir'
  | 'disparar' | 'fogo' | 'preparar' | 'cessar'
  | 'manter' | 'posicao' | 'parar' | 'alto' | 'segurar'
  | 'recuar' | 'tras' | 'flanco' | 'proteger' | 'reagrupar' | 'comigo'
  | 'elevado' | 'subir' | 'procurar' | 'terreno'
  | 'lider' | 'feridos' | 'arqueiros' | 'guerreiros' | 'todos'
  | 'nao' | 'condicao';

/**
 * Words the troops know, written as players type them; accents and case do not matter. A trailing "*" marks
 * a stem: any word that starts with it counts, to catch the many verb forms of Portuguese.
 */
const LEXICON: Record<Concept, string[]> = {
  avancar: ['avançar', 'avancem', 'avance', 'avança', 'avançai', 'avançando', 'avanço', 'avançem', 'avanc*', 'avante', 'frente',
    'adiante', 'marchar', 'marchem', 'marcha', 'march*', 'sigam', 'seguir', 'andem', 'andar', 'anda', 'movam', 'mover', 'movam',
    'mexam', 'mexer', 'mexe', 'aproximem', 'aproximar', 'aproxim*', 'cheguem', 'progridam', 'progred*', 'prossigam'],
  rapido: ['rápido', 'rápida', 'rápidos', 'rapidamente', 'rapid*', 'depressa', 'correndo', 'corram', 'correr', 'corre', 'corra',
    'galope', 'pressa', 'ligeiro', 'ligeiros', 'acelerem', 'acelerar', 'aceler*', 'velocidade', 'voando', 'disparada'],
  devagar: ['devagar', 'devagarinho', 'lento', 'lenta', 'lentos', 'lentamente', 'cuidado', 'cuidadosamente', 'cuidad*', 'calma',
    'calmamente', 'passo', 'cautela', 'cautelosos', 'cautel*', 'pausadamente'],
  atacar: ['atacar', 'ataquem', 'ataque', 'ataca', 'atacai', 'atacando', 'ataquemos', 'ataq*', 'atac*', 'carga', 'investir',
    'invistam', 'investida', 'invest*', 'matem', 'matar', 'mata', 'mate', 'lutem', 'lutar', 'luta', 'golpeiem', 'golpear', 'golpe*',
    'esmaguem', 'esmagar', 'acabem', 'acabar', 'derrubem', 'derrubar', 'derrub*', 'destruam', 'destruir', 'massacrem', 'ofensiva',
    'peguem', 'pegar', 'cacem', 'caçar', 'eliminem', 'eliminar', 'avancem sobre'],
  bater: ['batam', 'bater', 'bata', 'batendo'],
  cima: ['cima'],
  focar: ['foco', 'focar', 'focem', 'foquem', 'concentrem', 'concentrar', 'priorizem', 'priorizar', 'alvo'],
  linha: ['linha', 'linhas', 'fileira', 'fileiras', 'fileir*', 'muralha', 'barreira', 'alinhem', 'alinhar', 'alinh*', 'cerrar',
    'cerrem', 'formação', 'formações'],
  formar: ['formar', 'formem', 'forma', 'formem'],
  defender: ['defender', 'defendam', 'defenda', 'defende', 'defesa', 'defensiva', 'defensivo', 'defend*', 'defens*', 'resistam',
    'resistir', 'resist*', 'aguentem', 'aguentar', 'aguenta', 'aguent*'],
  escudo: ['escudo', 'escudos', 'escud*', 'broquel', 'broquéis', 'tartaruga'],
  levantar: ['levantar', 'levantem', 'levanta', 'levant*', 'ergam', 'erguer', 'ergue'],
  cobrir: ['cubram', 'cobrir', 'cubra', 'cobertura', 'abriguem', 'abrigar', 'abrigo', 'abrig*'],
  disparar: ['disparar', 'disparem', 'dispare', 'dispara', 'disparo', 'disparos', 'disparai', 'dispar*', 'atirar', 'atirem',
    'atire', 'atira', 'atirai', 'atirando', 'atir*', 'flechas', 'flecha', 'flechada', 'flech*', 'soltem', 'soltar', 'solta',
    'tiro', 'tiros', 'salva', 'saraivada'],
  fogo: ['fogo'],
  preparar: ['preparar', 'preparem', 'prepare', 'prepara', 'preparados', 'prepar*', 'prontos', 'pronto', 'mirar', 'mirem', 'mire',
    'mira', 'mirando', 'apontar', 'apontem', 'aponte', 'aponta', 'apont*', 'retesar', 'retesem', 'estiquem', 'esticar', 'armem',
    'carreguem'],
  cessar: ['cessar', 'cessem', 'cesse', 'suspendam', 'suspender', 'interrompam', 'interromper', 'baixem', 'baixar'],
  manter: ['manter', 'mantenham', 'mantém', 'mantenha', 'mantendo', 'manten*', 'permaneçam', 'permanecer', 'perman*', 'fiquem',
    'ficar', 'fica', 'fique', 'esperem', 'esperar', 'espera', 'aguardem', 'aguardar', 'aguarda', 'aguard*', 'quietos', 'parados',
    'parado', 'firmes', 'firme', 'imóveis'],
  posicao: ['posição', 'posições', 'lugar', 'lugares', 'posto', 'postos'],
  parar: ['parem', 'parar', 'pare'],
  alto: ['alto', 'altos', 'alta', 'altas'],
  segurar: ['segurar', 'segurem', 'segura', 'segure', 'segur*', 'sustentem', 'sustentar'],
  recuar: ['recuar', 'recuem', 'recua', 'recue', 'recuai', 'recuando', 'recuo', 'recu*', 'retirada', 'retirar', 'retirem',
    'retire', 'retira', 'retir*', 'retroceder', 'retrocedam', 'retroced*', 'voltem', 'voltar', 'volta', 'afastem', 'afastar',
    'afasta', 'afast*', 'fujam', 'fugir', 'debandar', 'recolham'],
  tras: ['trás', 'atrás', 'retaguarda'],
  flanco: ['flanco', 'flancos', 'flanquear', 'flanqueiem', 'flanqueie', 'flanqueando', 'flanc*', 'flanq*', 'cercar', 'cerquem',
    'cerque', 'cerco', 'cercando', 'cerc*', 'rodear', 'rodeiem', 'rodeie', 'rodei*', 'envolver', 'envolvam', 'envolv*', 'contornar',
    'contornem', 'contorn*', 'pinça', 'laterais'],
  proteger: ['proteger', 'protejam', 'proteja', 'protege', 'protegam', 'proteção', 'proteg*', 'protej*', 'escoltem', 'escoltar',
    'escolta', 'escolt*', 'salvem', 'salvar', 'guarda'],
  reagrupar: ['reagrupar', 'reagrupem', 'reagrupa', 'reagrup*', 'agrupem', 'agrupar', 'juntem', 'juntar', 'junta', 'unam', 'unir'],
  comigo: ['comigo', 'mim', 'me'],
  elevado: ['elevado', 'elevada', 'elevados', 'elevação', 'elev*', 'colina', 'colinas', 'morro', 'morros', 'encosta', 'topo',
    'cume', 'altura', 'alturas', 'monte', 'ladeira', 'outeiro', 'cima do morro'],
  subir: ['subam', 'subir', 'sobe', 'suba', 'subindo', 'escalem', 'escalar'],
  procurar: ['procurem', 'procurar', 'procura', 'procur*', 'busquem', 'buscar', 'achem', 'achar', 'encontrem', 'encontrar',
    'tomem', 'tomar', 'ocupem', 'ocupar', 'ocup*'],
  terreno: ['terreno', 'ponto', 'área'],
  lider: ['líder', 'líderes', 'capitão', 'chefe', 'chefão', 'comandante', 'comand*', 'general', 'senhor', 'cabeça', 'rei'],
  feridos: ['feridos', 'ferido', 'ferid*', 'fracos', 'machucados', 'machuc*', 'enfraquecidos', 'sangrando', 'moribundos'],
  arqueiros: ['arqueiros', 'arqueiro', 'arquei*', 'arcos', 'arqueria', 'besteiros', 'atiradores', 'flecheiros'],
  guerreiros: ['guerreiros', 'guerreiro', 'guerreir*', 'lanceiros', 'lanceiro', 'lanças', 'escudeiros', 'escudeiro', 'infantaria',
    'espadachins', 'espadas', 'maças'],
  todos: ['todos', 'todo', 'pelotão', 'tropa', 'tropas', 'homens', 'soldados', 'companheiros', 'rapazes', 'rapaziada', 'galera',
    'pessoal', 'irmãos', 'camaradas', 'gente', 'turma'],
  nao: ['não', 'ninguém', 'nunca', 'nem', 'jamais'],
  condicao: ['quando', 'caso', 'enquanto', 'assim que', 'senão'],
};
/**
 * Words with no order in them. Listed so the typo check never mistakes them for an order word
 * ("minha" is not a misspelled "linha", "tipo" is not "tiro").
 */
const FILLER = ['o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'e', 'ou', 'pra', 'pro', 'pras', 'pros', 'para', 'por', 'pelo', 'pela', 'pelos', 'pelas', 'com', 'sem', 'ao', 'aos', 'à', 'às',
  'que', 'eles', 'elas', 'ele', 'ela', 'deles', 'delas', 'dele', 'dela', 'seu', 'sua', 'seus', 'suas', 'meu', 'minha', 'meus',
  'minhas', 'nosso', 'nossa', 'nossos', 'nossas', 'vamos', 'bora', 'agora', 'já', 'logo', 'ali', 'aqui', 'lá', 'aí', 'vocês',
  'tu', 'ei', 'ok', 'sim', 'vai', 'vão', 'só', 'mais', 'muito', 'bem', 'isso', 'esse', 'essa', 'esses', 'essas', 'este', 'esta',
  'aquele', 'aquela', 'aqueles', 'aquelas', 'naquele', 'naquela', 'naqueles', 'naquelas', 'nesse', 'nessa', 'neles', 'nelas',
  'contra', 'sobre', 'até', 'entre', 'lado', 'lados', 'esquerda', 'esquerdo', 'direita', 'direito', 'depois', 'então', 'primeiro',
  'vontade', 'sinal', 'inimigo', 'inimigos', 'bando', 'guerra', 'cara', 'mano', 'tipo', 'hein', 'porra', 'droga', 'malditos',
  'maldito', 'desgraçados', 'canalhas', 'covardes', 'saqueadores', 'perto', 'longe', 'onde', 'estão', 'está', 'estamos', 'tudo',
  'toda', 'parte', 'partes', 'nada', 'outro', 'outra', 'vez', 'hora', 'favor', 'é', 'são', 'ser', 'estar', 'tem', 'têm', 'temos', 'mesmo', 'meio'];

/** Lower case, no accents, letters only. "Avançem!!" becomes "avancem". */
export function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s,;:!?.-]/g, ' ').replace(/([a-z])\1{2,}/g, '$1');
}

interface Word { text: string; concept?: Concept; index: number; used?: boolean; negated?: boolean; vocative?: boolean }

const exact = new Map<string, Concept>();
const stems: { stem: string; concept: Concept }[] = [];
const phrases: { words: string[]; concept: Concept }[] = [];
/** Spelled-out forms used for typo matching, with the accented original for suggestions. */
const forms: { form: string; shown: string; concept: Concept }[] = [];
const filler = new Set(FILLER.map(normalize));
for (const [concept, entries] of Object.entries(LEXICON) as [Concept, string[]][]) {
  for (const entry of entries) {
    const form = normalize(entry).trim();
    if (form.endsWith('*')) stems.push({ stem: form.slice(0, -1), concept });
    else if (form.includes(' ')) phrases.push({ words: form.split(/\s+/), concept });
    else {
      if (!exact.has(form)) exact.set(form, concept);
      if (form.length >= 4) forms.push({ form, shown: entry, concept });
    }
  }
}
stems.sort((a, b) => b.stem.length - a.stem.length);

/** Edit distance with swapped neighbors counting as one typo ("dispraem" is one typo away from "disparem"). */
function typos(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, rows[i - 2][j - 2] + 1);
      rows[i][j] = value; best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
  }
  return rows[a.length][b.length];
}
/** Typos forgiven for a word of this length: none for short words, one up to 7 letters, two from 8. */
const allowedTypos = (length: number): number => length < 4 ? 0 : length < 8 ? 1 : 2;

function lookup(text: string): Concept | undefined {
  const found = exact.get(text);
  if (found) return found;
  if (filler.has(text)) return undefined;
  const stem = stems.find(s => text.startsWith(s.stem) && text.length - s.stem.length <= 6);
  if (stem) return stem.concept;
  const limit = allowedTypos(text.length);
  if (!limit) return undefined;
  let best: Concept | undefined, distance = limit + 1;
  for (const { form, concept } of forms) {
    const d = typos(text, form, Math.min(limit, distance - 1 < 0 ? 0 : distance - 1));
    if (d < distance) { distance = d; best = concept; }
  }
  return distance <= limit ? best : undefined;
}
/** The closest order word to an unknown one, to suggest when the troops did not understand. */
function closest(text: string): string | undefined {
  if (text.length < 5) return undefined;
  let best: string | undefined, distance = 3;
  for (const { form, shown } of forms) {
    const d = typos(text, form, distance - 1);
    if (d < distance) { distance = d; best = shown; }
  }
  return best;
}

const VERBS = new Set<Concept>(['avancar', 'rapido', 'atacar', 'bater', 'linha', 'formar', 'defender', 'levantar', 'cobrir',
  'disparar', 'fogo', 'preparar', 'cessar', 'manter', 'parar', 'segurar', 'recuar', 'flanco', 'proteger', 'reagrupar',
  'subir', 'procurar', 'focar', 'escudo']);
/** Negations the troops follow: "não avancem", "não ataquem", "não recuem", "não atirem". */
const NEGATABLE = new Set<Concept>(['avancar', 'rapido', 'atacar', 'bater', 'recuar', 'disparar', 'fogo']);
const GROUPS: Partial<Record<Concept, OrderTarget>> = { arqueiros: 'arqueiros', guerreiros: 'guerreiros', todos: 'todos' };
/** Words before a noun that make it the object of the order ("ataquem OS arqueiros") rather than who is called. */
const ARTICLES = new Set(['o', 'a', 'os', 'as', 'no', 'na', 'nos', 'nas', 'ao', 'aos', 'pelo', 'pela', 'pelos', 'pelas', 'contra',
  'com', 'de', 'do', 'da', 'dos', 'das', 'em', 'seu', 'sua', 'seus', 'suas']);

function tokenize(text: string): { words: Word[]; raw: string[] } {
  // Pronouns hooked to verbs: "afastem-se" is just "afastem"; "protejam-me" and "sigam-nos" point at the leader.
  const cleaned = normalize(text).replace(/-(me|nos)\b/g, ' mim').replace(/-(se|lo|la|los|las|o|a|os|as)\b/g, '');
  const raw = cleaned.split(/[\s,;:!?.-]+/).filter(Boolean);
  const words: Word[] = raw.map((text, index) => ({ text, index, concept: lookup(text) }));
  // Two-word expressions, like "assim que".
  for (const { words: phrase, concept } of phrases) {
    for (let i = 0; i + phrase.length <= words.length; i++) {
      if (phrase.every((p, k) => words[i + k].text === p)) {
        words[i].concept = concept;
        for (let k = 1; k < phrase.length; k++) words[i + k].concept = undefined, words[i + k].used = true;
      }
    }
  }
  return { words, raw };
}

export type ShoutProblem = 'vazia' | 'desconhecida' | 'confusa' | 'condicao' | 'longa' | 'objeto';
export type ParsedOrder =
  | { ok: true; id: OrderId; focus?: OrderFocus; vocative?: OrderTarget }
  | { ok: false; problem: ShoutProblem; message: string; suggestion?: string };

const fail = (problem: ShoutProblem, message: string, suggestion?: string): ParsedOrder =>
  ({ ok: false, problem, message, ...(suggestion ? { suggestion } : {}) });

/**
 * Reads a shout and says which order it is. Pure: it does not look at the battle, only at the words.
 * The group the player picked is checked later, by resolveGroup and the engine.
 */
export function parseOrder(text: string): ParsedOrder {
  const { words } = tokenize(text);
  if (!words.length) return fail('vazia', 'Escreva a ordem que o líder vai gritar.');

  // "Arqueiros, ..." at the start names who is called. The same word after an article is a target instead.
  let vocative: OrderTarget | undefined;
  for (const word of words) {
    if (word.concept && VERBS.has(word.concept)) break;
    const group = word.concept && GROUPS[word.concept];
    const before = words[word.index - 1];
    if (group && (!before || !ARTICLES.has(before.text))) {
      word.vocative = true; word.used = true;
      // "Arqueiros, todos..." keeps the most specific group; "arqueiros e guerreiros" calls everyone.
      vocative = !vocative || vocative === 'todos' ? group : group === 'todos' || group === vocative ? vocative : 'todos';
    }
  }
  const meaningful = words.filter(w => !w.vocative);
  if (meaningful.length > MAX_SHOUT_WORDS)
    return fail('longa', `Ordem longa demais para gritar no meio da batalha. Use até ${MAX_SHOUT_WORDS} palavras.`);

  // "Não avancem", "não se movam": a "não" up to two words before a verb negates it.
  for (const word of words) {
    if (word.concept !== 'nao') continue;
    word.used = true;
    const next = words.slice(word.index + 1, word.index + 3).find(w => w.concept && VERBS.has(w.concept));
    if (next) next.negated = true;
  }
  // "se" next to a verb is a pronoun ("movam se", "não se mexam"); at the start of a clause it is an "if".
  const isVerb = (w?: Word) => Boolean(w?.concept && VERBS.has(w.concept));
  for (const word of words) {
    if (word.text !== 'se') continue;
    const before = words[word.index - 1], after = words[word.index + 1];
    const pronoun = before && !before.vocative && (isVerb(before) || before.concept === 'nao' || isVerb(after));
    if (!pronoun) word.concept = 'condicao';
  }
  if (words.some(w => w.concept === 'condicao'))
    return fail('condicao', 'Ordem complicada demais: condições como "se" e "quando" se perdem no barulho da batalha. Grite o que fazer agora.');
  // Only stopping a move, a charge, a retreat or the arrows reads clearly in battle.
  if (words.some(w => w.negated && !NEGATABLE.has(w.concept!)))
    return fail('confusa', 'Ordem confusa: no meio da batalha, grite o que fazer, não o que deixar de fazer.');

  const free = (concept: Concept, negated?: boolean) => words.find(w => !w.used && w.concept === concept && (negated === undefined || Boolean(w.negated) === negated));
  const has = (...concepts: Concept[]) => concepts.some(c => free(c));
  const take = (...concepts: Concept[]) => { for (const c of concepts) for (const w of words) if (!w.used && w.concept === c) w.used = true; };
  const intents = new Set<OrderId>();
  const add = (id: OrderId, ...consumed: Concept[]) => { intents.add(id); take(...consumed); };
  const objects = () => words.filter(w => !w.used && !w.vocative && (w.concept === 'arqueiros' || w.concept === 'guerreiros' || w.concept === 'todos'));

  // Fire control comes first: "segurem o fogo" is not "segurem a posição", and "não atirem" is not "atirem".
  if (free('disparar', true) || free('fogo', true) || has('cessar') || (has('segurar', 'parar') && has('disparar', 'fogo')))
    add('cessar-fogo', 'disparar', 'fogo', 'cessar', 'segurar', 'parar', 'arqueiros');
  // Shields: "escudos!", "escudos ao alto", "preparem os escudos", "parede de escudos".
  if (has('escudo')) add('levantar-escudos', 'escudo', 'levantar', 'alto', 'cima', 'linha', 'formar', 'cobrir', 'proteger', 'segurar', 'manter', 'preparar');
  if (free('preparar', false)) add('arqueiros-preparar', 'preparar', 'disparar', 'fogo', 'focar');
  // High ground: "terreno elevado", "subam a colina", "para o alto" with a place to go.
  if (has('elevado', 'subir') || (has('alto') && has('procurar', 'terreno', 'posicao')))
    add('terreno-elevado', 'elevado', 'subir', 'alto', 'procurar', 'terreno', 'posicao', 'cima', 'avancar');
  // Protect the leader: "protejam o líder", "defendam-me", "fiquem comigo", "reagrupem", "recuem até mim".
  if (has('proteger', 'defender', 'cobrir', 'segurar', 'recuar', 'manter', 'tras') && has('lider', 'comigo'))
    add('proteger-lider', 'proteger', 'defender', 'cobrir', 'segurar', 'recuar', 'tras', 'lider', 'comigo', 'manter', 'posicao');
  if (has('reagrupar')) add('proteger-lider', 'reagrupar', 'comigo', 'lider');
  // Taking cover: "cubram-se", "protejam-se".
  if (has('cobrir') || (has('proteger') && !objects().length)) add('levantar-escudos', 'cobrir', 'proteger', 'levantar');
  if (has('proteger')) return fail('objeto', 'Por enquanto as tropas só sabem proteger o líder. Tente "Protejam o líder!".');
  // The defensive line: "linha!", "segurem a linha", "formem linha", "defendam".
  if (has('linha') || has('defender') || has('formar')) add('linha-defensiva', 'linha', 'formar', 'defender', 'segurar', 'manter', 'posicao');
  if (free('disparar', false) || free('fogo', false)) add('arqueiros-disparem', 'disparar', 'fogo');
  if (free('recuar', true)) add('manter-posicao', 'recuar');
  if (has('recuar', 'tras')) add('recuar', 'recuar', 'tras', 'bater');
  if (has('flanco')) add('flanquear', 'flanco', 'atacar', 'bater', 'avancar', 'rapido', 'devagar');
  // Holding: "alto!", "mantenham a posição", "fiquem", "parem", "não avancem", "ninguém se mexe".
  if (has('manter', 'posicao', 'parar', 'alto', 'segurar') || free('avancar', true) || free('atacar', true) || free('rapido', true))
    add('manter-posicao', 'manter', 'posicao', 'parar', 'alto', 'segurar', 'avancar', 'atacar', 'rapido', 'devagar');
  if (free('rapido', false)) add('avanco-rapido', 'rapido', 'avancar');
  if (has('devagar') || free('avancar', false)) add('avanco-devagar', 'devagar', 'avancar', 'comigo');
  if (free('atacar', false) || has('bater')) add('atacar', 'atacar', 'bater', 'cima', 'comigo');
  // Words that only point at a target ("foco no líder!", "pra cima deles!") attack when nothing else was said.
  if (!intents.size && has('focar', 'cima')) add('atacar', 'focar', 'cima');
  if (!intents.size && has('comigo')) add('proteger-lider', 'comigo');

  // Orders that say the same thing twice fold into the more precise one.
  const fold = (keep: OrderId, ...dropped: OrderId[]) => { if (intents.has(keep)) for (const id of dropped) intents.delete(id); };
  fold('flanquear', 'atacar', 'avanco-devagar', 'avanco-rapido');
  fold('atacar', 'avanco-devagar', 'avanco-rapido');
  fold('avanco-rapido', 'avanco-devagar');
  fold('arqueiros-preparar', 'arqueiros-disparem', 'atacar');
  fold('arqueiros-disparem', 'atacar');
  fold('levantar-escudos', 'linha-defensiva', 'manter-posicao');
  fold('linha-defensiva', 'manter-posicao');
  fold('manter-posicao', 'arqueiros-disparem');
  fold('proteger-lider', 'recuar', 'manter-posicao');
  fold('cessar-fogo', 'manter-posicao');

  if (!intents.size) {
    const unknown = words.find(w => !w.concept && !w.vocative && !filler.has(w.text) && closest(w.text));
    const hint = unknown ? closest(unknown.text) : undefined;
    return fail('desconhecida', hint ? `As tropas não entenderam a ordem. Você quis dizer "${hint}"?`
      : 'As tropas não entenderam a ordem. Tente algo como "Avancem devagar!", "Escudos!" ou "Ataquem o líder!".', hint);
  }
  if (intents.size > 1) {
    const names = [...intents].map(id => `"${orderInfo(id).label}"`);
    return fail('confusa', `Ordem confusa: as tropas ouviram ${names.slice(0, -1).join(', ')} e ${names.at(-1)}. Dê uma ordem por vez.`);
  }
  const id = [...intents][0];
  // What is left after the verb tells who to strike first: "ataquem o líder", "mirem nos arqueiros", "acabem com os feridos".
  let focus: OrderFocus | undefined;
  if (orderInfo(id).focus) {
    const target = words.find(w => !w.vocative && (w.concept === 'lider' || w.concept === 'feridos' || w.concept === 'arqueiros'));
    focus = target?.concept === 'lider' ? 'lider' : target?.concept === 'feridos' ? 'feridos' : target?.concept === 'arqueiros' ? 'arqueiros' : undefined;
  }
  return { ok: true, id, ...(focus ? { focus } : {}), ...(vocative ? { vocative } : {}) };
}

/**
 * Who hears the order: the group picked before typing, narrowed by the name shouted ("Arqueiros, ..." with
 * "todos" picked goes to the archers). Naming the other division is a mistake the troops point out.
 */
export function resolveGroup(parsed: Extract<ParsedOrder, { ok: true }>, picked: OrderTarget): { target: OrderTarget } | { error: string } {
  const called = parsed.vocative;
  if (called && called !== 'todos' && picked !== 'todos' && called !== picked)
    return { error: `A ordem chama os ${TARGET_LABELS[called]}, mas você escolheu os ${TARGET_LABELS[picked]}.` };
  return { target: called && called !== 'todos' && picked === 'todos' ? called : picked };
}

const FOCUS_LABELS: Record<OrderFocus, string> = { lider: 'no líder', arqueiros: 'nos arqueiros', feridos: 'nos feridos' };
export const focusLabel = (focus: OrderFocus): string => FOCUS_LABELS[focus];

/**
 * The active leader shouts the text to the picked group. If the troops do not understand it, or the order
 * cannot be given, nothing changes and the PL stays with the leader.
 */
export function shoutOrder(s: BattleState, text: string, picked: OrderTarget): ActionResult {
  const parsed = parseOrder(text);
  if (!parsed.ok) return { ok: false, message: parsed.problem === 'vazia' ? parsed.message : `${parsed.message} PL devolvido.`, events: [] };
  const group = resolveGroup(parsed, picked);
  if ('error' in group) return { ok: false, message: `${group.error} PL devolvido.`, events: [] };
  const result = issueOrder(s, parsed.id, group.target, { focus: parsed.focus, words: text.trim().slice(0, MAX_SHOUT_LENGTH) });
  if (result.ok || /Pontos de liderança/.test(result.message)) return result;
  return { ...result, message: `${result.message} PL devolvido.` };
}

/** One sample shout per order, for the help and the hint under the order box. */
export const SHOUT_EXAMPLES: readonly { id: OrderId; examples: string[] }[] = ORDERS.map(o => ({ id: o.id, examples: o.examples }));
