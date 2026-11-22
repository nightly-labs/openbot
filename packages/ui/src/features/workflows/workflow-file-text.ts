import type { WorkflowFileExportProblem, WorkflowFileImportProblem } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";

const LISTED_FIELDS = 6;

export function workflowExportProblemText(t: AppTranslate, problem: WorkflowFileExportProblem): string {
  if (problem.kind === "secret") {
    const listed = problem.fields
      .slice(0, LISTED_FIELDS)
      .map((field) => t("workflow.file.export.field", { step: field.step, field: field.field }));
    const more = problem.fields.length - listed.length;
    if (more > 0) listed.push(t("workflow.canvas.status.more", { count: more }));
    return t("workflow.file.export.secret", { fields: listed.join(", ") });
  }
  if (problem.kind === "asset-missing") return t("workflow.file.export.assetMissing", { step: problem.step });
  if (problem.kind === "asset-too-large") return t("workflow.file.export.assetTooLarge", { step: problem.step });
  return t("workflow.file.export.tooLarge");
}

export function workflowImportProblemText(t: AppTranslate, problem: WorkflowFileImportProblem): string {
  if (problem.kind === "not-file") return t("workflow.file.import.notFile");
  if (problem.kind === "invalid") return t("workflow.file.import.invalid");
  return problem.minAppVersion
    ? t("workflow.file.import.newer", { version: problem.minAppVersion })
    : t("workflow.file.import.newerUnknown");
}
