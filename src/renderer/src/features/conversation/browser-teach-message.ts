import type { BrowserTeachStep } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";

const TEACH_FILE_NAME = "recorded-task.txt";

export function browserTeachFile(t: AppTranslate, steps: readonly BrowserTeachStep[]): File {
  return new File([browserTeachSteps(t, steps)], TEACH_FILE_NAME, { type: "text/plain" });
}

export function browserTeachSteps(t: AppTranslate, steps: readonly BrowserTeachStep[]): string {
  const lines = steps.map((step, index) => {
    const number = index + 1;
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
