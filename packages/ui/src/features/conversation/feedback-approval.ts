import type { AgentApproval } from "@openbot/contracts/ipc";
import { sourceText as englishSourceText } from "@openbot/i18n/source";

/** A bug report or an idea from `openbot.send_feedback`. */
export interface FeedbackApproval {
  kind: "bug" | "idea";
  title: string;
  text: string;
}

/**
 * The feedback that an approval sends, or null for any other approval. Its fixed notice marks it on
 * every client: the notice is a source text, and the Team API carries it unchanged. A client that does
 * not know it shows the notice. The first paragraph is the title.
 */
export function feedbackApproval(approval: AgentApproval): FeedbackApproval | null {
  if (approval.kind !== "permissions" || approval.permissions !== null || !approval.command) return null;
  const kind =
    approval.reason === englishSourceText("status.agent.reportProblem")
      ? "bug"
      : approval.reason === englishSourceText("status.agent.sendIdea")
        ? "idea"
        : null;
  if (!kind) return null;
  const [title = "", ...text] = approval.command.split("\n\n");
  return { kind, title, text: text.join("\n\n") };
}
