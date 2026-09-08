import type {
  AgentPublicationPreview,
  AgentSubmission,
  AgentSummary,
  AvatarImageInput,
  InstalledSkill,
  MarketplaceAgentDetail,
  MarketplaceAgentSummary,
  MarketplaceSkillDetail,
  MarketplaceSkillSummary,
  SkillCategory,
  SkillPackagePreview,
  SkillSubmission,
} from "@openbot/contracts/ipc";
import { isSkillCategory, SKILL_CATEGORIES } from "@openbot/contracts/ipc";
import { createEffect, createMemo, createSignal, createStore, For, Show, snapshot } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { normalizeAvatarFile } from "../../avatar-image";
import { createAsyncPanel } from "../../components/createAsyncPanel";
import {
  ArrowLeft,
  Button,
  Check,
  ChevronDown,
  Dialog,
  DropdownMenu,
  Ellipsis,
  IconButton,
  Input,
  NativeSelect,
  Plus,
  Puzzle,
  RefreshCw,
  Skeleton,
  Trash2,
  Upload,
  X,
} from "../../components/ui";
import { AgentAvatar } from "../agents/AgentAvatar";
import { routineScheduleSummary } from "../conversation/routine-schedule-ui";
import { CATEGORY_LABELS, MarketplaceCatalog } from "./MarketplaceCatalog";
import { MarketplaceDetail } from "./MarketplaceDetail";

interface SkillsMarketplaceModalProps {
  open: boolean;
  agents: Array<Pick<AgentSummary, "id" | "name" | "marketplaceSource">>;
  activeAgentId: string;
  onOpenChange: (open: boolean) => void;
  onAgentInstalled?: (agent: AgentSummary) => void | Promise<void>;
}

type Tab = "discover" | "installed" | "mine";
type MarketplaceKind = "skills" | "agents";
/**
 * What the detail layer shows. Three signals allowed a combination the product does not have - a
 * loaded skill and a loaded submission at once - and turned "is anything open" into a chain of
 * three reads that every caller had to spell the same way.
 */
type SkillDetail =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "skill"; skill: MarketplaceSkillDetail }
  | { kind: "submission"; submission: SkillSubmission };

/** Which listing is on screen and what narrows it: every field a tab switch resets together. */
interface SkillsBrowse {
  kind: MarketplaceKind;
  tab: Tab;
  targetAgentId: string;
}

/** The publish form. Meaningful only while `preview` holds a chosen package, and cleared with it. */
interface SkillPublication {
  category: SkillCategory;
  icon: AvatarImageInput | null;
  iconPreviewUrl: string | null;
  preview: SkillPackagePreview | null;
  skillId: string | undefined;
}

/** Everything the skills half of the marketplace shows, grouped by the surface that owns it. */
interface SkillsMarketplace {
  browse: SkillsBrowse;
  detail: SkillDetail;
  installed: InstalledSkill[];
  publication: SkillPublication;
  submissions: SkillSubmission[];
}

