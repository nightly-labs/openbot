import { lstatSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { dummyLogger, type Logger, redactText } from "@openbot/logging";
import type { Page } from "playwright-core";
import { describeTarget } from "./page-url";

const MAX_SNAPSHOT_LENGTH = 20_000;

export type AutomationRole = Parameters<Page["getByRole"]>[0];

const AUTOMATION_ROLES: readonly AutomationRole[] = [
  "alert",
  "alertdialog",
  "application",
  "article",
  "banner",
  "blockquote",
  "button",
  "caption",
  "cell",
  "checkbox",
  "code",
  "columnheader",
  "combobox",
  "complementary",
  "contentinfo",
  "definition",
  "deletion",
  "dialog",
  "directory",
  "document",
  "emphasis",
  "feed",
  "figure",
  "form",
  "generic",
  "grid",
  "gridcell",
  "group",
  "heading",
  "img",
  "insertion",
  "link",
  "list",
  "listbox",
  "listitem",
  "log",
  "main",
  "marquee",
  "math",
  "meter",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "navigation",
  "none",
  "note",
  "option",
  "paragraph",
  "presentation",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "scrollbar",
  "search",
  "searchbox",
  "separator",
  "slider",
  "spinbutton",
  "status",
  "strong",
  "subscript",
  "superscript",
  "switch",
  "tab",
  "table",
  "tablist",
  "tabpanel",
  "term",
  "textbox",
  "time",
  "timer",
  "toolbar",
  "tooltip",
  "tree",
  "treegrid",
  "treeitem",
];

export function parseAutomationRole(value: string): AutomationRole {
  for (const role of AUTOMATION_ROLES) {
    if (role === value) return role;
  }
  throw new Error(`Unknown role "${value}". Expected one of: ${AUTOMATION_ROLES.join(", ")}.`);
}

export interface WaitTarget {
  role: AutomationRole;
  name: string;
}

export function parseWaitTarget(value: string): WaitTarget {
  const separator = value.indexOf(",");
  if (separator < 1) {
    throw new Error('--wait-for must be <role>,<name>, for example --wait-for=button,"New thread".');
  }
  const name = value.slice(separator + 1).trim();
  if (name === "") throw new Error("--wait-for needs an accessible name after the role.");
  return { role: parseAutomationRole(value.slice(0, separator).trim()), name };
}

export async function waitForRole(
  page: Page,
  target: WaitTarget,
  timeoutMs: number,
  logger: Logger = dummyLogger,
  exact = false,
): Promise<void> {
  logger.info(`wait-for role=${target.role} name=${target.name}`);
  await page
    .getByRole(target.role, { name: target.name, exact })
    .first()
    .waitFor({ state: "visible", timeout: timeoutMs });
}

export interface AutomationSnapshot {
  url: string;
  title: string;
  accessibility: string;
}

const SENSITIVE_CONTROL_NAME = /one[\s-]?time|passcode|password|\botp\b|secret|token|credential|api[\s_-]?key/iu;

const NAMED_NODE = /^(\s*)- ([a-z]+) "((?:[^"\\]|\\.)*)"((?: \[[^\]]*\])*)(?::(.*))?$/u;

export function redactSensitiveSnapshotValues(yaml: string): string {
  const lines: string[] = [];
  const sensitiveIndents: number[] = [];
  let replaced = false;
  for (const line of yaml.split("\n")) {
    if (line.trim() === "") {
      lines.push(line);
      continue;
    }
    const indent = line.length - line.trimStart().length;
    while (sensitiveIndents.length > 0 && indent <= (sensitiveIndents.at(-1) ?? 0)) {
      sensitiveIndents.pop();
      replaced = false;
    }
    const match = NAMED_NODE.exec(line);
    const name = match?.[3];
    if (match && name !== undefined && SENSITIVE_CONTROL_NAME.test(name)) {
      const inline = match[5]?.trim() ?? "";
      sensitiveIndents.push(indent);
      replaced = inline !== "";
      lines.push(inline === "" ? line : `${match[1]}- ${match[2]} "${name}"${match[4]}: [redacted]`);
      continue;
    }
    if (match && sensitiveIndents.length > 0 && (match[5]?.trim() ?? "") !== "") {
      lines.push(`${match[1]}- ${match[2]} "${name}"${match[4]}: [redacted]`);
      continue;
    }
    if (sensitiveIndents.length === 0 || match) {
      lines.push(line);
      continue;
    }
    if (!replaced) {
      lines.push(`${" ".repeat(indent)}- text: "[redacted]"`);
      replaced = true;
    }
  }
  return lines.join("\n");
}

