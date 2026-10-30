import {
  type InstalledSkill,
  isRemovableSkill,
  type MarketplaceSkillDetail,
  type MarketplaceSkillSummary,
} from "@openbot/contracts/ipc";
import {
  Button,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Search,
  SettingsSection,
  Switch,
  Text,
} from "@openbot/ui";
import { skillExamplePrompt, skillInstructions } from "@openbot/ui/components/SkillPreview";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { MarkdownMessageText } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, For, Show } from "solid-js";
import { IntegrationPage, type IntegrationStatus } from "../settings/IntegrationLayout";
import { AddToAgents, type DialogSkill } from "./MarketplaceAgentsDialog";
import { useInstalls } from "./MarketplaceCards";
import { DetailState, SkillIcon, TryCard } from "./MarketplaceParts";
import { CATEGORY_LABELS } from "./marketplace-listing";
import type { MarketplaceAgent, MarketplaceModel } from "./marketplace-model";
import { agentsWith, canSwitch, isOn, matches, outdated, useSkillWords } from "./marketplace-skill-state";
import { createDetail, type MarketplaceScope } from "./marketplace-view";

/** The agents section shows a search when more agents than this have the skill. */
const AGENT_SEARCH_FROM = 6;

/** The status of a skill on the page header, as an app's. */
function useSkillStatus(model: () => MarketplaceModel) {
  const { t } = useText();
  const words = useSkillWords(model);
  return (skillId: string, version?: number): { status: IntegrationStatus; label: string } => {
    const have = agentsWith(model(), skillId);
    if (have.some((agent) => outdated(model().installedSkill(agent.id, skillId), version)))
      return { status: "attention", label: t("marketplace.skills.state.update") };
    if (have.length === 0) return { status: "idle", label: t("marketplace.skills.status.notAdded") };
    return { status: "connected", label: t("marketplace.skills.status.on", { agents: words.agentNames(have) }) };
  };
}

/**
 * One agent that has the skill: its state, Update, on and off, and Remove. A built-in or a folder
 * skill has no Remove. A changed copy, or one that needs repair, keeps its switch as it is.
 */
function AgentSkillRow(props: {
  model: MarketplaceModel;
  agent: MarketplaceAgent;
  skill: DialogSkill;
  version?: number | undefined;
}) {
  const { t, format } = useText();
  const words = useSkillWords(() => props.model);
  const installed = () => props.model.installedSkill(props.agent.id, props.skill.id);
  const busy = () => props.model.skillBusy(props.skill.id);
  const locked = (current: InstalledSkill) => busy() || !canSwitch(current);
  const line = (current: InstalledSkill) =>
    words.plainState(current, props.version) ??
    t("marketplace.skills.version", { version: format.number(current.installedVersion) });
  return (
    <Show when={installed()}>
      {(current) => (
        <Item class="settings-modal-row">
          <ItemMedia>
            <span class="marketplace-avatar" data-size="md">
              <AgentAvatar agent={props.agent} motion="idle" />
            </span>
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{props.agent.name}</ItemTitle>
            <ItemDescription>{line(current())}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Show when={outdated(current(), props.version)}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy()}
                onClick={() => void props.model.updateSkill(props.skill, [props.agent.id])}
              >
                {t("skill.update")}
              </Button>
            </Show>
            <Switch
              aria-label={t("marketplace.skills.agent.toggle", { name: current().name, agent: props.agent.name })}
              checked={isOn(current())}
              disabled={locked(current())}
              onChange={(on: boolean) => void props.model.setSkillEnabled(props.agent.id, props.skill.id, on)}
            />
            <Show when={isRemovableSkill(current())}>
              <Button
                type="button"
                size="sm"
                variant="destructive-ghost"
                aria-label={t("marketplace.skills.agent.removeName", { name: current().name, agent: props.agent.name })}
                disabled={busy()}
                onClick={() => void props.model.changeSkill(props.skill, { add: [], remove: [props.agent.id] })}
              >
                {t("marketplace.skills.agent.remove")}
              </Button>
            </Show>
          </ItemActions>
        </Item>
      )}
    </Show>
  );
}

