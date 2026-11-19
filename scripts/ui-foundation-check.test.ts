// @vitest-environment node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkUiFoundation } from "./ui-foundation-check";

const fixtureRenderer = resolve(import.meta.dirname, "../tools/ui-foundation/fixtures/renderer");
const cleanRenderer = resolve(import.meta.dirname, "../tools/ui-foundation/fixtures/renderer-clean");

function budget(label: string, actual: number, maximum = 0): string {
  return `${label}: ${actual} (migration budget: ${maximum}; the count may only go down)`;
}

describe("ui foundation check", () => {
  it("reports every violation the fixture tree contains, and nothing its correct files do", () => {
    const { failures } = checkUiFoundation(fixtureRenderer, fixtureRenderer);

    expect([...failures].sort()).toEqual(
      [
        "components/Bad.tsx: use a components/ui control instead of a native element",
        "components/Bad.tsx: Kobalte/Lucide imports are allowed only in components/ui",
        "components/Bad.tsx: a hand-rolled switch is forbidden; use components/ui/Switch",
        "components/Bad.tsx: a colour literal in an inline style is forbidden; use a palette token",
        "components/Bad.tsx: font-size, radius and transition in an inline style must use tokens",
        "components/Icons.tsx: Kobalte/Lucide imports are allowed only in components/ui",
        "components/ui/complex.tsx: a Kobalte namespace must go through an adapter, not a direct alias",
        "components/ui/features/Bad.tsx: use a components/ui control instead of a native element",
        "components/ui-kit/Sneaky.tsx: use a components/ui control instead of a native element",
        "components/branches/NativeInput.tsx: use a components/ui control instead of a native element",
        "components/branches/NativeSelect.tsx: use a components/ui control instead of a native element",
        "components/branches/NativeTextarea.tsx: use a components/ui control instead of a native element",
        "components/branches/ColourBackgroundRgb.tsx: a colour literal in an inline style is forbidden; use a palette token",
        "components/branches/ColourBackgroundRgba.tsx: a colour literal in an inline style is forbidden; use a palette token",
        "components/branches/ColourTextHsla.tsx: a colour literal in an inline style is forbidden; use a palette token",
        "components/branches/ColourBorderTopHsl.tsx: a colour literal in an inline style is forbidden; use a palette token",
        "components/branches/ColourFillNamed.tsx: a colour literal in an inline style is forbidden; use a palette token",
        "components/branches/ColourStrokeHex.tsx: a colour literal in an inline style is forbidden; use a palette token",
        "components/branches/InlineFontSize.tsx: font-size, radius and transition in an inline style must use tokens",
        "components/branches/InlineTransition.tsx: font-size, radius and transition in an inline style must use tokens",
        "components/branches/InlineTransitionDuration.tsx: font-size, radius and transition in an inline style must use tokens",
        "styles/unreachable.css: .identifier-panel is not reachable from any markup; delete the rule",
        "styles/unreachable.css: .lucide-unimported-glyph is not reachable from any markup; delete the rule",
        "styles/unreachable.css: .unreachable-panel is not reachable from any markup; delete the rule",
        budget("hand-rolled composite ARIA roles", 9),
        budget("colour literals outside the palette", 6),
        budget("untokenized font-size", 1),
        budget("untokenized border-radius", 1),
        budget("untokenized transition durations", 2),
        budget("data-testid hooks in renderer markup", 6),
      ].sort(),
    );
  });

  it("counts a composite role once, ignoring the copies in test files and components/ui", () => {
    const { manualCompositeCount } = checkUiFoundation(fixtureRenderer, fixtureRenderer);

    expect(manualCompositeCount).toBe(9);
  });

  it("reports nothing for a renderer that breaks no check", () => {
    const { failures, manualCompositeCount } = checkUiFoundation(cleanRenderer, cleanRenderer);

    expect(failures).toEqual([]);
    expect(manualCompositeCount).toBe(0);
  });

  it("reads markup outside the walked tree for reachability", () => {
    const { failures } = checkUiFoundation(fixtureRenderer, fixtureRenderer, [cleanRenderer]);

    expect(failures).toContain(
      "styles/unreachable.css: .reachable-from-markup is not reachable from any markup; delete the rule",
    );
    expect(failures).toContain(
      "styles/unreachable.css: .reachable-from-html is not reachable from any markup; delete the rule",
    );
  });

  it("labels a failure with a path relative to the root it is given", () => {
    const { failures } = checkUiFoundation(fixtureRenderer, resolve(fixtureRenderer, ".."));

    expect(failures).toContain(
      "renderer/components/Bad.tsx: a hand-rolled switch is forbidden; use components/ui/Switch",
    );
    expect(failures).toContain(
      "renderer/components/ui/complex.tsx: a Kobalte namespace must go through an adapter, not a direct alias",
    );
  });
});

