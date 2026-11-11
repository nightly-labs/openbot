import {
  MCP_ACCESS_LEVELS,
  type McpAccessChange,
  type McpAccessLevel,
  type McpServerAccess,
  mcpAccessRank,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  Dialog,
  IconButton,
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  ShieldCheck,
  UsersRound,
  X,
} from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import { createSignal, createStore, For, Show } from "solid-js";
import { AgentSearchList } from "./MarketplaceAgentsDialog";
import type { MarketplaceAgent, MarketplaceMcpAccess } from "./marketplace-model";

/** One MCP row of an app: the row of an account, or the one row of an app or a custom server. */
export interface AppAccessRow {
  /** The id of the MCP row. */
  id: string;
  name: string;
}

// One array for the life of the page: a new array on each read makes the select start again.
const LEVELS: McpAccessLevel[] = [...MCP_ACCESS_LEVELS];

const LEVEL_LABELS = {
  none: "server.agentAccess.level.none",
  use: "marketplace.app.access.use",
  manage: "server.agentAccess.level.manage",
} as const satisfies Record<McpAccessLevel, AppTextKey>;

const allows = (access: McpServerAccess, agentId: string) => access.agents === null || access.agents.includes(agentId);

const higher = (left: McpAccessLevel, right: McpAccessLevel) =>
  mcpAccessRank(right) > mcpAccessRank(left) ? right : left;

/** Chooses the agents of one MCP row, with a search. The change waits for Save. */
function AccessAgentsDialog(props: {
  access: MarketplaceMcpAccess;
  agents: readonly MarketplaceAgent[];
  row: AppAccessRow;
  onClose: () => void;
}) {
  const { t } = useText();
  /* Only the user's choices. An agent with no choice keeps what the host holds. */
  const [draft, setDraft] = createStore<{ on: Record<string, boolean> }>({ on: {} });
  const entry = () => props.access.entry(props.row.id);
  const checked = (agentId: string) => draft.on[agentId] ?? allows(entry(), agentId);
  const unchanged = () => props.agents.every((agent) => checked(agent.id) === allows(entry(), agent.id));
  const save = () => {
    const shown = new Set(props.agents.map((agent) => agent.id));
    const on = props.agents.filter((agent) => checked(agent.id)).map((agent) => agent.id);
    // An agent that this list does not show keeps its place. All agents: also each agent added later.
    const kept = (entry().agents ?? []).filter((agentId) => !shown.has(agentId));
    const agents = on.length === props.agents.length ? null : [...kept, ...on];
    void props.access.set([{ mcpServerId: props.row.id, access: { ...entry(), agents } }]);
    props.onClose();
  };
  let content: HTMLElement | undefined;
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="integration-dialog-backdrop" data-nested="" />
        <Dialog.Content
          class="integration-wizard integration-wizard-dialog marketplace-skill-agents-dialog"
          data-nested=""
          as="section"
          ref={(element) => {
            content = element;
          }}
          // The dialog opens on the agent search, not on Close.
          onOpenAutoFocus={(event) => {
            const search = content?.querySelector<HTMLElement>("input[type=search]");
            if (!search) return;
            event.preventDefault();
            search.focus({ preventScroll: true });
          }}
        >
          <header class="marketplace-skill-dialog-head">
            <Dialog.Title as="h2" class="ui-heading" data-size="md" data-tone="primary">
              {props.row.name}
            </Dialog.Title>
            <IconButton label={t("common.close")} variant="ghost" data-cuelume-tap="close" onClick={props.onClose}>
              <X />
            </IconButton>
          </header>
          <form
            class="integration-wizard-form"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div class="integration-wizard-body">
              <AgentSearchList
                agents={props.agents}
                label={t("marketplace.app.access.agentsOf", { name: props.row.name })}
                checked={checked}
                set={(chosen, on) =>
                  setDraft((state) => {
                    for (const agent of chosen) state.on[agent.id] = on;
                  })
                }
                blocked={() => false}
                note={() => undefined}
              />
            </div>
            <div class="integration-wizard-foot">
              <Button type="button" variant="ghost" onClick={props.onClose}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" class="marketplace-skill-dialog-submit" disabled={unchanged()}>
                {t("common.save")}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The agents of one MCP row: the first three faces and a count. The button opens the agents dialog. */
function AccessAgentsButton(props: {
  access: MarketplaceMcpAccess;
  agents: readonly MarketplaceAgent[];
  row: AppAccessRow;
}) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  const have = () => props.agents.filter((agent) => allows(props.access.entry(props.row.id), agent.id));
  const summary = () => {
    if (props.access.entry(props.row.id).agents === null || have().length === props.agents.length)
      return t("marketplace.agents.all");
    if (have().length === 0) return t("marketplace.app.access.noAgents");
    return t("marketplace.skills.dialog.checked", { checked: have().length, total: props.agents.length });
  };
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        class="marketplace-skill-agents-trigger"
        aria-label={t("marketplace.app.access.chooseAgents", { name: props.row.name, summary: summary() })}
        disabled={props.access.busy()}
        onClick={() => setOpen(true)}
      >
        <span class="marketplace-skill-stack" aria-hidden="true">
          <For each={have().slice(0, 3)} keyed={(agent) => agent.id}>
            {(agent) => (
              <span class="marketplace-avatar" data-size="xs">
                <AgentAvatar agent={agent()} motion="idle" />
              </span>
            )}
          </For>
        </span>
        {summary()}
      </Button>
      <Show when={open()}>
        <AccessAgentsDialog
          access={props.access}
          agents={props.agents}
          row={props.row}
          onClose={() => setOpen(false)}
        />
      </Show>
    </>
  );
}