/** "Agents · 12": a row for each agent that has the skill, a search for many, and Remove all. */
function SkillAgents(props: {
  model: MarketplaceModel;
  skill: DialogSkill;
  version?: number | undefined;
  title: string;
  description?: string | undefined;
}) {
  const { t } = useText();
  const [search, setSearch] = createSignal("");
  const have = () => agentsWith(props.model, props.skill.id);
  const shown = () => have().filter((agent) => matches(search(), `${agent.name} ${agent.title ?? ""}`));
  const removable = () =>
    have().filter((agent) => {
      const installed = props.model.installedSkill(agent.id, props.skill.id);
      return installed !== undefined && isRemovableSkill(installed);
    });
  return (
    <Show when={have().length > 0}>
      <SettingsSection
        title={props.title}
        description={props.description}
        actions={
          <>
            <Show when={have().length > AGENT_SEARCH_FROM}>
              <label class="search-field marketplace-skill-page-search">
                <Search aria-hidden="true" />
                <Input
                  type="search"
                  aria-label={t("marketplace.skills.agents.searchName", { name: props.skill.name })}
                  placeholder={t("marketplace.skills.agents.search")}
                  value={search()}
                  onInput={(event) => setSearch(event.currentTarget.value)}
                />
              </label>
            </Show>
            <Show when={removable().length > 0}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t("marketplace.skills.agents.removeAllName", {
                  name: props.skill.name,
                  count: removable().length,
                })}
                disabled={props.model.skillBusy(props.skill.id)}
                onClick={() =>
                  void props.model.changeSkill(props.skill, {
                    add: [],
                    remove: removable().map((agent) => agent.id),
                  })
                }
              >
                {t("marketplace.skills.agents.removeAll")}
              </Button>
            </Show>
          </>
        }
      >
        <ItemGroup class="settings-modal-card">
          <For each={shown()} keyed={(agent) => agent.id}>
            {(agent) => (
              <AgentSkillRow model={props.model} agent={agent()} skill={props.skill} version={props.version} />
            )}
          </For>
          <Show when={shown().length === 0}>
            <div class="integration-card-body">
              <Text as="p" variant="body-sm" tone="muted">
                {t("marketplace.skills.agents.noMatch", { query: search().trim() })}
              </Text>
            </div>
          </Show>
        </ItemGroup>
      </SettingsSection>
    </Show>
  );
}

/** What the skill does, who made it, where it comes from, its category, version, date and installs. */
function SkillInformation(props: { skill: MarketplaceSkillSummary }) {
  const { t, format } = useText();
  const installs = useInstalls();
  const source = () =>
    props.skill.verified === true
      ? t("marketplace.skills.source.verifiedLong")
      : t("marketplace.skills.source.publicLong");
  const facts = () => [
    { label: t("marketplace.properties.creator"), value: props.skill.creatorName },
    { label: t("marketplace.skills.sourceLabel"), value: source() },
    { label: t("marketplace.properties.category"), value: t(CATEGORY_LABELS[props.skill.category]) },
    { label: t("marketplace.properties.version"), value: format.number(props.skill.version) },
    {
      label: t("marketplace.properties.updated"),
      value: format.date(new Date(props.skill.updatedAt), { dateStyle: "medium" }),
    },
    { label: t("marketplace.properties.installs"), value: installs(props.skill.installs) },
  ];
  return (
    <SettingsSection title={t("plugin.section.information")}>
      <ItemGroup class="settings-modal-card">
        <div class="integration-card-body">
          <Text as="p" variant="body-sm">
            {props.skill.description}
          </Text>
          {/* `dt` and `dd` stay direct children of the list: axe rejects a wrapper per row. */}
          <dl class="marketplace-props marketplace-info">
            <For each={facts()} keyed={(fact) => fact.label}>
              {(fact) => (
                <>
                  <dt>
                    <Text as="span" variant="caption" tone="muted">
                      {fact().label}
                    </Text>
                  </dt>
                  <dd>
                    <Text as="span" variant="body-sm">
                      {fact().value}
                    </Text>
                  </dd>
                </>
              )}
            </For>
          </dl>
        </div>
      </ItemGroup>
    </SettingsSection>
  );
}

