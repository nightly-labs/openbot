// Captures the main surfaces of a running dev app in the dark and the light palette, for a design
// review: a direct message, a channel, the server menu, Settings and the agent settings. For each
// view it reads the computed type, colour and radius of the text that sets the hierarchy, and the
// contrast of that text on the surface under it. It checks that each sampled text reaches 4.5:1 and
// that each heading is larger than the text it heads. The theme changes in the window only; the saved
// preference stays. Writes .openbot-build/design-review/report.json and one screenshot per view and
// palette. Needs `--allow-mutations`, because it opens conversations and menus in the live app.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { en } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import type { Page } from "playwright-core";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

const OUT = resolve(import.meta.dirname, "../.openbot-build/design-review");
const THEMES = ["dark", "light"] as const;
// WCAG AA for body text.
const MIN_TEXT_CONTRAST = 4.5;

interface Sample {
  name: string;
  selector: string;
  // A heading names the sample it must be larger than.
  above?: string;
}

interface View {
  name: string;
  open: (page: Page) => Promise<void>;
  close?: (page: Page) => Promise<void>;
  samples: readonly Sample[];
}

const SIDEBAR_SAMPLES: readonly Sample[] = [
  { name: "sidebar title", selector: ".agent-row-title", above: "sidebar preview" },
  { name: "sidebar preview", selector: ".agent-row-preview" },
  { name: "sidebar time", selector: ".agent-row-time" },
];

// A direct message has no author names, and the latest screen may hold no message of the reader.
const DM_SAMPLES: readonly Sample[] = [
  ...SIDEBAR_SAMPLES,
  { name: "agent message", selector: ".message-entry-agent .ui-bubble-content" },
];

const CHANNEL_SAMPLES: readonly Sample[] = [
  ...DM_SAMPLES,
  { name: "author name", selector: ".message-author-name" },
  { name: "own message", selector: ".message-entry-user .ui-bubble-content" },
];

const SETTINGS_SAMPLES: readonly Sample[] = [
  { name: "settings title", selector: ".settings-modal-title", above: "settings section" },
  { name: "settings section", selector: ".ui-settings-section-header h3", above: "settings row" },
  { name: "settings row", selector: ".ui-settings-section .ui-item-title", above: "settings description" },
  { name: "settings description", selector: ".ui-settings-section .ui-item-description" },
];

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "design-review-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const logger = createOpenBotLogger("design-review-e2e");
const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});

/** Waits for the fonts and two frames, so a screenshot shows the settled view. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}

// A channel row shows the members' faces; an agent row shows one face.
const agentRow = (page: Page) => page.locator(".agent-row:not(:has(.channel-avatar))").first();
const channelRow = (page: Page) => page.locator(".agent-row:has(.channel-avatar)").first();

const VIEWS: readonly View[] = [
  {
    name: "dm",
    open: async (page) => {
      await agentRow(page).click();
      await page.locator(".message-entry").first().waitFor();
    },
    samples: DM_SAMPLES,
  },
  {
    name: "channel",
    open: async (page) => {
      await channelRow(page).click();
      await page.locator(".message-entry").first().waitFor();
    },
    samples: CHANNEL_SAMPLES,
  },
  {
    name: "menu",
    open: async (page) => {
      const prefix = en["server.menu.open"].split("{name}")[0] ?? "";
      await page
        .getByRole("button", { name: new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`) })
        .first()
        .click();
      await page.getByRole("menu").waitFor();
    },
    close: async (page) => {
      await page.keyboard.press("Escape");
      await page.getByRole("menu").waitFor({ state: "hidden" });
    },
    samples: SIDEBAR_SAMPLES,
  },
  {
    name: "settings",
    open: async (page) => {
      await page.getByRole("button", { name: en["app.rail.settings"], exact: true }).click();
      await page.locator(".settings-modal-title").waitFor();
    },
    close: async (page) => {
      await page.keyboard.press("Escape");
      await page.locator(".settings-modal-title").waitFor({ state: "hidden" });
    },
    samples: SETTINGS_SAMPLES,
  },
  {
    name: "agent-settings",
    open: async (page) => {
      await agentRow(page).click();
      await page.getByRole("button", { name: en["conversation.header.settings"], exact: true }).click();
      await page.locator(".settings-link-section-title").first().waitFor();
    },
    close: async (page) => {
      await page.keyboard.press("Escape");
      await page.locator(".settings-link-section-title").first().waitFor({ state: "hidden" });
    },
    samples: [
      { name: "agent settings group", selector: ".settings-link-section-title", above: "sidebar title" },
      ...SIDEBAR_SAMPLES,
    ],
  },
];

interface Measure {
  fontSize: number;
  lineHeight: string;
  fontWeight: string;
  letterSpacing: string;
  color: string;
  surface: string;
  borderRadius: string;
  contrast: number;
}

/**
 * The colour under a text, from the pixels: the text is hidden for one frame, its box is captured,
 * and the most common colour wins. Blur layers, pseudo-elements and siblings behind the text paint
 * that surface, so the computed styles of its ancestors cannot give it.
 */
