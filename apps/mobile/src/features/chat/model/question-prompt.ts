import type { AgentPromptQuestion, AgentPromptResolution } from "@openbot/contracts/ipc";
import type { MobileTranslate } from "@openbot/i18n/mobile";

export function nextUnansweredQuestion(
  questions: AgentPromptQuestion[],
  answers: Record<string, string[]>,
  currentIndex: number,
): number | null {
  for (let step = 1; step <= questions.length; step += 1) {
    const index = (currentIndex + step) % questions.length;
    const question = questions[index];
    if (question && !Object.hasOwn(answers, question.id)) return index;
  }
  return null;
}

export function answeredPromptResolution(
  questions: AgentPromptQuestion[],
  answers: Record<string, string[]>,
): AgentPromptResolution {
  if (Object.keys(answers).length === 0) return { status: "cancelled" };
  return {
    status: "answered",
    responses: Object.fromEntries(
      questions.map((question) => {
        const values = answers[question.id] ?? [];
        if (!values.length) return [question.id, { status: "skipped" }];
        return [question.id, question.isSecret ? { status: "answered" } : { status: "answered", answers: values }];
      }),
    ),
  };
}

export function promptAnswerLabel(
  question: AgentPromptQuestion,
  resolution: AgentPromptResolution,
  t: MobileTranslate,
): string {
  if (resolution.status !== "answered")
    return resolution.status === "cancelled"
      ? t("mobile.chat.question.answerCancelled")
      : t("mobile.chat.question.answerExpired");
  const response = resolution.responses[question.id];
  if (!response || response.status === "skipped") return t("mobile.chat.question.answerSkipped");
  if (question.isSecret || !response.answers) return t("mobile.chat.question.privateAnswer");
  return response.answers.join(", ") || t("mobile.chat.question.answerSkipped");
}
