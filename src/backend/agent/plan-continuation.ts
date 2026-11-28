import type { ConversationPlan, ConversationPlanStep } from "@openbot/contracts/ipc";
import {
  compactionContinuationPrompt,
  finishCheckContinuationPrompt,
  nextStepContinuationPrompt,
  planContinuationPrompt,
  providerExitContinuationPrompt,
} from "./delivery-content";

export interface PlanContinuationOptions {
  limit: number;
}

type ContinuationKind = "plan" | "nextStep" | "finishCheck" | "compaction" | "providerExit";

export type FinishCheckMode = "no" | "allowed" | "only";

export interface FinishCheckPending {
  kind: "check";
  continuations: number;
  earlierGaps: readonly string[];
}

const STOPPED = { kind: "stopped" } as const;

const LIMIT_REACHED = { kind: "limitReached" } as const;

const FINISH_CHECK_LIMIT = 3;

const NEXT_STEP_LIMIT = 2;
const NEXT_STEP_ANSWER_MAX = 400;
const CONTINUE_VERB = "(?:continue|keep going|go on|carry on|move on)";
const WORK_PARTS =
  "(?:steps|work|items|parts|ones|tasks|files|tests|changes|fixes|edits|checks|pages|sections|list|plan)";
const REST_OF_WORK = String.raw`(?:\s+(?:with|to|on)\s+(?:the\s+)?(?:next(?:\s+(?:steps?|ones?|parts?|phases?|items?))?|rest(?:\s+of\s+(?:it|them|the\s+${WORK_PARTS}))?|remaining(?:\s+${WORK_PARTS})?|steps?\s+\d+))?`;
const ASKS_TO_CONTINUE = new RegExp(
  String.raw`^(?:[^?？]*[.!]\s+)?(?:(?:(?:shall|should|can|may)\s+i|(?:do\s+you\s+)?want\s+me\s+to|would\s+you\s+like\s+me\s+to|ok(?:ay)?\s+(?:if\s+i|to))\s+)?${CONTINUE_VERB}${REST_OF_WORK}\s*\?+$`,
  "i",
);
const SENTENCE_CHAR = String.raw`(?:[^.!?\n]|\.(?=\S))`;
const NOT_WAITING = String.raw`(?!${SENTENCE_CHAR}*\b(?:(?:if|when|once|after|unless|until|as\s+soon\s+as)\s+(?:you|your)|get\s+back|once\s+approved|(?:your|the\s+user['’]s)\s+(?:approval|confirmation|permission)|later|tomorrow|next\s+(?:week|month|time)|back\s+in)\b)`;
const NAMES_NEXT_STEP = new RegExp(
  String.raw`(?:\blet me now\b|\bnow let me\b|\bi['’]ll now\b|\bi will now\b|\bnow i(?:['’]ll| will)\b|\bnext,?\s+i(?:['’]ll| will)\b)(?!\s+(?:wait|hold|pause|stop)\b)${NOT_WAITING}[^.!?\n]{0,100}[.:…]?\s*$`,
  "i",
);

const WORK_VERB = String.raw`(?:run|re-?run|check|test|fix|update|edit|write|create|add|build|install|open|read|look|search|inspect|review|verify|start|try|apply|implement|rename|move|refactor|debug|finish|continue|configure|set\s+up|generate|download|compile|patch|query|consult(?!\s+with\b)|fetch|retrieve|pull)`;
const WORK_GERUND = String.raw`(?:(?:re-?)?running(?!\s+(?:late|low|out|behind|into)\b)|checking(?!\s+with\b)|testing|fixing|updating|editing|writing(?!\s+to\b)|creating|adding|building|installing|opening|reading|looking\s+(?:at|into|up|through|for(?!\s+your\b))|searching|inspecting|reviewing|verifying|trying(?!\s+(?:my|our)\b)|applying|implementing|refactoring|debugging|configuring|generating|downloading|compiling|patching|querying|consulting(?!\s+with\b)|fetching|retrieving|pulling)`;
const SENTENCE_START = String.raw`(?:^|[.!:…–—]\s+|\s-\s+|\n\s*)`;
const ANNOUNCES_WORK = new RegExp(
  String.raw`${SENTENCE_START}(?:(?:ok(?:ay)?|now|next|first|then|so)[,:]?\s+)*(?:let\s+me|i['’]ll|i\s+will|i['’]m\s+going\s+to|i\s+am\s+going\s+to)\s+(?:(?:now|first|next|then|also|quickly)\s+)?${WORK_VERB}\b(?!\s+you\b)${NOT_WAITING}${SENTENCE_CHAR}{0,120}[.:…]?\s*$`,
  "i",
);
const STATES_WORK = new RegExp(
  String.raw`${SENTENCE_START}(?:(?:ok(?:ay)?|now|so)[,:]?\s+)*(?:(?:i['’]m|i\s+am)\s+(?:now\s+)?${WORK_GERUND}\b(?!\s+you\b)${NOT_WAITING}${SENTENCE_CHAR}{0,120}[.:…]?|${WORK_GERUND}\b${NOT_WAITING}${SENTENCE_CHAR}{0,120}(?:…|\.{3}))\s*$`,
  "i",
);

