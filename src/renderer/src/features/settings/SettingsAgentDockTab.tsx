import type { AgentDockDisplay, AgentDockDisplayInfo, AgentDockEdge } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  Switch,
  SwitchField,
} from "@openbot/ui";
import type { ComposerAgent } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, createUniqueId, For, onSettled, Show } from "solid-js";
import { useI18n } from "../../i18n-context";
import { agentDockPort } from "../agent-dock/agent-dock-port";
import {
  type AgentDockPlacement,
  agentDockSeats,
  setAgentDockPreference,
  setAgentDockSeats,
  useAgentDockPreference,
} from "../agent-dock/agent-dock-preference";

/** What the tab shows of the active server. The dock of each server has its own agents. */
export interface AgentDockSettingsModel {
  server: { id: string; name: string } | null;
  agents: readonly ComposerAgent[];
  hiddenAgentIds: ReadonlySet<string>;
}

const PLACEMENT_LABEL = {
  screen: "settings.agentDock.placement.screen",
  window: "settings.agentDock.placement.window",
} as const satisfies Record<AgentDockPlacement, AppTextKey>;

const EDGE_LABEL = {
  right: "settings.agentDock.edge.right",
  left: "settings.agentDock.edge.left",
} as const satisfies Record<AgentDockEdge, AppTextKey>;

