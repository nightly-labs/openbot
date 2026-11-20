import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  SIDE_QUESTION_CAPABILITY,
  SIDE_QUESTION_THREADS_CAPABILITY,
} from "@openbot/contracts/team-protocol/side-question-v1";
import type { SideQuestionExchange } from "@openbot/ui/features/conversation/SideQuestionPanel";
import { currentText } from "@openbot/ui/text";
import type { Store, StoreSetter } from "solid-js";
import { serverSupportsCapability } from "../../servers/server-capabilities";
import { conversationPort } from "../conversation-port";
import type { ConversationProps } from "../conversation-types";

const { t, errorMessage } = currentText();

export interface SideQuestionState {
  draft: string;
  exchanges: SideQuestionExchange[];
  error: string | null;
  focusRequest: number;
}

const SIDE_QUESTION_EMPTY: SideQuestionState = { draft: "", exchanges: [], error: null, focusRequest: 0 };

export interface SideQuestionStoreDeps {
  props: ConversationProps;
  questions: Store<Record<string, SideQuestionState>>;
  setQuestions: StoreSetter<Record<string, SideQuestionState>>;
  openPane: () => void;
}

export function createSideQuestionStore(deps: SideQuestionStoreDeps) {
  const { questions, setQuestions } = deps;

  const openTaskId = () => deps.props.threads?.open?.id;
  const stateKey = (agentId: string, taskId: string | undefined) =>
    taskId === undefined ? agentId : `${agentId}/${taskId}`;
  const currentKey = () => {
    const agentId = deps.props.agent?.id;
    return agentId ? stateKey(agentId, openTaskId()) : undefined;
  };
  const threadsAvailable = () =>
    deps.props.runtime
      ? deps.props.runtime.sideQuestionThreads === true
      : serverSupportsCapability(deps.props.server, SIDE_QUESTION_THREADS_CAPABILITY);
  const sideQuestionAvailable = () =>
    (deps.props.runtime
      ? Boolean(deps.props.runtime.askSideQuestion)
      : serverSupportsCapability(deps.props.server, SIDE_QUESTION_CAPABILITY)) &&
    (openTaskId() === undefined || threadsAvailable());
  const sideQuestion = (): SideQuestionState => {
    const key = currentKey();
    return (key && questions[key]) || SIDE_QUESTION_EMPTY;
  };
  const nextFocusRequest = () => Math.max(0, ...Object.values(questions).map((state) => state.focusRequest)) + 1;
  function update(key: string, change: (state: SideQuestionState) => void) {
    setQuestions((draft) => {
      draft[key] ??= { ...SIDE_QUESTION_EMPTY, exchanges: [] };
      change(draft[key]);
    });
  }

  function setSideQuestionDraft(text: string) {
    const key = currentKey();
    if (!key) return;
    update(key, (state) => {
      state.draft = text;
    });
  }

  function openSideQuestion(text = "") {
    const key = currentKey();
    if (!key || !sideQuestionAvailable()) return;
    const question = text.trim();
    update(key, (state) => {
      if (question) state.draft = state.draft.trim() ? `${state.draft.trim()}\n${question}` : question;
      state.focusRequest = nextFocusRequest();
    });
    deps.openPane();
  }

  function askSideQuestion(question: string) {
    const agentId = deps.props.agent?.id;
    if (!agentId) return;
    const taskId = openTaskId();
    const key = stateKey(agentId, taskId);
    const state = questions[key] ?? SIDE_QUESTION_EMPTY;
    if (state.exchanges.at(-1)?.answer === null) return;
    const earlier = state.exchanges.slice(-INPUT_LIMITS.sideQuestionTurns).flatMap((exchange) =>
      exchange.answer === null
        ? []
        : [
            {
              question: exchange.question.slice(0, INPUT_LIMITS.sideQuestionEarlierText),
              answer: exchange.answer.slice(0, INPUT_LIMITS.sideQuestionEarlierText),
            },
          ],
    );
    const id = crypto.randomUUID();
    update(key, (draft) => {
      draft.exchanges.push({ id, question, askedAt: new Date().toISOString(), answer: null, answeredAt: null });
      draft.draft = "";
      draft.error = null;
    });
    const runtimeAsk = deps.props.runtime?.askSideQuestion;
    const serverId = deps.props.server?.id;
    const input = { agentId, question, earlier, ...(taskId === undefined ? {} : { taskId }) };
    const ask = runtimeAsk ? runtimeAsk(input) : conversationPort().agent.askSideQuestion(input, serverId);
    void ask.then(
      (answer) => {
        if (!questions[key]) return;
        update(key, (draft) => {
          const exchange = draft.exchanges.find((item) => item.id === id);
          if (!exchange) return;
          exchange.answer = answer;
          exchange.answeredAt = new Date().toISOString();
        });
      },
      (error) => {
        if (!questions[key]) return;
        update(key, (draft) => {
          if (!draft.exchanges.some((item) => item.id === id)) return;
          draft.exchanges = draft.exchanges.filter((item) => item.id !== id);
          draft.error = errorMessage(error, t("conversation.sideQuestion.error"));
          draft.draft = draft.draft.trim() ? `${question}\n${draft.draft.trim()}` : question;
          draft.focusRequest = nextFocusRequest();
        });
      },
    );
  }

  function deleteSideQuestion() {
    const agentId = deps.props.agent?.id;
    if (!agentId) return;
    setQuestions((draft) => {
      for (const key of Object.keys(draft)) if (key === agentId || key.startsWith(`${agentId}/`)) delete draft[key];
    });
  }

  return {
    sideQuestionAvailable,
    sideQuestion,
    setSideQuestionDraft,
    openSideQuestion,
    askSideQuestion,
    deleteSideQuestion,
  };
}