const PT_WORK_VERBS = [
  "ver",
  "olhar",
  "dar uma olhada",
  "rodar",
  "executar",
  "verificar",
  "checar",
  "conferir",
  "testar",
  "corrigir",
  "consertar",
  "atualizar",
  "editar",
  "escrever",
  "criar",
  "adicionar",
  "compilar",
  "instalar",
  "abrir",
  "ler",
  "procurar",
  "buscar",
  "pesquisar",
  "inspecionar",
  "revisar",
  "analisar",
  "investigar",
  "consultar",
  "acessar",
  "baixar",
  "carregar",
  "listar",
  "obter",
  "puxar",
  "aplicar",
  "implementar",
  "renomear",
  "mover",
  "refatorar",
  "depurar",
  "validar",
  "tentar",
  "iniciar",
  "começar",
  "continuar",
  "terminar",
  "finalizar",
  "configurar",
  "gerar",
];
const ptPattern = (verbs: readonly string[]) =>
  `(?:${verbs.map((verb) => verb.replaceAll(" ", "\\s+")).join("|")})(?!\\p{L})`;
const PT_WORK_VERB = ptPattern(PT_WORK_VERBS);
const PT_WORK_GERUND = ptPattern(
  PT_WORK_VERBS.filter((verb) => verb !== "ver").map((verb) => verb.replace(/r(?=\s|$)/, "ndo")),
);
const PT_NOT_WAITING = String.raw`(?!${SENTENCE_CHAR}*(?:\b(?:se|quando|assim\s+que|depois\s+que|logo\s+que|caso)\s+(?:você|voce|vc|o\s+senhor|a\s+senhora)|\b(?:se|caso|quando)\s+(?:quiser|queira|preferir|prefira|desejar|deseje|puder|possa|achar|ache|precisar|precise)(?!\p{L})|\b(?:sua|tua)\s+(?:aprovação|aprovacao|confirmação|confirmacao|autorização|autorizacao|permissão|permissao|resposta)|\bmais\s+tarde|\bem\s+breve|\bdaqui\s+a\s+pouco|\bdepois(?=\s*[.!…]*\s*$)|\bamanh|\bpróxima\s+(?:semana|vez)|\bdepois\s+(?:te|lhe)\s+(?:aviso|falo)|\b(?:te|lhe)\s+(?:retorno|dou\s+(?:um\s+)?retorno)|\b(?:retorno|volto)\s+(?:em|mais|depois)))`;
const PT_ANNOUNCES_WORK = new RegExp(
  String.raw`${SENTENCE_START}(?:(?:ok(?:ay)?|certo|beleza|agora|então|primeiro|em\s+seguida)[,:]?\s+)*(?:(?:(?:eu\s+)?(?:vou|irei)\s+(?:agora\s+|já\s+|primeiro\s+)?|deix[ae](?:-me|\s+eu)\s+)${PT_WORK_VERB}${PT_NOT_WAITING}${SENTENCE_CHAR}{0,120}[.:…]?|(?:eu\s+)?(?:estou|tô)\s+(?:agora\s+)?${PT_WORK_GERUND}${PT_NOT_WAITING}${SENTENCE_CHAR}{0,120}[.:…]?|${PT_WORK_GERUND}${PT_NOT_WAITING}${SENTENCE_CHAR}{0,120}(?:…|\.{3}))\s*$`,
  "iu",
);

