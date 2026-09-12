import type {
  AgentSummary,
  InstalledSkill,
  MarketplaceAgentDetail,
  MarketplaceSkillPage,
  OpenBotDesktopApi,
  SkillSubmission,
} from "@openbot/contracts/ipc";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AnalyticsEventName, type DesktopAnalyticsEvents, desktopAnalytics } from "../../analytics";
import { SkillsMarketplaceModal } from "./SkillsMarketplaceModal";

const nativeCanvasGetContext = HTMLCanvasElement.prototype.getContext;
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

  it("tries only an installed skill for the selected agent", async () => {
    const installed: InstalledSkill = {
      skillId: "release-notes",
      slug: "release-notes",
      name: "Release Notes",
      installedVersion: 1,
      availableVersion: 1,
      state: "installed",
      enabled: true,
    };
    let finishResearch: ((skills: InstalledSkill[]) => void) | undefined;
    vi.spyOn(window.openbot.skills, "listInstalled").mockImplementation((agentId) =>
      agentId === "writer"
        ? Promise.resolve([installed])
        : new Promise((resolve) => {
            finishResearch = resolve;
          }),
    );
    const onTrySkill = vi.fn();
    render(() => (
      <SkillsMarketplaceModal
        open
        agents={[
          { id: "writer", name: "Writer" },
          { id: "research", name: "Research" },
        ]}
        activeAgentId="writer"
        onOpenChange={vi.fn()}
        onTrySkill={onTrySkill}
      />
    ));
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    fireEvent.click(await screen.findByRole("button", { name: "View Release Notes details" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Try skill" })).toBeEnabled());
    fireEvent.change(screen.getByRole("combobox", { name: "Install to" }), { target: { value: "research" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Try skill" })).toBeDisabled());
    await waitFor(() => expect(finishResearch).toBeDefined());
    finishResearch?.([]);
    expect(onTrySkill).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "Install to" }), { target: { value: "writer" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Try skill" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Try skill" }));
    expect(onTrySkill).toHaveBeenCalledWith("writer", expect.objectContaining({ id: "release-notes" }));
  });

  it("opens the approved skill instructions inside the marketplace modal", async () => {
    render(() => (
      <SkillsMarketplaceModal
        open
        agents={[{ id: "writer", name: "Writer" }]}
        activeAgentId="writer"
        onOpenChange={() => undefined}
      />
    ));
    screen.getByRole("button", { name: "Skills" }).click();
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
    within(details).getByRole("button", { name: "Back to skills" }).click();
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

    render(() => (
      <SkillsMarketplaceModal
        open
        activeAgentId=""
        onOpenChange={() => undefined}
        onAgentInstalled={onInstalled}
        agents={[
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
        ]}
      />
    ));
    expect(screen.getByRole("button", { name: "Agents" })).toHaveAttribute("aria-current", "page");
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

    render(() => <SkillsMarketplaceModal open agents={[]} activeAgentId="" onOpenChange={() => undefined} />);
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
    render(() => (
      <SkillsMarketplaceModal
        open
        agents={[
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
        ]}
        activeAgentId="research-local"
        onOpenChange={() => undefined}
      />
    ));

    fireEvent.click(await screen.findByRole("button", { name: "View Research Agent details" }));
    expect(await screen.findByRole("button", { name: "Update agent" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Back to agents" }));
    fireEvent.click(await screen.findByRole("button", { name: "View Writer Agent details" }));
    expect(await screen.findByRole("button", { name: "Install agent" })).toBeEnabled();
  });

  it("keeps Featured across category pages and restores the filter and focus after details", async () => {
    const detail = await window.openbot.skills.get("release-notes");
    window.openbot.skills.list = vi.fn<OpenBotDesktopApi["skills"]["list"]>(async (query) => ({
      skills:
        query?.featured || query?.category === "documents"
          ? [{ ...detail, id: query.cursor ? "second" : detail.id, name: query.cursor ? "Second skill" : detail.name }]
          : [],
      nextCursor: query?.category === "documents" && query.limit === 50 && !query.cursor ? "next-page" : null,
    }));
    render(() => <SkillsMarketplaceModal open agents={[]} activeAgentId="" onOpenChange={() => undefined} />);
    screen.getByRole("button", { name: "Skills" }).click();
    fireEvent.click(await screen.findByRole("button", { name: "View all Documents skills" }));
    expect(screen.getByRole("button", { name: "View featured Release Notes" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("button", { name: "View Second skill details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View featured Release Notes" })).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "View Release Notes details" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "Back to skills" }));
    expect(await screen.findByRole("button", { name: "View Second skill details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Documents", pressed: true })).toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    await screen.findByRole("button", { name: "View all Documents skills" });
    expect(vi.mocked(window.openbot.skills.list).mock.calls.filter(([query]) => query?.featured)).toHaveLength(1);
  });

  it("keeps newer category results when an older request finishes last", async () => {
    const detail = await window.openbot.skills.get("release-notes");
    let finishOld!: (page: MarketplaceSkillPage) => void;
    const oldPage = new Promise<MarketplaceSkillPage>((resolve) => {
      finishOld = resolve;
    });
    window.openbot.skills.list = vi.fn<OpenBotDesktopApi["skills"]["list"]>(async (query) => {
      if (query?.limit === 50 && query.category === "coding") return oldPage;
      return {
        skills:
          query?.category === "design"
            ? [{ ...detail, category: "design", name: query.limit === 50 ? "Design skill" : "Overview design" }]
            : [],
        nextCursor: null,
      };
    });
    render(() => <SkillsMarketplaceModal open agents={[]} activeAgentId="" onOpenChange={() => undefined} />);
    screen.getByRole("button", { name: "Skills" }).click();
    await screen.findByRole("button", { name: "View Overview design details" });
    fireEvent.click(screen.getByRole("button", { name: "Coding" }));
    fireEvent.click(screen.getByRole("button", { name: "Design" }));
    await screen.findByRole("button", { name: "View Design skill details" });
    vi.useFakeTimers();
    finishOld({ skills: [detail], nextCursor: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(await screen.findByRole("button", { name: "View Design skill details" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View Release Notes details" })).not.toBeInTheDocument();
  });

  it("waits 500ms after typing before searching", async () => {
    vi.useFakeTimers();
    render(() => <SkillsMarketplaceModal open agents={[]} activeAgentId="" onOpenChange={() => undefined} />);
    screen.getByRole("button", { name: "Skills" }).click();
    await Promise.resolve();
    await Promise.resolve();
    const list = vi.mocked(window.openbot.skills.list);
    list.mockClear();

    fireEvent.input(screen.getByLabelText("Search skills"), { target: { value: "solana" } });
    await vi.advanceTimersByTimeAsync(499);
    expect(list).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(list).toHaveBeenCalled();
  });

  it("uses category and card skeletons while discover listings load", async () => {
    let resolvePage!: (page: MarketplaceSkillPage) => void;
    const pendingPage = new Promise<MarketplaceSkillPage>((resolve) => {
      resolvePage = resolve;
    });
    window.openbot.skills.list = vi.fn(() => pendingPage);

    render(() => (
      <SkillsMarketplaceModal
        open
        agents={[{ id: "writer", name: "Writer" }]}
        activeAgentId="writer"
        onOpenChange={() => undefined}
      />
    ));
    screen.getByRole("button", { name: "Skills" }).click();

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
    render(() => (
      <SkillsMarketplaceModal
        open
        agents={[{ id: "writer", name: "Writer" }]}
        activeAgentId="writer"
        onOpenChange={() => undefined}
      />
    ));
    screen.getByRole("button", { name: "Skills" }).click();

    // aria-current marks which marketplace section is showing
    // (SkillsMarketplaceModal.tsx:413,423); nothing else asserts it.
    await waitFor(() => expect(screen.getByRole("button", { name: "Skills" })).toHaveAttribute("aria-current", "page"));
    expect(screen.getByRole("button", { name: "Agents" })).not.toHaveAttribute("aria-current");

    const listing = await screen.findByRole("button", { name: "View Release Notes details" });
    listing.click();

    expect(await screen.findByRole("region", { name: "Release Notes details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Installed" })).toBeDisabled();
    const detail = await window.openbot.skills.get("release-notes");
    window.openbot.skills.get = vi.fn(async () => ({ ...detail, version: 3, versionId: "release-notes-v3" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
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

    render(() => (
      <SkillsMarketplaceModal
        open
        agents={[{ id: "writer", name: "Writer" }]}
        activeAgentId="writer"
        onOpenChange={() => undefined}
      />
    ));
    screen.getByRole("button", { name: "Skills" }).click();
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
    render(() => (
      <SkillsMarketplaceModal
        open
        agents={[{ id: "research", name: "Research" }]}
        activeAgentId="research"
        onOpenChange={() => undefined}
      />
    ));
    if (kind === "skills") fireEvent.click(screen.getByRole("button", { name: "Skills" }));
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
    render(() => (
      <SkillsMarketplaceModal
        open
        agents={[
          { id: "first", name: "First" },
          { id: "second", name: "Second" },
        ]}
        activeAgentId="first"
        onOpenChange={() => undefined}
      />
    ));
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
    render(() => <SkillsMarketplaceModal open agents={[]} activeAgentId="" onOpenChange={() => undefined} />);
    screen.getByRole("button", { name: "Skills" }).click();

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
    render(() => <SkillsMarketplaceModal open agents={[]} activeAgentId="" onOpenChange={() => undefined} />);
    screen.getByRole("button", { name: "Skills" }).click();

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
    render(() => <SkillsMarketplaceModal open agents={[]} activeAgentId="" onOpenChange={() => undefined} />);
    screen.getByRole("button", { name: "Skills" }).click();

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
});
