import type { BrowserControlAction, BrowserControlDetailAction, BrowserControlSession } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";

export const BROWSER_ACTION_LABELS = {
  open: "browser.action.open",
  "list-tabs": "browser.action.listTabs",
  snapshot: "browser.action.snapshot",
  click: "browser.action.click",
  type: "browser.action.type",
  key: "browser.action.key",
  scroll: "browser.action.scroll",
  back: "browser.action.back",
  forward: "browser.action.forward",
  reload: "browser.action.reload",
  screenshot: "browser.action.screenshot",
  status: "browser.action.status",
  navigate: "browser.action.navigate",
  press: "browser.action.key",
  hover: "browser.action.hover",
  "select-option": "browser.action.selectOption",
  "set-checked": "browser.action.setChecked",
  drag: "browser.action.drag",
  "upload-files": "browser.action.uploadFiles",
  "wait-for": "browser.action.waitFor",
  evaluate: "browser.action.evaluate",
  "set-environment": "browser.action.setEnvironment",
  "recording-start": "browser.action.recordingStart",
  "recording-stop": "browser.action.recordingStop",
  "close-tab": "browser.action.closeTab",
} as const satisfies Record<BrowserControlAction | BrowserControlDetailAction, AppTextKey>;

/** The text key of the step that a browser control session does now. */
export function browserActionLabel(session: Pick<BrowserControlSession, "action" | "detailAction">): AppTextKey {
  return BROWSER_ACTION_LABELS[session.detailAction ?? session.action];
}