const NOTHING_FROM_USER =
  /(?:(?<=[.!…])\s+|\s*\n\s*)(?:nothing\s+(?:else\s+)?(?:(?:needed|required)\s+)?(?:from\s+you|for\s+you\s+to\s+do)|no\s+action\s+(?:needed|required)\s+from\s+you|(?:de\s+(?:você|voce|vc)|da\s+sua\s+parte)[,:]?\s+nada|nada\s+(?:de\s+(?:você|voce|vc)|da\s+sua\s+parte|para\s+(?:você|voce|vc)\s+fazer)|(?:você|voce|vc)\s+não\s+precisa\s+fazer\s+nada)[.!]?\s*$/iu;

const WAITS_FOR_USER =
  /\b(?:i['\u2019]ll|i will|i['\u2019]m going to|let me)\s+(?:now\s+)?(?:wait|hold|pause|stop)\b|\bwaiting\s+(?:for|on)\s+(?:you|your)\b/i;

function lastLine(answer: string | undefined): string {
  return (answer?.trimEnd().split("\n").at(-1) ?? "").replace(/[*_`>#]/g, "").trim();
}

function asksToContinue(answer: string | undefined): boolean {
  return ASKS_TO_CONTINUE.test(lastLine(answer));
}

export function waitsForUser(answer: string | undefined): boolean {
  const line = lastLine(answer);
  return (/[?？]/.test(line) && !ASKS_TO_CONTINUE.test(line)) || WAITS_FOR_USER.test(line);
}

function stoppedBeforeNextStep(answer: string | undefined): boolean {
  if (asksToContinue(answer)) return true;
  const text = answer?.trim() ?? "";
  if (text.length === 0 || text.length > NEXT_STEP_ANSWER_MAX) return false;
  if (NAMES_NEXT_STEP.test(text.slice(-160))) return true;
  const plain = text
    .replace(/[*_`>#]/g, "")
    .trimEnd()
    .replace(NOTHING_FROM_USER, "");
  return ANNOUNCES_WORK.test(plain) || STATES_WORK.test(plain) || PT_ANNOUNCES_WORK.test(plain);
}

const PROMISES_WORK =
  /(?:^|[^\p{L}'’])(?<!(?:^|[^\p{L}])(?:não|nao|nunca)\s+)(?:i['’]ll|i\s+will|let\s+me|i['’]m\s+going\s+to|i\s+am\s+going\s+to|(?:eu\s+)?vou|(?:eu\s+)?irei|deix[ae](?:-me|\s+eu))\s+(?!(?:not|never|know|wait|hold|pause|stop|be\s+here|aguardar|esperar|ficar\s+(?:aguardando|esperando|no\s+aguardo))(?!\p{L}))\p{L}/iu;

const UNDONE_WORK_ANSWER_MAX = 1200;
const LIST_ITEM = /^\s*(?:[-*+•]|\d+[.)])\s+/u;
const WORK_DONE_VERB =
  "(?:applied|apply|changed|change|made|make|fixed|fix|run|ran|started|start|implemented|implement|edited|edit|updated|update|written|write|created|create|sent|send|done|do|executed|execute|touched|touch|finished|finish)";
const ADMITS_WORK_NOT_DONE = new RegExp(
  String.raw`(?:^|[^\p{L}'’])(?:i\s+(?:have|had|did)\s+not|i\s+(?:haven['’]?t|hadn['’]?t|didn['’]?t))\s+(?:yet\s+|actually\s+|really\s+)?${WORK_DONE_VERB}(?!\p{L})|(?:^|[^\p{L}])(?:not|nothing)\s+(?:(?:has|have|was|were)\s+)?(?:been\s+)?(?:applied|changed|fixed|implemented|done|sent|started|edited|updated)\s+yet(?!\p{L})|(?:^|[^\p{L}])(?:ainda\s+)?(?:não|nao)\s+(?:fiz|apliquei|corrigi|executei|rodei|enviei|alterei|implementei|mudei|editei|atualizei|criei|terminei|comecei)(?!\p{L})|(?:^|[^\p{L}])ainda\s+(?:não|nao)\s+(?:foi|foram|está|esta|estão|estao)\s+(?:feit|aplicad|corrigid|enviad|alterad|implementad)`,
  "iu",
);

const TALKS_ABOUT_WORK =
  /(?:i['’]ll|i\s+will|let\s+me|i['’]m\s+going\s+to|i\s+am\s+going\s+to)\s+(?:now\s+|first\s+|quickly\s+)?(?:explain|walk\s+you|summari[sz]e|recap|clarify|break\s+(?:it\s+|this\s+)?down|describe|outline|show\s+you|answer|be\s+(?:honest|brief|clear|direct))(?!\p{L})/iu;
const STILL_OPEN = /(?:^|[^\p{L}])(?:yet|ainda)(?!\p{L})/iu;

interface ClosingParts {
  earlier: string[];
  closing: string[];
  asksBeforeList: boolean;
}

function closingParts(plain: string): ClosingParts {
  const lines = plain.split("\n");
  const blank = (line: string | undefined) => (line ?? "").trim().length === 0;
  let end = lines.length;
  while (end > 0 && (LIST_ITEM.test(lines[end - 1] ?? "") || blank(lines[end - 1]))) end -= 1;
  let start = end;
  while (start > 0 && !blank(lines[start - 1])) start -= 1;
  const items = lines
    .slice(end)
    .filter((line) => LIST_ITEM.test(line))
    .map((line) => line.replace(LIST_ITEM, ""));
  const intro = lines[end - 1];
  const introduced =
    intro !== undefined && items[0] !== undefined ? [`${intro.replace(/:\s*$/u, "")} ${items[0]}`] : [];
  const sentences = lines
    .slice(start, end)
    .join("\n")
    .split(/(?<=[.!…])\s+|\n+/u)
    .filter((sentence) => !blank(sentence));
  return {
    earlier: sentences.slice(0, -1),
    closing: [...sentences.slice(-1), ...items, ...introduced],
    asksBeforeList: items.length > 0 && /[?？]/u.test(intro ?? ""),
  };
}

export function leavesWorkUndone(answer: string | undefined): boolean {
  const text = answer?.trim() ?? "";
  if (text.length === 0 || text.length > UNDONE_WORK_ANSWER_MAX || waitsForUser(answer)) return false;
  const plain = text
    .replace(/^(\s*)\*\s+/gmu, "$1- ")
    .replace(/[*_`>#]/g, "")
    .trimEnd()
    .replace(NOTHING_FROM_USER, "");
  const { earlier, closing, asksBeforeList } = closingParts(plain);
  if (asksBeforeList) return false;
  return (
    closing.some((sentence) => PROMISES_WORK.test(sentence) || ADMITS_WORK_NOT_DONE.test(sentence)) ||
    earlier.some(
      (sentence) =>
        (PROMISES_WORK.test(sentence) && !TALKS_ABOUT_WORK.test(sentence)) ||
        (ADMITS_WORK_NOT_DONE.test(sentence) && STILL_OPEN.test(sentence)),
    )
  );
}

interface ContinuationCount {
  current: number;
  limit: number;
}

interface Chain {
  deliveryIds: ReadonlySet<string>;
  count: number;
  kind: ContinuationKind;
  shown: ContinuationCount;
  nextSteps: number;
  checks: number;
  gap: string | null;
  earlierGaps: readonly string[];
  final?: true;
  failureContinued: boolean;
  plan: ConversationPlan | null;
  openSteps: string;
  earlierSteps: ReadonlySet<string>;
}

function laneKey(agentId: string, taskId: string | null): string {
  return taskId === null ? agentId : `${agentId}\u0000${taskId}`;
}

const stepKey = (step: ConversationPlanStep) => JSON.stringify([step.text, step.status]);

function openSteps(plan: ConversationPlan, earlierSteps: ReadonlySet<string>): ConversationPlanStep[] {
  return plan.steps.filter((step) => step.status !== "completed" && !earlierSteps.has(stepKey(step)));
}

export class PlanContinuation {
  readonly #limit: number;
  readonly #chains = new Map<string, Chain>();

  constructor(options: PlanContinuationOptions) {
    this.#limit = options.limit;
  }

  get limit(): number {
    return this.#limit;
  }

  consider(input: {
    agentId: string;
    taskId: string | null;
    deliveryIds: readonly string[];
    plan: ConversationPlan | null;
    earlierPlan: ConversationPlan | null;
    answer: string | undefined;
    finishCheck?: FinishCheckMode;
    nextStep?: boolean;
  }): ({ kind: ContinuationKind } & ContinuationCount) | typeof STOPPED | FinishCheckPending | null {
    const key = laneKey(input.agentId, input.taskId);
    const previous = this.#chains.get(key);
    this.#chains.delete(key);
    const chained =
      previous !== undefined &&
      input.deliveryIds.length > 0 &&
      input.deliveryIds.some((deliveryId) => previous.deliveryIds.has(deliveryId));
    const plan = input.plan ?? (chained ? previous.plan : null);
    const earlierSteps = chained
      ? previous.earlierSteps
      : new Set(
          (input.earlierPlan?.steps ?? []).filter((step) => step.status !== "completed").map((step) => stepKey(step)),
        );
    const count = chained ? previous.count : 0;
    const open = plan ? openSteps(plan, earlierSteps) : [];
    const nextSteps = chained ? previous.nextSteps : 0;
    const checks = chained ? previous.checks : 0;
    const earlierGaps = chained ? previous.earlierGaps : [];
    const mode = input.finishCheck ?? "no";
    const checkAtLimit = (): FinishCheckPending | null => {
      if (!chained || mode === "no") return null;
      this.#chains.set(key, {
        deliveryIds: new Set(input.deliveryIds),
        count,
        kind: "finishCheck",
        shown: previous.shown,
        nextSteps,
        checks,
        gap: null,
        earlierGaps,
        final: true,
        failureContinued: previous.failureContinued,
        plan,
        openSteps: JSON.stringify(open.map(stepKey)),
        earlierSteps,
      });
      return { kind: "check", continuations: count, earlierGaps };
    };
    if (count >= this.#limit) return chained && open.length > 0 ? STOPPED : checkAtLimit();
    let kind: ContinuationKind;
    if (open.length > 0 && mode !== "only") {
      const signature = JSON.stringify(open.map(stepKey));
      if (
        chained &&
        previous.kind !== "nextStep" &&
        previous.kind !== "finishCheck" &&
        previous.openSteps === signature
      )
        return STOPPED;
      kind = "plan";
    } else if (
      mode !== "only" &&
      input.nextStep !== false &&
      nextSteps < NEXT_STEP_LIMIT &&
      stoppedBeforeNextStep(input.answer)
    )
      kind = "nextStep";
    else if (mode !== "no" && checks < FINISH_CHECK_LIMIT) {
      this.#chains.set(key, {
        deliveryIds: new Set(input.deliveryIds),
        count,
        kind: "finishCheck",
        shown: { current: checks, limit: FINISH_CHECK_LIMIT },
        nextSteps,
        checks,
        gap: null,
        earlierGaps,
        failureContinued: chained ? previous.failureContinued : false,
        plan,
        openSteps: JSON.stringify(open.map(stepKey)),
        earlierSteps,
      });
      return { kind: "check", continuations: count, earlierGaps };
    } else return checkAtLimit();
    const shown =
      kind === "plan"
        ? { current: count + 1, limit: this.#limit }
        : { current: nextSteps + 1, limit: nextSteps + Math.min(NEXT_STEP_LIMIT - nextSteps, this.#limit - count) };
    this.#chains.set(key, {
      deliveryIds: new Set(input.deliveryIds),
      count: count + 1,
      kind,
      shown,
      nextSteps: kind === "nextStep" ? nextSteps + 1 : nextSteps,
      checks,
      gap: null,
      earlierGaps,
      failureContinued: chained ? previous.failureContinued : false,
      plan,
      openSteps: JSON.stringify(open.map(stepKey)),
      earlierSteps,
    });
    return { kind, ...shown };
  }

  afterFinishCheck(
    agentId: string,
    taskId: string | null,
    gap: string,
  ): ({ kind: ContinuationKind } & ContinuationCount) | typeof LIMIT_REACHED | null {
    const key = laneKey(agentId, taskId);
    const chain = this.#chains.get(key);
    if (chain?.kind !== "finishCheck" || chain.gap !== null || chain.final) {
      this.#chains.delete(key);
      return chain?.final ? LIMIT_REACHED : null;
    }
    const shown = {
      current: chain.checks + 1,
      limit: chain.checks + Math.min(FINISH_CHECK_LIMIT - chain.checks, this.#limit - chain.count),
    };
    this.#chains.set(key, {
      ...chain,
      count: chain.count + 1,
      checks: chain.checks + 1,
      gap,
      earlierGaps: [...chain.earlierGaps, gap],
      shown,
    });
    return { kind: "finishCheck", ...shown };
  }

  waitsForCheck(agentId: string, taskId: string | null): boolean {
    const chain = this.#chains.get(laneKey(agentId, taskId));
    return chain?.kind === "finishCheck" && chain.gap === null;
  }

  afterFailedCompaction(input: {
    agentId: string;
    taskId: string | null;
    deliveryIds: readonly string[];
    plan: ConversationPlan | null;
    earlierPlan: ConversationPlan | null;
  }): ({ kind: ContinuationKind } & ContinuationCount) | null {
    return this.#afterFailure("compaction", input);
  }

  afterProviderExit(input: {
    agentId: string;
    taskId: string | null;
    deliveryIds: readonly string[];
    plan: ConversationPlan | null;
    earlierPlan: ConversationPlan | null;
  }): ({ kind: ContinuationKind } & ContinuationCount) | null {
    return this.#afterFailure("providerExit", input);
  }

  #afterFailure(
    kind: "compaction" | "providerExit",
    input: {
      agentId: string;
      taskId: string | null;
      deliveryIds: readonly string[];
      plan: ConversationPlan | null;
      earlierPlan: ConversationPlan | null;
    },
  ): ({ kind: ContinuationKind } & ContinuationCount) | null {
    const key = laneKey(input.agentId, input.taskId);
    const previous = this.#chains.get(key);
    this.#chains.delete(key);
    const chained =
      previous !== undefined && input.deliveryIds.some((deliveryId) => previous.deliveryIds.has(deliveryId));
    const count = chained ? previous.count : 0;
    if (count >= this.#limit || (chained && previous.failureContinued)) return null;
    const plan = input.plan ?? (chained ? previous.plan : null);
    const earlierSteps = chained
      ? previous.earlierSteps
      : new Set(
          (input.earlierPlan?.steps ?? []).filter((step) => step.status !== "completed").map((step) => stepKey(step)),
        );
    const shown = { current: 1, limit: 1 };
    this.#chains.set(key, {
      deliveryIds: new Set(input.deliveryIds),
      count: count + 1,
      kind,
      shown,
      nextSteps: chained ? previous.nextSteps : 0,
      checks: chained ? previous.checks : 0,
      gap: null,
      earlierGaps: chained ? previous.earlierGaps : [],
      failureContinued: true,
      plan,
      openSteps: JSON.stringify((plan ? openSteps(plan, earlierSteps) : []).map(stepKey)),
      earlierSteps,
    });
    return { kind, ...shown };
  }

  claim(agentId: string, taskId: string | null, deliveryId: string, othersQueued: boolean): string | null {
    const key = laneKey(agentId, taskId);
    const chain = this.#chains.get(key);
    if (!chain?.deliveryIds.has(deliveryId) || othersQueued) {
      this.#chains.delete(key);
      return null;
    }
    if (chain.kind === "compaction") return compactionContinuationPrompt();
    if (chain.kind === "providerExit") return providerExitContinuationPrompt();
    if (chain.kind === "finishCheck" && chain.gap !== null)
      return finishCheckContinuationPrompt(chain.gap, chain.shown.current, chain.shown.limit);
    return chain.kind === "plan" && chain.plan
      ? planContinuationPrompt(openSteps(chain.plan, chain.earlierSteps), chain.shown.current, chain.shown.limit)
      : nextStepContinuationPrompt(chain.shown.current, chain.shown.limit);
  }

  cancel(agentId: string, taskId?: string | null): void {
    if (taskId !== undefined) {
      this.#chains.delete(laneKey(agentId, taskId));
      return;
    }
    for (const key of [...this.#chains.keys()])
      if (key === agentId || key.startsWith(`${agentId}\u0000`)) this.#chains.delete(key);
  }

  dispose(): void {
    this.#chains.clear();
  }
}
