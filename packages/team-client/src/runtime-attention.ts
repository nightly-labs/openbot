import type { AgentApproval, AgentPromptQuestion, AgentRuntimeApproval } from "@openbot/contracts/ipc";

export function reconcilePendingRequests<Item extends { requestId: string | number; agentId: string }>(
  current: readonly Item[],
  snapshotItems: readonly Item[],
  attentionComplete: boolean,
): Item[] {
  if (attentionComplete) return [...snapshotItems];
  const namedAgents = new Set(snapshotItems.map((item) => item.agentId));
  return [...current.filter((item) => !namedAgents.has(item.agentId)), ...snapshotItems];
}

export function approvalIsCut(approval: AgentApproval | AgentRuntimeApproval): approval is AgentRuntimeApproval {
  return "truncated" in approval && approval.truncated;
}

function sameRequest(left: string | number, right: string | number) {
  return String(left) === String(right);
}

function startsWith(whole: string | null, cut: string | null) {
  return whole === null ? cut === null : cut !== null && whole.startsWith(cut);
}

function isWholeCopyOf(whole: AgentApproval | AgentRuntimeApproval, cut: AgentRuntimeApproval) {
  return (
    !approvalIsCut(whole) &&
    sameRequest(whole.requestId, cut.requestId) &&
    whole.agentId === cut.agentId &&
    whole.threadId === cut.threadId &&
    whole.turnId === cut.turnId &&
    whole.kind === cut.kind &&
    startsWith(whole.command, cut.command) &&
    startsWith(whole.cwd, cut.cwd) &&
    startsWith(whole.reason, cut.reason) &&
    startsWith(whole.grantRoot, cut.grantRoot)
  );
}

export function keepWholeApprovals<Item extends AgentApproval | AgentRuntimeApproval>(
  current: readonly Item[],
  snapshotItems: readonly AgentRuntimeApproval[],
): (Item | AgentRuntimeApproval)[] {
  return snapshotItems.map((approval) =>
    approval.truncated ? (current.find((item) => isWholeCopyOf(item, approval)) ?? approval) : approval,
  );
}

interface PromptRequest {
  agentId: string;
  threadId: string;
  turnId: string;
  requestId: string | number;
  questions: readonly AgentPromptQuestion[];
}

function longerText(cut: string, whole: string | undefined) {
  return whole !== undefined && whole.length > cut.length && whole.startsWith(cut) ? whole : cut;
}

function withWholeQuestion(cut: AgentPromptQuestion, whole: AgentPromptQuestion | undefined): AgentPromptQuestion {
  if (!whole || whole.id !== cut.id) return cut;
  const header = longerText(cut.header, whole.header);
  const question = longerText(cut.question, whole.question);
  const detail = cut.detail === undefined ? undefined : longerText(cut.detail, whole.detail);
  const options =
    cut.options?.map((option, index) => {
      const wholeOption = whole.options?.[index];
      if (wholeOption?.label !== option.label) return option;
      const description = longerText(option.description, wholeOption.description);
      return description === option.description ? option : { ...option, description };
    }) ?? null;
  const unchanged =
    header === cut.header &&
    question === cut.question &&
    detail === cut.detail &&
    (options === null || options.every((option, index) => option === cut.options?.[index]));
  if (unchanged) return cut;
  return { ...cut, header, question, ...(detail === undefined ? {} : { detail }), options };
}

export function withWholePromptText<Prompt extends PromptRequest>(
  prompt: Prompt,
  wholeQuestions: readonly AgentPromptQuestion[] | undefined,
): Prompt {
  if (!wholeQuestions) return prompt;
  const questions = prompt.questions.map((question, index) => withWholeQuestion(question, wholeQuestions[index]));
  return questions.every((question, index) => question === prompt.questions[index]) ? prompt : { ...prompt, questions };
}

export function isSamePromptRequest(left: PromptRequest, right: PromptRequest): boolean {
  return (
    sameRequest(left.requestId, right.requestId) &&
    left.agentId === right.agentId &&
    left.threadId === right.threadId &&
    left.turnId === right.turnId
  );
}

export function keepWholePrompts<Item extends PromptRequest>(
  current: readonly PromptRequest[],
  snapshotItems: readonly Item[],
): Item[] {
  return snapshotItems.map((prompt) =>
    withWholePromptText(prompt, current.find((item) => isSamePromptRequest(item, prompt))?.questions),
  );
}

export function withWholeApproval<Item extends AgentApproval | AgentRuntimeApproval>(
  current: readonly Item[],
  whole: Item,
): readonly Item[] {
  const index = current.findIndex((item) => approvalIsCut(item) && isWholeCopyOf(whole, item));
  if (index === -1) return current;
  const next = [...current];
  next[index] = whole;
  return next;
}
