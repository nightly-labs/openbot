import type { MarketplaceAgentSummary } from "@openbot/contracts/ipc";
import { Button, CalendarClock, Plus, Text } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { routineScheduleSummary } from "@openbot/ui/features/conversation/routine-schedule-ui";
import { useText } from "@openbot/ui/text";
import { For, Show } from "solid-js";
import { LogoTile } from "../settings/IntegrationLayout";
import { useInstalls } from "./MarketplaceCards";
import { Block, DetailState, PageHead, Properties, SkillMark } from "./MarketplaceParts";
import { CATEGORY_LABELS } from "./marketplace-listing";
import { createDetail, type MarketplaceScope } from "./marketplace-view";

/**
 * "Add agent", then "Open chat". An agent with a newer version offers "Update" beside "Open chat".
 * The first button keeps its element when the add ends, so the focus stays on it.
 */
function AgentActions(props: { scope: MarketplaceScope; listing: MarketplaceAgentSummary; add: () => void }) {
  const { t } = useText();
  const model = () => props.scope.model;
  const state = () => model().agentState(props.listing);
  const busy = () => model().agentBusy(props.listing.id);
  return (
    <Show when={state()}>
      {(current) => (
        <div class="marketplace-head-actions">
          <Button
            type="button"
            variant={current() === "update" ? "outline" : "default"}
            loading={current() === "add" && busy()}
            onClick={() => (current() === "add" ? props.add() : model().openChat(props.listing.id))}
          >
            <Show when={current() === "add"} fallback={t("marketplace.agent.openChat")}>
              <Plus aria-hidden="true" />
              {t("marketplace.agent.addAgent")}
            </Show>
          </Button>
          <Show when={current() === "update"}>
            <Button type="button" loading={busy()} onClick={props.add}>
              {t("marketplace.agent.update")}
            </Button>
          </Show>
        </div>
      )}
    </Show>
  );
}

export function MarketplaceAgentPage(props: { scope: MarketplaceScope; listing: MarketplaceAgentSummary }) {
  const { t, format } = useText();
  const installs = useInstalls();
  const model = () => props.scope.model;
  const detail = createDetail(() => model().loadAgent(props.listing.id));
  const add = () =>
    void model().addAgent(detail.value() ?? props.listing, model().agentState(props.listing) === "update");

  return (
    <div class="marketplace-view">
      <PageHead
        media={
          <span class="marketplace-avatar" data-size="lg">
            <AgentAvatar agent={props.listing} motion="hover" />
          </span>
        }
        title={props.listing.name}
        description={props.listing.description}
        actions={<AgentActions scope={props.scope} listing={props.listing} add={add} />}
      />
      <div class="marketplace-page">
        <div class="marketplace-stack">
          <DetailState
            status={detail.status()}
            loadingLabel={t("marketplace.agents.loadingDetail")}
            onRetry={detail.retry}
          >
            <Show when={(detail.value()?.skills.length ?? 0) > 0}>
              <Block id="marketplace-agent-skills" level="h4" title={t("marketplace.agents.skills")}>
                <ul class="marketplace-rows">
                  <For each={detail.value()?.skills ?? []}>
                    {(skill) => (
                      <li class="marketplace-row">
                        <SkillMark skill={{ iconUrl: null }} size="row" />
                        <span class="marketplace-row-copy">
                          <Text as="span" variant="label">
                            {skill.name}
                          </Text>
                          <Text as="span" variant="caption" tone="muted">
                            {t("marketplace.version", { version: skill.version })}
                          </Text>
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </Block>
            </Show>
            <Show when={(detail.value()?.routines.length ?? 0) > 0}>
              <Block id="marketplace-agent-routines" level="h4" title={t("marketplace.agents.routines")}>
                <ul class="marketplace-rows">
                  <For each={detail.value()?.routines ?? []}>
                    {(routine) => (
                      <li class="marketplace-row">
                        <LogoTile>
                          <CalendarClock aria-hidden="true" />
                        </LogoTile>
                        <span class="marketplace-row-copy">
                          <Text as="span" variant="label">
                            {routine.name}
                          </Text>
                          <Text as="span" variant="caption" tone="muted">
                            {[
                              routineScheduleSummary(routine.schedule),
                              t(
                                routine.active
                                  ? "marketplace.agents.routineActive"
                                  : "marketplace.agents.routineInactive",
                              ),
                            ].join(" · ")}
                          </Text>
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </Block>
            </Show>
          </DetailState>
        </div>
        <Properties
          label={t("marketplace.properties.agent")}
          items={[
            { label: t("marketplace.properties.creator"), value: props.listing.creatorName },
            ...(props.listing.category
              ? [{ label: t("marketplace.properties.category"), value: t(CATEGORY_LABELS[props.listing.category]) }]
              : []),
            { label: t("marketplace.properties.version"), value: format.number(props.listing.version) },
            {
              label: t("marketplace.properties.updated"),
              value: format.date(new Date(props.listing.updatedAt), { dateStyle: "medium" }),
            },
            { label: t("marketplace.properties.installs"), value: installs(props.listing.installs) },
          ]}
        />
      </div>
    </div>
  );
}
