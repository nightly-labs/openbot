import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AskSideQuestionInput } from "@openbot/contracts/ipc";
import * as Crypto from "expo-crypto";
import { create } from "zustand";

export interface SideQuestionExchange {
  id: string;
  question: string;
  askedAt: string;
  answer: string | null;
  answeredAt: string | null;
}

export interface SideQuestion {
  serverId: string;
  agentId: string;
  draft: string;
  exchanges: readonly SideQuestionExchange[];
  error: string | null;
  failures: number;
}

const useSideQuestions = create<{ questions: Readonly<Record<string, SideQuestion>> }>(() => ({ questions: {} }));

function sideQuestionKey(serverId: string, agentId: string): string {
  return `${serverId}\n${agentId}`;
}

function write(serverId: string, agentId: string, change: (current: SideQuestion) => SideQuestion | null): void {
  const key = sideQuestionKey(serverId, agentId);
  useSideQuestions.setState(({ questions }) => {
    const current = questions[key] ?? { serverId, agentId, draft: "", exchanges: [], error: null, failures: 0 };
    const next = change(current);
    const { [key]: _previous, ...rest } = questions;
    const empty = next === null || (next.exchanges.length === 0 && !next.draft && next.error === null);
    return { questions: empty ? rest : { ...rest, [key]: next } };
  });
}

export function useSideQuestion(serverId: string, agentId: string): SideQuestion | undefined {
  return useSideQuestions((state) => state.questions[sideQuestionKey(serverId, agentId)]);
}

export function setSideQuestionDraft(serverId: string, agentId: string, draft: string): void {
  write(serverId, agentId, (current) => (current.draft === draft ? current : { ...current, draft }));
}

export function askSideQuestion(
  serverId: string,
  agentId: string,
  question: string,
  ask: (input: AskSideQuestionInput) => Promise<string>,
  failureText: (error: unknown) => string,
): void {
  const state = useSideQuestions.getState().questions[sideQuestionKey(serverId, agentId)];
  const exchanges = state?.exchanges ?? [];
  if (exchanges.at(-1)?.answer === null) return;
  const earlier = exchanges.slice(-INPUT_LIMITS.sideQuestionTurns).flatMap((exchange) =>
    exchange.answer === null
      ? []
      : [
          {
            question: exchange.question.slice(0, INPUT_LIMITS.sideQuestionEarlierText),
            answer: exchange.answer.slice(0, INPUT_LIMITS.sideQuestionEarlierText),
          },
        ],
  );
  const id = Crypto.randomUUID();
  write(serverId, agentId, (current) => ({
    ...current,
    draft: "",
    error: null,
    exchanges: [
      ...current.exchanges,
      { id, question, askedAt: new Date().toISOString(), answer: null, answeredAt: null },
    ],
  }));
  const settle = (change: (current: SideQuestion) => SideQuestion) =>
    write(serverId, agentId, (current) =>
      current.exchanges.some((exchange) => exchange.id === id) ? change(current) : current,
    );
  ask({ agentId, question, earlier }).then(
    (answer) =>
      settle((current) => ({
        ...current,
        exchanges: current.exchanges.map((exchange) =>
          exchange.id === id ? { ...exchange, answer, answeredAt: new Date().toISOString() } : exchange,
        ),
      })),
    (error: unknown) =>
      settle((current) => ({
        ...current,
        exchanges: current.exchanges.filter((exchange) => exchange.id !== id),
        error: failureText(error),
        failures: current.failures + 1,
        draft: current.draft.trim() ? `${question}\n${current.draft.trim()}` : question,
      })),
  );
}

export function deleteSideQuestion(serverId: string, agentId: string): void {
  write(serverId, agentId, () => null);
}

export function deleteServerSideQuestions(serverIds: ReadonlySet<string>): void {
  useSideQuestions.setState(({ questions }) => {
    const kept = Object.entries(questions).filter(([, question]) => !serverIds.has(question.serverId));
    return kept.length === Object.keys(questions).length ? {} : { questions: Object.fromEntries(kept) };
  });
}

export function deleteSideQuestions(): void {
  useSideQuestions.setState({ questions: {} });
}
