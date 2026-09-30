import {
  Button,
  ChevronRight,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  SettingsSection,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { type IntegrationStatus, LogoTile, StatusPill } from "./IntegrationLayout";

export type IntegrationAgent = Pick<AgentProfile, "id" | "name" | "avatarSeed" | "avatarHue" | "avatarUrl">;

export interface IntegrationsHubRow {
  id: string;
  name: string;
  logo: JSX.Element;
  status: IntegrationStatus;
  statusLabel: string;
  summary: string;
  /** The agents that use the integration, when it belongs to some agents and not to all. */
  agents?: IntegrationAgent[] | undefined;
  onOpen: () => void;
}

const FACES = 4;

/**
 * Server settings > Connectors: one quiet row per integration. The whole row opens its page. A row
 * that is set up sorts into the first section with its status; the others wait below with Set up.
 */
export function IntegrationsHub(props: { rows: IntegrationsHubRow[] }) {
  const { t } = useText();
  const active = () => props.rows.filter((row) => row.status !== "idle");
  const idle = () => props.rows.filter((row) => row.status === "idle");
  return (
    <div class="integrations-hub">
      <Show when={active().length > 0}>
        <SettingsSection title={t("connector.hub.onThisComputer")}>
          <ItemGroup class="settings-modal-card">
            <For each={active()}>{(row) => <HubRow row={row} />}</For>
          </ItemGroup>
        </SettingsSection>
      </Show>
      <Show when={idle().length > 0}>
        <SettingsSection title={active().length > 0 ? t("connector.hub.notSetUp") : t("connector.hub.available")}>
          <ItemGroup class="settings-modal-card">
            <For each={idle()}>{(row) => <HubRow row={row} />}</For>
          </ItemGroup>
        </SettingsSection>
      </Show>
    </div>
  );
}

function HubRow(props: { row: IntegrationsHubRow }) {
  const { t } = useText();
  return (
    <Item class="settings-modal-row integrations-hub-row" data-status={props.row.status}>
      <Button
        type="button"
        variant="ghost"
        class="integrations-hub-hitarea"
        aria-label={t("connector.hub.open", { name: props.row.name })}
        onClick={() => props.row.onOpen()}
      />
      <ItemMedia>
        <LogoTile>{props.row.logo}</LogoTile>
      </ItemMedia>
      <ItemContent>
        <ItemTitle class="integrations-hub-title">
          {props.row.name}
          <Show when={props.row.status !== "idle"}>
            <StatusPill status={props.row.status} label={props.row.statusLabel} />
          </Show>
        </ItemTitle>
        <ItemDescription class="integrations-hub-summary" data-status={props.row.status}>
          {props.row.summary}
        </ItemDescription>
      </ItemContent>
      <ItemActions class="integrations-hub-actions">
        <Show when={props.row.agents?.length ? props.row.agents : undefined}>
          {(agents) => <FaceStack agents={agents()} />}
        </Show>
        <Show
          when={props.row.status === "idle"}
          fallback={<ChevronRight class="integrations-hub-chevron" aria-hidden="true" />}
        >
          <Button type="button" size="sm" onClick={() => props.row.onOpen()}>
            {t("connector.hub.setUp")}
          </Button>
        </Show>
      </ItemActions>
    </Item>
  );
}

function FaceStack(props: { agents: IntegrationAgent[] }) {
  const { t } = useText();
  const extra = () => props.agents.length - FACES;
  return (
    <span
      class="integrations-face-stack"
      role="img"
      aria-label={t("connector.hub.usedBy", { names: props.agents.map((agent) => agent.name).join(", ") })}
    >
      <For each={props.agents.slice(0, FACES)}>
        {(agent) => (
          <span class="integrations-agent-face" data-size="sm">
            <AgentAvatar agent={agent} motion="idle" />
          </span>
        )}
      </For>
      <Show when={extra() > 0}>
        <span class="integrations-face-more" aria-hidden="true">{`+${extra()}`}</span>
      </Show>
    </span>
  );
}
