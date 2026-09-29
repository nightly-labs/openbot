import type {
  AddedAgent,
  AgentPublicationPreview,
  AgentSubmission,
  AgentSummary,
  MarketplaceAgentDetail,
  MarketplaceAgentSummary,
  SkillCategory,
} from "@openbot/contracts/ipc";
import { isSkillCategory, SKILL_CATEGORIES } from "@openbot/contracts/ipc";
import { Button, ChevronDown, NativeSelect, Plus } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { routineScheduleSummary } from "@openbot/ui/features/conversation/routine-schedule-ui";
import { CATEGORY_LABELS, MarketplaceCatalog } from "@openbot/ui/features/settings/MarketplaceCatalog";
import { MarketplaceDetail } from "@openbot/ui/features/settings/MarketplaceDetail";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, createStore, For, Show, untrack } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { createAsyncPanel } from "../../components/createAsyncPanel";
import type { MarketplaceCalls } from "./marketplace-calls";
import {
  agentHomeCache,
  type MarketplaceTab,
  marketplaceErrorMessage,
  publishingCalls,
  REVIEW_STATUS_LABEL,
} from "./marketplace-shared";

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

export function AgentMarketplacePanel(props: {
  /** This computer's agents, which can be published. */
  agents: Array<Pick<AgentSummary, "id" | "name" | "marketplaceSource">>;
  /** The agents whose listing offers an update; they live on `updateServerId`. */
  installedAgents: Array<Pick<AgentSummary, "id" | "name" | "marketplaceSource">>;
  view: MarketplaceTab;
  query: string;
  refreshVersion: number;
  addVersion: number;
  serverId: string | undefined;
  updateServerId: string | undefined;
  calls: MarketplaceCalls;
  onInstalled?: (agent: AddedAgent, serverId?: string) => void | Promise<void>;
  onEnterDetail: (name: string, close: () => void) => void;
  onLeaveDetail: () => void;
}) {
  const { t } = useText();
  const [market, setMarket] = createStore<AgentsMarketplace>({
    detail: null,
    publication: {
      category: "other",
      listingId: undefined,
      preview: null,
      sourceAgentId: untrack(() => props.agents[0]?.id ?? ""),
    },
    submissions: [],
  });
  const { panel, run, setBusy, setError, setLoading } = createAsyncPanel(marketplaceErrorMessage);
  const [catalogRefresh, setCatalogRefresh] = createSignal(0);
  let initialized = false;
  let handledAddVersion = 0;
  let openingAgent = false;
  let publicationRequest = 0;
  let detailRequest = 0;

  createEffect(
    () => [props.view, props.refreshVersion] as const,
    ([view]) => {
      publicationRequest += 1;
      // A detail answer that arrives after the panel moved on belongs to a page that is gone.
      detailRequest += 1;
      setBusy(null);
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
    const values = await run(() => publishingCalls(props.calls).agents.listMine());
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
    props.onEnterDetail(agent.name, closeAgent);
    const request = ++detailRequest;
    setLoading(true);
    const value = await run(() => props.calls.agents.get(agent.id));
    analytics.track("marketplace_action", {
      entity: "agent",
      action: "view",
      listing_slug: agent.id,
      result: value ? "succeeded" : "failed",
      ...(value ? {} : { failure_code: "load_failed" }),
    });
    openingAgent = false;
    setLoading(false);
    if (request !== detailRequest) return;
    if (value) {
      setMarket((state) => {
        state.detail = value;
      });
    } else props.onLeaveDetail();
  }

  function closeAgent() {
    detailRequest += 1;
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
    const serverId = updating ? props.updateServerId : props.serverId;
    const input = {
      listingId: agent.id,
      ...(installation ? { agentId: installation.id } : {}),
      timezone,
      receiptId: crypto.randomUUID(),
    };
    const value = await run(() => props.calls.addAgent(input, serverId));
    analytics.track("marketplace_action", {
      entity: "agent",
      action: updating ? "update" : "install",
      listing_slug: agent.id,
      result: value ? "succeeded" : "failed",
      ...(value ? {} : { failure_code: updating ? "update_failed" : "install_failed" }),
    });
    if (value) await props.onInstalled?.(value, serverId);
    setBusy(null);
  }

  function installedAgent(agent: MarketplaceAgentSummary) {
    const installations = props.installedAgents.filter(
      (installed) => installed.marketplaceSource?.listingId === agent.id,
    );
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
      setError(t("marketplace.error.publishNeedsLocal"));
      return;
    }
    setMarket((state) => {
      state.publication.listingId = listingId;
      const previous = state.submissions.find((item) => item.listingId === listingId);
      state.publication.category = previous?.category ?? "other";
    });
    await refreshPublicationPreview(agentId);
  }

  async function refreshPublicationPreview(agentId: string) {
    const request = ++publicationRequest;
    setBusy("publish");
    const value = await run(() => publishingCalls(props.calls).agents.preview(agentId));
    if (request !== publicationRequest) return;
    setMarket((state) => {
      state.publication.preview = value ?? null;
    });
    setBusy(null);
  }

  /** Drops the previewed publication and the agent it was going to update. */
  function discardPublication(): void {
    publicationRequest += 1;
    setBusy(null);
    setMarket((state) => {
      state.publication.preview = null;
      state.publication.listingId = undefined;
    });
  }

  async function submitPublication() {
    const value = market.publication.preview;
    if (!value || panel.busy !== null) return;
    const analytics = desktopAnalytics.scope();
    const listingId = market.publication.listingId;
    setBusy("submit");
    const result = await run(() =>
      publishingCalls(props.calls).agents.submit({
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
    <section
      class="skills-marketplace-panel agent-marketplace-panel"
      aria-label={t("marketplace.agents.label")}
      data-preview-loading={panel.busy === "publish" ? "" : undefined}
    >
      <Show when={props.view === "discover"}>
        <div hidden={Boolean(market.detail) || panel.loading} inert={Boolean(market.detail) || panel.loading}>
          <MarketplaceCatalog
            kind="agents"
            query={props.query}
            refreshVersion={catalogRefresh()}
            homeCache={agentHomeCache(props.calls)}
            list={async (query) => {
              const page = await props.calls.agents.list(query);
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
            {t("marketplace.agents.loadingDetail")}
          </div>
        </Show>
        <Show when={market.detail} keyed>
          {(agent) => (
            <MarketplaceDetail
              name={agent.name}
              /* The heading carries the one-line title; the long text is the instructions below. */
              description={agent.title}
              creatorName={agent.creatorName}
              creatorAvatarUrl={agent.creatorAvatarUrl ?? null}
              icon={<AgentAvatar seed={agent.avatarSeed} hue={agent.avatarHue} url={agent.avatarUrl} motion="hover" />}
              action={
                <>
                  <Show when={agentAction(agent) === "Update"}>
                    <Button
                      disabled={panel.busy !== null}
                      loading={panel.busy === `update:${agent.id}`}
                      loadingLabel={t("marketplace.agents.updating")}
                      onClick={() => void installAgent(agent, true)}
                    >
                      {t("marketplace.agents.update")}
                    </Button>
                  </Show>
                  <Button
                    disabled={panel.busy !== null}
                    loading={panel.busy === agent.id}
                    loadingLabel={t("marketplace.agents.installing")}
                    onClick={() => void installAgent(agent)}
                  >
                    {t("marketplace.agents.install")}
                  </Button>
                </>
              }
              /* A section is offered only when it carries data, so an agent without routines does
                 not open an empty panel. */
              sections={[
                {
                  title: t("marketplace.agents.instructions"),
                  subtitle: t("marketplace.agents.instructionsHint"),
                  content: () => <p>{agent.description}</p>,
                },
                ...(agent.skills.length
                  ? [
                      {
                        title: t("marketplace.agents.skills"),
                        subtitle: t("marketplace.agents.skillsHint"),
                        content: () => (
                          <ul class="agent-marketplace-dependency-list">
                            <For each={agent.skills}>
                              {(skill) => (
                                <li>
                                  <span>{skill.name}</span>
                                  <small>{t("marketplace.version", { version: skill.version })}</small>
                                </li>
                              )}
                            </For>
                          </ul>
                        ),
                      },
                    ]
                  : []),
                ...(agent.routines.length
                  ? [
                      {
                        title: t("marketplace.agents.routines"),
                        subtitle: t("marketplace.agents.routinesHint"),
                        content: () => (
                          <ul class="agent-marketplace-routine-list">
                            <For each={agent.routines}>
                              {(routine) => (
                                <li>
                                  <span>{routine.name}</span>
                                  <p>{routine.instruction}</p>
                                  <small>
                                    {routineScheduleSummary(routine.schedule)} ·{" "}
                                    {routine.active
                                      ? t("marketplace.agents.routineActive")
                                      : t("marketplace.agents.routineInactive")}
                                  </small>
                                </li>
                              )}
                            </For>
                          </ul>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </Show>
      </Show>

      <Show when={props.view === "mine"}>
        <div class="skills-marketplace-heading">
          <div>
            <h1>{t("marketplace.agents.mine")}</h1>
            <p>{t("marketplace.agents.mineDescription")}</p>
          </div>
          <div class="agent-marketplace-publish-picker">
            <span class="skills-agent-select-control">
              <NativeSelect
                aria-label={t("marketplace.agents.source")}
                value={market.publication.sourceAgentId}
                onChange={(event) => {
                  const agentId = event.currentTarget.value;
                  setMarket((state) => {
                    state.publication.sourceAgentId = agentId;
                  });
                  void refreshPublicationPreview(agentId);
                }}
                disabled={!props.agents.length}
              >
                <Show when={props.agents.length} fallback={<option value="">{t("marketplace.agents.noLocal")}</option>}>
                  <For each={props.agents}>{(agent) => <option value={agent.id}>{agent.name}</option>}</For>
                </Show>
              </NativeSelect>
              <ChevronDown aria-hidden="true" />
            </span>
            <Button disabled={panel.busy !== null} onClick={() => void preparePublication()}>
              <Plus /> {t("marketplace.addAgent")}
            </Button>
          </div>
        </div>
        <Show when={market.publication.preview}>
          <div class="skills-publish-card agent-publish-card" aria-busy={panel.busy === "publish" ? "true" : "false"}>
            <Show when={market.publication.preview} keyed>
              {(value) => (
                <div class="skills-publish-summary">
                  <AgentAvatar seed={value.avatarSeed} hue={value.avatarHue} url={value.avatarUrl} motion="hover" />
                  <div>
                    <h2>{value.name}</h2>
                    <p>{value.description}</p>
                    <small>
                      {t("marketplace.agents.counts", { skills: value.skills.length, routines: value.routines.length })}
                    </small>
                  </div>
                </div>
              )}
            </Show>
            <p>{t("marketplace.agents.excluded")}</p>
            <label class="marketplace-publication-category">
              {t("marketplace.publish.category")}
              <NativeSelect
                aria-label={t("marketplace.agents.category")}
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
                  {(category) => <option value={category}>{t(CATEGORY_LABELS[category])}</option>}
                </For>
              </NativeSelect>
            </label>
            <div class="skills-publish-actions">
              <Button variant="ghost" onClick={discardPublication}>
                {t("common.cancel")}
              </Button>
              <Button
                loading={panel.busy === "submit"}
                disabled={panel.busy !== null}
                loadingLabel={t("marketplace.publish.submitting")}
                onClick={() => void submitPublication()}
              >
                {t("marketplace.publish.submit")}
              </Button>
            </div>
          </div>
        </Show>
        <Show when={!market.publication.preview}>
          <Show
            when={!panel.loading}
            fallback={<div class="skills-marketplace-state">{t("marketplace.agents.loadingSubmissions")}</div>}
          >
            <Show
              when={market.submissions.length}
              fallback={<div class="skills-marketplace-state">{t("marketplace.agents.empty")}</div>}
            >
              <div class="skills-submission-list">
                <For each={market.submissions}>
                  {(item) => (
                    <article class="skills-submission-row agent-submission-row">
                      <AgentAvatar seed={item.avatarSeed} hue={item.avatarHue} url={item.avatarUrl} motion="hover" />
                      <div>
                        <h3>{item.name}</h3>
                        <p>
                          {t("marketplace.agents.submissionMeta", {
                            version: item.version,
                            skills: item.skillCount,
                            routines: item.routineCount,
                          })}
                        </p>
                        <Show when={item.rejectionNote}>
                          <small>{item.rejectionNote}</small>
                        </Show>
                      </div>
                      <span class="skills-submission-status" data-status={item.status}>
                        {t(REVIEW_STATUS_LABEL[item.status])}
                      </span>
                      <Show when={item.status === "approved" || item.status === "rejected"}>
                        <Button size="sm" onClick={() => void preparePublication(item.listingId)}>
                          <Plus /> {t("marketplace.submission.newVersion")}
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