it("checks primitive adapters when the shared UI is outside the renderer", () => {
  const report = checkUiFoundation(
    cleanRenderer,
    fixtureRenderer,
    [cleanRenderer, fixtureRenderer],
    resolve(fixtureRenderer, "components/ui"),
  );
  expect(report.failures).toContain(
    "components/ui/complex.tsx: a Kobalte namespace must go through an adapter, not a direct alias",
  );
  const clean = checkUiFoundation(
    cleanRenderer,
    cleanRenderer,
    [cleanRenderer],
    resolve(cleanRenderer, "components/ui"),
  );
  expect(clean.failures).toEqual([]);
});

interface PluginDiagnostic {
  category: string;
  severity: string;
  message: string;
  location?: { start?: { line?: number } };
}

function pluginDiagnostics(plugin: string, fixture: string, extension: string): PluginDiagnostic[] {
  const workspace = mkdtempSync(resolve(tmpdir(), "ui-plugin-"));
  try {
    writeFileSync(
      resolve(workspace, "biome.json"),
      JSON.stringify({
        plugins: [resolve(import.meta.dirname, "../tools/ui-foundation", plugin)],
        linter: { enabled: true, rules: { recommended: false } },
        formatter: { enabled: false },
        assist: { enabled: false },
      }),
    );
    const target = resolve(workspace, `fixture.${extension}`);
    writeFileSync(target, readFileSync(fixture));
    const result = spawnSync(
      resolve(import.meta.dirname, "../node_modules/.bin/biome"),
      ["check", target, `--config-path=${workspace}`, "--reporter=json"],
      { encoding: "utf8" },
    );
    const report: { diagnostics: PluginDiagnostic[] } = JSON.parse(result.stdout);
    const diagnostics = report.diagnostics.filter((item) => item.category === "plugin");
    expect(diagnostics.filter((item) => item.message.includes("errored"))).toEqual([]);
    return diagnostics;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

it("rejects desktop preload access in shared UI while allowing browser APIs and documentation", () => {
  for (const [sourceRoot, file, expected] of [
    [fixtureRenderer, "DesktopPreload.ts", 6],
    [fixtureRenderer, "OptionalPreload.ts", 1],
    [fixtureRenderer, "IndexedPreload.ts", 1],
    [cleanRenderer, "BrowserGlobals.ts", 0],
  ] as const) {
    const diagnostics = pluginDiagnostics("no-desktop-preload.grit", resolve(sourceRoot, "components/ui", file), "ts");
    expect(diagnostics).toHaveLength(expected);
    if (expected) expect(diagnostics[0]?.severity).toBe("error");
  }
});

it("rejects a story play function on each line its fixture marks, and nothing in a visual story", () => {
  const fixture = resolve(fixtureRenderer, "stories/Play.stories.tsx");
  const marked = readFileSync(fixture, "utf8")
    .split("\n")
    .flatMap((line, index) => (line.trimEnd().endsWith("// flag") ? [index + 1] : []));
  const flagged = pluginDiagnostics("no-story-play.grit", fixture, "tsx").map((item) => item.location?.start?.line);

  expect(marked.length).toBeGreaterThan(0);
  expect(flagged).toEqual(marked);
  expect(pluginDiagnostics("no-story-play.grit", resolve(cleanRenderer, "stories/Visual.stories.tsx"), "tsx")).toEqual(
    [],
  );
});

it("flags hardcoded interface text on each line its fixture marks, and not on translated text", () => {
  const fixture = resolve(fixtureRenderer, "components/HardcodedText.tsx");
  const marked = readFileSync(fixture, "utf8")
    .split("\n")
    .flatMap((line, index) => (line.trimEnd().endsWith("// flag") ? [index + 1] : []));
  const diagnostics = pluginDiagnostics("no-hardcoded-ui-text.grit", fixture, "tsx");

  expect(marked.length).toBeGreaterThan(0);
  expect(diagnostics.map((item) => item.location?.start?.line)).toEqual(marked);
  expect(diagnostics.every((item) => item.message.startsWith("[no-hardcoded-ui-text]"))).toBe(true);
  expect(
    pluginDiagnostics("no-hardcoded-ui-text.grit", resolve(cleanRenderer, "components/TranslatedText.tsx"), "tsx"),
  ).toEqual([]);
});
