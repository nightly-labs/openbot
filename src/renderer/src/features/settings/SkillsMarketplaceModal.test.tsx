import type {
  AgentSummary,
  InstalledSkill,
  MarketplaceAgentDetail,
  MarketplaceSkillPage,
  McpServerConfig,
  OpenBotDesktopApi,
  SkillSubmission,
} from "@openbot/contracts/ipc";
import type { MarketplacePluginDetail } from "@openbot/ui/features/settings/marketplace-plugins";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { type ComponentProps, createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AnalyticsEventName, type DesktopAnalyticsEvents, desktopAnalytics } from "../../analytics";
import { SkillsMarketplaceModal } from "./SkillsMarketplaceModal";

/** The install target is a listbox control, so a choice is a click on the trigger and on the option. */
async function chooseInstallTarget(name: string) {
  // The control names itself and the agent it holds, such as "Install to Writer".
  const trigger = screen.getByRole("button", { name: /^Install to/ });
  fireEvent.pointerDown(trigger, { pointerType: "mouse", button: 0 });
  fireEvent.click(trigger);
  const option = await screen.findByRole("option", { name });
  fireEvent.pointerDown(option, { pointerType: "mouse", button: 0 });
  fireEvent.pointerUp(option, { pointerType: "mouse", button: 0 });
  fireEvent.click(option);
  // The choice lands with the list, so the next step waits for the list to go.
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
}

const nativeCanvasGetContext = HTMLCanvasElement.prototype.getContext;

type MarketplaceProps = Partial<ComponentProps<typeof SkillsMarketplaceModal>>;

/**
 * The modal as the marketplace tests open it: no agents chosen, so every install picks a target.
 *
 * A case that drives a prop from a signal passes a function, so the read stays inside the render and
 * the prop stays reactive. Passing the object form there would freeze the signal at its first value.
 */
function renderMarketplace(props: MarketplaceProps | (() => MarketplaceProps) = {}) {
  const resolve = typeof props === "function" ? props : () => props;
  return render(() => (
    <SkillsMarketplaceModal open agents={[]} activeAgentId="" onOpenChange={() => undefined} {...resolve()} />
  ));
}

function openSkillsTab(): void {
  screen.getByRole("tab", { name: "Skills" }).click();
}

function installedSkill(skillId: string, name: string, overrides: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    skillId,
    slug: skillId,
    name,
    installedVersion: 2,
    availableVersion: 2,
    state: "installed",
    enabled: true,
    ...overrides,
  };
}
const trackMarketplaceAnalytics = vi.fn();

function trackScopedMarketplaceAnalytics<Name extends AnalyticsEventName>(
  name: Name,
  properties: DesktopAnalyticsEvents[Name],
) {
  trackMarketplaceAnalytics(name, properties);
}

