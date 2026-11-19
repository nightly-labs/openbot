import type { ConversationPlan, ConversationPlanStep } from "@openbot/contracts/ipc";
import {
  compactionContinuationPrompt,
  nextStepContinuationPrompt,
  planContinuationPrompt,
  providerExitContinuationPrompt,
} from "./delivery-content";

export interface PlanContinuationOptions {
  limit: number;
}

type ContinuationKind = "plan" | "nextStep" | "compaction" | "providerExit";

const STOPPED = { kind: "stopped" } as const;

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
  }): ({ kind: ContinuationKind } & ContinuationCount) | typeof STOPPED | null {
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
    if (count >= this.#limit) return chained && open.length > 0 ? STOPPED : null;
    const nextSteps = chained ? previous.nextSteps : 0;
    let kind: ContinuationKind;
    if (open.length > 0) {
      const signature = JSON.stringify(open.map(stepKey));
      if (chained && previous.kind !== "nextStep" && previous.openSteps === signature) return STOPPED;
      kind = "plan";
    } else if (nextSteps < NEXT_STEP_LIMIT && stoppedBeforeNextStep(input.answer)) kind = "nextStep";
    else return null;
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
      failureContinued: chained ? previous.failureContinued : false,
      plan,
      openSteps: JSON.stringify(open.map(stepKey)),
      earlierSteps,
    });
    return { kind, ...shown };
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
