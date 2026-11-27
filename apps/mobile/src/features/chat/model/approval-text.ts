import type { PendingApproval } from "@/features/workspace/model/pending-approvals";
import type { MobileText } from "@/shared/lib/text";

const SHELL_WRAPPER = /^(?:\/(?:usr\/)?bin\/)?(?:ba|z)?sh -l?c (?:'([^']*)'|"([^"\\$`]*)")$/su;
const HOME_FOLDER = /^(?:\/Users|\/home)\/[^/]+(?=\/|$)/u;

export function approvalTitle(approval: PendingApproval, t: MobileText["t"]): string {
  if (approval.kind === "command") return t("mobile.chat.approval.title.command");
  if (approval.kind === "file-change") return t("mobile.chat.approval.title.fileChange");
  return t("mobile.chat.approval.title.permissions");
}

export function approvalCommandText(command: string) {
  const match = SHELL_WRAPPER.exec(command);
  return match?.[1] ?? match?.[2] ?? command;
}

export function shortPath(path: string) {
  return path.replace(HOME_FOLDER, "~");
}