describe("SkillsMarketplaceModal", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      writable: true,
      value: nativeCanvasGetContext,
    });
  });

  beforeEach(() => {
    trackMarketplaceAnalytics.mockClear();
    vi.spyOn(desktopAnalytics, "scope").mockImplementation(() => ({ track: trackScopedMarketplaceAnalytics }));
    const page: MarketplaceSkillPage = {
      skills: [
        {
          id: "release-notes",
          slug: "release-notes",
          name: "Release Notes",
          description: "Turns merged work into clear release notes.",
          category: "documents",
          creatorName: "Ada",
          version: 2,
          installs: 1280,
          featured: true,
          iconUrl: null,
          updatedAt: "2026-08-25T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    };
    const skills: OpenBotDesktopApi["skills"] = {
      localList: vi.fn(async () => []),
      localGet: vi.fn(),
      localCreate: vi.fn(),
      localRevise: vi.fn(),
      localInstall: vi.fn(),
      list: vi.fn(async (query) => (query?.category === "documents" ? page : { skills: [], nextCursor: null })),
      get: vi.fn(async () => {
        const skill = page.skills[0];
        if (!skill) throw new Error("Missing test skill.");
        return {
          ...skill,
          versionId: "release-notes-v2",
          bundleSha256: "abc123",
          files: ["SKILL.md", "references/template.md"],
          instructions: "Group changes by customer impact and call out breaking changes.",
        };
      }),
      listMine: vi.fn(async () => []),
      choosePackage: vi.fn(),
      submit: vi.fn(),
      listInstalled: vi.fn(async () => []),
      install: vi.fn(),
      uninstall: vi.fn(),
      setEnabled: vi.fn(),
    };
    window.openbot = { ...window.openbot, skills };
    window.openbot.marketplaceAgents = {
      list: vi.fn(async () => ({ agents: [], nextCursor: null })),
      get: vi.fn(),
      listMine: vi.fn(async () => []),
      preview: vi.fn(),
      submit: vi.fn(),
      install: vi.fn(),
    };
  });

  it.each([1, 2])("tries only a matching installed version %s for the selected agent", async (version) => {
    const installed = installedSkill("release-notes", "Release Notes", { installedVersion: version });
    let finishResearch: ((skills: InstalledSkill[]) => void) | undefined;
    vi.spyOn(window.openbot.skills, "listInstalled").mockImplementation((agentId) =>
      agentId === "writer"
        ? Promise.resolve([installed])
        : new Promise((resolve) => {
            finishResearch = resolve;
          }),
    );
    const onTrySkill = vi.fn();
    renderMarketplace({
      open: true,
      agents: [
        { id: "writer", name: "Writer" },
        { id: "research", name: "Research" },
      ],
      activeAgentId: "writer",
      onOpenChange: vi.fn(),
      onTrySkill: onTrySkill,
    });
    fireEvent.click(screen.getByRole("tab", { name: "Skills" }));
    fireEvent.click(await screen.findByRole("button", { name: "View Release Notes details" }));
    if (version !== 2) {
      expect(await screen.findByText("Update this skill to try this version.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try skill" })).toBeDisabled();
      expect(onTrySkill).not.toHaveBeenCalled();
      return;
    }
    await waitFor(() => expect(screen.getByRole("button", { name: "Try skill" })).toBeEnabled());
    await chooseInstallTarget("Research");
    await waitFor(() => expect(screen.getByRole("button", { name: "Try skill" })).toBeDisabled());
    await waitFor(() => expect(finishResearch).toBeDefined());
    finishResearch?.([]);
    expect(onTrySkill).not.toHaveBeenCalled();
    await chooseInstallTarget("Writer");
    await waitFor(() => expect(screen.getByRole("button", { name: "Try skill" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Try skill" }));
    expect(onTrySkill).toHaveBeenCalledWith("writer", expect.objectContaining({ id: "release-notes" }));
  });

  it("names an unread skills list instead of asking for an install that may exist", async () => {
    let failRead: ((error: Error) => void) | undefined;
    vi.spyOn(window.openbot.skills, "listInstalled").mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          failRead = reject;
        }),
    );
    renderMarketplace({
      open: true,
      agents: [{ id: "writer", name: "Writer" }],
      activeAgentId: "writer",
      onOpenChange: vi.fn(),
      onTrySkill: vi.fn(),
    });
    fireEvent.click(screen.getByRole("tab", { name: "Skills" }));
    fireEvent.click(await screen.findByRole("button", { name: "View Release Notes details" }));

    expect(await screen.findByText("Reading this agent's skills…")).toBeInTheDocument();
    await waitFor(() => expect(failRead).toBeDefined());
    failRead?.(new Error("Skill list unavailable."));

    // A list that could not be read looks exactly like an empty one. Naming a missing skill here
    // sends the user to install what the agent may already have.
    expect(await screen.findByText("OpenBot could not read this agent's skills. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try skill" })).toBeDisabled();
  });

  it("keeps a failed skills read after an install instead of asking for the install again", async () => {
    const installed = installedSkill("release-notes", "Release Notes");
    let failRefresh: ((error: Error) => void) | undefined;
    let reads = 0;
    vi.spyOn(window.openbot.skills, "listInstalled").mockImplementation(() => {
      reads += 1;
      if (reads === 1) return Promise.resolve([]);
      return new Promise((_resolve, reject) => {
        failRefresh = reject;
      });
    });
    vi.spyOn(window.openbot.skills, "install").mockResolvedValue(installed);
    renderMarketplace({
      open: true,
      agents: [{ id: "writer", name: "Writer" }],
      activeAgentId: "writer",
      onOpenChange: vi.fn(),
      onTrySkill: vi.fn(),
    });
    fireEvent.click(screen.getByRole("tab", { name: "Skills" }));
    fireEvent.click(await screen.findByRole("button", { name: "View Release Notes details" }));
    expect(await screen.findByText("Install this skill for an agent to try it.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Install skill" }));
    await waitFor(() => expect(failRefresh).toBeDefined());
    failRefresh?.(new Error("Skill list unavailable."));

    // The skill is installed, but the list on screen is older than the install. Asking for the
    // install again would repeat work the agent has already done.
    expect(await screen.findByText("OpenBot could not read this agent's skills. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try skill" })).toBeDisabled();
  });

  it("opens the approved skill instructions inside the marketplace modal", async () => {
    renderMarketplace({
      open: true,
      agents: [{ id: "writer", name: "Writer" }],
      activeAgentId: "writer",
      onOpenChange: () => undefined,
    });
    openSkillsTab();
    const listing = await screen.findByRole("button", { name: "View Release Notes details" });
    listing.click();
    const details = await screen.findByRole("region", { name: "Release Notes details" });
    expect(within(details).getByRole("button", { name: "Try skill" })).toBeDisabled();
    expect(within(details).getByText(/Group changes by customer impact/u)).toBeInTheDocument();
    expect(trackMarketplaceAnalytics).toHaveBeenCalledWith("marketplace_action", {
      entity: "skill",
      action: "view",
      result: "succeeded",
    });
    screen.getByRole("button", { name: "Marketplace" }).click();
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Release Notes details" })).not.toBeInTheDocument(),
    );
  });

  it("installs separate copies of an existing agent without a routine confirmation", async () => {
    const detail: MarketplaceAgentDetail = {
      id: "research-agent",
      versionId: "research-agent-v1",
      name: "Research Agent",
      title: "Finds evidence quickly",
      description: "Searches sources and produces concise cited findings.",
      creatorName: "Ada",
      version: 1,
      installs: 42,
      featured: true,
      avatarSeed: "research-agent",
      avatarHue: 215,
      avatarUrl: "https://example.com/research-agent.png",
      skillCount: 1,
      routineCount: 1,
      activeRoutineCount: 1,
      updatedAt: "2026-08-25T00:00:00.000Z",
      skills: [{ skillId: "research", versionId: "research-v1", slug: "research", name: "Research", version: 1 }],
      routines: [
        {
          name: "Daily brief",
          instruction: "Prepare a brief.",
          active: true,
          schedule: { kind: "daily", time: "09:00" },
        },
      ],
    };
    const installedAgent = {
      id: "bot-installed",
      name: detail.name,
      title: detail.title,
      description: detail.description,
      notifications: true,
      provider: "codex",
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      threadId: null,
      workspacePath: "/tmp/bot-installed",
      preview: "No messages yet",
      updatedAt: null,
      avatarSeed: detail.avatarSeed,
      avatarHue: detail.avatarHue,
      avatarUrl: detail.avatarUrl,
    } satisfies AgentSummary;
    window.openbot.marketplaceAgents.list = vi.fn(async (query) => ({
      agents: query?.category && query.category !== "other" ? [] : [detail],
      nextCursor: null,
    }));
    window.openbot.marketplaceAgents.get = vi.fn(async () => detail);
    window.openbot.marketplaceAgents.install = vi.fn(async () => ({ agent: installedAgent }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onInstalled = vi.fn();

    renderMarketplace({
      open: true,
      activeAgentId: "",
      onOpenChange: () => undefined,
      onAgentInstalled: onInstalled,
      agents: [
        {
          id: "existing-research-agent",
          name: detail.name,
          marketplaceSource: {
            listingId: detail.id,
            versionId: detail.versionId,
            version: detail.version,
            skillIds: [],
            routineIds: [],
          },
        },
      ],
    });
    expect(screen.getByRole("tab", { name: "Agents" })).toHaveAttribute("aria-selected", "true");
    (await screen.findByRole("button", { name: "View Research Agent details" })).click();
    (await screen.findByRole("button", { name: "Install agent" })).click();

    await waitFor(() => expect(window.openbot.marketplaceAgents.install).toHaveBeenCalled());
    expect(confirm).not.toHaveBeenCalled();
    expect(window.openbot.marketplaceAgents.install).toHaveBeenCalledWith(
      expect.objectContaining({ listingId: detail.id }),
    );
    await waitFor(() => expect(onInstalled).toHaveBeenCalledWith(installedAgent));
    expect(trackMarketplaceAnalytics).toHaveBeenCalledWith("marketplace_action", {
      entity: "agent",
      action: "install",
      result: "succeeded",
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Install agent" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Install agent" }));
    await waitFor(() => expect(onInstalled).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(window.openbot.marketplaceAgents.install).mock.calls;
    expect(calls.map(([input]) => input.agentId)).toEqual([undefined, undefined]);
    expect(calls[0]?.[0].receiptId).not.toBe(calls[1]?.[0].receiptId);
  });

  it("blocks concurrent agent detail requests and permits another selection after failure", async () => {
    const agent = {
      id: "research-agent",
      name: "Research Agent",
      title: "Finds evidence quickly",
      description: "Searches sources.",
      creatorName: "Ada",
      version: 1,
      installs: 42,
      featured: true,
      avatarSeed: "research-agent",
      avatarHue: 215,
      avatarUrl: null,
      skillCount: 1,
      routineCount: 0,
      activeRoutineCount: 0,
      updatedAt: "2026-08-25T00:00:00.000Z",
    } as const;
    window.openbot.marketplaceAgents.list = vi.fn(async (query) => ({
      agents:
        query?.category && query.category !== "other"
          ? []
          : [agent, { ...agent, id: "writer-agent", name: "Writer Agent" }],
      nextCursor: null,
    }));
    const pending = Promise.withResolvers<MarketplaceAgentDetail>();
    window.openbot.marketplaceAgents.get = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockRejectedValue(new Error("private response"));

    renderMarketplace();
    const research = await screen.findByRole("button", { name: "View Research Agent details" });
    const writer = await screen.findByRole("button", { name: "View Writer Agent details" });
    fireEvent.click(research);
    fireEvent.click(writer);
    expect(window.openbot.marketplaceAgents.get).toHaveBeenCalledTimes(1);
    pending.reject(new Error("private response"));

    await waitFor(() =>
      expect(trackMarketplaceAnalytics).toHaveBeenCalledWith("marketplace_action", {
        entity: "agent",
        action: "view",
        result: "failed",
        failure_code: "load_failed",
      }),
    );
    expect(window.openbot.marketplaceAgents.install).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "View Writer Agent details" }));
    await waitFor(() => expect(window.openbot.marketplaceAgents.get).toHaveBeenCalledWith("writer-agent"));
  });

  it("offers updates separately and allows installing agents that are already current", async () => {
    const baseAgent = {
      name: "Research Agent",
      title: "Finds evidence quickly",
      description: "Searches sources and produces concise cited findings.",
      creatorName: "Ada",
      installs: 42,
      featured: true,
      avatarSeed: "research-agent",
      avatarHue: 215,
      avatarUrl: null,
      skillCount: 1,
      routineCount: 0,
      activeRoutineCount: 0,
      updatedAt: "2026-08-25T00:00:00.000Z",
    } as const;
    window.openbot.marketplaceAgents.list = vi.fn(async (query) => ({
      agents:
        query?.category && query.category !== "other"
          ? []
          : [
              { ...baseAgent, id: "research-agent", version: 2 },
              { ...baseAgent, id: "writer-agent", name: "Writer Agent", version: 1 },
            ],
      nextCursor: null,
    }));

    window.openbot.marketplaceAgents.get = vi.fn(async (id) => ({
      ...baseAgent,
      id,
      name: id === "research-agent" ? "Research Agent" : "Writer Agent",
      version: id === "research-agent" ? 2 : 1,
      versionId: id === "research-agent" ? "research-v2" : "writer-v1",
      skills: [],
      routines: [],
    }));
    renderMarketplace({
      open: true,
      agents: [
        {
          id: "research-local",
          name: "Research Agent",
          marketplaceSource: {
            listingId: "research-agent",
            versionId: "research-v1",
            version: 1,
            skillIds: [],
            routineIds: [],
          },
        },
        {
          id: "writer-local",
          name: "Writer Agent",
          marketplaceSource: {
            listingId: "writer-agent",
            versionId: "writer-v1",
            version: 1,
            skillIds: [],
            routineIds: [],
          },
        },
        {
          id: "research-current-copy",
          name: "Research Agent",
          marketplaceSource: {
            listingId: "research-agent",
            versionId: "research-v2",
            version: 2,
            skillIds: [],
            routineIds: [],
          },
        },
      ],
      activeAgentId: "research-local",
      onOpenChange: () => undefined,
    });

    fireEvent.click(await screen.findByRole("button", { name: "View Research Agent details" }));
    expect(await screen.findByRole("button", { name: "Update agent" })).toBeEnabled();
    // The header crumb names the open page and is the only way back out of it.
    expect(screen.getByRole("dialog", { name: "Research Agent" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Marketplace" }));
    expect(await screen.findByRole("dialog", { name: "Marketplace" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "View Writer Agent details" }));
    expect(await screen.findByRole("button", { name: "Install agent" })).toBeEnabled();
  });

  it("offers a detail section only for the content the agent carries", async () => {
    const baseAgent = {
      name: "Research Agent",
      title: "Finds evidence quickly",
      description: "Searches sources and produces concise cited findings.",
      creatorName: "Ada",
      version: 1,
      installs: 42,
      featured: true,
      avatarSeed: "research-agent",
      avatarHue: 215,
      avatarUrl: null,
      skillCount: 1,
      routineCount: 0,
      activeRoutineCount: 0,
      updatedAt: "2026-08-25T00:00:00.000Z",
    } as const;
    window.openbot.marketplaceAgents.list = vi.fn(async () => ({
      agents: [
        { ...baseAgent, id: "research-agent" },
        { ...baseAgent, id: "writer-agent", name: "Writer Agent" },
      ],
      nextCursor: null,
    }));
    window.openbot.marketplaceAgents.get = vi.fn(async (id) => ({
      ...baseAgent,
      id,
      name: id === "research-agent" ? "Research Agent" : "Writer Agent",
      versionId: `${id}-v1`,
      skills:
        id === "research-agent"
          ? [{ skillId: "research", versionId: "research-v1", slug: "research", name: "Research", version: 1 }]
          : [],
      routines:
        id === "research-agent"
          ? []
          : [
              {
                name: "Daily brief",
                instruction: "Prepare a brief.",
                active: true,
                schedule: { kind: "daily" as const, time: "09:00" },
              },
            ],
    }));
    renderMarketplace();

    fireEvent.click(await screen.findByRole("button", { name: "View Research Agent details" }));
    expect(await screen.findByRole("button", { name: /^Skills/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Routines/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Marketplace" }));
    fireEvent.click(await screen.findByRole("button", { name: "View Writer Agent details" }));
    expect(await screen.findByRole("button", { name: /^Routines/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Skills / })).toBeNull();
  });

  it("keeps loaded pages and restores the category filter and focus after details", async () => {
    const detail = await window.openbot.skills.get("release-notes");
    window.openbot.skills.list = vi.fn<OpenBotDesktopApi["skills"]["list"]>(async (query) => ({
      skills:
        query?.category === "documents"
          ? [{ ...detail, id: query.cursor ? "second" : detail.id, name: query.cursor ? "Second skill" : detail.name }]
          : [],
      nextCursor: query?.category === "documents" && !query.cursor ? "next-page" : null,
    }));
    renderMarketplace();
    openSkillsTab();
    fireEvent.click(await screen.findByRole("button", { name: "View all Documents skills" }));
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("button", { name: "View Second skill details" })).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "View Release Notes details" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "Marketplace" }));
    expect(await screen.findByRole("button", { name: "View Second skill details" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Documents" })).toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "All skills" }));
    await screen.findByRole("button", { name: "View all Documents skills" });
  });

  it("offers a category page only when the overview does not already show every listing", async () => {
    const detail = await window.openbot.skills.get("release-notes");
    window.openbot.skills.list = vi.fn<OpenBotDesktopApi["skills"]["list"]>(async (query) => {
      if (query?.category === "documents") return { skills: [detail], nextCursor: null };
      if (query?.category === "design")
        return {
          skills: [{ ...detail, id: "overview-design", category: "design", name: "Overview design" }],
          nextCursor: "next-page",
        };
      return { skills: [], nextCursor: null };
    });
    renderMarketplace();
    openSkillsTab();

    await screen.findByRole("button", { name: "View all Design skills" });
    expect(screen.getByRole("heading", { name: "Documents" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View all Documents skills" })).toBeNull();
  });

  it("keeps newer category results when an older request finishes last", async () => {
    const detail = await window.openbot.skills.get("release-notes");
    let finishOld!: (page: MarketplaceSkillPage) => void;
    const oldPage = new Promise<MarketplaceSkillPage>((resolve) => {
      finishOld = resolve;
    });
    window.openbot.skills.list = vi.fn<OpenBotDesktopApi["skills"]["list"]>(async (query) => {
      if (query?.limit === 50 && query.category === "design") return oldPage;
      return {
        skills: query?.category === "design" ? [{ ...detail, category: "design", name: "Overview design" }] : [],
        nextCursor: query?.category === "design" ? "next-page" : null,
      };
    });
    renderMarketplace();
    openSkillsTab();
    fireEvent.click(await screen.findByRole("button", { name: "View all Design skills" }));
    fireEvent.click(await screen.findByRole("button", { name: "All skills" }));
    await screen.findByRole("button", { name: "View Overview design details" });
    vi.useFakeTimers();
    finishOld({ skills: [detail], nextCursor: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(await screen.findByRole("button", { name: "View Overview design details" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View Release Notes details" })).not.toBeInTheDocument();
  });

  it("collects the keystrokes of a word into one search request", async () => {
    vi.useFakeTimers();
    renderMarketplace();
    openSkillsTab();
    await Promise.resolve();
    await Promise.resolve();
    const list = vi.mocked(window.openbot.skills.list);
    list.mockClear();

    const field = screen.getByLabelText("Search skills");
    for (const value of ["s", "so", "sol", "sola", "solan", "solana"]) {
      fireEvent.input(field, { target: { value } });
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(list).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(220);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ query: "solana" }));
  });

  it("narrows the loaded listings while the search request is still open", async () => {
    const listed = (id: string, name: string) => ({
      id,
      slug: id,
      name,
      description: "A skill for the release desk.",
      category: "documents" as const,
      creatorName: "Ada",
      version: 1,
      installs: 10,
      featured: false,
      iconUrl: null,
      updatedAt: "2026-08-25T00:00:00.000Z",
    });
    const loaded: MarketplaceSkillPage = {
      skills: [listed("release-notes", "Release Notes"), listed("standup-digest", "Standup Digest")],
      nextCursor: null,
    };
    window.openbot.skills.list = vi.fn(async (query) => {
      if (query?.query) return new Promise<MarketplaceSkillPage>(() => undefined);
      return query?.category === "documents" ? loaded : { skills: [], nextCursor: null };
    });
    renderMarketplace();
    openSkillsTab();
    await screen.findByRole("button", { name: "View Standup Digest details" });

    fireEvent.input(screen.getByLabelText("Search skills"), { target: { value: "standup" } });

    // The rows narrow on the keystroke itself, before the request for it is sent or answered.
    await waitFor(() => expect(screen.queryByRole("button", { name: "View Release Notes details" })).toBeNull());
    expect(screen.getByRole("button", { name: "View Standup Digest details" })).toBeInTheDocument();
  });

  it("uses category and card skeletons while discover listings load", async () => {
    let resolvePage!: (page: MarketplaceSkillPage) => void;
    const pendingPage = new Promise<MarketplaceSkillPage>((resolve) => {
      resolvePage = resolve;
    });
    window.openbot.skills.list = vi.fn(() => pendingPage);

    renderMarketplace({
      open: true,
      agents: [{ id: "writer", name: "Writer" }],
      activeAgentId: "writer",
      onOpenChange: () => undefined,
    });
    openSkillsTab();

    expect(await screen.findByRole("status", { name: "Loading skills" })).toBeInTheDocument();

    resolvePage({ skills: [], nextCursor: null });
    await waitFor(() => expect(screen.queryByRole("status", { name: "Loading skills" })).not.toBeInTheDocument());
  });

  it("offers an update when a newer detail version arrives after the installed list was loaded", async () => {
    const installed: InstalledSkill[] = [
      {
        skillId: "release-notes",
        slug: "release-notes",
        name: "Release Notes",
        installedVersion: 2,
        availableVersion: 2,
        state: "installed",
      },
    ];
    window.openbot.skills.listInstalled = vi.fn(async () => installed);
    renderMarketplace({
      open: true,
      agents: [{ id: "writer", name: "Writer" }],
      activeAgentId: "writer",
      onOpenChange: () => undefined,
    });
    openSkillsTab();

    // aria-selected marks which marketplace section is showing
    // (SkillsMarketplaceModal.tsx:413,423); nothing else asserts it.
    await waitFor(() => expect(screen.getByRole("tab", { name: "Skills" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("tab", { name: "Agents" })).toHaveAttribute("aria-selected", "false");

    const listing = await screen.findByRole("button", { name: "View Release Notes details" });
    listing.click();

    expect(await screen.findByRole("region", { name: "Release Notes details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Installed" })).toBeDisabled();
    const detail = await window.openbot.skills.get("release-notes");
    window.openbot.skills.get = vi.fn(async () => ({ ...detail, version: 3, versionId: "release-notes-v3" }));
    fireEvent.click(screen.getByRole("button", { name: "Marketplace" }));
    fireEvent.click(await screen.findByRole("button", { name: "View Release Notes details" }));
    expect(await screen.findByRole("button", { name: "Update skill" })).toBeEnabled();
  });

  it("announces detail loading with its own live region", async () => {
    // SkillsMarketplaceModal.tsx:1445 is a second status region named
    // "Loading skill"; the listing skeleton at :1409 is "Loading skills" and
    // is covered separately, so detail loading needs its own assertion.
    const loadedDetail = await window.openbot.skills.get("release-notes");
    let resolveDetail!: (detail: typeof loadedDetail) => void;
    window.openbot.skills.get = vi.fn(
      () =>
        new Promise<typeof loadedDetail>((resolve) => {
          resolveDetail = resolve;
        }),
    );

    renderMarketplace({
      open: true,
      agents: [{ id: "writer", name: "Writer" }],
      activeAgentId: "writer",
      onOpenChange: () => undefined,
    });
    openSkillsTab();
    const listing = await screen.findByRole("button", { name: "View Release Notes details" });
    listing.click();

    expect(await screen.findByRole("status", { name: "Loading skill" })).toBeInTheDocument();

    resolveDetail(loadedDetail);
    await screen.findByRole("region", { name: "Release Notes details" });
  });

  it.each(["skills", "agents"] as const)("includes the account photo when submitting %s", async (kind) => {
    window.openbot.skills.choosePackage = vi.fn(async () => ({
      draftId: "draft",
      name: "Research",
      description: "Research sources.",
      slug: "research",
      files: ["SKILL.md"],
      size: 100,
    }));
    window.openbot.marketplaceAgents.preview = vi.fn(async () => ({
      agentId: "research",
      name: "Research",
      title: "Research sources",
      description: "Research sources.",
      avatarSeed: "research",
      avatarHue: null,
      avatarUrl: null,
      skills: [],
      routines: [],
    }));
    renderMarketplace({
      open: true,
      agents: [{ id: "research", name: "Research" }],
      activeAgentId: "research",
      onOpenChange: () => undefined,
    });
    if (kind === "skills") fireEvent.click(screen.getByRole("tab", { name: "Skills" }));
    await fireEvent.pointerDown(screen.getByRole("button", { name: "Marketplace menu" }), {
      pointerType: "mouse",
      button: 0,
    });
    await fireEvent.pointerUp(
      await screen.findByRole("menuitem", { name: kind === "skills" ? "Add skill" : "Add agent" }),
      { button: 0 },
    );
    if (kind === "skills") {
      const choosePackage = await screen.findByRole("button", { name: "Choose folder or ZIP" });
      expect(window.openbot.skills.choosePackage).not.toHaveBeenCalled();
      fireEvent.click(choosePackage);
    }
    fireEvent.click(await screen.findByRole("button", { name: "Submit for review" }));
    const submit = kind === "skills" ? window.openbot.skills.submit : window.openbot.marketplaceAgents.submit;
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ showCreatorAvatar: true })));
  });

  it("updates the publication preview when the selected agent changes and ignores stale previews", async () => {
    const preview = (agentId: string) => ({
      agentId,
      name: `${agentId} preview`,
      title: "",
      description: "Prepared for publication.",
      avatarSeed: agentId,
      avatarHue: null,
      avatarUrl: null,
      skills: [],
      routines: [],
    });
    let resolveFirst!: (value: ReturnType<typeof preview>) => void;
    const first = new Promise<ReturnType<typeof preview>>((resolve) => {
      resolveFirst = resolve;
    });
    window.openbot.marketplaceAgents.preview = vi.fn((id) => (id === "first" ? first : Promise.resolve(preview(id))));
    renderMarketplace({
      open: true,
      agents: [
        { id: "first", name: "First" },
        { id: "second", name: "Second" },
      ],
      activeAgentId: "first",
      onOpenChange: () => undefined,
    });
    await fireEvent.pointerDown(screen.getByRole("button", { name: "Marketplace menu" }), {
      pointerType: "mouse",
      button: 0,
    });
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "My submissions" }), { button: 0 });
    const selector = await screen.findByRole("combobox", { name: "Agent to publish" });
    fireEvent.change(selector, { target: { value: "second" } });
    expect(await screen.findByText("second preview")).toBeInTheDocument();
    fireEvent.change(selector, { target: { value: "first" } });
    await waitFor(() => expect(window.openbot.marketplaceAgents.preview).toHaveBeenCalledWith("first"));
    expect(screen.getByText("second preview")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeDisabled();
    const category = screen.getByRole("combobox", { name: "Agent category" });
    category.focus();
    fireEvent.change(screen.getByRole("combobox", { name: "Agent to publish" }), { target: { value: "second" } });
    expect(await screen.findByText("second preview")).toBeInTheDocument();
    resolveFirst(preview("first"));
    await first;
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit for review" })).toBeEnabled());
    expect(category).toHaveFocus();
    fireEvent.click(await screen.findByRole("button", { name: "Submit for review" }));
    await waitFor(() =>
      expect(window.openbot.marketplaceAgents.submit).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: "second" }),
      ),
    );
    expect(screen.queryByText("first preview")).not.toBeInTheDocument();
  });

  it("opens pending submission details from its row", async () => {
    const submissions: SkillSubmission[] = [
      {
        id: "release-notes-v3",
        skillId: "release-notes",
        slug: "release-notes",
        name: "Release Notes",
        description: "Turns merged work into clear release notes.",
        category: "documents",
        version: 3,
        status: "pending",
        rejectionNote: null,
        iconUrl: null,
        createdAt: "2026-08-25T00:00:00.000Z",
      },
    ];
    window.openbot.skills.listMine = vi.fn(async () => submissions);
    renderMarketplace();
    openSkillsTab();

    await fireEvent.pointerDown(screen.getByRole("button", { name: "Marketplace menu" }), {
      pointerType: "mouse",
      button: 0,
    });
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "My submissions" }), { button: 0 });
    const listing = await screen.findByRole("button", { name: "View Release Notes submission details" });
    listing.click();

    const details = await screen.findByRole("region", { name: "Release Notes submission details" });
    expect(within(details).getByRole("heading", { name: "Review status" })).toBeInTheDocument();
    expect(within(details).getByText("pending")).toBeInTheDocument();
  });

  it("keeps the selected icon filename visible and previews it", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 512, height: 512, close: vi.fn() })),
    );
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({
        drawImage: vi.fn(),
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
      })),
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob([new Uint8Array([1])], { type: "image/webp" }));
    });
    window.openbot.skills.choosePackage = vi.fn(async () => ({
      draftId: "release-notes-draft",
      name: "Release Notes",
      description: "Turns merged work into clear release notes.",
      slug: "release-notes",
      files: ["SKILL.md"],
      size: 1024,
    }));
    renderMarketplace();
    openSkillsTab();

    await fireEvent.pointerDown(screen.getByRole("button", { name: "Marketplace menu" }), {
      pointerType: "mouse",
      button: 0,
    });
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "My submissions" }), { button: 0 });
    (await screen.findByRole("button", { name: "Choose folder or ZIP" })).click();
    const input = await screen.findByLabelText("Icon (optional)");
    const icon = new File(["icon"], "skill-icon.png", { type: "image/png" });
    Object.defineProperty(input, "value", {
      configurable: true,
      writable: true,
      value: "C:\\fakepath\\skill-icon.png",
    });

    fireEvent.change(input, { target: { files: [icon] } });

    const iconPreview = await screen.findByRole("img", { name: "Skill icon preview" });
    expect(iconPreview).toHaveAttribute("src", expect.stringMatching(/^data:image\/webp;base64,/u));
    expect(input).toHaveValue("C:\\fakepath\\skill-icon.png");
  });

  it("explains how to resolve a duplicate skill name", async () => {
    window.openbot.skills.choosePackage = vi.fn(async () => ({
      draftId: "release-notes-draft",
      name: "Release Notes",
      description: "Turns merged work into clear release notes.",
      slug: "release-notes",
      files: ["SKILL.md"],
      size: 1024,
    }));
    window.openbot.skills.submit = vi.fn(async () => {
      throw new Error("Error invoking remote method 'skills:submit': Error: A skill with this name already exists.");
    });
    renderMarketplace();
    openSkillsTab();

    await fireEvent.pointerDown(screen.getByRole("button", { name: "Marketplace menu" }), {
      pointerType: "mouse",
      button: 0,
    });
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "My submissions" }), { button: 0 });
    (await screen.findByRole("button", { name: "Choose folder or ZIP" })).click();
    (await screen.findByRole("button", { name: "Submit for review" })).click();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That skill name is already taken. Choose a different name in SKILL.md, then try again.",
    );
  });
  it("drops a skill detail answer that arrives after the reader went back", async () => {
    const detail = await window.openbot.skills.get("release-notes");
    const pending = Promise.withResolvers<typeof detail>();
    window.openbot.skills.get = vi.fn(() => pending.promise);
    renderMarketplace();
    openSkillsTab();
    fireEvent.click(await screen.findByRole("button", { name: "View Release Notes details" }));

    fireEvent.click(await screen.findByRole("button", { name: "Marketplace" }));
    pending.resolve(detail);

    // The answer lands and is reported, and the page it was read for stays closed.
    await waitFor(() =>
      expect(trackMarketplaceAnalytics).toHaveBeenCalledWith("marketplace_action", {
        entity: "skill",
        action: "view",
        result: "succeeded",
      }),
    );
    expect(screen.queryByRole("button", { name: "Marketplace" })).toBeNull();
    expect(screen.queryByText(detail.instructions)).toBeNull();
    expect(screen.getByRole("button", { name: "View Release Notes details" })).toBeInTheDocument();
  });

  it("closes an open agent page when the management menu changes the listing", async () => {
    const detail: MarketplaceAgentDetail = {
      id: "research-agent",
      versionId: "research-agent-v1",
      name: "Research Agent",
      title: "Finds evidence quickly",
      description: "Searches sources and produces concise cited findings.",
      creatorName: "Ada",
      version: 1,
      installs: 42,
      featured: true,
      avatarSeed: "research-agent",
      avatarHue: 215,
      avatarUrl: null,
      skillCount: 0,
      routineCount: 0,
      activeRoutineCount: 0,
      updatedAt: "2026-08-25T00:00:00.000Z",
      skills: [],
      routines: [],
    };
    window.openbot.marketplaceAgents.list = vi.fn(async (query) => ({
      agents: query?.category && query.category !== "other" ? [] : [detail],
      nextCursor: null,
    }));
    window.openbot.marketplaceAgents.get = vi.fn(async () => detail);
    renderMarketplace();
    fireEvent.click(await screen.findByRole("button", { name: "View Research Agent details" }));
    await screen.findByRole("button", { name: "Marketplace" });

    await fireEvent.pointerDown(screen.getByRole("button", { name: "Marketplace menu" }), {
      pointerType: "mouse",
      button: 0,
    });
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "Discover" }), { button: 0 });

    expect(await screen.findByRole("button", { name: "View Research Agent details" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marketplace" })).toBeNull();
  });

  it("stops paging when the search changes until the first page of the new query arrives", async () => {
    const listed = {
      id: "release-notes",
      slug: "release-notes",
      name: "Release Notes",
      description: "Turns merged work into clear release notes.",
      category: "documents" as const,
      creatorName: "Ada",
      version: 1,
      installs: 10,
      featured: false,
      iconUrl: null,
      updatedAt: "2026-08-25T00:00:00.000Z",
    };
    const search = Promise.withResolvers<MarketplaceSkillPage>();
    window.openbot.skills.list = vi.fn(async (query) => {
      if (query?.query) return search.promise;
      return query?.category === "documents"
        ? { skills: [listed], nextCursor: "next-page" }
        : { skills: [], nextCursor: null };
    });
    renderMarketplace();
    openSkillsTab();
    fireEvent.click(await screen.findByRole("button", { name: "View all Documents skills" }));
    await screen.findByRole("button", { name: "Load more" });

    fireEvent.input(screen.getByLabelText("Search skills"), { target: { value: "release" } });

    // The cursor belongs to the former query, so paging waits for the page of the new one.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Load more" })).toBeNull());
    search.resolve({ skills: [listed], nextCursor: "search-page" });
    expect(await screen.findByRole("button", { name: "Load more" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() =>
      expect(window.openbot.skills.list).toHaveBeenCalledWith(
        expect.objectContaining({ query: "release", cursor: "search-page" }),
      ),
    );
  });

  /**
   * A plugin's app is an MCP server, which the host holds rather than one agent. The install must
   * therefore reach the server the modal was given, and a plugin whose app is already on that host
   * must not offer the install a second time.
   */
  describe("plugins", () => {
    const plugin: MarketplacePluginDetail = {
      id: "plugin-aave",
      slug: "aave",
      name: "Aave",
      tagline: "Aave data and transactions",
      description: "Live markets, positions and prepared transactions.",
      category: "data-analytics",
      creatorName: "avara.xyz",
      creatorAvatarUrl: null,
      iconUrl: null,
      version: "1.0.0",
      installs: 0,
      featured: true,
      updatedAt: "2026-09-18T00:00:00.000Z",
      shareUrl: "https://openbot.run/plugins/aave",
      prompts: [],
      apps: [
        {
          id: "app-aave-mcp",
          name: "Aave",
          description: "Markets and prepared transactions, over one MCP server.",
          iconUrl: null,
          server: { name: "aave", transport: "http", url: "https://mcp.aave.com/mcp" },
        },
      ],
      skills: [],
      websiteUrl: null,
      privacyPolicyUrl: null,
      termsUrl: null,
    };
    const installedYield = installedSkill("skill-yield", "Yield analysis", {
      slug: "yield-analysis",
      installedVersion: 3,
      availableVersion: 3,
    });
    const app = plugin.apps[0];
    if (app?.server.transport !== "http") throw new Error("The plugin under test must publish one http app.");
    const appUrl = app.server.url;

    async function openPluginPage() {
      fireEvent.click(screen.getByRole("tab", { name: "Plugins" }));
      fireEvent.click(await screen.findByRole("button", { name: "View Aave details" }));
    }

    it("installs the app on the host it was given", async () => {
      const saved: McpServerConfig[] = [];
      const saveMcpServer: OpenBotDesktopApi["agent"]["saveMcpServer"] = vi.fn(async (input) => {
        saved.push(input.config);
        return saved;
      });
      window.openbot.agent = { ...window.openbot.agent, listMcpServers: vi.fn(async () => []), saveMcpServer };
      renderMarketplace({
        open: true,
        agents: [{ id: "writer", name: "Writer" }],
        activeAgentId: "writer",
        onOpenChange: vi.fn(),
        plugins: [plugin],
        pluginServerId: "local",
      });
      await openPluginPage();
      fireEvent.click(await screen.findByRole("button", { name: "Install plugin" }));

      await waitFor(() => expect(saveMcpServer).toHaveBeenCalled());
      // The id is empty because the store mints one. An id it does not hold reads as an edit of a
      // removed row, and the save is refused.
      expect(saveMcpServer).toHaveBeenCalledWith(
        { config: expect.objectContaining({ id: "", name: app.server.name, transport: "http", url: appUrl }) },
        "local",
      );
      // The one control turns into the way back out, which is how the page says it is installed.
      expect(await screen.findByRole("button", { name: "Uninstall plugin" })).toBeInTheDocument();
    });

    /**
     * A listing that declares a way in is connected before it is installed, and what is saved is
     * what connected. A key that never reached the server would be stored as a working app, and the
     * failure would arrive inside an agent's next answer instead of here.
     */
    const withKey: MarketplacePluginDetail = {
      ...plugin,
      apps: [
        {
          ...app,
          server: {
            ...app.server,
            auth: [
              {
                id: "api-key",
                kind: "key",
                label: "API key",
                fields: [{ id: "token", label: "API key", header: "Authorization", prefix: "Bearer " }],
              },
            ],
          },
        },
      ],
    };

    it("saves the configuration the connect dialog proved", async () => {
      const saveMcpServer: OpenBotDesktopApi["agent"]["saveMcpServer"] = vi.fn(async (input) => [input.config]);
      const testMcpServer: OpenBotDesktopApi["agent"]["testMcpServer"] = vi.fn(async () => ({
        toolCount: 4,
        error: null,
      }));
      window.openbot.agent = {
        ...window.openbot.agent,
        listMcpServers: vi.fn(async () => []),
        saveMcpServer,
        testMcpServer,
      };
      renderMarketplace({
        open: true,
        agents: [{ id: "writer", name: "Writer" }],
        activeAgentId: "writer",
        onOpenChange: vi.fn(),
        plugins: [withKey],
        pluginServerId: "local",
      });
      await openPluginPage();
      fireEvent.click(await screen.findByRole("button", { name: "Install plugin" }));

      const key = await screen.findByLabelText(/API key/);
      fireEvent.input(key, { target: { value: "live-key" } });
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));

      await waitFor(() => expect(saveMcpServer).toHaveBeenCalled());
      const sent = { key: "Authorization", value: "Bearer live-key" };
      expect(testMcpServer).toHaveBeenCalledWith({ config: expect.objectContaining({ headers: [sent] }) }, "local");
      expect(saveMcpServer).toHaveBeenCalledWith({ config: expect.objectContaining({ headers: [sent] }) }, "local");
    });

    it("saves nothing when the connect dialog is closed", async () => {
      const saveMcpServer: OpenBotDesktopApi["agent"]["saveMcpServer"] = vi.fn(async (input) => [input.config]);
      window.openbot.agent = { ...window.openbot.agent, listMcpServers: vi.fn(async () => []), saveMcpServer };
      renderMarketplace({
        open: true,
        agents: [{ id: "writer", name: "Writer" }],
        activeAgentId: "writer",
        onOpenChange: vi.fn(),
        plugins: [withKey],
        pluginServerId: "local",
      });
      await openPluginPage();
      fireEvent.click(await screen.findByRole("button", { name: "Install plugin" }));
      fireEvent.click(await screen.findByRole("button", { name: "Close connect Aave" }));

      // Closing the dialog is a decision, not a failure: the install stops and can be started again.
      await waitFor(() => expect(screen.getByRole("button", { name: "Install plugin" })).toBeEnabled());
      expect(saveMcpServer).not.toHaveBeenCalled();
    });

    it("stops the connect step when the marketplace itself is closed", async () => {
      const saveMcpServer: OpenBotDesktopApi["agent"]["saveMcpServer"] = vi.fn(async (input) => [input.config]);
      window.openbot.agent = { ...window.openbot.agent, listMcpServers: vi.fn(async () => []), saveMcpServer };
      const [open, setOpen] = createSignal(true);
      renderMarketplace(() => ({
        open: open(),
        agents: [{ id: "writer", name: "Writer" }],
        activeAgentId: "writer",
        onOpenChange: setOpen,
        plugins: [withKey],
        pluginServerId: "local",
      }));
      await openPluginPage();
      fireEvent.click(await screen.findByRole("button", { name: "Install plugin" }));
      await screen.findByRole("dialog", { name: "Connect Aave" });

      // The connect dialog is a sibling of the marketplace, so it has to be told the page it was
      // started from is gone. Otherwise it stays on screen over nothing.
      setOpen(false);

      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Connect Aave" })).toBeNull());
      expect(saveMcpServer).not.toHaveBeenCalled();
    });

    it("sends an example question to the chosen agent", async () => {
      const onRunPluginPrompt = vi.fn();
      window.openbot.agent = { ...window.openbot.agent, listMcpServers: vi.fn(async () => []) };
      const asked = { id: "prompt-yield", text: "Where can I earn the most on stablecoins?" };
      renderMarketplace({
        open: true,
        agents: [{ id: "writer", name: "Writer" }],
        activeAgentId: "writer",
        onOpenChange: vi.fn(),
        plugins: [{ ...plugin, prompts: [asked] }],
        pluginServerId: "local",
        onRunPluginPrompt: onRunPluginPrompt,
      });
      await openPluginPage();
      fireEvent.click(await screen.findByRole("button", { name: `Ask Aave: ${asked.text}` }));

      expect(onRunPluginPrompt).toHaveBeenCalledWith("writer", asked);
    });

    /** A plugin with skills: the two halves land in different places, and in this order. */
    const withSkill: MarketplacePluginDetail = {
      ...plugin,
      skills: [
        {
          id: "skill-yield",
          versionId: "skill-yield-v3",
          slug: "yield-analysis",
          description: "Compare Aave yields and rates.",
        },
      ],
    };

    it("installs the pinned skill into the agent before the app reaches the host", async () => {
      const order: string[] = [];
      const install = vi.fn(async () => {
        order.push("skill");
        return installedYield;
      });
      const saveMcpServer: OpenBotDesktopApi["agent"]["saveMcpServer"] = vi.fn(async (input) => {
        order.push("app");
        return [input.config];
      });
      window.openbot.skills = { ...window.openbot.skills, install };
      window.openbot.agent = { ...window.openbot.agent, listMcpServers: vi.fn(async () => []), saveMcpServer };
      renderMarketplace({
        open: true,
        agents: [{ id: "writer", name: "Writer" }],
        activeAgentId: "writer",
        onOpenChange: vi.fn(),
        plugins: [withSkill],
        pluginServerId: "local",
      });
      await openPluginPage();
      fireEvent.click(await screen.findByRole("button", { name: "Install plugin" }));

      await waitFor(() => expect(saveMcpServer).toHaveBeenCalled());
      expect(install).toHaveBeenCalledWith({ agentId: "writer", skillId: "skill-yield", versionId: "skill-yield-v3" });
      // The skills go first, so a failure never leaves a server that nothing knows how to drive.
      expect(order).toEqual(["skill", "app"]);
    });

    it("removes the skill it installed when the app cannot be saved", async () => {
      const install = vi.fn(async () => installedYield);
      const uninstall = vi.fn(async () => undefined);
      window.openbot.skills = { ...window.openbot.skills, install, uninstall };
      window.openbot.agent = {
        ...window.openbot.agent,
        listMcpServers: vi.fn(async () => []),
        saveMcpServer: vi.fn(async () => {
          throw new Error("This MCP server no longer exists.");
        }),
      };
      renderMarketplace({
        open: true,
        agents: [{ id: "writer", name: "Writer" }],
        activeAgentId: "writer",
        onOpenChange: vi.fn(),
        plugins: [withSkill],
        pluginServerId: "local",
      });
      await openPluginPage();
      fireEvent.click(await screen.findByRole("button", { name: "Install plugin" }));

      await waitFor(() => expect(uninstall).toHaveBeenCalledWith({ agentId: "writer", skillId: "skill-yield" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("This MCP server no longer exists.");
      expect(screen.getByRole("button", { name: "Install plugin" })).toBeEnabled();
    });

    it("reports a plugin whose app the host already holds as installed", async () => {
      window.openbot.agent = {
        ...window.openbot.agent,
        listMcpServers: vi.fn(async () => [
          {
            id: "mcp-1",
            name: app.server.name,
            transport: "http" as const,
            enabled: true,
            command: "",
            args: [],
            env: [],
            envPassthrough: [],
            workingDirectory: "",
            url: appUrl,
            headers: [],
          },
        ]),
        saveMcpServer: vi.fn(),
      };
      renderMarketplace({
        open: true,
        agents: [{ id: "writer", name: "Writer" }],
        activeAgentId: "writer",
        onOpenChange: vi.fn(),
        plugins: [plugin],
        pluginServerId: "local",
      });
      await openPluginPage();

      expect(await screen.findByRole("button", { name: "Uninstall plugin" })).toBeInTheDocument();
      expect(window.openbot.agent.saveMcpServer).not.toHaveBeenCalled();
    });

    /** The host row an installed app leaves behind, as `listMcpServers` answers it. */
    function hostApp(): McpServerConfig {
      return {
        id: "mcp-1",
        name: app.server.name,
        transport: "http" as const,
        enabled: true,
        command: "",
        args: [],
        env: [],
        envPassthrough: [],
        workingDirectory: "",
        url: appUrl,
        headers: [],
      };
    }

    /** Opens the listing of an installed plugin and presses Uninstall, stopping at the confirmation. */
    async function askToUninstall() {
      await openPluginPage();
      fireEvent.click(await screen.findByRole("button", { name: "Uninstall plugin" }));
      return screen.findByRole("alertdialog");
    }

    it("names the app and the skill it is about to remove before removing either", async () => {
      window.openbot.skills = { ...window.openbot.skills, listInstalled: vi.fn(async () => [installedYield]) };
      window.openbot.agent = {
        ...window.openbot.agent,
        listMcpServers: vi.fn(async () => [hostApp()]),
        removeMcpServer: vi.fn(async () => []),
      };
      renderMarketplace({
        open: true,
        agents: [{ id: "writer", name: "Writer" }],
        activeAgentId: "writer",
        onOpenChange: vi.fn(),
        plugins: [withSkill],
        pluginServerId: "local",
      });
      const confirm = await askToUninstall();

      expect(within(confirm).getByRole("heading", { name: "Uninstall Aave?" })).toBeInTheDocument();
      expect(within(confirm).getByText(app.server.name)).toBeInTheDocument();
      expect(within(confirm).getByText("yield-analysis")).toBeInTheDocument();
      // The question is asked before anything goes: nothing is removed by opening it.
      expect(window.openbot.agent.removeMcpServer).not.toHaveBeenCalled();
      expect(window.openbot.skills.uninstall).not.toHaveBeenCalled();
    });

    it("removes the host's app row and the agent's skill when the uninstall is confirmed", async () => {
      const order: string[] = [];
      const removeMcpServer: OpenBotDesktopApi["agent"]["removeMcpServer"] = vi.fn(async () => {
        order.push("app");
        return [];
      });
      const uninstall = vi.fn(async () => {
        order.push("skill");
      });
      let held: InstalledSkill[] = [installedYield];
      window.openbot.skills = { ...window.openbot.skills, listInstalled: vi.fn(async () => held), uninstall };
      let hostRows: McpServerConfig[] = [hostApp()];
      window.openbot.agent = {
        ...window.openbot.agent,
        listMcpServers: vi.fn(async () => hostRows),
        removeMcpServer,
      };
      renderMarketplace({
        open: true,
        agents: [{ id: "writer", name: "Writer" }],
        activeAgentId: "writer",
        onOpenChange: vi.fn(),
        plugins: [withSkill],
        pluginServerId: "local",
      });
      const confirm = await askToUninstall();
      hostRows = [];
      held = [];
      fireEvent.click(within(confirm).getByRole("button", { name: "Uninstall" }));

      await waitFor(() => expect(uninstall).toHaveBeenCalledWith({ agentId: "writer", skillId: "skill-yield" }));
      expect(removeMcpServer).toHaveBeenCalledWith({ mcpServerId: "mcp-1" }, "local");
      // The app stops answering before the instructions that drive it are taken away.
      expect(order).toEqual(["app", "skill"]);
      expect(await screen.findByRole("button", { name: "Install plugin" })).toBeInTheDocument();
    });

    it("removes nothing when the confirmation is cancelled", async () => {
      window.openbot.skills = { ...window.openbot.skills, listInstalled: vi.fn(async () => [installedYield]) };
      window.openbot.agent = {
        ...window.openbot.agent,
        listMcpServers: vi.fn(async () => [hostApp()]),
        removeMcpServer: vi.fn(async () => []),
      };
      renderMarketplace({
        open: true,
        agents: [{ id: "writer", name: "Writer" }],
        activeAgentId: "writer",
        onOpenChange: vi.fn(),
        plugins: [withSkill],
        pluginServerId: "local",
      });
      const confirm = await askToUninstall();
      fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(window.openbot.agent.removeMcpServer).not.toHaveBeenCalled();
      expect(window.openbot.skills.uninstall).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Uninstall plugin" })).toBeInTheDocument();
    });

    /**
     * A cleanup that half works. The skill must still be taken even though the app row refused, and
     * the failure must name what stayed rather than leave the user to find it.
     */
    it("reports what could not be removed and still removes the rest", async () => {
      const uninstall = vi.fn(async () => undefined);
      let held: InstalledSkill[] = [installedYield];
      window.openbot.skills = { ...window.openbot.skills, listInstalled: vi.fn(async () => held), uninstall };
      window.openbot.agent = {
        ...window.openbot.agent,
        listMcpServers: vi.fn(async () => [hostApp()]),
        removeMcpServer: vi.fn(async () => {
          throw new Error("This MCP server no longer exists.");
        }),
      };
      renderMarketplace({
        open: true,
        agents: [{ id: "writer", name: "Writer" }],
        activeAgentId: "writer",
        onOpenChange: vi.fn(),
        plugins: [withSkill],
        pluginServerId: "local",
      });
      const confirm = await askToUninstall();
      held = [];
      fireEvent.click(within(confirm).getByRole("button", { name: "Uninstall" }));

      await waitFor(() => expect(uninstall).toHaveBeenCalledWith({ agentId: "writer", skillId: "skill-yield" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("This MCP server no longer exists.");
      // Half a plugin is not installed, but what stayed must still have a way out: the retry.
      expect(screen.getByRole("button", { name: "Uninstall plugin" })).toBeInTheDocument();
    });

    /**
     * Names are unique on a host, so a server the user wrote by hand can own a catalog name while
     * pointing somewhere else. That row is not the plugin's, and an uninstall must never offer to
     * take it: the listing reads as not installed and there is nothing to confirm.
     */
    it("leaves a server that only shares the app's name alone", async () => {
      window.openbot.agent = {
        ...window.openbot.agent,
        listMcpServers: vi.fn(async () => [{ ...hostApp(), url: "https://mcp.example.test/mine" }]),
        removeMcpServer: vi.fn(async () => []),
      };
      renderMarketplace({
        open: true,
        agents: [{ id: "writer", name: "Writer" }],
        activeAgentId: "writer",
        onOpenChange: vi.fn(),
        plugins: [plugin],
        pluginServerId: "local",
      });
      await openPluginPage();

      expect(await screen.findByRole("button", { name: "Install plugin" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Uninstall plugin" })).toBeNull();
    });

    /**
     * The deep link. A web page can name a listing, and that is all it can do: the page it opens
     * still asks the user to install, against an agent they pick.
     */
    it("opens the listing a link names without installing it", async () => {
      window.openbot.agent = {
        ...window.openbot.agent,
        listMcpServers: vi.fn(async () => []),
        saveMcpServer: vi.fn(),
      };
      renderMarketplace({
        open: true,
        agents: [{ id: "writer", name: "Writer" }],
        activeAgentId: "writer",
        onOpenChange: vi.fn(),
        plugins: [plugin],
        pluginServerId: "local",
        initialPluginSlug: "aave",
      });

      expect(await screen.findByRole("button", { name: "Install plugin" })).toBeInTheDocument();
      expect(screen.getByText(plugin.description)).toBeInTheDocument();
      expect(window.openbot.agent.saveMcpServer).not.toHaveBeenCalled();
    });

    it("says a link names no listing this catalog holds, and offers the list", async () => {
      renderMarketplace({
        open: true,
        agents: [{ id: "writer", name: "Writer" }],
        activeAgentId: "writer",
        onOpenChange: vi.fn(),
        plugins: [plugin],
        pluginServerId: "local",
        initialPluginSlug: "not-a-plugin",
      });

      expect(await screen.findByText("This plugin is not in the OpenBot catalog.")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Browse plugins" }));

      expect(await screen.findByRole("button", { name: "View Aave details" })).toBeInTheDocument();
    });

    it("reopens the same listing when its link arrives again after leaving it", async () => {
      window.openbot.agent = {
        ...window.openbot.agent,
        listMcpServers: vi.fn(async () => []),
        saveMcpServer: vi.fn(),
      };
      const [slug, setSlug] = createSignal<string | null>("aave");
      const consumed = vi.fn();
      renderMarketplace(() => ({
        open: true,
        agents: [{ id: "writer", name: "Writer" }],
        activeAgentId: "writer",
        onOpenChange: vi.fn(),
        plugins: [plugin],
        pluginServerId: "local",
        initialPluginSlug: slug() ?? undefined,
        onInitialPluginSlugConsumed: () => {
          consumed();
          setSlug(null);
        },
      }));

      expect(await screen.findByRole("button", { name: "Install plugin" })).toBeInTheDocument();
      await waitFor(() => expect(consumed).toHaveBeenCalled());
      await waitFor(() => expect(slug()).toBeNull());

      fireEvent.click(screen.getByRole("button", { name: "Marketplace" }));
      expect(await screen.findByRole("button", { name: "View Aave details" })).toBeInTheDocument();

      setSlug("aave");
      expect(await screen.findByRole("button", { name: "Install plugin" })).toBeInTheDocument();
      expect(screen.getByText(plugin.description)).toBeInTheDocument();
    });

    it("forgets the open page when a link names no listing, so browsing returns to the list", async () => {
      window.openbot.agent = {
        ...window.openbot.agent,
        listMcpServers: vi.fn(async () => []),
        saveMcpServer: vi.fn(),
      };
      const [slug, setSlug] = createSignal<string | null>("aave");
      renderMarketplace(() => ({
        open: true,
        agents: [{ id: "writer", name: "Writer" }],
        activeAgentId: "writer",
        onOpenChange: vi.fn(),
        plugins: [plugin],
        pluginServerId: "local",
        initialPluginSlug: slug() ?? undefined,
        onInitialPluginSlugConsumed: () => setSlug(null),
      }));

      expect(await screen.findByRole("button", { name: "Install plugin" })).toBeInTheDocument();

      setSlug("not-a-plugin");
      expect(await screen.findByText("This plugin is not in the OpenBot catalog.")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Browse plugins" }));

      expect(await screen.findByRole("button", { name: "View Aave details" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Install plugin" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Marketplace" })).toBeNull();
    });

    it("copies the address the public page answers on", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
      renderMarketplace({
        open: true,
        agents: [{ id: "writer", name: "Writer" }],
        activeAgentId: "writer",
        onOpenChange: vi.fn(),
        plugins: [plugin],
        pluginServerId: "local",
      });
      await openPluginPage();
      fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://openbot.run/plugins/aave"));
    });
  });
});