/** The level menu of one role. A role cannot go below the level that Everyone gives. */
function AccessLevelSelect(props: {
  label: string;
  level: McpAccessLevel;
  everyone?: McpAccessLevel | undefined;
  disabled: boolean;
  onChange: (level: McpAccessLevel) => void;
}) {
  const { t } = useText();
  const below = (option: McpAccessLevel) =>
    props.everyone !== undefined && mcpAccessRank(option) < mcpAccessRank(props.everyone);
  const fromEveryone = () =>
    props.everyone !== undefined && props.everyone !== "none" && props.level === props.everyone;
  return (
    <Select<McpAccessLevel>
      options={LEVELS}
      value={props.level}
      disabled={props.disabled}
      placement="bottom-end"
      optionDisabled={below}
      disallowEmptySelection={true}
      onChange={(option) => {
        // The select also reports the value it already has.
        if (option && option !== props.level) props.onChange(option);
      }}
      itemComponent={(item) => <SelectItem item={item.item}>{t(LEVEL_LABELS[item.item.rawValue])}</SelectItem>}
    >
      <SelectTrigger size="sm" class="server-roles-level server-roles-agent-level" aria-label={props.label}>
        <SelectValue<McpAccessLevel>>
          {() => (
            <>
              {t(LEVEL_LABELS[props.level])}
              <Show when={fromEveryone()}>
                <span class="server-roles-level-source">
                  {" · "}
                  {t("server.roles.everyone")}
                </span>
              </Show>
            </>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent class="server-roles-level-menu" />
    </Select>
  );
}

/**
 * Who gets a connected app: the agents of each MCP row, and the level of each role. A level change
 * goes to each row of the app. The rows can differ, for example after a new account, which starts
 * with the default: the page then shows the highest level that a row gives, so it does not show an
 * open row as closed.
 */
export function AppAccessSections(props: {
  access: MarketplaceMcpAccess;
  agents: readonly MarketplaceAgent[];
  rows: readonly AppAccessRow[];
  /** The name of the app in the label of a level menu. */
  name: string;
}) {
  const { t } = useText();
  const entries = () => props.rows.map((row) => props.access.entry(row.id));
  const everyone = (): McpAccessLevel =>
    entries()
      .map((access) => access.everyone)
      .reduce(higher, "none");
  const roleLevel = (roleId: string): McpAccessLevel =>
    entries()
      .map((access) => access.roles[roleId] ?? "none")
      .reduce(higher, everyone());
  const setLevels = (change: (access: McpServerAccess) => McpServerAccess) =>
    void props.access.set(
      props.rows.map((row): McpAccessChange => ({ mcpServerId: row.id, access: change(props.access.entry(row.id)) })),
    );
  const setEveryone = (level: McpAccessLevel) =>
    setLevels((access) => ({
      ...access,
      everyone: level,
      // A role keeps only a level above the new one of Everyone.
      roles: Object.fromEntries(
        Object.entries(access.roles).filter(([, own]) => mcpAccessRank(own) > mcpAccessRank(level)),
      ),
    }));
  const setRole = (roleId: string, level: McpAccessLevel) =>
    setLevels((access) => {
      const roles = Object.fromEntries(Object.entries(access.roles).filter(([id]) => id !== roleId));
      return { ...access, roles: level === access.everyone ? roles : { ...roles, [roleId]: level } };
    });
  return (
    <>
      <SettingsSection title={t("server.roles.agents")}>
        <ItemGroup class="settings-modal-card">
          <For each={props.rows} keyed={(row) => row.id}>
            {(row) => (
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("marketplace.app.access.agentsOf", { name: row().name })}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <AccessAgentsButton access={props.access} agents={props.agents} row={row()} />
                </ItemActions>
              </Item>
            )}
          </For>
        </ItemGroup>
      </SettingsSection>
      <SettingsSection title={t("server.members.roles")}>
        <ItemGroup class="settings-modal-card">
          <Item class="settings-modal-row">
            <ItemMedia class="server-roles-icon">
              <UsersRound aria-hidden="true" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t("server.roles.everyone")}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <AccessLevelSelect
                label={t("marketplace.app.access.level", { role: t("server.roles.everyone"), name: props.name })}
                level={everyone()}
                disabled={props.access.busy()}
                onChange={setEveryone}
              />
            </ItemActions>
          </Item>
          <For each={props.access.roles()} keyed={(role) => role.id}>
            {(role) => (
              <Item class="settings-modal-row">
                <ItemMedia class="server-roles-icon">
                  <ShieldCheck aria-hidden="true" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{role().name}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <AccessLevelSelect
                    label={t("marketplace.app.access.level", { role: role().name, name: props.name })}
                    level={roleLevel(role().id)}
                    everyone={everyone()}
                    disabled={props.access.busy()}
                    onChange={(level) => setRole(role().id, level)}
                  />
                </ItemActions>
              </Item>
            )}
          </For>
        </ItemGroup>
      </SettingsSection>
    </>
  );
}