export async function snapshotPage(page: Page, logger: Logger = dummyLogger): Promise<AutomationSnapshot> {
  const yaml = redactText(redactSensitiveSnapshotValues(await page.ariaSnapshot({ depth: 30 })));
  const snapshot: AutomationSnapshot = {
    url: describeTarget(page.url()),
    title: redactText(await page.title()),
    accessibility: yaml.length > MAX_SNAPSHOT_LENGTH ? `${yaml.slice(0, MAX_SNAPSHOT_LENGTH)}…` : yaml,
  };
  logger.info(`snapshot ${snapshot.url}`, snapshot.title);
  return snapshot;
}

export async function clickByRole(
  page: Page,
  role: AutomationRole,
  name: string,
  timeoutMs: number,
  exact = false,
): Promise<void> {
  const control = page.getByRole(role, { name, exact });
  if (role === "switch") {
    await control.press("Space", { timeout: timeoutMs });
    return;
  }
  await control.click({ timeout: timeoutMs });
}

export async function typeByRole(
  page: Page,
  role: AutomationRole,
  name: string,
  text: string,
  timeoutMs: number,
  submit: boolean,
  exact = false,
): Promise<void> {
  const control = page.getByRole(role, { name, exact });
  await control.fill(text, { timeout: timeoutMs });
  if (submit) await control.press("Enter", { timeout: timeoutMs });
}

export function resolveWritablePath(root: string, requested: string, extension: string, subject: string): string {
  const base = resolve(root);
  if (requested === "") throw new Error("--out=<path> cannot be empty.");
  const target = resolve(base, requested);
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new Error(`--out must stay inside ${base}. ${subject} never write outside the build directory.`);
  }
  if (!target.endsWith(extension)) throw new Error(`--out must name a ${extension} file.`);
  assertNoSymlinkOnPath(base, target, subject);
  return target;
}

export function resolveScreenshotPath(root: string, requested: string | null, now: number): string {
  if (requested === null) return resolve(resolve(root), `screenshot-${now}.png`);
  return resolveWritablePath(root, requested, ".png", "Screenshots");
}

function assertNoSymlinkOnPath(base: string, target: string, subject: string): void {
  const steps = relative(base, target).split(sep);
  let current = base;
  for (const step of [".", ...steps]) {
    current = step === "." ? base : resolve(current, step);
    let link = false;
    try {
      link = lstatSync(current).isSymbolicLink();
    } catch {
      return;
    }
    if (link) {
      throw new Error(
        `${current} is a symbolic link, so writing through it would leave ${base}. ` +
          `${subject} never follow a link out of the build directory.`,
      );
    }
  }
}

export function reportableScreenshotPath(out: string, workspace: string): string {
  const reportable = relative(workspace, out);
  const redacted = redactText(reportable);
  if (redacted !== reportable) {
    throw new Error(
      `--out=${reportable} would be redacted on the way out, so the saved file could not be reopened. ` +
        "Pick a name without a credential or an address in it.",
    );
  }
  return reportable;
}

export async function screenshotTo(page: Page, outPath: string, logger: Logger = dummyLogger): Promise<string> {
  await mkdir(dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath });
  logger.info("screenshot saved", outPath);
  return outPath;
}
