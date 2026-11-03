import type { OverviewTone } from "@openbot/ui/features/workflows/WorkflowOverview";
import type { OverviewColorRule } from "@openbot/ui/features/workflows/WorkflowOverviewSettings";
import { type Accessor, createSignal } from "solid-js";
import { z } from "zod";

/**
 * The settings of the All workflows page, in `localStorage` so they survive a restart. The colour
 * rules replaced a fixed list: a card's strip now follows the patterns the user writes, and the
 * shipped defaults keep the look of that first list.
 */

const STORAGE_KEY = "openbot:workflows-overview";

/** The look of the first page: the first match wins, so a "GLM Build" card shows the GLM tone. */
const DEFAULT_COLOR_RULES: readonly OverviewColorRule[] = [
  { pattern: "*conflict*", tone: "conflict" },
  { pattern: "*judge*", tone: "judge" },
  { pattern: "*glm*", tone: "violet" },
  { pattern: "*plan*", tone: "plan" },
  { pattern: "*build*", tone: "build" },
];

const toneSchema = z.enum(["plan", "build", "judge", "conflict", "violet"]);
const colorRuleSchema = z.object({ pattern: z.string().trim().min(1).max(80), tone: toneSchema });
const settingsSchema = z.object({
  /** "owner/name", or null to follow the project the issue-stats helper reports. */
  project: z
    .string()
    .trim()
    .regex(/^[^\s/]+\/[^\s/]+$/)
    .nullable()
    .catch(null),
  colorRules: z
    .array(colorRuleSchema)
    .max(30)
    .catch(() => [...DEFAULT_COLOR_RULES]),
  hiddenUsageRows: z.array(z.string().min(1).max(80)).max(30).catch([]),
});

export interface OverviewSettings {
  project: string | null;
  colorRules: readonly OverviewColorRule[];
  hiddenUsageRows: readonly string[];
}

function readStored(): OverviewSettings {
  const defaults: OverviewSettings = { project: null, colorRules: DEFAULT_COLOR_RULES, hiddenUsageRows: [] };
  try {
    const parsed = settingsSchema.safeParse(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}"));
    return parsed.success ? { ...defaults, ...parsed.data } : defaults;
  } catch {
    return defaults;
  }
}

const compiled = new Map<string, RegExp>();
/**
 * A rule pattern with `*` for any run of characters and everything else literal, read without
 * case. An empty pattern matches nothing, so an unfinished rule stays quiet.
 */
function patternMatches(pattern: string, text: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  let rule = compiled.get(trimmed);
  if (!rule) {
    const source = trimmed.replace(/[.*+?^${}()|[\]\\]/g, (char) => (char === "*" ? ".*" : `\\${char}`));
    rule = new RegExp(`^${source}$`, "iu");
    compiled.set(trimmed, rule);
  }
  return rule.test(text);
}

/** The tone of the first rule that matches any of the texts, or undefined when none does. */
export function toneFromRules(
  rules: readonly OverviewColorRule[],
  ...texts: readonly string[]
): OverviewTone | undefined {
  for (const rule of rules) {
    if (texts.some((text) => patternMatches(rule.pattern, text))) return rule.tone;
  }
  return undefined;
}

/** Reads and writes the page settings. One instance lives for the window. */
export function createOverviewSettingsStore(): {
  settings: Accessor<OverviewSettings>;
  setProject: (project: string | null) => void;
  setColorRules: (rules: readonly OverviewColorRule[]) => void;
  setHiddenUsageRows: (ids: readonly string[]) => void;
} {
  const [settings, setSettings] = createSignal<OverviewSettings>(readStored());
  const write = (change: (current: OverviewSettings) => OverviewSettings) => {
    setSettings((current) => {
      const next = change(current);
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ project: next.project, colorRules: next.colorRules, hiddenUsageRows: next.hiddenUsageRows }),
      );
      return next;
    });
  };
  return {
    settings,
    setProject: (project) => write((current) => ({ ...current, project })),
    setColorRules: (colorRules) => write((current) => ({ ...current, colorRules: [...colorRules] })),
    setHiddenUsageRows: (hiddenUsageRows) =>
      write((current) => ({ ...current, hiddenUsageRows: [...hiddenUsageRows] })),
  };
}

let shared: ReturnType<typeof createOverviewSettingsStore> | undefined;
/** The one store of the window, so the page and the rail read the same settings. */
export function overviewSettings(): ReturnType<typeof createOverviewSettingsStore> {
  if (!shared) shared = createOverviewSettingsStore();
  return shared;
}