export function SkillsMarketplaceModal(props: SkillsMarketplaceModalProps) {
  const [market, setMarket] = createStore<SkillsMarketplace>({
    browse: { kind: "skills", tab: "discover", targetAgentId: "" },
    detail: { kind: "none" },
    installed: [],
    publication: {
      category: "other",
      icon: null,
      iconPreviewUrl: null,
      preview: null,
      skillId: undefined,
    },
    submissions: [],
  });
  /** Pulse counters, not marketplace state: each one asks the agent panel to do something once. */
  const [agentRefreshVersion, setAgentRefreshVersion] = createSignal(0);
  const [agentAddVersion, setAgentAddVersion] = createSignal(0);
  const { panel, run, setBusy, setError, setLoading } = createAsyncPanel(marketplaceErrorMessage);
  let marketplaceBody: HTMLDivElement | undefined;
  let listScrollTop = 0;
  const [skillRefreshVersion, setSkillRefreshVersion] = createSignal(0);
  const [detailActive, setDetailActive] = createSignal(false);
  let detailTrigger: HTMLElement | null = null;

  const installedById = createMemo(() => new Map(market.installed.map((item) => [item.skillId, item])));
  const targetAgent = createMemo(() => props.agents.find((agent) => agent.id === market.browse.targetAgentId) ?? null);
  // The arms of the detail union, so the JSX narrows here once instead of at every read.
  const detailOpen = () => market.detail.kind !== "none";
  const detailLoading = () => market.detail.kind === "loading";
  const skillDetail = () => (market.detail.kind === "skill" ? market.detail.skill : null);
  const submissionDetail = () => (market.detail.kind === "submission" ? market.detail.submission : null);

  createEffect(
    () => props.open,
    (open) => {
      if (!open) {
        closeDetail();
        return;
      }
      setMarket((state) => {
        state.browse.targetAgentId = state.browse.targetAgentId || props.activeAgentId || props.agents[0]?.id || "";
      });
      void loadSkills();
    },
  );

  createEffect(
    () => [props.open, market.browse.targetAgentId] as const,
    ([open, agentId]) => {
      if (open && agentId) void loadInstalled(agentId);
      else {
        setMarket((state) => {
          state.installed = [];
        });
      }
    },
  );

  function closeDetail(): void {
    setDetailActive(false);
    setMarket((state) => {
      state.detail = { kind: "none" };
    });
  }

  function loadSkills() {
    setSkillRefreshVersion((version) => version + 1);
  }

  async function loadInstalled(agentId = market.browse.targetAgentId) {
    if (!agentId) {
      setMarket((state) => {
        state.installed = [];
      });
      return;
    }
    const values = await run(() => window.openbot.skills.listInstalled(agentId));
    if (values) {
      setMarket((state) => {
        state.installed = values;
      });
    }
  }

  async function loadMine() {
    setLoading(true);
    const values = await run(() => window.openbot.skills.listMine());
    if (values) {
      setMarket((state) => {
        state.submissions = values;
      });
    }
    setLoading(false);
  }

  function refresh(next: Tab = market.browse.tab) {
    if (next === "discover") void loadSkills();
    if (next === "mine") void loadMine();
    if (next === "installed") void loadInstalled();
  }

  function selectTab(next: Tab) {
    setDetailActive(false);
    const marketplaceKind = market.browse.kind;
    if (marketplaceBody) marketplaceBody.scrollTop = 0;
    setMarket((state) => {
      state.browse.tab = next;
      state.detail = { kind: "none" };
      state.publication.preview = null;
      state.publication.icon = null;
      state.publication.iconPreviewUrl = null;
    });
    setError(null);
    if (marketplaceKind === "skills") refresh(next);
  }

  function selectKind(next: MarketplaceKind) {
    setDetailActive(false);
    if (marketplaceBody) marketplaceBody.scrollTop = 0;
    setMarket((state) => {
      state.browse.kind = next;
      state.browse.tab = "discover";
      state.detail = { kind: "none" };
      state.publication.preview = null;
    });
    setError(null);
    if (next === "skills") void loadSkills();
  }

  function enterDetails() {
    detailTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDetailActive(true);
    if (!detailOpen()) {
      listScrollTop = marketplaceBody?.scrollTop ?? 0;
    }
    if (marketplaceBody) marketplaceBody.scrollTop = 0;
  }

  function leaveDetails() {
    closeDetail();
    queueMicrotask(() => {
      if (marketplaceBody) marketplaceBody.scrollTop = listScrollTop;
      if (detailTrigger?.isConnected) detailTrigger.focus();
    });
  }

  async function openDetails(skill: MarketplaceSkillSummary) {
    const analytics = desktopAnalytics.scope();
    enterDetails();
    setMarket((state) => {
      state.detail = { kind: "loading" };
    });
    const value = await run(() => window.openbot.skills.get(skill.id));
    analytics.track("marketplace_action", {
      entity: "skill",
      action: "view",
      result: value ? "succeeded" : "failed",
      ...(value ? {} : { failure_code: "load_failed" }),
    });
    if (!value) {
      leaveDetails();
      return;
    }
    setMarket((state) => {
      state.detail = { kind: "skill", skill: value };
    });
  }

  async function openDetailsById(skillId: string) {
    enterDetails();
    const analytics = desktopAnalytics.scope();
    setMarket((state) => {
      state.detail = { kind: "loading" };
    });
    const value = await run(() => window.openbot.skills.get(skillId));
    analytics.track("marketplace_action", {
      entity: "skill",
      action: "view",
      result: value ? "succeeded" : "failed",
      ...(value ? {} : { failure_code: "load_failed" }),
    });
    if (!value) {
      leaveDetails();
      return;
    }
    setMarket((state) => {
      state.detail = { kind: "skill", skill: value };
    });
  }

  function openSubmissionDetails(submission: SkillSubmission) {
    if (submission.status === "approved") {
      void openDetailsById(submission.skillId);
      return;
    }
    enterDetails();
    setMarket((state) => {
      state.detail = { kind: "submission", submission };
    });
  }

  async function install(
    skill: MarketplaceSkillSummary,
    replaceModified = false,
    action: "install" | "update" = "install",
  ) {
    const agentId = market.browse.targetAgentId;
    if (!agentId) {
      setError("Switch to Local and create an agent before installing skills.");
      return;
    }
    const analytics = desktopAnalytics.scope();
    setBusy(skill.id);
    const result = await run(() => window.openbot.skills.install({ agentId, skillId: skill.id, replaceModified }));
    analytics.track("marketplace_action", {
      entity: "skill",
      action,
      result: result ? "succeeded" : "failed",
      ...(result ? {} : { failure_code: action === "update" ? "update_failed" : "install_failed" }),
    });
    if (result) await loadInstalled(agentId);
    setBusy(null);
  }

  async function updateInstalled(item: InstalledSkill) {
    const analytics = desktopAnalytics.scope();
    const listing = await run(() => window.openbot.skills.get(item.skillId));
    if (!listing) {
      analytics.track("marketplace_action", {
        entity: "skill",
        action: "update",
        result: "failed",
        failure_code: "load_failed",
      });
      return;
    }
    const replace = item.state === "modified";
    if (replace && !window.confirm(`Replace local changes in ${item.name}?`)) return;
    await install(listing, replace, "update");
  }

  async function uninstall(item: InstalledSkill) {
    const modified = item.state === "modified";
    if (!window.confirm(modified ? `Delete ${item.name} and its local changes?` : `Uninstall ${item.name}?`)) return;
    const analytics = desktopAnalytics.scope();
    setBusy(item.skillId);
    const removed = await run(async () => {
      await window.openbot.skills.uninstall({
        agentId: market.browse.targetAgentId,
        skillId: item.skillId,
        ...(modified ? { removeModified: true } : {}),
      });
      return true;
    });
    analytics.track("marketplace_action", {
      entity: "skill",
      action: "uninstall",
      result: removed ? "succeeded" : "failed",
      ...(removed ? {} : { failure_code: "uninstall_failed" }),
    });
    if (removed) await loadInstalled();
    setBusy(null);
  }

  async function choosePackage(skillId?: string) {
    const value = await run(() => window.openbot.skills.choosePackage());
    if (!value) return;
    const category = skillId
      ? (market.submissions.find((item) => item.skillId === skillId)?.category ?? "other")
      : "other";
    setMarket((state) => {
      state.publication = {
        category,
        icon: null,
        iconPreviewUrl: null,
        preview: value,
        skillId,
      };
    });
  }

  async function submit() {
    const value = market.publication.preview;
    if (!value) return;
    const analytics = desktopAnalytics.scope();
    const { category, skillId } = market.publication;
    // The icon crosses to IPC, which structured-clones it, so it goes as a snapshot rather than as
    // whatever the store hands back.
    const icon = snapshot(market.publication.icon);
    setBusy("publish");
    const created = await run(() =>
      window.openbot.skills.submit({
        draftId: value.draftId,
        showCreatorAvatar: true,
        category,
        icon,
        ...(skillId ? { skillId } : {}),
      }),
    );
    analytics.track("marketplace_action", {
      entity: "skill",
      action: "publish",
      result: created ? "succeeded" : "failed",
      ...(created ? {} : { failure_code: "publish_failed" }),
    });
    if (created) {
      discardPublication();
      await loadMine();
    }
    setBusy(null);
  }

  async function chooseIcon(file: File | undefined) {
    if (!file) return;
    const icon = await run(() => normalizeAvatarFile(file));
    if (!icon) return;
    const iconPreviewUrl = avatarImageDataUrl(icon);
    setMarket((state) => {
      state.publication.icon = icon;
      state.publication.iconPreviewUrl = iconPreviewUrl;
    });
  }

  /** Drops the chosen package and the icon picked for it: neither outlives the other. */
  function discardPublication(): void {
    setMarket((state) => {
      state.publication.preview = null;
      state.publication.icon = null;
      state.publication.iconPreviewUrl = null;
    });
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class="skills-marketplace-backdrop">
          <Dialog.Content class="skills-marketplace" onOpenAutoFocus={(event) => event.preventDefault()}>
            <header class="skills-marketplace-topbar" data-detail={detailActive() ? "" : undefined}>
              <Dialog.Title class="marketplace-title">Marketplace</Dialog.Title>
              <nav class="skills-marketplace-kind-tabs" aria-label="Marketplace content types">
                <Button
                  class="skills-marketplace-kind-tab"
                  variant="ghost"
                  size="sm"
                  data-active={market.browse.kind === "skills" ? "" : undefined}
                  aria-current={market.browse.kind === "skills" ? "page" : undefined}
                  onClick={() => selectKind("skills")}
                >
                  <Puzzle /> Skills
                </Button>
                <Button
                  class="skills-marketplace-kind-tab"
                  variant="ghost"
                  size="sm"
                  data-active={market.browse.kind === "agents" ? "" : undefined}
                  aria-current={market.browse.kind === "agents" ? "page" : undefined}
                  onClick={() => selectKind("agents")}
                >
                  <AgentAvatar seed="marketplace-agents" hue={280} /> Agents
                </Button>
              </nav>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger class="marketplace-management" aria-label="Marketplace menu">
                  <Ellipsis />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content class="marketplace-menu">
                    <DropdownMenu.Item onSelect={() => selectTab("discover")}>Discover</DropdownMenu.Item>
                    <DropdownMenu.Item onSelect={() => selectTab("mine")}>My submissions</DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                      onSelect={() => {
                        selectTab("mine");
                        if (market.browse.kind === "skills") void choosePackage();
                        else setAgentAddVersion((version) => version + 1);
                      }}
                    >
                      <Plus /> Add {market.browse.kind === "skills" ? "skill" : "agent"}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      onSelect={() =>
                        market.browse.kind === "skills" ? refresh() : setAgentRefreshVersion((version) => version + 1)
                      }
                    >
                      <RefreshCw /> Refresh
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
              <IconButton label="Close marketplace" variant="ghost" onClick={() => props.onOpenChange(false)}>
                <X />
              </IconButton>
            </header>

            <div
              class="skills-marketplace-body"
              data-detail-open={detailOpen() ? "" : undefined}
              ref={(element) => (marketplaceBody = element)}
            >
              <Show when={market.browse.kind === "skills"}>
                <Show when={market.browse.tab === "discover"}>
                  <div class="skills-marketplace-discover" hidden={detailOpen()} inert={detailOpen()}>
                    <MarketplaceCatalog
                      kind="skills"
                      refreshVersion={skillRefreshVersion()}
                      list={async (query) => {
                        const page = await window.openbot.skills.list(query);
                        return { items: page.skills, nextCursor: page.nextCursor };
                      }}
                      icon={(skill) => <SkillIcon skill={skill} />}
                      onOpen={openDetails}
                    />
                  </div>
                </Show>

                <Show when={market.browse.tab === "installed"}>
                  <section class="skills-marketplace-panel">
                    <div class="skills-marketplace-heading">
                      <div>
                        <h1>Installed</h1>
                        <p>Manage marketplace-owned skills for one local agent.</p>
                      </div>
                      <AgentSelect
                        agents={props.agents}
                        value={market.browse.targetAgentId}
                        onChange={(agentId) =>
                          setMarket((state) => {
                            state.browse.targetAgentId = agentId;
                          })
                        }
                      />
                    </div>
                    <Show
                      when={targetAgent()}
                      fallback={
                        <div class="skills-marketplace-state">
                          Switch to Local and choose an agent to manage skills.
                        </div>
                      }
                    >
                      <Show
                        when={market.installed.length}
                        fallback={
                          <div class="skills-marketplace-state">
                            No marketplace skills are installed for this agent.
                          </div>
                        }
                      >
                        <div class="skills-installed-list">
                          <For each={market.installed}>
                            {(item) => (
                              <article class="skills-installed-row">
                                <Button
                                  variant="ghost"
                                  type="button"
                                  class="skills-marketplace-row-hitarea"
                                  aria-label={`View ${item.name} details`}
                                  onClick={() => void openDetailsById(item.skillId)}
                                />
                                <span class="skills-marketplace-default-icon">
                                  <Puzzle />
                                </span>
                                <div>
                                  <h3>{item.name}</h3>
                                  <p>
                                    v{item.installedVersion}
                                    {item.availableVersion > item.installedVersion
                                      ? ` · v${item.availableVersion} available`
                                      : ""}
                                  </p>
                                </div>
                                <span class="skills-installed-state" data-state={item.state}>
                                  {item.state.replaceAll("-", " ")}
                                </span>
                                <Button
                                  size="sm"
                                  loading={panel.busy === item.skillId}
                                  onClick={() => void updateInstalled(item)}
                                >
                                  <RefreshCw /> {item.state === "installed" ? "Repair" : "Update"}
                                </Button>
                                <IconButton
                                  label={`Uninstall ${item.name}`}
                                  variant="ghost"
                                  onClick={() => void uninstall(item)}
                                >
                                  <Trash2 />
                                </IconButton>
                              </article>
                            )}
                          </For>
                        </div>
                      </Show>
                    </Show>
                  </section>
                </Show>

                <Show when={market.browse.tab === "mine"}>
                  <section class="skills-marketplace-panel">
                    <div class="skills-marketplace-heading">
                      <div>
                        <h1>My submissions</h1>
                        <p>Package a focused, safe skill and submit it for marketplace review.</p>
                      </div>
                      <Button onClick={() => void choosePackage()}>
                        <Upload /> Choose folder or ZIP
                      </Button>
                    </div>
                    <section class="skills-submission-guide" aria-labelledby="skills-submission-guide-title">
                      <div class="skills-submission-guide-heading">
                        <h2 id="skills-submission-guide-title">Submission requirements</h2>
                        <p>Your skill is validated before it can be sent for review.</p>
                      </div>
                      <div class="skills-submission-guide-grid">
                        <div>
                          <h3>Package</h3>
                          <ul>
                            <li>
                              <Check />
                              <span>
                                Choose a folder or ZIP with <code>SKILL.md</code> at its root.
                              </span>
                            </li>
                            <li>
                              <Check />
                              <span>
                                Include no more than 200 files and keep both packaged and expanded size under 10 MB.
                              </span>
                            </li>
                            <li>
                              <Check />
                              <span>Include only the scripts, references, and assets the skill needs.</span>
                            </li>
                          </ul>
                        </div>
                        <div>
                          <h3>Safety and review</h3>
                          <ul>
                            <li>
                              <Check />
                              <span>Explain when to use the skill, its workflow, and the expected output.</span>
                            </li>
                            <li>
                              <Check />
                              <span>
                                Never include secrets, <code>.env</code> files, private keys, or user data.
                              </span>
                            </li>
                            <li>
                              <Check />
                              <span>
                                Exclude <code>.git</code>, <code>node_modules</code>, symlinks, and nested archives.
                              </span>
                            </li>
                          </ul>
                        </div>
                      </div>
                      <div class="skills-submission-example">
                        <div>
                          <h3>Required SKILL.md metadata</h3>
                          <p>Name: 80 characters maximum · Description: 500 characters maximum</p>
                        </div>
                        <pre>{`---
name: Release Notes
description: Turn merged work into clear, consistent release notes.
---`}</pre>
                      </div>
                      <p class="skills-submission-limit">
                        Limits: 5 skills total · 5 submitted versions per skill · 10 submitted versions per 24 hours
                      </p>
                    </section>
                    <Show when={market.publication.preview}>
                      {(value) => (
                        <div class="skills-publish-card">
                          <div class="skills-publish-summary">
                            <Show
                              when={market.publication.iconPreviewUrl}
                              fallback={
                                <span class="skills-marketplace-default-icon">
                                  <Puzzle />
                                </span>
                              }
                              keyed
                            >
                              {(url) => (
                                <span class="skills-marketplace-icon">
                                  <img src={url} alt="Skill icon preview" />
                                </span>
                              )}
                            </Show>
                            <div>
                              <h2>{value().name}</h2>
                              <p>{value().description}</p>
                              <small>
                                {value().files.length} files · {(value().size / 1024).toFixed(1)} KB
                              </small>
                            </div>
                          </div>
                          <div class="skills-publish-fields">
                            <label class="skills-publish-category">
                              Category
                              <NativeSelect
                                value={market.publication.category}
                                onChange={(event) => {
                                  const category = event.currentTarget.value;
                                  if (isSkillCategory(category)) {
                                    setMarket((state) => {
                                      state.publication.category = category;
                                    });
                                  }
                                }}
                              >
                                <For each={SKILL_CATEGORIES}>
                                  {(item) => <option value={item}>{CATEGORY_LABELS[item]}</option>}
                                </For>
                              </NativeSelect>
                              <ChevronDown aria-hidden="true" />
                            </label>
                            <label>
                              Icon (optional)
                              <Input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                onChange={(event) => void chooseIcon(event.currentTarget.files?.[0])}
                              />
                            </label>
                          </div>
                          <div class="skills-publish-actions">
                            <Button variant="ghost" onClick={discardPublication}>
                              Cancel
                            </Button>
                            <Button
                              variant="default"
                              loading={panel.busy === "publish"}
                              loadingLabel="Submitting…"
                              onClick={() => void submit()}
                            >
                              Submit for review
                            </Button>
                          </div>
                        </div>
                      )}
                    </Show>
                    <Show when={!market.publication.preview}>
                      <Show
                        when={market.submissions.length}
                        fallback={
                          <div class="skills-marketplace-state">
                            No submissions yet. Choose a skill folder or ZIP to publish.
                          </div>
                        }
                      >
                        <div class="skills-submission-list">
                          <For each={market.submissions}>
                            {(item) => (
                              <article class="skills-submission-row">
                                <Button
                                  variant="ghost"
                                  type="button"
                                  class="skills-marketplace-row-hitarea"
                                  aria-label={`View ${item.name} submission details`}
                                  onClick={() => openSubmissionDetails(item)}
                                />
                                <SkillIcon skill={item} />
                                <div>
                                  <h3>{item.name}</h3>
                                  <p>
                                    {CATEGORY_LABELS[item.category]} · version {item.version}
                                  </p>
                                  <Show when={item.rejectionNote}>
                                    <small>{item.rejectionNote}</small>
                                  </Show>
                                </div>
                                <span class="skills-submission-status" data-status={item.status}>
                                  {item.status}
                                </span>
                                <Show when={item.status === "approved" || item.status === "rejected"}>
                                  <Button size="sm" onClick={() => void choosePackage(item.skillId)}>
                                    <Plus /> New version
                                  </Button>
                                </Show>
                              </article>
                            )}
                          </For>
                        </div>
                      </Show>
                    </Show>
                  </section>
                </Show>
                <Show when={detailOpen()}>
                  <div class="skills-marketplace-detail-layer">
                    <Show when={!detailLoading()} fallback={<SkillDetailSkeleton />}>
                      <Show when={skillDetail()} keyed>
                        {(skill) => (
                          <SkillDetailView
                            skill={skill}
                            installed={installedById().get(skill.id)}
                            busy={panel.busy === skill.id}
                            onBack={leaveDetails}
                            onInstall={install}
                            agents={props.agents}
                            targetAgentId={market.browse.targetAgentId}
                            onTargetChange={(id) =>
                              setMarket((state) => {
                                state.browse.targetAgentId = id;
                              })
                            }
                          />
                        )}
                      </Show>
                      <Show when={submissionDetail()} keyed>
                        {(submission) => <SkillSubmissionDetailView submission={submission} onBack={leaveDetails} />}
                      </Show>
                    </Show>
                  </div>
                </Show>
                <Show when={panel.error}>
                  {(message) => (
                    <div class="skills-marketplace-error" role="alert">
                      {message()}
                    </div>
                  )}
                </Show>
              </Show>
              <Show when={market.browse.kind === "agents"}>
                <AgentMarketplacePanel
                  agents={props.agents}
                  view={market.browse.tab}
                  refreshVersion={agentRefreshVersion()}
                  addVersion={agentAddVersion()}
                  onInstalled={props.onAgentInstalled}
                  onEnterDetail={enterDetails}
                  onLeaveDetail={leaveDetails}
                />
              </Show>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The agent half's listing, its detail layer, and the one publication being prepared. */
interface AgentsMarketplace {
  detail: MarketplaceAgentDetail | null;
  publication: {
    category: SkillCategory;
    /** The marketplace listing a new version is for, or `undefined` for a first submission. */
    listingId: string | undefined;
    preview: AgentPublicationPreview | null;
    sourceAgentId: string;
  };
  submissions: AgentSubmission[];
}

function AgentMarketplacePanel(props: {
  agents: Array<Pick<AgentSummary, "id" | "name" | "marketplaceSource">>;
  view: Tab;
  refreshVersion: number;
  addVersion: number;
  onInstalled?: (agent: AgentSummary) => void | Promise<void>;
  onEnterDetail: () => void;
  onLeaveDetail: () => void;
}) {
  const [market, setMarket] = createStore<AgentsMarketplace>({
    detail: null,
    publication: {
      category: "other",
      listingId: undefined,
      preview: null,
      sourceAgentId: props.agents[0]?.id ?? "",
    },
    submissions: [],
  });
  const { panel, run, setBusy, setError, setLoading } = createAsyncPanel(marketplaceErrorMessage);
  const [catalogRefresh, setCatalogRefresh] = createSignal(0);
  let initialized = false;
  let handledAddVersion = 0;
  let openingAgent = false;

  createEffect(
    () => [props.view, props.refreshVersion] as const,
    ([view]) => {
      setMarket((state) => {
        state.detail = null;
        state.publication.preview = null;
      });
      setError(null);
      if (view === "discover") void loadAgents();
      if (view === "mine") void loadMine();
      initialized = true;
    },
  );

  createEffect(
    () => props.addVersion,
    (version) => {
      if (!initialized || version === handledAddVersion) return;
      handledAddVersion = version;
      void preparePublication();
    },
  );

  function loadAgents() {
    setCatalogRefresh((version) => version + 1);
  }

  async function loadMine() {
    setLoading(true);
    const values = await run(() => window.openbot.marketplaceAgents.listMine());
    if (values) {
      setMarket((state) => {
        state.submissions = values;
      });
    }
    setLoading(false);
  }

  async function openAgent(agent: MarketplaceAgentSummary) {
    if (openingAgent) return;
    openingAgent = true;
    const analytics = desktopAnalytics.scope();
    props.onEnterDetail();
    setLoading(true);
    const value = await run(() => window.openbot.marketplaceAgents.get(agent.id));
    analytics.track("marketplace_action", {
      entity: "agent",
      action: "view",
      result: value ? "succeeded" : "failed",
      ...(value ? {} : { failure_code: "load_failed" }),
    });
    if (value) {
      setMarket((state) => {
        state.detail = value;
      });
    } else props.onLeaveDetail();
    openingAgent = false;
    setLoading(false);
  }

  function closeAgent() {
    setMarket((state) => {
      state.detail = null;
    });
    props.onLeaveDetail();
  }

  async function installAgent(agent: MarketplaceAgentDetail, update = false) {
    const installation = update ? installedAgent(agent) : undefined;
    if (installation?.marketplaceSource?.versionId === agent.versionId) return;
    const updating = Boolean(installation);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const analytics = desktopAnalytics.scope();
    setBusy(updating ? `update:${agent.id}` : agent.id);
    const value = await run(() =>
      window.openbot.marketplaceAgents.install({
        listingId: agent.id,
        ...(installation ? { agentId: installation.id } : {}),
        timezone,
        receiptId: crypto.randomUUID(),
      }),
    );
    analytics.track("marketplace_action", {
      entity: "agent",
      action: updating ? "update" : "install",
      result: value ? "succeeded" : "failed",
      ...(value ? {} : { failure_code: updating ? "update_failed" : "install_failed" }),
    });
    if (value) await props.onInstalled?.(value.agent);
    setBusy(null);
  }

  function installedAgent(agent: MarketplaceAgentSummary) {
    const installations = props.agents.filter((installed) => installed.marketplaceSource?.listingId === agent.id);
    return (
      installations.find((installed) => (installed.marketplaceSource?.version ?? 0) < agent.version) ?? installations[0]
    );
  }

  function agentAction(agent: MarketplaceAgentSummary): "Install" | "Update" | "Installed" {
    const installed = installedAgent(agent);
    if (!installed) return "Install";
    return installed.marketplaceSource?.versionId === ("versionId" in agent ? agent.versionId : undefined) ||
      (installed.marketplaceSource?.version ?? 0) >= agent.version
      ? "Installed"
      : "Update";
  }

  async function preparePublication(listingId?: string) {
    const agentId = market.publication.sourceAgentId || props.agents[0]?.id;
    if (!agentId) {
      setError("Switch to Local and choose an agent to publish.");
      return;
    }
    setMarket((state) => {
      state.publication.listingId = listingId;
      const previous = state.submissions.find((item) => item.listingId === listingId);
      state.publication.category = previous?.category ?? "other";
    });
    setBusy("publish");
    const value = await run(() => window.openbot.marketplaceAgents.preview(agentId));
    if (value) {
      setMarket((state) => {
        state.publication.preview = value;
      });
    }
    setBusy(null);
  }

  /** Drops the previewed publication and the agent it was going to update. */
  function discardPublication(): void {
    setMarket((state) => {
      state.publication.preview = null;
      state.publication.listingId = undefined;
    });
  }

  async function submitPublication() {
    const value = market.publication.preview;
    if (!value) return;
    const analytics = desktopAnalytics.scope();
    const listingId = market.publication.listingId;
    setBusy("submit");
    const result = await run(() =>
      window.openbot.marketplaceAgents.submit({
        agentId: value.agentId,
        category: market.publication.category,
        showCreatorAvatar: true,
        ...(listingId ? { listingId } : {}),
      }),
    );
    analytics.track("marketplace_action", {
      entity: "agent",
      action: "publish",
      result: result ? "succeeded" : "failed",
      ...(result ? {} : { failure_code: "publish_failed" }),
    });
    if (result) {
      discardPublication();
      await loadMine();
    }
    setBusy(null);
  }

  return (
    <section class="skills-marketplace-panel agent-marketplace-panel" aria-label="Agent marketplace">
      <Show when={props.view === "discover"}>
        <div hidden={Boolean(market.detail) || panel.loading} inert={Boolean(market.detail) || panel.loading}>
          <MarketplaceCatalog
            kind="agents"
            refreshVersion={catalogRefresh()}
            list={async (query) => {
              const page = await window.openbot.marketplaceAgents.list(query);
              return { items: page.agents, nextCursor: page.nextCursor };
            }}
            icon={(agent) => (
              <AgentAvatar seed={agent.avatarSeed} hue={agent.avatarHue} url={agent.avatarUrl} motion="hover" />
            )}
            onOpen={openAgent}
          />
        </div>
        <Show when={panel.loading}>
          <div class="skills-marketplace-state" role="status">
            Loading agent details…
          </div>
        </Show>
        <Show when={market.detail} keyed>
          {(agent) => (
            <MarketplaceDetail
              name={agent.name}
              description={agent.description}
              creatorName={agent.creatorName}
              creatorAvatarUrl={agent.creatorAvatarUrl}
              icon={<AgentAvatar seed={agent.avatarSeed} hue={agent.avatarHue} url={agent.avatarUrl} motion="hover" />}
              backLabel="Back to agents"
              onBack={closeAgent}
              action={
                <>
                  <Show when={agentAction(agent) === "Update"}>
                    <Button
                      disabled={panel.busy !== null}
                      loading={panel.busy === `update:${agent.id}`}
                      loadingLabel="Updating…"
                      onClick={() => void installAgent(agent, true)}
                    >
                      Update agent
                    </Button>
                  </Show>
                  <Button
                    disabled={panel.busy !== null}
                    loading={panel.busy === agent.id}
                    loadingLabel="Installing…"
                    onClick={() => void installAgent(agent)}
                  >
                    Install agent
                  </Button>
                </>
              }
              sections={[
                {
                  title: "Instructions",
                  subtitle: "How this agent should work",
                  content: () => <p>{agent.description}</p>,
                },
                {
                  title: "Skills",
                  subtitle: "Playbooks it can run",
                  content: () => (
                    <Show when={agent.skills.length} fallback={<p>No marketplace skills included.</p>}>
                      <ul class="agent-marketplace-dependency-list">
                        <For each={agent.skills}>
                          {(skill) => (
                            <li>
                              <span>{skill.name}</span>
                              <small>v{skill.version}</small>
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>
                  ),
                },
                {
                  title: "Routines",
                  subtitle: "Jobs that run on their own",
                  content: () => (
                    <Show when={agent.routines.length} fallback={<p>No routines included.</p>}>
                      <ul class="agent-marketplace-routine-list">
                        <For each={agent.routines}>
                          {(routine) => (
                            <li>
                              <span>
                                {routine.name}
                                <small>{routineScheduleSummary(routine.schedule)}</small>
                                <p>{routine.instruction}</p>
                              </span>
                              <small>{routine.active ? "Active" : "Inactive"}</small>
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>
                  ),
                },
              ]}
            />
          )}
        </Show>
      </Show>

      <Show when={props.view === "installed"}>
        <div class="skills-marketplace-heading">
          <div>
            <h1>Installed</h1>
            <p>Agents available in your local sidebar.</p>
          </div>
        </div>
        <Show
          when={props.agents.length}
          fallback={<div class="skills-marketplace-state">No agents installed yet.</div>}
        >
          <section class="skills-marketplace-category-section">
            <div class="skills-marketplace-section-title">
              <h2>Local agents</h2>
              <span>{props.agents.length} installed</span>
            </div>
            <div class="skills-marketplace-grid agent-marketplace-grid">
              <For each={props.agents}>
                {(agent) => (
                  <article class="skills-marketplace-card agent-marketplace-card">
                    <AgentAvatar seed={agent.id} hue={null} motion="hover" />
                    <div class="skills-marketplace-card-copy">
                      <div>
                        <h3>{agent.name}</h3>
                        <span>Installed</span>
                      </div>
                      <p>Available in Local</p>
                    </div>
                  </article>
                )}
              </For>
            </div>
          </section>
        </Show>
      </Show>

      <Show when={props.view === "mine"}>
        <div class="skills-marketplace-heading">
          <div>
            <h1>My agent submissions</h1>
            <p>Publish a reusable snapshot of a local agent for review.</p>
          </div>
          <div class="agent-marketplace-publish-picker">
            <span class="skills-agent-select-control">
              <NativeSelect
                aria-label="Agent to publish"
                value={market.publication.sourceAgentId}
                onChange={(event) => {
                  const agentId = event.currentTarget.value;
                  setMarket((state) => {
                    state.publication.sourceAgentId = agentId;
                  });
                }}
                disabled={!props.agents.length}
              >
                <Show when={props.agents.length} fallback={<option value="">No local agents</option>}>
                  <For each={props.agents}>{(agent) => <option value={agent.id}>{agent.name}</option>}</For>
                </Show>
              </NativeSelect>
              <ChevronDown aria-hidden="true" />
            </span>
            <Button loading={panel.busy !== null} onClick={() => void preparePublication()}>
              <Plus /> Add agent
            </Button>
          </div>
        </div>
        <Show when={market.publication.preview} keyed>
          {(value) => (
            <div class="skills-publish-card agent-publish-card">
              <div class="skills-publish-summary">
                <AgentAvatar seed={value.avatarSeed} hue={value.avatarHue} url={value.avatarUrl} motion="hover" />
                <div>
                  <h2>{value.name}</h2>
                  <p>{value.description}</p>
                  <small>
                    {value.skills.length} skills · {value.routines.length} routines
                  </small>
                </div>
              </div>
              <p>Conversation history, memories, model settings, and workspace files are not included.</p>
              <label class="marketplace-publication-category">
                Category
                <NativeSelect
                  aria-label="Agent category"
                  value={market.publication.category}
                  onChange={(event) => {
                    const category = event.currentTarget.value;
                    if (isSkillCategory(category))
                      setMarket((state) => {
                        state.publication.category = category;
                      });
                  }}
                >
                  <For each={SKILL_CATEGORIES}>
                    {(category) => <option value={category}>{CATEGORY_LABELS[category]}</option>}
                  </For>
                </NativeSelect>
              </label>
              <div class="skills-publish-actions">
                <Button variant="ghost" onClick={discardPublication}>
                  Cancel
                </Button>
                <Button
                  loading={panel.busy !== null}
                  loadingLabel="Submitting…"
                  onClick={() => void submitPublication()}
                >
                  Submit for review
                </Button>
              </div>
            </div>
          )}
        </Show>
        <Show when={!market.publication.preview}>
          <Show when={!panel.loading} fallback={<div class="skills-marketplace-state">Loading submissions…</div>}>
            <Show
              when={market.submissions.length}
              fallback={<div class="skills-marketplace-state">No agent submissions yet.</div>}
            >
              <div class="skills-submission-list">
                <For each={market.submissions}>
                  {(item) => (
                    <article class="skills-submission-row agent-submission-row">
                      <AgentAvatar seed={item.avatarSeed} hue={item.avatarHue} url={item.avatarUrl} motion="hover" />
                      <div>
                        <h3>{item.name}</h3>
                        <p>
                          Version {item.version} · {item.skillCount} skills · {item.routineCount} routines
                        </p>
                        <Show when={item.rejectionNote}>
                          <small>{item.rejectionNote}</small>
                        </Show>
                      </div>
                      <span class="skills-submission-status" data-status={item.status}>
                        {item.status}
                      </span>
                      <Show when={item.status === "approved" || item.status === "rejected"}>
                        <Button size="sm" onClick={() => void preparePublication(item.listingId)}>
                          <Plus /> New version
                        </Button>
                      </Show>
                    </article>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </Show>
      <Show when={panel.error}>
        {(message) => (
          <div class="skills-marketplace-error" role="alert">
            {message()}
          </div>
        )}
      </Show>
    </section>
  );
}

function SkillDetailSkeleton() {
  return (
    <section
      class="skills-marketplace-detail skills-marketplace-detail-skeleton"
      role="status"
      aria-label="Loading skill"
    >
      <Skeleton class="skills-marketplace-detail-skeleton-back" />
      <div class="skills-marketplace-detail-hero">
        <Skeleton class="skills-marketplace-detail-skeleton-icon" />
        <div>
          <Skeleton class="skills-marketplace-detail-skeleton-category" />
          <Skeleton class="skills-marketplace-detail-skeleton-title" />
          <Skeleton class="skills-marketplace-detail-skeleton-description" />
          <div class="skills-marketplace-detail-meta">
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        </div>
        <Skeleton class="skills-marketplace-detail-skeleton-action" />
      </div>
      <div class="skills-marketplace-detail-content">
        <div class="skills-marketplace-detail-instructions">
          <Skeleton class="skills-marketplace-detail-skeleton-heading" />
          <div class="skills-marketplace-detail-skeleton-copy">
            <Skeleton />
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        </div>
        <aside class="skills-marketplace-detail-package">
          <Skeleton class="skills-marketplace-detail-skeleton-package-heading" />
          <Skeleton class="skills-marketplace-detail-skeleton-package-count" />
          <div class="skills-marketplace-detail-skeleton-files">
            <Skeleton />
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        </aside>
      </div>
    </section>
  );
}

function SkillDetailView(props: {
  skill: MarketplaceSkillDetail;
  installed: InstalledSkill | undefined;
  busy: boolean;
  onBack: () => void;
  onInstall: (skill: MarketplaceSkillSummary) => Promise<void>;
  agents: Array<Pick<AgentSummary, "id" | "name">>;
  targetAgentId: string;
  onTargetChange: (id: string) => void;
}) {
  const current = () =>
    props.installed?.state === "installed" && props.installed.installedVersion >= props.skill.version;
  return (
    <MarketplaceDetail
      name={props.skill.name}
      description={props.skill.description}
      creatorName={props.skill.creatorName}
      creatorAvatarUrl={props.skill.creatorAvatarUrl}
      icon={<SkillIcon skill={props.skill} />}
      backLabel="Back to skills"
      onBack={props.onBack}
      action={
        <>
          <AgentSelect agents={props.agents} value={props.targetAgentId} onChange={props.onTargetChange} />
          <Button
            loading={props.busy}
            disabled={!props.targetAgentId || current()}
            onClick={() => void props.onInstall(props.skill)}
          >
            {current() ? "Installed" : props.installed ? "Update skill" : "Install skill"}
          </Button>
        </>
      }
      sections={[
        {
          title: "Instructions",
          subtitle: "How this skill should work",
          content: () => <p>{displayInstructions(props.skill)}</p>,
        },
        {
          title: "Package contents",
          subtitle: "Files included with this skill",
          content: () => (
            <>
              <p>
                {props.skill.files.length} files included · Version {props.skill.version}
              </p>
              <ul>
                <For each={props.skill.files}>{(file) => <li>{file}</li>}</For>
              </ul>
            </>
          ),
        },
      ]}
    />
  );
}

function SkillSubmissionDetailView(props: { submission: SkillSubmission; onBack: () => void }) {
  return (
    <section class="skills-marketplace-detail" aria-label={`${props.submission.name} submission details`}>
      <Button class="skills-marketplace-detail-back" variant="ghost" size="sm" onClick={props.onBack}>
        <ArrowLeft /> Back to submissions
      </Button>
      <div class="skills-marketplace-detail-hero skills-submission-detail-hero">
        <SkillIcon skill={props.submission} />
        <div>
          <p class="skills-marketplace-detail-category">{CATEGORY_LABELS[props.submission.category]}</p>
          <h1>{props.submission.name}</h1>
          <p>{props.submission.description}</p>
          <div class="skills-marketplace-detail-meta">
            <span>Submitted by you</span>
            <span>Version {props.submission.version}</span>
            <span>{new Date(props.submission.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
      <div class="skills-marketplace-detail-content">
        <div class="skills-marketplace-detail-instructions">
          <h2>What this skill does</h2>
          <div>{props.submission.description}</div>
        </div>
        <aside class="skills-marketplace-detail-package skills-submission-detail-review">
          <h2>Review status</h2>
          <span class="skills-submission-status" data-status={props.submission.status}>
            {props.submission.status}
          </span>
          <Show when={props.submission.rejectionNote}>
            {(note) => <p class="skills-submission-detail-note">{note()}</p>}
          </Show>
        </aside>
      </div>
    </section>
  );
}

function displayInstructions(skill: MarketplaceSkillDetail): string {
  const instructions = skill.instructions || skill.description;
  const [firstLine, ...remaining] = instructions.split(/\r?\n/u);
  if (firstLine?.replace(/^#\s+/u, "").trim() === skill.name) return remaining.join("\n").trim();
  return instructions;
}

function avatarImageDataUrl(image: AvatarImageInput): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < image.bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...image.bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${image.mimeType};base64,${btoa(binary)}`;
}

function marketplaceErrorMessage(cause: unknown): string {
  const rawMessage = cause instanceof Error ? cause.message : String(cause);
  const message = rawMessage.replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, "");
  if (message === "A skill with this name already exists.") {
    return "That skill name is already taken. Choose a different name in SKILL.md, then try again.";
  }
  return message;
}

function AgentSelect(props: {
  agents: Array<{ id: string; name: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label class="skills-agent-select">
      <span>Install to</span>
      <span class="skills-agent-select-control">
        <NativeSelect
          value={props.value}
          onChange={(event) => props.onChange(event.currentTarget.value)}
          disabled={!props.agents.length}
        >
          <Show when={props.agents.length} fallback={<option value="">No local agents</option>}>
            <For each={props.agents}>{(agent) => <option value={agent.id}>{agent.name}</option>}</For>
          </Show>
        </NativeSelect>
        <ChevronDown aria-hidden="true" />
      </span>
    </label>
  );
}

function SkillIcon(props: { skill: { name: string; iconUrl: string | null } }) {
  const [failedUrl, setFailedUrl] = createSignal<string | null>(null);
  const iconUrl = createMemo(() => {
    const url = props.skill.iconUrl;
    return url && failedUrl() !== url ? url : null;
  });

  return (
    <span class="skills-marketplace-icon">
      <Show when={iconUrl()} fallback={<Puzzle />} keyed>
        {(url) => <img src={url} alt="" onError={() => setFailedUrl(url)} />}
      </Show>
    </span>
  );
}
