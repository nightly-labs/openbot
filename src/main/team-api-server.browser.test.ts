import { Effect } from "effect";

// @vitest-environment node

// The embedded browser over the wire: `src/main/team-api/route-browser.ts`.

import { EventEmitter } from "node:events";
import type { BrowserTab } from "@openbot/contracts/ipc";
import { TEAM_CURRENT_CAPABILITIES } from "@openbot/contracts/team-protocol/current";
import { TEAM_PROTOCOL_V6 } from "@openbot/contracts/team-protocol/v6";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAgents,
  createBrowser,
  createTeamApiFixture,
  jsonRequest,
  nextJsonEvent,
  stopTeamApiFixtures,
} from "./team-api-server-test-harness";

afterEach(stopTeamApiFixtures);

describe("TeamApiServer browser", () => {
  it("returns a bounded browser preview to an authenticated client", async () => {
    const { start, signIn } = await createTeamApiFixture("browser-preview", { configure: true });
    const capturePreview = vi.fn(() =>
      Effect.sync(() => ({
        dataUrl: "data:image/jpeg;base64,YWJj",
        width: 960,
        height: 600,
      })),
    );
    const { base } = await start({
      browser: createBrowser({ capturePreview }),
    });

    const token = await signIn();
    const preview = await jsonRequest<{ dataUrl: string; width: number; height: number }>(base, "/v1/browser/preview", {
      token: token,
      body: { tabId: "tab-login" },
    });

    expect(capturePreview).toHaveBeenCalledWith("tab-login");
    expect(preview).toEqual({ dataUrl: "data:image/jpeg;base64,YWJj", width: 960, height: 600 });
  });

  it("hides an administrator's MCP sign-in tab from a member", async () => {
    const { store, start, signIn } = await createTeamApiFixture("browser-private", { configure: true });
    const events = new EventEmitter();
    const tab = (id: string): BrowserTab => ({
      id,
      title: id,
      url: "https://example.com/",
      loading: false,
      ownerThreadId: null,
      ownerAgentId: null,
    });
    const tabs = [tab("tab-shared"), tab("tab-sign-in")];
    const activate = vi.fn(() => Effect.void);
    const { base, port } = await start({
      agents: createAgents({}, events),
      browser: createBrowser({
        listTabs: () => tabs,
        getDisplayState: () => ({ tabs, activeTabId: "tab-sign-in" }),
        activate,
        isPrivate: (tabId) => tabId === "tab-sign-in",
      }),
    });
    const member = store.openRemoteSession({
      sessionId: "browser-member",
      membershipId: "member-a",
      userId: "account-a",
      role: "member",
    });
    const asMember = {
      token: member.sessionToken,
      capabilities: [...TEAM_CURRENT_CAPABILITIES],
      protocol: TEAM_PROTOCOL_V6,
    };

    const ids = (list: { id: string }[]) => list.map(({ id }) => id);
    expect(ids(await jsonRequest<{ id: string }[]>(base, "/v1/browser/tabs", asMember))).toEqual(["tab-shared"]);
    const display = await jsonRequest<{ tabs: { id: string }[]; activeTabId: string | null }>(
      base,
      "/v1/browser/display",
      asMember,
    );
    expect({ tabs: ids(display.tabs), activeTabId: display.activeTabId }).toEqual({
      tabs: ["tab-shared"],
      activeTabId: null,
    });
    const refused = await fetch(`${base}/v1/browser/activate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${member.sessionToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tabId: "tab-sign-in" }),
    });
    expect(refused.status).toBe(404);
    expect(activate).not.toHaveBeenCalled();

    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/events`, [
      "openbot-team-v1",
      `openbot-token.${member.sessionToken}`,
    ]);
    const presence = nextJsonEvent(socket);
    await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve(), { once: true }));
    await presence;
    const initial = nextJsonEvent(socket);
    socket.send(
      JSON.stringify({
        type: "agent-event-scope",
        includeConversations: false,
        capabilities: ["agent-runtime-snapshots", "browser-control"],
      }),
    );
    await initial;
    const changed = new Promise<{ type: string; activeTabId: string | null; tabs: { id: string }[] }>((resolve) =>
      socket.addEventListener("message", (message) => resolve(JSON.parse(String(message.data))), { once: true }),
    );
    events.emit("event", { type: "browser-changed", tabs, activeTabId: "tab-sign-in" });
    const event = await changed;
    expect({ type: event.type, tabs: ids(event.tabs), activeTabId: event.activeTabId }).toEqual({
      type: "browser-changed",
      tabs: ["tab-shared"],
      activeTabId: null,
    });
    socket.close();

    const owner = await signIn();
    expect(ids(await jsonRequest<{ id: string }[]>(base, "/v1/browser/tabs", { token: owner }))).toEqual([
      "tab-shared",
      "tab-sign-in",
    ]);
  });
});
