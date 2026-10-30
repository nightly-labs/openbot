import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenBotLogger } from "@openbot/logging";

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    // The reachable roots below are whole workspaces, and every one of them symlinks a
    // node_modules that statSync follows straight into the hoisted install.
    if (entry === "node_modules") return [];
    const path = resolve(directory, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function matches(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}

export interface UiFoundationReport {
  /** One human-readable line per violation, in the order the tree was walked. */
  readonly failures: readonly string[];
  /** Composite ARIA roles hand-rolled outside `components/ui`. Ratchets down, never up. */
  readonly manualCompositeCount: number;
}

/**
 * Every stretch of source that builds a class string, matched by balancing the brace rather
 * than by reading a line, because the renderer's array form spans several:
 *
 *     class={[
 *       "remote-desktop-workspace",
 *       `remote-desktop-workspace-${props.platform}`,
 *     ]}
 *
 * One opener, because this renderer has one. `className` and the `classList={{…}}` prop are
 * React and Solid idioms it uses zero times, and the `cx()` helper it uses 78 times is inside
 * a `class={…}` on all 78 - an opener for it widens no region and no fixture can hold it to
 * account.
 */
function classRegions(source: string): string[] {
  const regions: string[] = [];
  const opener = /class\s*=\s*\{/gu;
  let match: RegExpExecArray | null = opener.exec(source);
  while (match !== null) {
    let depth = 1;
    let index = match.index + match[0].length;
    while (index < source.length && depth > 0) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") depth -= 1;
      index += 1;
    }
    regions.push(source.slice(match.index, index));
    opener.lastIndex = index;
    match = opener.exec(source);
  }
  return regions;
}

// The prefix of a class family does not have to open the literal:
// `agent-row-agent-status agent-row-agent-status-${kind}` puts it after a space, so this
// anchors on the backtick or the whitespace that starts the class name instead.
const CLASS_FAMILY_PREFIX = /[`\s]([a-zA-Z][a-zA-Z0-9_-]*-)\$\{/gu;

/**
 * Reads a renderer tree and reports every design-system violation in it. Paths in
 * `failures` are relative to `labelRoot`, which the CLI sets to the repository root
 * so a message can be pasted straight into an editor.
 *
 * Takes its roots as arguments rather than resolving them, so the fixture trees in
 * `tools/ui-foundation/fixtures` can prove each check still matches something. Two
 * of these checks silently matched nothing for months.
 *
 * `reachableRoots` is where markup that can name a class lives, and it is wider than
 * `rendererRoot` in both directions. The renderer's four `.html` entry points and its
 * `stories/` tree sit beside `src/` rather than inside it, and a class can be named from
 * outside the renderer altogether: `src/main` injects one into a picture-in-picture window
 * and `apps/auth-api` renders the preview shell. So the CLI passes `src` and `apps` whole,
 * rather than a list of the three directories that happen to do it today.
 */
/**
 * The class names a stylesheet declares, read from selector preludes alone. A bare `.name` scan
 * over the whole file cannot tell a selector from `url("sprite.svg")` or from a comment naming a
 * rule that was deleted, and either one fails the check for a class nothing ever declared.
 */
function declaredClasses(source: string): Set<string> {
  const names = new Set<string>();
  const withoutComments = source.replaceAll(/\/\*.*?\*\//gsu, " ");
  let start = 0;
  for (let index = 0; index < withoutComments.length; index += 1) {
    const char = withoutComments[index];
    // A prelude ends at its block. `;` and `}` end a declaration or a block instead, so
    // whatever was collecting is a value or the tail of a rule and never a selector.
    if (char === "{") {
      for (const [, name] of withoutComments.slice(start, index).matchAll(/\.(-?[a-zA-Z][a-zA-Z0-9_-]*)/gu)) {
        if (name !== undefined) names.add(name);
      }
      start = index + 1;
    } else if (char === "}" || char === ";") {
      start = index + 1;
    }
  }
  return names;
}

/** The stylesheets of the public site, and the most of each style debt that they may hold. */
export interface SiteStyles {
  readonly sheets: readonly string[];
  readonly budgets: Readonly<Partial<Record<StyleDebt, number>>>;
}

const STYLE_DEBTS = [
  "colour literals outside the palette",
  "untokenized font-size",
  "untokenized font-weight",
  "pixel line-height",
  "untokenized letter-spacing",
  "icon size outside the icon scale",
  "untokenized border-radius",
  "untokenized transition durations",
] as const;

export type StyleDebt = (typeof STYLE_DEBTS)[number];

/** The literals that a stylesheet holds where a design token belongs, by kind. */
function styleDebts(styles: string): Record<StyleDebt, number> {
  // An icon takes its size from the icon scale. A drawing above 24px keeps its own size.
  let iconSizeLiteralCount = 0;
  for (const [, selector = "", body = ""] of styles
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .matchAll(/([^{}]*)\{([^{}]*)\}/gu)) {
    if (!/(?:^|[\s>+~,(])svg\b|\.lucide\b/u.test(selector)) continue;
    for (const [, size = ""] of body.matchAll(
      /(?<![-\w])(?:width|height|inline-size|block-size):\s*(\d+(?:\.\d+)?)px/gu,
    )) {
      if (Number(size) <= 24) iconSizeLiteralCount += 1;
    }
  }
  return {
    "colour literals outside the palette":
      matches(styles, /#[\da-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)/giu) +
      matches(styles, /(?<![-\w])(?:white|black|red|blue|green|yellow|purple|orange|gray|grey|pink)(?![-\w])/giu),
    "untokenized font-size": matches(styles, /font-size:(?!\s*(?:var\(|inherit\b))\s*[^;]+/gu),
    "untokenized font-weight": matches(styles, /font-weight:(?!\s*(?:var\(|inherit\b))\s*[^;]+/gu),
    // A unitless line-height scales with its font and stays allowed; a pixel one is a leading token.
    "pixel line-height": matches(styles, /line-height:\s*[\d.]+px\b/gu),
    "untokenized letter-spacing": matches(
      styles,
      /letter-spacing:(?!\s*(?:var\(|0(?:\s|;)|inherit\b|normal\b))\s*[^;]+/gu,
    ),
    "icon size outside the icon scale": iconSizeLiteralCount,
    "untokenized border-radius": matches(styles, /border-radius:(?!\s*(?:var\(|0(?:\s|;)|inherit\b))\s*[^;]+/gu),
    "untokenized transition durations": matches(
      styles,
      /transition(?:-duration)?:(?![^;]*var\()(?!\s*(?:none|0\.01ms))[^;]*\b\d+m?s\b[^;]*/gu,
    ),
  };
}

export function checkUiFoundation(
  rendererRoot: string,
  labelRoot: string,
  reachableRoots: readonly string[] = [rendererRoot],
  uiRoot = resolve(rendererRoot, "components/ui"),
  tokenSheets: readonly string[] = [],
  site: SiteStyles = { sheets: [], budgets: {} },
): UiFoundationReport {
  const sourceFiles = [...new Set([...filesUnder(rendererRoot), ...filesUnder(uiRoot)])];
  // Compared with a separator appended, or components/ui-kit and components/uiLegacy read
  // as being inside the design system and every check below skips them silently.
  const insideUi = (path: string): boolean =>
    path.startsWith(`${uiRoot}${sep}`) &&
    !path.startsWith(`${uiRoot}${sep}features${sep}`) &&
    !path.startsWith(`${uiRoot}${sep}components${sep}`);
  const failures: string[] = [];

  for (const file of sourceFiles.filter((path) => /\.(?:ts|tsx)$/.test(path))) {
    if (insideUi(file) || /\.test\.tsx?$/u.test(file)) continue;
    const source = readFileSync(file, "utf8");
    const label = relative(labelRoot, file);

    if (/<(?:button|input|textarea|select)\b/u.test(source)) {
      failures.push(`${label}: use a components/ui control instead of a native element`);
    }
    if (/from\s+["'](?:@kobalte\/core|lucide-solid)(?:\/[^"']*)?["']/u.test(source)) {
      failures.push(`${label}: Kobalte/Lucide imports are allowed only in components/ui`);
    }
    if (/role=["']switch["']/u.test(source)) {
      failures.push(`${label}: a hand-rolled switch is forbidden; use components/ui/Switch`);
    }
    if (file.endsWith(".tsx")) {
      // The property may be quoted, and a hyphenated one has to be: `border-color` is not a
      // bare JS key. Without the optional quote every hyphenated branch of this pattern was
      // unreachable - dead from the day it was written, and green about it.
      const inlineColor =
        /(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|fill|stroke)["']?\s*:\s*["'](?:#[\da-f]{3,8}|rgba?\(|hsla?\(|(?:white|black|red|blue|green|yellow|purple|orange|gray|grey|pink)\b)/iu;
      if (inlineColor.test(source)) {
        failures.push(`${label}: a colour literal in an inline style is forbidden; use a palette token`);
      }
      const inlineFoundationValue =
        /["']?(?:font-size|border-radius|transition(?:-duration)?)["']?\s*:\s*["'](?!var\()[^"']+["']/iu;
      if (inlineFoundationValue.test(source)) {
        failures.push(`${label}: font-size, radius and transition in an inline style must use tokens`);
      }
    }
  }

  // Every non-test source in the renderer, the shared layer included. The composite-role
  // scan below deliberately skips components/ui because a primitive there is allowed to
  // hand-roll a role; a test hook is not, so this one has no exempt directory. Scoping it
  // to the same join as that scan would leave components/ui free to grow hooks silently,
  // which is the exact shape of the two blindnesses this file's history records.
  const testHookSource = sourceFiles
    .filter((path) => /\.tsx?$/u.test(path))
    .filter((path) => !/\.test\.tsx?$/u.test(path))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  const complexApiPath = resolve(uiRoot, "complex.tsx");
  if (/export const \w+\s*=\s*\w+Primitive\s*;/u.test(readFileSync(complexApiPath, "utf8"))) {
    failures.push(
      `${relative(labelRoot, complexApiPath)}: a Kobalte namespace must go through an adapter, not a direct alias`,
    );
  }

  // Every renderer component outside the shared layer, wherever it lives. This
  // used to walk `components/` alone, which stopped seeing a component the moment
  // it moved into `features/` - the budget stayed at zero by going blind, not by
  // being met.
  const componentSource = sourceFiles
    .filter((path) => path.endsWith(".tsx") && !insideUi(path))
    .filter((path) => !path.endsWith(".test.tsx"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const manualCompositeCount = matches(
    componentSource,
    /role=["'](?:dialog|alertdialog|menu|tablist|tab|tabpanel|listbox|option)["']/gu,
  );

  // The palette moved to @openbot/brand, which is now the only file allowed to hold
  // a colour literal, so every stylesheet the renderer owns is scanned whole. This
  // used to slice styles.css after its :root block to spare the palette, which also
  // spared everything else declared in there. It then named styles.css and styles/
  // explicitly, which spared a stylesheet placed anywhere else: preview/preview.css
  // was outside the scan and nothing said so, and a feature stylesheet moving next
  // to the components it dresses would have left the budget the same silent way.
  // The whole renderer tree is the scope, so a new stylesheet is covered by
  // existing there rather than by being listed.
  const styleSheets = sourceFiles.filter((path) => path.endsWith(".css"));
  const legacyStyles = styleSheets.map((path) => readFileSync(path, "utf8")).join("\n");

  // CSS is the one renderer surface no compiler reads, so a rule outlives the markup it
  // dressed in silence. A class counts as reachable when its name appears as a word in any
  // component, story or HTML entry point, or when a `prefix-${value}` family covers it. The
  // family prefixes are taken from class-building regions alone: `id={`remote-${index}`}` has
  // the same shape as a class family, and honouring it there would hide every `remote-*` rule.
  const markup = reachableRoots.flatMap(filesUnder).filter((path) => /\.(?:tsx?|html)$/u.test(path));
  const named = new Set<string>();
  const families: string[] = [];
  for (const path of markup) {
    const source = readFileSync(path, "utf8");
    for (const word of source.matchAll(/[a-zA-Z][a-zA-Z0-9_-]*/gu)) named.add(word[0]);
    for (const region of classRegions(source)) {
      for (const [, prefix] of region.matchAll(CLASS_FAMILY_PREFIX)) if (prefix !== undefined) families.push(prefix);
    }
  }
  for (const path of styleSheets) {
    const declared = declaredClasses(readFileSync(path, "utf8"));
    for (const name of [...declared].sort()) {
      if (named.has(name)) continue;
      if (families.some((prefix) => name.startsWith(prefix) && name.length > prefix.length)) continue;
      failures.push(`${relative(labelRoot, path)}: .${name} is not reachable from any markup; delete the rule`);
    }
  }
  // A token that no stylesheet declares resolves to nothing, and the property silently falls
  // back to its initial value: `--openbot-text-xs` sized three rules that way. A reference with a
  // fallback, `var(--name, value)`, is optional by intent and is not reported.
  const declaredTokens = new Set(
    [...styleSheets, ...tokenSheets, ...site.sheets].flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/(--openbot-[\w-]+)\s*:/gu)].map(([, name]) => name),
    ),
  );
  for (const path of [...styleSheets, ...site.sheets]) {
    const referenced = new Set(
      [...readFileSync(path, "utf8").matchAll(/var\(\s*(--openbot-[\w-]+)\s*\)/gu)].map(([, name]) => name),
    );
    for (const name of [...referenced].sort()) {
      if (name !== undefined && !declaredTokens.has(name)) {
        failures.push(`${relative(labelRoot, path)}: var(${name}) is not declared by any stylesheet`);
      }
    }
  }
  const debtBudgets: [string, number, number][] = [
    ["hand-rolled composite ARIA roles", manualCompositeCount, 0],
    // Biome rejects the *ByTestId queries, but a GritQL rule cannot see a JSX attribute in
    // the product tree, so this count is the only guard against a hook in markup. Reach an
    // element by its accessible name instead.
    ["data-testid hooks in renderer markup", matches(testHookSource, /data-testid\s*=/gu), 0],
  ];
  const rendererDebts = styleDebts(legacyStyles);
  for (const label of STYLE_DEBTS) debtBudgets.push([label, rendererDebts[label], 0]);
  // The public site has its own budgets. They start at the counts of the day the check came in
  // and may only go down, as the renderer's did.
  if (site.sheets.length > 0) {
    const siteDebts = styleDebts(site.sheets.map((path) => readFileSync(path, "utf8")).join("\n"));
    for (const label of STYLE_DEBTS)
      debtBudgets.push([`public web ${label}`, siteDebts[label], site.budgets[label] ?? 0]);
  }

  for (const [label, actual, maximum] of debtBudgets) {
    if (actual > maximum)
      failures.push(`${label}: ${actual} (migration budget: ${maximum}; the count may only go down)`);
  }

  return { failures, manualCompositeCount };
}

/** The style debt of the public site, which may only go down. */
const SITE_DEBT_BUDGETS: SiteStyles["budgets"] = {
  "colour literals outside the palette": 107,
  "untokenized font-size": 280,
  "untokenized font-weight": 159,
  "pixel line-height": 4,
  "untokenized letter-spacing": 79,
  "icon size outside the icon scale": 38,
  "untokenized border-radius": 88,
  "untokenized transition durations": 33,
};

if (import.meta.main) {
  const logger = createOpenBotLogger("ui-foundation-check");
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const { failures, manualCompositeCount } = checkUiFoundation(
    resolve(projectRoot, "src/renderer/src"),
    projectRoot,
    [resolve(projectRoot, "src"), resolve(projectRoot, "apps"), resolve(projectRoot, "packages/ui/src")],
    resolve(projectRoot, "packages/ui/src"),
    filesUnder(resolve(projectRoot, "packages/brand/src")).filter((path) => path.endsWith(".css")),
    {
      sheets: ["apps/auth-api/src", "apps/status/src"]
        .flatMap((directory) => filesUnder(resolve(projectRoot, directory)))
        .filter((path) => path.endsWith(".css")),
      budgets: SITE_DEBT_BUDGETS,
    },
  );

  if (failures.length > 0) {
    logger.error(`UI foundation check failed:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }

  logger.info(`UI foundation check passed. Legacy composite debt: ${manualCompositeCount}/0.`);
}
