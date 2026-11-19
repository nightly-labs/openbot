import type { AgentApproval } from "@openbot/contracts/ipc";
import { sourceText as englishSourceText } from "@openbot/i18n/source";

export interface FeedbackApproval {
  kind: "bug" | "idea";
  title: string;
  text: string;
  phone: boolean;
}

export function feedbackApproval(approval: AgentApproval): FeedbackApproval | null {
  if (approval.kind !== "permissions" || approval.permissions !== null || !approval.command) return null;
  const phone = approval.reason === englishSourceText("status.agent.reportPhoneProblem");
  const kind =
    phone || approval.reason === englishSourceText("status.agent.reportProblem")
      ? "bug"
      : approval.reason === englishSourceText("status.agent.sendIdea")
        ? "idea"
        : null;
  if (!kind) return null;
  const [title = "", ...text] = approval.command.split("\n\n");
  return { kind, title, text: text.join("\n\n"), phone };
}
