import type {
  AgentAccessLevel,
  ServerAuditChange,
  ServerAuditEntry,
  ServerAuditMemberRole,
  ServerAuditName,
} from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import {
  ArrowRight,
  Crown,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  KeyRound,
  LogOut,
  Pencil,
  Search,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  ShieldCheck,
  Text,
  Trash2,
  UserRoundPlus,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import type { RoleAgent } from "./ServerRoles";

const LEVEL_LABELS = {
  none: "server.agentAccess.level.none",
  view: "server.agentAccess.level.view",
  chat: "server.agentAccess.level.chat",
  manage: "server.agentAccess.level.manage",
} as const satisfies Record<AgentAccessLevel, AppTextKey>;

const MEMBER_ROLE_LABELS = {
  admin: "server.role.admin",
  member: "server.role.member",
} as const satisfies Record<ServerAuditMemberRole, AppTextKey>;

const FILTERS = ["all", "members", "roles", "agents"] as const;
type AuditFilter = (typeof FILTERS)[number];

const FILTER_LABELS = {
  all: "server.audit.filterAll",
  members: "server.audit.filterMembers",
  roles: "server.audit.filterRoles",
  agents: "server.audit.filterAgents",
} as const satisfies Record<AuditFilter, AppTextKey>;

function category(change: ServerAuditChange): Exclude<AuditFilter, "all"> {
  switch (change.kind) {
    case "member-joined":
    case "member-removed":
    case "member-role":
      return "members";
    case "agent-level":
      return "agents";
    default:
      return "roles";
  }
}

/** One keyword of a change line. */
type Keyword =
  | { kind: "member"; name: string }
  | { kind: "role"; name: string }
  | { kind: "agent"; agent: ServerAuditName }
  | { kind: "level"; value: AgentAccessLevel }
  | { kind: "memberRole"; value: ServerAuditMemberRole };

/** A change from one keyword to the next, shown with an arrow. */
type Step = { kind: "step"; from: Keyword; to: Keyword };

type Value = Keyword | Step;

const member = (name: ServerAuditName): Extract<Keyword, { kind: "member" }> => ({ kind: "member", name: name.name });
const role = (name: string): Extract<Keyword, { kind: "role" }> => ({ kind: "role", name });

/**
 * The line of a change in the interface language. `show` gives the text of each placeholder value:
 * plain text for the search, or a marker that the row replaces with a styled keyword.
 */
function changeLine(entry: ServerAuditEntry, t: AppTranslate, show: (value: Value) => string): string {
  const change = entry.change;
  switch (change.kind) {
    case "member-joined":
      return t("server.audit.memberJoined", {
        member: show(member(change.member)),
        role: show({ kind: "memberRole", value: change.role }),
      });
    case "member-removed":
      // A member who removed themself left.
      return entry.actor?.id === change.member.id
        ? t("server.audit.memberLeft", { member: show(member(change.member)) })
        : t("server.audit.memberRemoved", { member: show(member(change.member)) });
    case "member-role":
      return t("server.audit.memberRole", {
        member: show(member(change.member)),
        change: show({
          kind: "step",
          from: { kind: "memberRole", value: change.from },
          to: { kind: "memberRole", value: change.to },
        }),
      });
    case "role-created":
      return t("server.audit.roleCreated", { role: show(role(change.role.name)) });
    case "role-renamed":
      return t("server.audit.roleRenamed", {
        change: show({ kind: "step", from: role(change.from), to: role(change.to) }),
      });
    case "role-deleted":
      return t("server.audit.roleDeleted", { role: show(role(change.role.name)) });
    case "role-member": {
      const values = { member: show(member(change.member)), role: show(role(change.role.name)) };
      return change.added ? t("server.audit.roleMemberAdded", values) : t("server.audit.roleMemberRemoved", values);
    }
    case "agent-level":
      return t("server.audit.agentLevel", {
        agent: show({ kind: "agent", agent: change.agent }),
        role: show(role(change.role?.name ?? t("server.roles.everyone"))),
        change: show({
          kind: "step",
          from: { kind: "level", value: change.from },
          to: { kind: "level", value: change.to },
        }),
      });
  }
}

type Tone = "success" | "danger" | "accent";

/** The icon and its color for one change: green adds, red takes away, blue changes. */
function changeMark(change: ServerAuditChange): { icon: () => JSX.Element; tone: Tone } {
  switch (change.kind) {
    case "member-joined":
    case "role-member":
      return change.kind === "role-member" && !change.added
        ? { icon: () => <LogOut />, tone: "danger" }
        : { icon: () => <UserRoundPlus />, tone: "success" };
    case "member-removed":
      return { icon: () => <LogOut />, tone: "danger" };
    case "member-role":
      return { icon: () => <Crown />, tone: change.to === "admin" ? "success" : "danger" };
    case "role-created":
      return { icon: () => <ShieldCheck />, tone: "success" };
    case "role-renamed":
      return { icon: () => <Pencil />, tone: "accent" };
    case "role-deleted":
      return { icon: () => <Trash2 />, tone: "danger" };
    case "agent-level":
      return { icon: () => <KeyRound />, tone: "accent" };
  }
}

/** The face of an agent. A deleted agent keeps a face made from its ID. */
function AgentFace(props: { agent: ServerAuditName; profile: RoleAgent | undefined }) {
  return (
    <span class="integrations-agent-face" aria-hidden="true">
      <AgentAvatar agent={props.profile} seed={props.profile ? undefined : props.agent.id} motion="idle" />
    </span>
  );
}

// Marks a placeholder in a translated line, so the line can be split around its keywords.
const MARK = "\u0000";

export interface ServerAuditLogPanelProps {
  /** The changes, newest first. */
  entries: ServerAuditEntry[];
  /** The agents of now, for their faces. */
  agents: RoleAgent[];
  /** Where the filter menu opens: inside the dialog, so the dialog keeps focus. */
  menuMount?: HTMLElement | undefined;
}

/** The changes to the access of a server, with a filter by kind and a search. */
export function ServerAuditLogPanel(props: ServerAuditLogPanelProps) {
  const { t, format } = useText();
  const [filter, setFilter] = createSignal<AuditFilter>("all");
  const [search, setSearch] = createSignal("");
  const profiles = createMemo(() => new Map(props.agents.map((agent) => [agent.id, agent] as const)));

  const keywordText = (keyword: Keyword): string => {
    switch (keyword.kind) {
      case "member":
      case "role":
        return keyword.name;
      case "agent":
        return keyword.agent.name;
      case "level":
        return t(LEVEL_LABELS[keyword.value]);
      case "memberRole":
        return t(MEMBER_ROLE_LABELS[keyword.value]);
    }
  };
  const valueText = (value: Value) =>
    value.kind === "step"
      ? `${keywordText(value.from)} ${t("server.audit.to")} ${keywordText(value.to)}`
      : keywordText(value);
  const plainLine = (entry: ServerAuditEntry) => changeLine(entry, t, valueText);
  const actor = (entry: ServerAuditEntry) =>
    entry.actor?.name ?? (entry.change.kind === "member-joined" ? "" : t("server.audit.unknownActor"));
  const time = (at: string) =>
    format.date(new Date(at), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const shown = createMemo(() => {
    const query = search().trim().toLocaleLowerCase();
    return props.entries.filter((entry) => {
      if (filter() !== "all" && category(entry.change) !== filter()) return false;
      if (!query) return true;
      return [plainLine(entry), actor(entry)].some((value) => value.toLocaleLowerCase().includes(query));
    });
  });

  const KeywordView = (keyword: Keyword) => {
    switch (keyword.kind) {
      case "level":
        return (
          <span class="server-audit-key" data-level={keyword.value}>
            {keywordText(keyword)}
          </span>
        );
      default:
        return <span class="server-audit-key">{keywordText(keyword)}</span>;
    }
  };
  const ValueView = (value: Value) =>
    value.kind === "step" ? (
      <>
        {KeywordView(value.from)}
        <span class="server-audit-arrow">
          <ArrowRight aria-hidden="true" />
          <span class="sr-only"> {t("server.audit.to")} </span>
        </span>
        {KeywordView(value.to)}
      </>
    ) : (
      KeywordView(value)
    );

  /** The translated line, split around its placeholders, with each keyword styled. */
  const LineView = (entry: ServerAuditEntry) => {
    const values: Value[] = [];
    const marked = changeLine(entry, t, (value) => `${MARK}${values.push(value) - 1}${MARK}`);
    return marked.split(MARK).map((piece, index) => {
      if (index % 2 === 0) return piece;
      const value = values[Number(piece)];
      return value ? ValueView(value) : "";
    });
  };

  const AuditRow = (rowProps: { entry: ServerAuditEntry }) => {
    const change = () => rowProps.entry.change;
    const mark = () => changeMark(change());
    const levelAgent = () => {
      const value = change();
      return value.kind === "agent-level" ? value.agent : undefined;
    };
    return (
      <Item class="settings-modal-row server-audit-row">
        <ItemMedia>
          <Show
            when={levelAgent()}
            fallback={
              <span class="server-audit-mark" data-tone={mark().tone} aria-hidden="true">
                {mark().icon()}
              </span>
            }
          >
            {(agent) => <AgentFace agent={agent()} profile={profiles().get(agent().id)} />}
          </Show>
        </ItemMedia>
        <ItemContent>
          <ItemTitle class="server-audit-title">{LineView(rowProps.entry)}</ItemTitle>
          <Show when={actor(rowProps.entry)}>{(name) => <ItemDescription>{name()}</ItemDescription>}</Show>
        </ItemContent>
        <ItemActions>
          <Text variant="label-sm" tone="muted" class="server-audit-time">
            <time datetime={rowProps.entry.at}>{time(rowProps.entry.at)}</time>
          </Text>
        </ItemActions>
      </Item>
    );
  };

  return (
    <SettingsSection
      title={t("server.audit.changes")}
      actions={
        <div class="server-audit-controls">
          <Select<AuditFilter>
            options={[...FILTERS]}
            value={filter()}
            placement="bottom-end"
            onChange={(value) => setFilter(value ?? "all")}
            itemComponent={(item) => <SelectItem item={item.item}>{t(FILTER_LABELS[item.item.rawValue])}</SelectItem>}
          >
            <SelectTrigger size="sm" aria-label={t("server.audit.filter")}>
              <SelectValue<AuditFilter>>{(state) => t(FILTER_LABELS[state.selectedOption()])}</SelectValue>
            </SelectTrigger>
            <SelectContent mount={props.menuMount} />
          </Select>
          <label class="server-settings-search">
            <Search aria-hidden="true" />
            <span class="sr-only">{t("server.audit.search")}</span>
            <Input
              size="sm"
              type="search"
              placeholder={t("common.search")}
              value={search()}
              onValueChange={setSearch}
            />
          </label>
        </div>
      }
    >
      <ItemGroup class="settings-modal-card">
        <For
          each={shown()}
          fallback={
            <Item class="server-settings-empty-row">
              <ItemContent>
                <ItemDescription>
                  {props.entries.length ? t("server.audit.noMatch") : t("server.audit.empty")}
                </ItemDescription>
              </ItemContent>
            </Item>
          }
        >
          {(entry) => <AuditRow entry={entry} />}
        </For>
      </ItemGroup>
    </SettingsSection>
  );
}