/** The page of a catalog skill on the app page layout: Try, the agents that have it, its SKILL.md and facts. */
export function MarketplaceSkillPage(props: { scope: MarketplaceScope; listing: MarketplaceSkillSummary }) {
  const { t } = useText();
  const model = () => props.scope.model;
  const status = useSkillStatus(model);
  const detail = createDetail(() => model().loadSkill(props.listing.id));
  /* The loaded detail can be newer than the listing, and the Try card sends its instructions. */
  const skill = () => detail.value() ?? props.listing;
  const current = () => status(skill().id, skill().version);
  // An effect, not `onSettled`: the read goes through the owner's props, and a prop that the
  // owner computes makes a memo, which `onSettled` refuses.
  createEffect(
    () => props.listing.id,
    () => model().readSkills(),
  );

  /* An agent can try the skill when it has this version and the skill is on. */
  const usable = (agentId: string) => {
    const installed = model().installedSkill(agentId, skill().id);
    return (
      installed !== undefined &&
      installed.enabled !== false &&
      installed.state !== "needs-repair" &&
      installed.installedVersion >= skill().version
    );
  };
  /** The agent whose chat is open, when it can try the skill; else the first agent that can. */
  const tryAgent = () => {
    const agents = model()
      .agents()
      .filter((agent) => usable(agent.id));
    return agents.find((agent) => agent.id === model().activeAgentId()) ?? agents[0];
  };
  /** Why the Try arrow is off, when the reason is not on the page already. */
  const reason = () => {
    if (tryAgent()) return model().trySkill ? undefined : t("marketplace.try.composerUnavailable");
    if (
      model()
        .agents()
        .some((agent) => model().skillRead(agent.id) === "failed")
    )
      return t("marketplace.try.readFailed");
    const have = agentsWith(model(), skill().id).flatMap((agent) => model().installedSkill(agent.id, skill().id) ?? []);
    if (have.length === 0) return undefined;
    if (have.some((installed) => installed.enabled === false)) return t("marketplace.try.enable");
    if (have.some((installed) => installed.state === "needs-repair")) return t("marketplace.try.repair");
    return t("marketplace.try.update");
  };
  const tryLabel = () => {
    const agent = tryAgent();
    return agent ? t("marketplace.try.in", { name: agent.name }) : t("skill.preview.try");
  };
  /** The Try arrow: off while no agent can try the skill or no composer takes it. */
  const tryHandler = (full: MarketplaceSkillDetail) => {
    const run = model().trySkill;
    if (!tryAgent() || !run) return undefined;
    return () => {
      const agent = tryAgent();
      if (agent) run(agent.id, full);
    };
  };

  return (
    <div class="marketplace-view">
      <IntegrationPage
        class="marketplace-skill-page"
        logo={<SkillIcon url={skill().iconUrl} />}
        name={skill().name}
        status={current().status}
        statusLabel={current().label}
        subtitle={skill().description}
        actions={<AddToAgents model={model()} skill={skill()} />}
        intro={
          <DetailState
            status={detail.status()}
            reference={detail.reference()}
            loadingLabel={t("marketplace.skill.loading")}
            onRetry={detail.retry}
          >
            <Show when={detail.value()}>
              {(full) => (
                <TryCard
                  seed={skill().name}
                  chip={{ kind: "skill", name: skill().name, icon: <SkillIcon url={skill().iconUrl} /> }}
                  requests={[{ id: "example", text: skillExamplePrompt(full(), t) }]}
                  tryLabel={tryLabel}
                  onTry={tryHandler(full())}
                  caption={reason()}
                />
              )}
            </Show>
          </DetailState>
        }
        details={<SkillInformation skill={skill()} />}
      >
        <SkillAgents
          model={model()}
          skill={skill()}
          version={skill().version}
          title={t("marketplace.skills.agentsTitle", { total: agentsWith(model(), skill().id).length })}
        />
        <Show when={detail.value()}>
          {(full) => (
            <SettingsSection title={t("marketplace.skill.doc")}>
              <ItemGroup class="settings-modal-card">
                <div class="integration-card-body marketplace-doc message-markdown">
                  <MarkdownMessageText
                    imagesAsLinks
                    body={skillInstructions(full())}
                    agents={[]}
                    onSelectAgent={() => undefined}
                    onOpenLink={(url) => model().openUrl(url)}
                  />
                </div>
              </ItemGroup>
            </SettingsSection>
          )}
        </Show>
      </IntegrationPage>
    </div>
  );
}

/** A skill made on this computer, or in an agent's folder: the agents that have it. It has no catalog page. */
export function MarketplaceLocalSkillPage(props: { scope: MarketplaceScope; skillId: string }) {
  const { t } = useText();
  const model = () => props.scope.model;
  const words = useSkillWords(model);
  const status = useSkillStatus(model);
  const installed = () =>
    agentsWith(model(), props.skillId)
      .map((agent) => model().installedSkill(agent.id, props.skillId))
      .find((skill) => skill !== undefined);
  const subtitle = (skill: InstalledSkill) => skill.description ?? words.sourceOf(skill);
  createEffect(
    () => props.skillId,
    () => model().readSkills(),
  );
  return (
    <div class="marketplace-view">
      <Show
        when={installed()}
        fallback={
          <Text as="p" variant="body" tone="muted">
            {t("marketplace.skills.local.gone")}
          </Text>
        }
      >
        {(skill) => (
          <IntegrationPage
            class="marketplace-skill-page"
            logo={<SkillIcon url={null} />}
            name={skill().name}
            status={status(props.skillId).status}
            statusLabel={status(props.skillId).label}
            subtitle={subtitle(skill())}
            actions={<AddToAgents model={model()} skill={{ id: props.skillId, name: skill().name }} />}
          >
            <SkillAgents
              model={model()}
              skill={{ id: props.skillId, name: skill().name }}
              title={t("marketplace.tab.agents")}
              description={words.sourceOf(skill())}
            />
          </IntegrationPage>
        )}
      </Show>
    </div>
  );
}
