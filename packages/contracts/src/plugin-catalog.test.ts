import { describe, expect, it } from "vitest";
import { isReservedMcpServerName } from "./ipc-mcp-servers";
import type { MarketplacePluginDetail } from "./ipc-plugin-catalog";
import { isSkillCategory } from "./ipc-skills";
import { findMarketplacePlugin, MARKETPLACE_PLUGINS } from "./plugin-catalog";
import { createPluginShareUrl, isPluginSlug } from "./plugin-links";

/**
 * One array now feeds a public page and an installer, so what used to be a renderer literal is a
 * contract between two applications. These are the invariants each side assumes of the other.
 */
describe("the marketplace plugin catalog", () => {
  const plugins: MarketplacePluginDetail[] = MARKETPLACE_PLUGINS;

  it("is not empty", () => {
    expect(plugins.length).toBeGreaterThan(0);
  });

  it("gives every listing an id and a slug of its own", () => {
    expect(new Set(plugins.map((plugin) => plugin.id)).size).toBe(plugins.length);
    expect(new Set(plugins.map((plugin) => plugin.slug)).size).toBe(plugins.length);
  });

  it.each(plugins.map((plugin) => [plugin.slug, plugin] as const))("%s", (_slug, plugin) => {
    /* The site routes on the slug, so a slug it cannot serve is a listing with no page. */
    expect(isPluginSlug(plugin.slug)).toBe(true);
    /* A hand-edited share URL is how the app's "Copy link" and the page's address drift apart. */
    expect(plugin.shareUrl).toBe(createPluginShareUrl(plugin.slug));
    /* Both catalogs filter on the same enum. */
    expect(isSkillCategory(plugin.category)).toBe(true);
    expect(findMarketplacePlugin(plugin.slug)).toBe(plugin);

    for (const app of plugin.apps) {
      expect(isReservedMcpServerName(app.server.name)).toBe(false);

      if (app.server.transport === "http") {
        expect(app.server.url).toMatch(/^https?:\/\//u);
        expect(app.server.command ?? "").toBe("");
      } else {
        expect(app.server.command ?? "").not.toBe("");
      }

      const flows = app.server.auth ?? [];
      expect(new Set(flows.map((flow) => flow.id)).size).toBe(flows.length);
      for (const flow of flows) {
        if (flow.kind !== "key") continue;
        for (const field of flow.fields) {
          /* `applyMcpFlow` writes a field only when it names a header or an environment variable.
             A field that names neither collects a credential from the user and drops it. */
          expect(Boolean(field.header) || Boolean(field.env)).toBe(true);
        }
      }
    }
  });

  it("has no listing that installs nothing", () => {
    for (const plugin of plugins) {
      expect(plugin.apps.length + plugin.skills.length).toBeGreaterThan(0);
    }
  });

  it("gives nothing for a slug it does not hold", () => {
    expect(findMarketplacePlugin("not-a-plugin")).toBeNull();
  });
});
