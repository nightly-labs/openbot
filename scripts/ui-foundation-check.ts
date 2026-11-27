import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenBotLogger } from "@openbot/logging";

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.isSymbolicLink()) return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function matches(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}

export interface UiFoundationReport {
  readonly failures: readonly string[];
  readonly manualCompositeCount: number;
}

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

const CLASS_FAMILY_PREFIX = /[`\s]([a-zA-Z][a-zA-Z0-9_-]*-)\$\{/gu;
const LUCIDE_ICON_IMPORT = /["']lucide-solid\/icons\/([a-z0-9-]+)["']/gu;

function declaredClasses(source: string): Set<string> {
  const names = new Set<string>();
  const withoutComments = source.replaceAll(/\/\*.*?\*\//gsu, " ");
  let start = 0;
  for (let index = 0; index < withoutComments.length; index += 1) {
    const char = withoutComments[index];
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

export function checkUiFoundation(
  rendererRoot: string,
  labelRoot: string,
  reachableRoots: readonly string[] = [rendererRoot],
  uiRoot = resolve(rendererRoot, "components/ui"),
): UiFoundationReport {
  const sourceFiles = [...new Set([...filesUnder(rendererRoot), ...filesUnder(uiRoot)])];
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

  const componentSource = sourceFiles
    .filter((path) => path.endsWith(".tsx") && !insideUi(path))
    .filter((path) => !path.endsWith(".test.tsx"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const manualCompositeCount = matches(
    componentSource,
    /role=["'](?:dialog|alertdialog|menu|tablist|tab|tabpanel|listbox|option)["']/gu,
  );

  const styleSheets = sourceFiles.filter((path) => path.endsWith(".css"));
  const legacyStyles = styleSheets.map((path) => readFileSync(path, "utf8")).join("\n");

  const markup = reachableRoots.flatMap(filesUnder).filter((path) => /\.(?:tsx?|html)$/u.test(path));
  const named = new Set<string>();
  const families: string[] = [];
  for (const path of markup) {
    const source = readFileSync(path, "utf8");
    for (const word of source.matchAll(/[a-zA-Z][a-zA-Z0-9_-]*/gu)) named.add(word[0]);
    for (const [, icon] of source.matchAll(LUCIDE_ICON_IMPORT)) if (icon !== undefined) named.add(`lucide-${icon}`);
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
  const colorLiteralCount =
    matches(legacyStyles, /#[\da-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)/giu) +
    matches(legacyStyles, /(?<![-\w])(?:white|black|red|blue|green|yellow|purple|orange|gray|grey|pink)(?![-\w])/giu);
  const debtBudgets = [
    ["hand-rolled composite ARIA roles", manualCompositeCount, 0],
    ["data-testid hooks in renderer markup", matches(testHookSource, /data-testid\s*=/gu), 0],
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
  const { failures, manualCompositeCount } = checkUiFoundation(
    resolve(projectRoot, "src/renderer/src"),
    projectRoot,
    [resolve(projectRoot, "src"), resolve(projectRoot, "apps"), resolve(projectRoot, "packages/ui/src")],
    resolve(projectRoot, "packages/ui/src"),
  );

  if (failures.length > 0) {
    logger.error(`UI foundation check failed:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }

  logger.info(`UI foundation check passed. Legacy composite debt: ${manualCompositeCount}/0.`);
}
