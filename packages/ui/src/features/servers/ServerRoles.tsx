import {
  AGENT_ACCESS_LEVELS,
  AGENT_ACCESS_ROLE_NAME_LIMIT,
  type AgentAccessLevel,
  type AgentAccessLevels,
  type AgentAccessRole,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  buttonVariants,
  Check,
  ChevronDown,
  ChevronRight,
  ConfirmDialog,
  DropdownMenu,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Plus,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  ShieldCheck,
  Text,
  UsersRound,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";

/** An agent as the role pages show it. */
export type RoleAgent = Pick<AgentProfile, "id" | "name" | "avatarSeed" | "avatarHue" | "avatarUrl">;

/** The page that the Roles section shows: the list, Everyone, or one role. */
export type ServerRolePage = { kind: "list" } | { kind: "everyone" } | { kind: "role"; roleId: string };

const LEVEL_LABELS = {
  none: "server.agentAccess.level.none",
  view: "server.agentAccess.level.view",
  chat: "server.agentAccess.level.chat",
  manage: "server.agentAccess.level.manage",
} as const satisfies Record<AgentAccessLevel, AppTextKey>;

/** Everyone gives `manage` for an agent that it does not list; another role gives `none`. */
export function everyoneLevel(everyone: AgentAccessLevels, agentId: string): AgentAccessLevel {
  return everyone[agentId] ?? "manage";
}

export function roleLevel(role: AgentAccessRole, agentId: string): AgentAccessLevel {
  return role.agents[agentId] ?? "none";
}

const FACES = 4;

function AgentFaces(props: { agents: RoleAgent[] }) {
  const { t } = useText();
  return (
    <Show when={props.agents.length > 0}>
      <span
        class="integrations-face-stack"
        role="img"
        aria-label={t("server.roles.agentList", { names: props.agents.map((agent) => agent.name).join(", ") })}
      >
        <For each={props.agents.slice(0, FACES)}>
          {(agent) => (
            <span class="integrations-agent-face" data-size="sm">
              <AgentAvatar agent={agent} motion="idle" />
            </span>
          )}
        </For>
        <Show when={props.agents.length > FACES}>
          <span class="integrations-face-more" aria-hidden="true">{`+${props.agents.length - FACES}`}</span>
        </Show>
      </span>
    </Show>
  );
}

/** A row that opens a role page. The whole row is the button, as on the Connectors page. */
function RoleRow(props: { name: string; icon: JSX.Element; agents: RoleAgent[]; members: string; onOpen: () => void }) {
  const { t } = useText();
  return (
    <Item class="settings-modal-row integrations-hub-row">
      <Button
        type="button"
        variant="ghost"
        class="integrations-hub-hitarea"
        aria-label={t("server.roles.open", { name: props.name })}
        onClick={props.onOpen}
      />
      <ItemMedia class="server-roles-icon">{props.icon}</ItemMedia>
      <ItemContent>
        <ItemTitle>{props.name}</ItemTitle>
      </ItemContent>
      <ItemActions class="integrations-hub-actions">
        <AgentFaces agents={props.agents} />
        <Text variant="label-sm" tone="muted" class="server-roles-member-count">
          {props.members}
        </Text>
        <ChevronRight class="integrations-hub-chevron" aria-hidden="true" />
      </ItemActions>
    </Item>
  );
}

/** One agent with the level that the open role gives it. */
function AgentAccessRow(props: {
  agent: RoleAgent;
  label: string;
  level: AgentAccessLevel;
  disabled: boolean;
  menuMount: HTMLElement | undefined;
  onChange: (level: AgentAccessLevel) => void;
}) {
  const { t } = useText();
  return (
    <Item class="settings-modal-row">
      <ItemMedia>
        <span class="integrations-agent-face" data-size="md">
          <AgentAvatar agent={props.agent} motion="idle" />
        </span>
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{props.agent.name}</ItemTitle>
      </ItemContent>
      <ItemActions>
        <Select<AgentAccessLevel>
          options={[...AGENT_ACCESS_LEVELS]}
          value={props.level}
          disabled={props.disabled}
          placement="bottom-end"
          onChange={(level) => {
            if (level && level !== props.level) props.onChange(level);
          }}
          itemComponent={(item) => <SelectItem item={item.item}>{t(LEVEL_LABELS[item.item.rawValue])}</SelectItem>}
        >
          <SelectTrigger size="sm" class="server-roles-level" aria-label={props.label}>
            <SelectValue<AgentAccessLevel>>{(state) => t(LEVEL_LABELS[state.selectedOption()])}</SelectValue>
          </SelectTrigger>
          <SelectContent mount={props.menuMount} />
        </Select>
      </ItemActions>
    </Item>
  );
}

/**
 * The menu that gives one level to every agent of the open role. Its mark shows the level when all
 * agents have the same one.
 */
function SetAllLevelsMenu(props: {
  title: string;
  levels: AgentAccessLevel[];
  disabled: boolean;
  mount: HTMLElement | undefined;
  onChange: (level: AgentAccessLevel) => void;
}) {
  const { t } = useText();
  const common = () => {
    const [first] = props.levels;
    return first !== undefined && props.levels.every((level) => level === first) ? first : undefined;
  };
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false}>
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "sm" })} server-roles-member-trigger`}
        disabled={props.disabled}
        aria-label={t("server.roles.setAllLabel", { role: props.title })}
      >
        <span class="server-roles-member-summary">{t("server.roles.setAll")}</span>
        <ChevronDown aria-hidden="true" />
      </DropdownMenu.Trigger>
      {/* A portal without a mount uses the document body. */}
      <DropdownMenu.Portal mount={props.mount ?? document.body}>
        <DropdownMenu.Content>
          {/* With mixed levels no item is checked, so each choice is a change. */}
          <DropdownMenu.RadioGroup
            aria-label={t("server.roles.setAllLabel", { role: props.title })}
            value={common() ?? ""}
            onChange={(value: string) => {
              const level = AGENT_ACCESS_LEVELS.find((item) => item === value);
              if (level) props.onChange(level);
            }}
          >
            <For each={[...AGENT_ACCESS_LEVELS]}>
              {(level) => (
                <DropdownMenu.RadioItem value={level}>
                  <MenuMark on={common() === level} />
                  {t(LEVEL_LABELS[level])}
                </DropdownMenu.RadioItem>
              )}
            </For>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The name field of a role. It saves on Enter or when it loses focus, not on each key. */
function RoleNameField(props: { name: string; disabled: boolean; onRename: (name: string) => void }) {
  const { t } = useText();
  // A saved name, or a rename by another admin, replaces the draft.
  const [draft, setDraft] = createSignal(() => props.name);
  function commit() {
    const name = draft().trim();
    if (!name) setDraft(props.name);
    else if (name !== props.name) props.onRename(name);
  }
  return (
    <Input
      aria-label={t("server.roles.name")}
      value={draft()}
      maxlength={AGENT_ACCESS_ROLE_NAME_LIMIT}
      disabled={props.disabled}
      onValueChange={setDraft}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

export interface ServerRolesPanelProps {
  agents: RoleAgent[];
  everyone: AgentAccessLevels;
  roles: AgentAccessRole[];
  page: ServerRolePage;
  disabled: boolean;
  menuMount: HTMLElement | undefined;
  onPage: (page: ServerRolePage) => void;
  onCreate: () => void;
  onRename: (roleId: string, name: string) => void;
  onDelete: (roleId: string) => void;
  /** Gives `level` to each agent of `agentIds`, in one save. */
  onSetEveryoneLevel: (agentIds: readonly string[], level: AgentAccessLevel) => void;
  onSetRoleLevel: (roleId: string, agentIds: readonly string[], level: AgentAccessLevel) => void;
}

/**
 * Server Settings > Roles, as Discord has them. Every member gets the agents of Everyone; each other
 * role adds agents for the members that have it. The caller saves each change.
 */
export function ServerRolesPanel(props: ServerRolesPanelProps) {
  const { t } = useText();
  const [deleteId, setDeleteId] = createSignal<string | null>(null);
  const openRole = () => {
    const page = props.page;
    return page.kind === "role" ? props.roles.find((role) => role.id === page.roleId) : undefined;
  };
  const deleting = () => props.roles.find((role) => role.id === deleteId());

  const agentList = (
    title: string,
    level: (agentId: string) => AgentAccessLevel,
    onChange: (agentIds: readonly string[], level: AgentAccessLevel) => void,
  ) => (
    <SettingsSection
      title={t("server.roles.agents")}
      actions={
        props.agents.length > 1 ? (
          <SetAllLevelsMenu
            title={title}
            levels={props.agents.map((agent) => level(agent.id))}
            disabled={props.disabled}
            mount={props.menuMount}
            onChange={(next) => {
              const changed = props.agents.filter((agent) => level(agent.id) !== next).map((agent) => agent.id);
              if (changed.length > 0) onChange(changed, next);
            }}
          />
        ) : undefined
      }
    >
      <ItemGroup class="settings-modal-card">
        <For
          each={props.agents}
          fallback={
            <Item class="server-settings-empty-row">
              <ItemContent>
                <Text variant="caption" tone="muted">
                  {t("server.roles.noAgents")}
                </Text>
              </ItemContent>
            </Item>
          }
        >
          {(agent) => (
            <AgentAccessRow
              agent={agent}
              label={t("server.roles.agentLevel", { role: title, agent: agent.name })}
              level={level(agent.id)}
              disabled={props.disabled}
              menuMount={props.menuMount}
              onChange={(next) => onChange([agent.id], next)}
            />
          )}
        </For>
      </ItemGroup>
    </SettingsSection>
  );

  const list = () => (
    <>
      <ItemGroup class="settings-modal-card">
        <RoleRow
          name={t("server.roles.everyone")}
          icon={<UsersRound aria-hidden="true" />}
          agents={props.agents.filter((agent) => everyoneLevel(props.everyone, agent.id) !== "none")}
          members={t("server.roles.allMembers")}
          onOpen={() => props.onPage({ kind: "everyone" })}
        />
      </ItemGroup>
      <SettingsSection
        title={t("server.roles.title", { count: props.roles.length })}
        actions={
          <Button
            type="button"
            size="sm"
            class="server-roles-create"
            disabled={props.disabled}
            onClick={props.onCreate}
          >
            <Plus aria-hidden="true" />
            {t("server.roles.create")}
          </Button>
        }
      >
        <Show when={props.roles.length > 0}>
          <ItemGroup class="settings-modal-card">
            <For each={props.roles}>
              {(role) => (
                <RoleRow
                  name={role.name}
                  icon={<ShieldCheck aria-hidden="true" />}
                  agents={props.agents.filter((agent) => roleLevel(role, agent.id) !== "none")}
                  members={t("server.roles.memberCount", { count: role.memberIds.length })}
                  onOpen={() => props.onPage({ kind: "role", roleId: role.id })}
                />
              )}
            </For>
          </ItemGroup>
        </Show>
      </SettingsSection>
    </>
  );

  return (
    <>
      <Show
        when={openRole()}
        fallback={
          <Show when={props.page.kind === "everyone"} fallback={list()}>
            {agentList(
              t("server.roles.everyone"),
              (agentId) => everyoneLevel(props.everyone, agentId),
              props.onSetEveryoneLevel,
            )}
          </Show>
        }
      >
        {(role) => (
          <>
            <div class="server-roles-name-row">
              <RoleNameField
                name={role().name}
                disabled={props.disabled}
                onRename={(name) => props.onRename(role().id, name)}
              />
              <Button
                type="button"
                variant="destructive-ghost"
                size="sm"
                disabled={props.disabled}
                onClick={() => setDeleteId(role().id)}
              >
                {t("server.roles.delete")}
              </Button>
            </div>
            {agentList(
              role().name,
              (agentId) => roleLevel(role(), agentId),
              (agentIds, level) => props.onSetRoleLevel(role().id, agentIds, level),
            )}
          </>
        )}
      </Show>
      <Show when={deleting()}>
        {(role) => (
          <ConfirmDialog
            open
            initialFocus="cancel"
            title={t("server.roles.deleteTitle", { name: role().name })}
            description={t("server.roles.deleteDescription")}
            confirmLabel={t("server.roles.delete")}
            onCancel={() => setDeleteId(null)}
            onConfirm={() => {
              setDeleteId(null);
              props.onDelete(role().id);
            }}
          />
        )}
      </Show>
    </>
  );
}

/** The check mark of the marketplace menus, for a checkbox or radio item. */
function MenuMark(props: { on: boolean }) {
  return (
    <span class="ui-menu-check" data-checked={props.on ? "" : undefined}>
      <Show when={props.on}>
        <Check aria-hidden="true" />
      </Show>
    </span>
  );
}

const SERVER_ROLE_LABELS = {
  admin: "server.role.admin",
  member: "server.role.member",
} as const satisfies Record<"admin" | "member", AppTextKey>;

export interface MemberRoleMenuProps {
  memberName: string;
  serverRole: "admin" | "member";
  /** The roles of the server, or nothing when its host has no roles. */
  roles: readonly Pick<AgentAccessRole, "id" | "name" | "memberIds">[] | undefined;
  memberId: string;
  disabled: boolean;
  mount: HTMLElement | undefined;
  /** The caller confirms the change; `trigger` gets the focus back. */
  onServerRole: (role: "admin" | "member", trigger: HTMLElement) => void;
  onToggleRole: (roleId: string, on: boolean) => void;
}

/**
 * The role menu at the end of a member row: the server role, then the roles. Its button names the
 * roles of the member. Roles apply only to a member, so an admin sees the server role only.
 */
export function MemberRoleMenu(props: MemberRoleMenuProps) {
  const { t } = useText();
  let triggerElement: HTMLElement | undefined;
  const summary = () => {
    if (props.serverRole !== "member") return t(SERVER_ROLE_LABELS[props.serverRole]);
    const names = (props.roles ?? [])
      .filter((role) => role.memberIds.includes(props.memberId))
      .map((role) => role.name);
    return names.length > 0 ? names.join(" · ") : t(SERVER_ROLE_LABELS.member);
  };
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false}>
      <DropdownMenu.Trigger
        ref={(element) => (triggerElement = element)}
        class={`${buttonVariants({ variant: "ghost", size: "sm" })} server-roles-member-trigger`}
        disabled={props.disabled}
        aria-label={t("server.members.rolesOf", { name: props.memberName, roles: summary() })}
      >
        <span class="server-roles-member-summary">{summary()}</span>
        <ChevronDown aria-hidden="true" />
      </DropdownMenu.Trigger>
      {/* A portal without a mount uses the document body. */}
      <DropdownMenu.Portal mount={props.mount ?? document.body}>
        <DropdownMenu.Content>
          <span class="ui-menu-label" aria-hidden="true">
            {t("server.members.serverRole")}
          </span>
          <DropdownMenu.RadioGroup
            aria-label={t("server.members.serverRole")}
            value={props.serverRole}
            onChange={(value: string) => {
              const role = value === "admin" ? "admin" : "member";
              if (role !== props.serverRole && triggerElement) props.onServerRole(role, triggerElement);
            }}
          >
            <For each={["member", "admin"] as const}>
              {(role) => (
                <DropdownMenu.RadioItem value={role}>
                  <MenuMark on={props.serverRole === role} />
                  {t(SERVER_ROLE_LABELS[role])}
                </DropdownMenu.RadioItem>
              )}
            </For>
          </DropdownMenu.RadioGroup>
          <Show when={props.serverRole === "member" && props.roles && props.roles.length > 0 ? props.roles : null}>
            {(roles) => (
              <>
                <DropdownMenu.Separator />
                <span class="ui-menu-label" aria-hidden="true">
                  {t("server.members.roles")}
                </span>
                <For each={roles()}>
                  {(role) => (
                    <DropdownMenu.CheckboxItem
                      checked={role.memberIds.includes(props.memberId)}
                      closeOnSelect={false}
                      onChange={(on: boolean) => props.onToggleRole(role.id, on)}
                    >
                      <MenuMark on={role.memberIds.includes(props.memberId)} />
                      {role.name}
                    </DropdownMenu.CheckboxItem>
                  )}
                </For>
              </>
            )}
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