async function surfaceUnder(page: Page, selector: string): Promise<string | null> {
  const box = await page.evaluate((query) => {
    const rect = [...document.querySelectorAll(query)]
      .map((node) => node.getBoundingClientRect())
      .find((r) => r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth);
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
  }, selector);
  if (!box) return null;
  const hidden = await page.addStyleTag({
    content: `${selector}, ${selector} * { color: transparent !important; -webkit-text-fill-color: transparent !important; }`,
  });
  try {
    await settle(page);
    const image = await page.screenshot({ clip: box, type: "png" });
    return await page.evaluate(async (source) => {
      // The page's CSP blocks fetching a data URL, so the bytes become a Blob directly.
      const bytes = Uint8Array.from(atob(source), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d");
      if (!canvas) throw new Error("No 2D canvas.");
      canvas.drawImage(bitmap, 0, 0);
      const { data } = canvas.getImageData(0, 0, bitmap.width, bitmap.height);
      const counts = new Map<string, number>();
      for (let index = 0; index < data.length; index += 4) {
        const color = `rgb(${data[index]}, ${data[index + 1]}, ${data[index + 2]})`;
        counts.set(color, (counts.get(color) ?? 0) + 1);
      }
      return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }, image.toString("base64"));
  } finally {
    await hidden.evaluate((node) => node.parentNode?.removeChild(node));
  }
}

/** Reads the first visible match of each selector, and its contrast on the given surface. */
function measure(page: Page, samples: readonly { selector: string; surface: string }[]) {
  return page.evaluate((list) => {
    const canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!canvas) throw new Error("No 2D canvas.");
    // Resolves any CSS colour to sRGB channels and alpha through the canvas.
    const rgba = (value: string) => {
      canvas.clearRect(0, 0, 1, 1);
      canvas.fillStyle = "#000";
      canvas.fillStyle = value;
      canvas.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = canvas.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const channel = (value: number) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const results: Record<string, Measure | null> = {};
    for (const { selector, surface } of list) {
      // The same element whose surface was captured: the first one wholly in the viewport.
      const element = [...document.querySelectorAll(selector)].find((node) => {
        const r = node.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
      });
      if (!element) {
        results[selector] = null;
        continue;
      }
      const style = getComputedStyle(element);
      const under = rgba(surface);
      const top = rgba(style.color);
      const text = {
        r: top.r * top.a + under.r * (1 - top.a),
        g: top.g * top.a + under.g * (1 - top.a),
        b: top.b * top.a + under.b * (1 - top.a),
      };
      const [first, second] = [luminance(text), luminance(under)];
      const light = Math.max(first, second);
      const dark = Math.min(first, second);
      results[selector] = {
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight: style.lineHeight,
        fontWeight: style.fontWeight,
        letterSpacing: style.letterSpacing,
        color: style.color,
        surface,
        borderRadius: style.borderRadius,
        contrast: Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100,
      };
    }
    return results;
  }, samples);
}

const page = session.page;
const original = await page.locator("html").getAttribute("data-openbot-color-scheme");
const report: Record<string, Record<string, Record<string, Measure | null>>> = {};
const failures: string[] = [];
mkdirSync(OUT, { recursive: true });

async function setTheme(theme: string) {
  await page.evaluate((value) => document.documentElement.setAttribute("data-openbot-color-scheme", value), theme);
  await settle(page);
}

try {
  for (const view of VIEWS) {
    await view.open(page);
    await settle(page);
    const themes: Record<string, Record<string, Measure | null>> = {};
    report[view.name] = themes;
    for (const theme of THEMES) {
      await setTheme(theme);
      await page.screenshot({ path: resolve(OUT, `${view.name}-${theme}.png`) });
      const surfaces = [];
      for (const sample of view.samples) {
        const surface = await surfaceUnder(page, sample.selector);
        if (surface) surfaces.push({ selector: sample.selector, surface });
      }
      const measured = await measure(page, surfaces);
      const byName: Record<string, Measure | null> = {};
      for (const sample of view.samples) byName[sample.name] = measured[sample.selector] ?? null;
      themes[theme] = byName;
      for (const sample of view.samples) {
        const value = byName[sample.name];
        if (!value) {
          failures.push(`${view.name} ${theme}: no ${sample.name} on screen (${sample.selector})`);
          continue;
        }
        if (value.contrast < MIN_TEXT_CONTRAST)
          failures.push(`${view.name} ${theme}: ${sample.name} contrast ${value.contrast} < ${MIN_TEXT_CONTRAST}`);
        const below = sample.above ? byName[sample.above] : null;
        if (below && value.fontSize <= below.fontSize)
          failures.push(
            `${view.name} ${theme}: ${sample.name} (${value.fontSize}px) is not larger than ${sample.above} (${below.fontSize}px)`,
          );
      }
    }
    await view.close?.(page);
  }
} finally {
  await setTheme(original ?? "dark");
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify({ failures, views: report }, null, 2)}\n`);
  await session.close();
}

assert.deepEqual(failures, [], `Design review failed. See ${resolve(OUT, "report.json")}.`);
logger.info("design review passed", { out: OUT });
