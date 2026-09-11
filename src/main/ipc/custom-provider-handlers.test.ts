// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { CustomProviderIpcDependencies } from "./custom-provider-handlers";

type TrustedInvoke = (event: { senderFrame: { url: string } }, payload: unknown) => unknown;

// The real binder is used, so each endpoint is reached the way a renderer reaches it. `ipcMain` has
// no injectable seam and electron cannot load outside an Electron process, which is why this one
// stand-in exists; it records what the registrar bound.
const bound = new Map<string, TrustedInvoke>();
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, listener: TrustedInvoke) => bound.set(channel, listener) },
}));

const { customProviderIpcHandlers } = await import("./custom-provider-handlers");

const APP_FRAME = { senderFrame: { url: "openbot-app://app/index.html" } };

/**
 * A delete reads the catalogue to pick a fallback, then writes the file, then records the exclusion.
 * Nothing between those steps may belong to another endpoint change.
 */
describe("custom provider endpoint changes", () => {
  it("runs one complete endpoint change before the next one starts", async () => {
    // A development URL would make the app frame above untrusted, and the binder rejects the call
    // before it decodes anything.
    delete process.env.ELECTRON_RENDERER_URL;
    const steps: string[] = [];
    const releases = new Map<string, () => void>();
    const service: CustomProviderIpcDependencies["service"] = {
      // Held open, so the second delete has every chance to start inside the first one.
      removeCustomProvider: <T>(id: string, persist: () => Promise<T>) =>
        new Promise<T>((resolve) => {
          steps.push(`remove:${id}`);
          releases.set(id, () => resolve(persist()));
        }),
      noteCustomProviderSaved: (id: string): void => {
        steps.push(`saved:${id}`);
      },
      reloadOpenCodeConfig: async () => "restarted",
    };
    const customProviders: CustomProviderIpcDependencies["customProviders"] = {
      list: () => [],
      save: async () => [],
      remove: async (id: string) => {
        steps.push(`removed:${id}`);
        return [];
      },
    };

    const { customProviders: endpoints } = customProviderIpcHandlers({ service, customProviders });
    for (const [name, bind] of Object.entries(endpoints)) bind(name);
    const remove = bound.get("delete");
    expect(remove).toBeDefined();

    const first = remove?.(APP_FRAME, { id: "studio" });
    const second = remove?.(APP_FRAME, { id: "house" });
    await vi.waitFor(() => expect(releases.has("studio")).toBe(true));
    // The second change has not read anything yet, because the first one has not finished.
    expect(steps).toEqual(["remove:studio"]);

    releases.get("studio")?.();
    await first;
    await vi.waitFor(() => expect(releases.has("house")).toBe(true));
    releases.get("house")?.();
    await second;

    expect(steps).toEqual(["remove:studio", "removed:studio", "remove:house", "removed:house"]);
  });
});
