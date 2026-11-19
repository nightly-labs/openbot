import type { MarketplaceAgentDetail, MarketplaceAgentSummary } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  CalendarClock,
  ChevronRight,
  Clock3,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Plus,
  SettingsSection,
  Text,
  UsersRound,
} from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { routineScheduleSummary } from "@openbot/ui/features/conversation/routine-schedule-ui";
import { useText } from "@openbot/ui/text";
import { For, Show } from "solid-js";
import { IntegrationPage, type IntegrationStatus, LogoTile } from "../settings/IntegrationLayout";
import { CopyListingLink, DetailState, SkillIcon } from "./MarketplaceParts";
import { VerifiedMark } from "./MarketplaceSkills";
import { CATEGORY_LABELS } from "./marketplace-listing";
import type { MarketplaceModel } from "./marketplace-model";
import { createDetail, type MarketplaceScope } from "./marketplace-view";

type Trust = "verified" | "reviewed" | "pending";

function trustOf(agent: MarketplaceAgentSummary | MarketplaceAgentDetail): Trust {
  if ("pending" in agent && agent.pending === true) return "pending";
  return agent.verified === true ? "verified" : "reviewed";
}

const TRUST_TEXT = {
  reviewed: { added: "marketplace.agents.trust.reviewed", add: "marketplace.agents.trust.reviewedBeforeAdd" },
  pending: { added: "marketplace.agents.trust.pending", add: "marketplace.agents.trust.pendingBeforeAdd" },
} as const satisfies Record<Exclude<Trust, "verified">, { added: AppTextKey; add: AppTextKey }>;

function useAgentStatus(model: () => MarketplaceModel) {
  const { t } = useText();
  return (listing: MarketplaceAgentSummary): { status: IntegrationStatus; label: string } => {
    const state = model().agentState(listing);
    if (state === "update") return { status: "attention", label: t("marketplace.agent.updateAvailable") };
    if (state === "added") return { status: "connected", label: t("marketplace.agent.added") };
    return { status: "idle", label: t("marketplace.skills.status.notAdded") };
  };
}

function AgentPageActions(props: { model: MarketplaceModel; listing: MarketplaceAgentSummary; add: () => void }) {
  const { t } = useText();
  const state = () => props.model.agentState(props.listing);
  const busy = () => props.model.agentBusy(props.listing.id);
  return (
    <Show when={state()}>
      {(current) => (
        <Show
          when={current() !== "add"}
          fallback={
            <Button type="button" size="sm" variant="outline" loading={busy()} onClick={props.add}>
              <Plus aria-hidden="true" />
              {t("marketplace.agent.addAgent")}
            </Button>
          }
        >
          <Show when={current() === "update"}>
            <Button type="button" size="sm" variant="outline" loading={busy()} onClick={props.add}>
              {t("marketplace.agent.update")}
            </Button>
          </Show>
          <Button type="button" size="sm" variant="outline" onClick={() => props.model.openChat(props.listing.id)}>
            {t("marketplace.agent.openChat")}
          </Button>
        </Show>
      )}
    </Show>
  );
}

function AgentSkillRow(props: { scope: MarketplaceScope; skill: MarketplaceAgentDetail["skills"][number] }) {
  const { t } = useText();
  const listing = createDetail(() => props.scope.model.skillListing(props.skill.skillId));
  return (
    <Item class="settings-modal-row integrations-hub-row">
      <Show when={listing.value()}>
        {(found) => (
          <Button
            type="button"
            variant="ghost"
            class="integrations-hub-hitarea"
            aria-label={t("marketplace.open", { name: props.skill.name })}
            data-cuelume-tap="navigate"
            onClick={() => props.scope.nav.go({ kind: "skill", listing: found() })}
          />
        )}
      </Show>
      <ItemMedia>
        <LogoTile>
          <SkillIcon url={listing.value()?.iconUrl} />
        </LogoTile>
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{props.skill.name}</ItemTitle>
        <ItemDescription>
          {listing.value()?.description ?? t("marketplace.version", { version: props.skill.version })}
        </ItemDescription>
      </ItemContent>
      <ItemActions class="integrations-hub-actions">
        <Show when={listing.value()}>
          <ChevronRight class="integrations-hub-chevron" aria-hidden="true" />
        </Show>
      </ItemActions>
    </Item>
  );
}

function AgentRoutineRow(props: { routine: MarketplaceAgentDetail["routines"][number] }) {
  const { t } = useText();
  const line = () =>
    [
      routineScheduleSummary(props.routine.schedule),
      ...(props.routine.active ? [] : [t("marketplace.agents.routineInactive")]),
    ].join(" · ");
  return (
    <Item class="settings-modal-row">
      <ItemMedia>
        <LogoTile>
          <CalendarClock aria-hidden="true" />
        </LogoTile>
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{props.routine.name}</ItemTitle>
        <ItemDescription>{line()}</ItemDescription>
      </ItemContent>
    </Item>
  );
}