export function SettingsAgentDockTab(props: { model: AgentDockSettingsModel; selectMount?: HTMLElement | undefined }) {
  const i18n = useI18n();
  const preference = useAgentDockPreference();
  /** The display, the edge and hiding apply to the dock above the other apps. */
  const aboveApps = () => preference().shown && preference().placement === "screen";
  const seats = createMemo(() => {
    const server = props.model.server;
    return server
      ? agentDockSeats(server.id, () => props.model.agents.map((agent) => agent.id), props.model.hiddenAgentIds)
      : [];
  });

  function setOnDock(serverId: string, agentId: string, onDock: boolean): void {
    const current = seats();
    setAgentDockSeats(serverId, onDock ? [...current, agentId] : current.filter((id) => id !== agentId));
  }

  return (
    <>
      <SettingsSection title={i18n.t("settings.agentDock.title")}>
        <ItemGroup class="settings-modal-card">
          <SwitchField
            data-settings-row="settings.agentDock.show.title"
            checked={preference().shown}
            onChange={(shown) => setAgentDockPreference({ shown })}
            label={i18n.t("settings.agentDock.show.title")}
            description={i18n.t("settings.agentDock.show.description")}
          />
          <Item data-settings-row="settings.agentDock.placement.title" class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{i18n.t("settings.agentDock.placement.title")}</ItemTitle>
              <ItemDescription>{i18n.t("settings.agentDock.placement.description")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <ChoiceSelect
                value={preference().placement}
                text={(placement) => i18n.t(PLACEMENT_LABEL[placement])}
                choices={["screen", "window"]}
                label={i18n.t("settings.agentDock.placement.title")}
                disabled={!preference().shown}
                mount={props.selectMount}
                onChange={(placement) => setAgentDockPreference({ placement })}
              />
            </ItemActions>
          </Item>
          <Item data-settings-row="settings.agentDock.display.title" class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{i18n.t("settings.agentDock.display.title")}</ItemTitle>
              <ItemDescription>{i18n.t("settings.agentDock.display.description")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <DisplaySelect
                value={preference().display}
                disabled={!aboveApps()}
                mount={props.selectMount}
                onChange={(display) => setAgentDockPreference({ display })}
              />
            </ItemActions>
          </Item>
          <Item data-settings-row="settings.agentDock.edge.title" class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{i18n.t("settings.agentDock.edge.title")}</ItemTitle>
              <ItemDescription>{i18n.t("settings.agentDock.edge.description")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <ChoiceSelect
                value={preference().edge}
                text={(edge) => i18n.t(EDGE_LABEL[edge])}
                choices={["right", "left"]}
                label={i18n.t("settings.agentDock.edge.title")}
                disabled={!aboveApps()}
                mount={props.selectMount}
                onChange={(edge) => setAgentDockPreference({ edge })}
              />
            </ItemActions>
          </Item>
          <SwitchField
            data-settings-row="settings.agentDock.autoHide.title"
            checked={preference().autoHide}
            disabled={!aboveApps()}
            onChange={(autoHide) => setAgentDockPreference({ autoHide })}
            label={i18n.t("settings.agentDock.autoHide.title")}
            description={i18n.t("settings.agentDock.autoHide.description")}
          />
          <SwitchField
            data-settings-row="settings.agentDock.results.title"
            checked={preference().results}
            disabled={!preference().shown}
            onChange={(results) => setAgentDockPreference({ results })}
            label={i18n.t("settings.agentDock.results.title")}
            description={i18n.t("settings.agentDock.results.description")}
          />
        </ItemGroup>
      </SettingsSection>

      <Show when={props.model.server}>
        {(server) => (
          <SettingsSection
            data-settings-row="settings.agentDock.agents.title"
            title={i18n.t("settings.agentDock.agents.title")}
            description={i18n.t("settings.agentDock.agents.description", { server: server().name })}
          >
            <ItemGroup class="settings-modal-card">
              <For
                each={props.model.agents}
                fallback={
                  <Item>
                    <ItemContent>
                      <ItemDescription>{i18n.t("settings.agentDock.agents.empty")}</ItemDescription>
                    </ItemContent>
                  </Item>
                }
              >
                {(agent) => (
                  <DockAgentRow
                    agent={agent}
                    onDock={seats().includes(agent.id)}
                    disabled={!preference().shown}
                    onChange={(onDock) => setOnDock(server().id, agent.id, onDock)}
                  />
                )}
              </For>
            </ItemGroup>
          </SettingsSection>
        )}
      </Show>
    </>
  );
}

function DockAgentRow(props: {
  agent: ComposerAgent;
  onDock: boolean;
  disabled: boolean;
  onChange: (onDock: boolean) => void;
}): JSX.Element {
  const titleId = createUniqueId();
  return (
    <Item>
      <ItemMedia class="settings-agent-dock-avatar" aria-hidden="true">
        <AgentAvatar agent={props.agent} motion="idle" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle id={titleId}>{props.agent.name}</ItemTitle>
        <Show when={props.agent.title}>{(title) => <ItemDescription>{title()}</ItemDescription>}</Show>
      </ItemContent>
      <ItemActions>
        <Switch checked={props.onDock} disabled={props.disabled} onChange={props.onChange} aria-labelledby={titleId} />
      </ItemActions>
    </Item>
  );
}

/** A select of a few fixed choices. */
function ChoiceSelect<T extends string>(props: {
  value: T;
  choices: readonly T[];
  text: (value: T) => string;
  label: string;
  disabled: boolean;
  mount: HTMLElement | undefined;
  onChange: (value: T) => void;
}): JSX.Element {
  const options = createMemo(() => props.choices.map((id) => ({ id })));
  const label = (id: T) => props.text(id);
  return (
    <Select<{ id: T }>
      class="settings-modal-select"
      options={options()}
      optionValue="id"
      optionTextValue={(option) => label(option.id)}
      value={options().find((option) => option.id === props.value) ?? null}
      disabled={props.disabled}
      onChange={(option) => option && props.onChange(option.id)}
      placement="bottom-end"
      itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{label(itemProps.item.rawValue.id)}</SelectItem>}
    >
      <SelectTrigger size="sm" aria-label={props.label}>
        <SelectValue<{ id: T }>>{(state) => label(state.selectedOption().id)}</SelectValue>
      </SelectTrigger>
      <SelectContent mount={props.mount} />
    </Select>
  );
}

function displayKey(display: AgentDockDisplay): string {
  return display.kind === "display" ? `display:${display.id}` : display.kind;
}

function keyDisplay(key: string): AgentDockDisplay {
  if (key === "window" || key === "primary" || key === "all") return { kind: key };
  return { kind: "display", id: Number(key.slice("display:".length)) };
}

function sameKeys(before: string[], after: string[]): boolean {
  return before.length === after.length && before.every((key, index) => key === after[index]);
}

/**
 * The display of the dock above the other apps. The list is read again each time it opens, so a display
 * connected after the tab opened is there. A saved display that is not connected stays as a choice.
 */
function DisplaySelect(props: {
  value: AgentDockDisplay;
  disabled: boolean;
  mount: HTMLElement | undefined;
  onChange: (display: AgentDockDisplay) => void;
}): JSX.Element {
  const i18n = useI18n();
  const [displays, setDisplays] = createSignal<AgentDockDisplayInfo[]>([]);
  let active = true;
  const load = () =>
    void agentDockPort()
      .agentDock.listDisplays()
      .then((list) => {
        if (active) setDisplays(list);
      })
      .catch(() => undefined);
  onSettled(() => {
    load();
    return () => {
      active = false;
    };
  });

  // A new array makes Kobalte choose again, so the list changes only when its keys change.
  const options = createMemo(
    (): string[] => {
      const listed = displays().map((display) => `display:${display.id}`);
      const saved = displayKey(props.value);
      const extra = props.value.kind === "display" && !listed.includes(saved) ? [saved] : [];
      return ["window", "primary", "all", ...listed, ...extra];
    },
    { equals: sameKeys },
  );

  const label = (key: string): string => {
    if (key === "window") return i18n.t("settings.agentDock.display.window");
    if (key === "primary") return i18n.t("settings.agentDock.display.primary");
    if (key === "all") return i18n.t("settings.agentDock.display.all");
    const index = displays().findIndex((display) => `display:${display.id}` === key);
    if (index < 0) return i18n.t("settings.agentDock.display.disconnected");
    return displays()[index]?.label || i18n.t("settings.agentDock.display.unnamed", { number: index + 1 });
  };

  return (
    <Select<string>
      class="settings-modal-select"
      options={options()}
      value={displayKey(props.value)}
      disabled={props.disabled}
      onOpenChange={(open) => {
        if (open) load();
      }}
      onChange={(key) => {
        if (key && key !== displayKey(props.value)) props.onChange(keyDisplay(key));
      }}
      placement="bottom-end"
      sameWidth={false}
      itemComponent={(item) => <SelectItem item={item.item}>{label(item.item.rawValue)}</SelectItem>}
    >
      <SelectTrigger size="sm" aria-label={i18n.t("settings.agentDock.display.title")}>
        <SelectValue<string>>{(state) => label(state.selectedOption() ?? "window")}</SelectValue>
      </SelectTrigger>
      <SelectContent mount={props.mount} />
    </Select>
  );
}
