import type { AgentApproval } from "@openbot/contracts/ipc";
import { sourceText as englishSourceText } from "@openbot/i18n/source";

/** A bug report or an idea from `openbot.send_feedback`. */
export interface FeedbackApproval {
  kind: "bug" | "idea";
  title: string;
  text: string;
  /**
   * A bug in the phone app. Only the phone app sends it, with `phone-feedback-v1`, because the report
   * must have the phone's version, system and support log. Another client shows no Send.
   */
  phone: boolean;
}

/**
 * The feedback that an approval sends, or null for any other approval. Its fixed notice marks it on
 * every client: the notice is a source text, and the Team API carries it unchanged. A client that does
 * not know it shows the notice. The first paragraph is the title. A client that does not know the
 * notice of a report about the phone app shows a plain approval, and the host refuses its Allow.
 */
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