function AgentInformation(props: { agent: MarketplaceAgentSummary | MarketplaceAgentDetail }) {
  const { t, format } = useText();
  const source = () => {
    const trust = trustOf(props.agent);
    if (trust === "verified") return t("marketplace.skills.source.verifiedLong");
    if (trust === "pending") return t("marketplace.agents.source.pending");
    return t("marketplace.skills.source.publicLong");
  };
  const facts = () => [
    { label: t("marketplace.properties.creator"), value: props.agent.creatorName },
    { label: t("marketplace.skills.sourceLabel"), value: source() },
    ...(props.agent.category
      ? [{ label: t("marketplace.properties.category"), value: t(CATEGORY_LABELS[props.agent.category]) }]
      : []),
    { label: t("marketplace.properties.version"), value: format.number(props.agent.version) },
    {
      label: t("marketplace.properties.updated"),
      value: format.date(new Date(props.agent.updatedAt), { dateStyle: "medium" }),
    },
  ];
  return (
    <SettingsSection title={t("plugin.section.information")}>
      <ItemGroup class="settings-modal-card">
        <div class="integration-card-body">
          <Text as="p" variant="body-sm">
            {props.agent.description}
          </Text>
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

function TrustLine(props: { model: MarketplaceModel; agent: MarketplaceAgentSummary | MarketplaceAgentDetail }) {
  const { t } = useText();
  const trust = (): Exclude<Trust, "verified"> | undefined => {
    const current = trustOf(props.agent);
    return current === "verified" ? undefined : current;
  };
  const text = (current: Exclude<Trust, "verified">) => {
    const keys = TRUST_TEXT[current];
    return t(props.model.agentState(props.agent) === "add" ? keys.add : keys.added);
  };
  return (
    <Show when={trust()} keyed>
      {(current) => (
        <Text as="p" variant="caption" tone="muted" class="marketplace-agent-trust">
          <Show when={current === "pending"} fallback={<UsersRound aria-hidden="true" />}>
            <Clock3 aria-hidden="true" />
          </Show>
          {text(current)}
        </Text>
      )}
    </Show>
  );
}

export function MarketplaceAgentPage(props: {
  scope: MarketplaceScope;
  listing: MarketplaceAgentSummary;
  detail?: MarketplaceAgentDetail | undefined;
}) {
  const { t } = useText();
  const model = () => props.scope.model;
  const status = useAgentStatus(model);
  const detail = createDetail(() =>
    props.detail ? Promise.resolve(props.detail) : model().loadAgent(props.listing.id),
  );
  const agent = () => detail.value() ?? props.listing;
  const current = () => status(props.listing);
  const subtitle = () => [agent().title, t("marketplace.agents.by", { name: agent().creatorName })].join(" · ");
  const add = () => void model().addAgent(agent(), model().agentState(props.listing) === "update");

  return (
    <div class="marketplace-view">
      <IntegrationPage
        class="marketplace-skill-page"
        logo={
          <span class="marketplace-avatar" data-size="md">
            <AgentAvatar agent={agent()} motion="hover" />
          </span>
        }
        name={agent().name}
        nameMark={<VerifiedMark on={agent().verified === true} />}
        status={current().status}
        statusLabel={current().label}
        subtitle={subtitle()}
        actions={
          <>
            <CopyListingLink model={model()} link={{ kind: "agent", id: props.listing.id }} />
            <AgentPageActions model={model()} listing={props.listing} add={add} />
          </>
        }
        alert={<TrustLine model={model()} agent={agent()} />}
        details={<AgentInformation agent={agent()} />}
      >
        <DetailState
          status={detail.status()}
          reference={detail.reference()}
          loadingLabel={t("marketplace.agents.loadingDetail")}
          onRetry={detail.retry}
        >
          <Show when={(detail.value()?.skills.length ?? 0) > 0}>
            <SettingsSection title={t("marketplace.agents.skills")}>
              <ItemGroup class="settings-modal-card">
                <For each={detail.value()?.skills ?? []} keyed={(skill) => skill.skillId}>
                  {(skill) => <AgentSkillRow scope={props.scope} skill={skill()} />}
                </For>
              </ItemGroup>
            </SettingsSection>
          </Show>
          <Show when={(detail.value()?.routines.length ?? 0) > 0}>
            <SettingsSection title={t("marketplace.agents.routines")}>
              <ItemGroup class="settings-modal-card">
                <For each={detail.value()?.routines ?? []}>{(routine) => <AgentRoutineRow routine={routine} />}</For>
              </ItemGroup>
            </SettingsSection>
          </Show>
        </DetailState>
      </IntegrationPage>
    </div>
  );
}
