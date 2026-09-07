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
      for (const match of withoutComments.slice(start, index).matchAll(/\.(-?[a-zA-Z][a-zA-Z0-9_-]*)/gu)) {
        names.add(match[1]);
      }
      start = index + 1;
    } else if (char === "}" || char === ";") {
      start = index + 1;
    }
  }
  return names;
}

export function checkUiFoundation(
  rendererRoot: string,
  labelRoot: string,
  reachableRoots: readonly string[] = [rendererRoot],
): UiFoundationReport {
  const uiRoot = resolve(rendererRoot, "components/ui");
  // Compared with a separator appended, or components/ui-kit and components/uiLegacy read
  // as being inside the design system and every check below skips them silently.
  const insideUi = (path: string): boolean => path.startsWith(`${uiRoot}${sep}`);
  const failures: string[] = [];

  for (const file of filesUnder(rendererRoot).filter((path) => /\.(?:ts|tsx)$/.test(path))) {
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
  const testHookSource = filesUnder(rendererRoot)
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
  const componentSource = filesUnder(rendererRoot)
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
  const styleSheets = filesUnder(rendererRoot).filter((path) => path.endsWith(".css"));
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
      for (const prefix of region.matchAll(CLASS_FAMILY_PREFIX)) families.push(prefix[1]);
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
  const colorLiteralCount =
    matches(legacyStyles, /#[\da-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)/giu) +
    matches(legacyStyles, /(?<![-\w])(?:white|black|red|blue|green|yellow|purple|orange|gray|grey|pink)(?![-\w])/giu);
  const debtBudgets = [
    ["hand-rolled composite ARIA roles", manualCompositeCount, 0],
    // Biome rejects the *ByTestId queries, but a GritQL rule cannot see a JSX attribute in
    // the product tree, so root AGENTS.md rules this out in prose alone. The five that exist
    // are not dead weight: three are read by play functions in src/renderer/stories, where
    // the test rules relax by design. So this freezes the count rather than demanding zero -
    // a new hook has to replace an old one, and the accessible-name route is the only way to
    // reach an element the sixth time.
    ["data-testid hooks in renderer markup", matches(testHookSource, /data-testid\s*=/gu), 5],
    ["colour literals outside the palette", colorLiteralCount, 0],
    ["untokenized font-size", matches(legacyStyles, /font-size:(?!\s*(?:var\(|inherit\b))\s*[^;]+/gu), 0],
    [
      "untokenized border-radius",
      matches(legacyStyles, /border-radius:(?!\s*(?:var\(|0(?:\s|;)|inherit\b))\s*[^;]+/gu),
      0,
    ],
    [
      "untokenized transition durations",
      matches(legacyStyles, /transition(?:-duration)?:(?![^;]*var\()(?!\s*(?:none|0\.01ms))[^;]*\b\d+m?s\b[^;]*/gu),
      0,
    ],
  ] as const;

  for (const [label, actual, maximum] of debtBudgets) {
    if (actual > maximum)
      failures.push(`${label}: ${actual} (migration budget: ${maximum}; the count may only go down)`);
  }

  return { failures, manualCompositeCount };
}

if (import.meta.main) {
  const logger = createOpenBotLogger("ui-foundation-check");
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const { failures, manualCompositeCount } = checkUiFoundation(resolve(projectRoot, "src/renderer/src"), projectRoot, [
    resolve(projectRoot, "src"),
    resolve(projectRoot, "apps"),
  ]);

  if (failures.length > 0) {
    logger.error(`UI foundation check failed:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }

  logger.info(`UI foundation check passed. Legacy composite debt: ${manualCompositeCount}/0.`);
}
