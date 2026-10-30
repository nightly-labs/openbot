// Run against an existing Storybook with installed Chrome:
// bun scripts/code-language-e2e.ts --storybook=http://localhost:6006 --phase=before
// Each phase keeps its own report and screenshots under .openbot-build/code-language-e2e/.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { translateFor } from "@openbot/i18n";
import { type Browser, chromium, type Locator, type Page } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "..");
const t = translateFor("en");
const CODE_BLOCK = "packages/ui/src/features/conversation/CodeBlock.tsx";
const stories = [
  { id: "unknown-constructor-language", label: "CONSTRUCTOR", lines: ["const total = 42;"], surrounding: true },
  { id: "unknown-prototype-language", label: "__PROTO__", lines: ["const fallback = 7;"], surrounding: true },
  { id: "unknown-ordinary-language", label: "MYLANG", lines: ["const ordinary = 3;"], surrounding: true },
  {
    id: "code-block",
    label: "TypeScript",
    lines: [
      "export async function churnBatch() {",
      '  const flavor = await getFlavor("pistachio");',
      "  const base = await dairy.fetch({ flavor });",
      '  await freezer.store(base, { temp: "-14C" });',
      "  return base.gallons;",
      "}",
    ],
    surrounding: false,
  },
];

interface Observation {
  expected: string;
  visible: boolean;
  text: string | null;
  error: string | null;
}

interface CaseReport {
  id: string;
  url: string;
  passed: boolean;
  observations: Observation[];
  visibleText: string | null;
  pageErrors: string[];
  errors: string[];
  screenshot: string | null;
}

interface Report {
  phase: "before" | "after";
  storybook: string;
  codeBlock: { path: string; sha256: string };
  passed: boolean;
  cases: CaseReport[];
  error: string | null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

async function observe(locator: Locator, expected: string): Promise<Observation> {
  const observation: Observation = { expected, visible: false, text: null, error: null };
  try {
    await locator.waitFor({ state: "visible" });
    observation.visible = true;
    observation.text = await locator.innerText();
    assert.equal(observation.text, expected, "Visible text must keep the original text.");
  } catch (error) {
    observation.error = errorText(error);
  }
  return observation;
}

async function finishAnimations(page: Page) {
  await page.waitForFunction(
    async () => {
      await document.fonts.ready;
      await Promise.all(
        document
          .getAnimations()
          .filter(
            (animation) =>
              (animation.playState === "running" || animation.pending) &&
              Number.isFinite(animation.effect?.getComputedTiming().endTime),
          )
          .map((animation) => animation.finished.catch(() => undefined)),
      );
      return true;
    },
    undefined,
    { timeout: 15_000 },
  );
}

async function main() {
  const storybook = process.argv.find((arg) => arg.startsWith("--storybook="))?.slice("--storybook=".length);
  const phase = process.argv.find((arg) => arg.startsWith("--phase="))?.slice("--phase=".length);
  assert.ok(storybook, "Pass --storybook=<url> for the running Storybook.");
  assert.ok(phase === "before" || phase === "after", "Pass --phase=before or --phase=after.");
  const base = new URL(storybook);
  assert.ok(base.protocol === "http:" || base.protocol === "https:", "Storybook must use HTTP or HTTPS.");
  const out = resolve(ROOT, ".openbot-build/code-language-e2e", phase);
  mkdirSync(out, { recursive: true });
  const report: Report = {
    phase,
    storybook: base.href,
    codeBlock: { path: CODE_BLOCK, sha256: "" },
    passed: false,
    cases: stories.map((story): CaseReport => {
      const url = new URL("iframe.html", `${base.href.replace(/\/$/u, "")}/`);
      const id = `conversation-messagebody--${story.id}`;
      url.searchParams.set("id", id);
      url.searchParams.set("viewMode", "story");
      return {
        id,
        url: url.href,
        passed: false,
        observations: [],
        visibleText: null,
        pageErrors: [],
        errors: [],
        screenshot: null,
      };
    }),
    error: null,
  };
  const errors: string[] = [];
  let browser: Browser | undefined;
  try {
    report.codeBlock.sha256 = createHash("sha256")
      .update(readFileSync(resolve(ROOT, CODE_BLOCK)))
      .digest("hex");
    browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 30_000 });
    for (const [index, story] of stories.entries()) {
      const result = report.cases[index];
      if (!result) throw new Error("Missing story report.");
      let page: Page | undefined;
      try {
        const storyPage = await browser.newPage({ viewport: { width: 1200, height: 860 } });
        page = storyPage;
        page.setDefaultTimeout(10_000);
        page.setDefaultNavigationTimeout(30_000);
        page.on("pageerror", (error) => result.pageErrors.push(errorText(error)));
        const response = await page.goto(result.url, { waitUntil: "load" });
        if (!response?.ok()) result.errors.push(`Story navigation returned ${response?.status() ?? "no response"}.`);
        const expectedText = story.surrounding
          ? ["Before the code.", ...story.lines, story.label, "After the code."]
          : [...story.lines, story.label];
        // Check each item even if another item is absent or the component throws.
        result.observations = await Promise.all([
          ...expectedText.map((text) => observe(storyPage.getByText(text, { exact: true }), text)),
          observe(page.getByRole("button", { name: t("chat.code.copy"), exact: true }), "Copy"),
        ]);
      } catch (error) {
        result.errors.push(errorText(error));
      } finally {
        if (page) {
          try {
            result.visibleText = await page.locator("body").innerText();
          } catch (error) {
            result.errors.push(`Visible text: ${errorText(error)}`);
          }
          try {
            await finishAnimations(page);
          } catch (error) {
            result.errors.push(`Animation completion: ${errorText(error)}`);
          }
          // Keep screenshot evidence even when rendering or animation completion fails.
          try {
            const filename = `${story.id}.png`;
            await page.screenshot({ path: resolve(out, filename), fullPage: true, timeout: 15_000 });
            result.screenshot = filename;
          } catch (error) {
            result.errors.push(`Screenshot: ${errorText(error)}`);
          }
          try {
            await page.close();
          } catch (error) {
            result.errors.push(`Page close: ${errorText(error)}`);
          }
        }
        for (const observation of result.observations) {
          if (observation.error) result.errors.push(`${observation.expected}: ${observation.error}`);
        }
        result.errors.push(...result.pageErrors.map((error) => `pageerror: ${error}`));
        result.passed = result.errors.length === 0 && result.observations.length > 0 && result.screenshot !== null;
      }
    }
  } catch (error) {
    const message = errorText(error);
    errors.push(message);
    for (const result of report.cases) {
      if (result.observations.length === 0) result.errors.push(`Case could not complete: ${message}`);
    }
  } finally {
    try {
      await browser?.close();
    } catch (error) {
      errors.push(`Browser close: ${errorText(error)}`);
    }
    errors.push(...report.cases.filter((result) => !result.passed).map((result) => `${result.id}: failed`));
    report.passed = errors.length === 0 && report.cases.every((result) => result.passed);
    report.error = errors.length > 0 ? errors.join("\n") : null;
    writeFileSync(resolve(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (!report.passed) process.exitCode = 1;
  }
}

await main().catch((error) => {
  process.stderr.write(`${errorText(error)}\n`);
  process.exitCode = 1;
});
