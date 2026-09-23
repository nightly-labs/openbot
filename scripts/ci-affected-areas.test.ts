// @vitest-environment node

// These cases run against the repository's real manifests, not fixtures: the
// point is that the CI map still matches the workspace graph after someone adds
// a dependency or an app.

import { describe, expect, it } from "vitest";
import { AREAS, type Area, affectedAreas, workspaceAreas } from "./ci-affected-areas";
import { workspaceDirectories } from "./workspace-graph";

function flagged(...files: string[]): Area[] {
  const areas = affectedAreas(files);
  return AREAS.filter((area) => areas[area]);
}

describe("CI affected areas", () => {
  it("runs the account API for a renderer change, because auth-api builds the renderer preview", () => {
    expect(flagged("src/renderer/src/App.tsx")).toEqual(["desktop", "api", "storybook", "unit", "code"]);
  });

  it("reaches mobile through user-errors when logging changes", () => {
    expect(flagged("packages/logging/src/index.ts")).toContain("mobile");
  });

  it("keeps an i18n change on the desktop, its only consumer", () => {
    expect(flagged("packages/i18n/src/index.ts")).toEqual(["desktop", "storybook", "unit", "code"]);
  });

  it("runs only the site router checks for a site router change", () => {
    expect(flagged("apps/site-router/src/index.ts")).toEqual(["sites", "code"]);
  });

  it("runs the remote checks for remote scripts outside the workspace", () => {
    expect(flagged("remote/scripts/rotate.ts")).toEqual(["remote", "code"]);
  });

  it("runs every area for a contracts change", () => {
    expect(flagged("packages/contracts/src/index.ts")).toEqual([...AREAS]);
  });

  it("runs nothing for prose", () => {
    expect(flagged("README.md", "docs/ARCHITECTURE.md", "src/main/AGENTS.md")).toEqual([]);
  });

  it("runs every area for a path the map does not know", () => {
    expect(flagged("new-top-level/thing.ts")).toEqual([...AREAS]);
  });

  // A new app would otherwise fall back to every area on each change, silently.
  it("names the areas of every workspace", () => {
    const unmapped = [...workspaceDirectories().values()].filter((directory) => !workspaceAreas(directory));
    expect(unmapped).toEqual([]);
  });
});
