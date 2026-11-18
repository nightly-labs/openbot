import type { BrowserTeachStep } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";

/** The agent reads the steps from this file. The name is fixed, as `pasted-text.txt` is. */
const TEACH_FILE_NAME = "recorded-task.txt";

/**
 * The steps of a shown task, as the file that goes with the short message. The chat thus shows one
 * line and the file, not the list.
 */
export function browserTeachFile(t: AppTranslate, steps: readonly BrowserTeachStep[]): File {
  return new File([browserTeachSteps(t, steps)], TEACH_FILE_NAME, { type: "text/plain" });
}

/**
 * The steps of a shown task as text for the agent. The steps have no typed text, so the first line
 * says to ask for those values. The request for a skill is in the message, not here.
 */
export function browserTeachSteps(t: AppTranslate, steps: readonly BrowserTeachStep[]): string {
  const lines = steps.map((step, index) => {
    const number = index + 1;
    // Code marks: the chat does not make a link, with a scheme that the step does not have, from the address.
    const page = `\`${step.host}${step.path}\``;
    if (step.kind === "page") {
      return step.title
        ? t("browser.teach.step.pageTitled", { number, page, title: step.title })
        : t("browser.teach.step.page", { number, page });
    }
    const role = step.role ?? "";
    return step.name
      ? t("browser.teach.step.click", { number, role, name: step.name })
      : t("browser.teach.step.clickUnnamed", { number, role, page });
  });
  return [t("browser.teach.steps"), ...lines].join("\n");
}
