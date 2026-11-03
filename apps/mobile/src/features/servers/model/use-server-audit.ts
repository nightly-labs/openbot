import type { AgentAccessLevel, ServerAuditChange, ServerAuditEntry, ServerAuditName } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useQuery } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { SERVER_ROLE_LABEL_KEYS } from "@/features/servers/model/server-role";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileText } from "@/shared/lib/text";

export const AUDIT_FILTERS = ["all", "members", "roles", "agents"] as const;
export type AuditFilter = (typeof AUDIT_FILTERS)[number];

export const AUDIT_FILTER_KEYS = {
  all: "mobile.server.audit.filterAll",
  members: "mobile.server.audit.filterMembers",
  roles: "mobile.server.audit.filterRoles",
  agents: "mobile.server.audit.filterAgents",
} as const satisfies Record<AuditFilter, MobileTextKey>;

const LEVEL_KEYS = {
  none: "mobile.server.roles.level.none",
  view: "mobile.server.roles.level.view",
  chat: "mobile.server.roles.level.chat",
  manage: "mobile.server.roles.level.manage",
} as const satisfies Record<AgentAccessLevel, MobileTextKey>;

export function auditCategory(change: ServerAuditChange): Exclude<AuditFilter, "all"> {
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

type Piece =
  | { kind: "text"; text: string }
  | { kind: "key"; text: string; level?: AgentAccessLevel }
  | { kind: "to"; text: string };

/**
 * One piece of a change line: the words between keywords, a keyword, or the word between two values.
 * `id` is its place in the line, which does not change, so a row can key its pieces by it.
 */
export type AuditPart = Piece & { id: number };

type Key = Extract<Piece, { kind: "key" }>;

// Marks a placeholder in a translated line, so the line can be split around its keywords.
const MARK = "\u0000";

/** The line of a change in the interface language, as the desktop audit log writes it. */
export function auditLine(entry: ServerAuditEntry, t: MobileText["t"]): AuditPart[] {
  const values: Piece[][] = [];
  const show = (...parts: Piece[]) => `${MARK}${values.push(parts) - 1}${MARK}`;
  const key = (text: string, level?: AgentAccessLevel): Key =>
    level ? { kind: "key", text, level } : { kind: "key", text };
  const name = (value: ServerAuditName) => key(value.name);
  const step = (from: Key, to: Key) => show(from, { kind: "to", text: t("mobile.server.audit.to") }, to);
  const memberRole = (role: "admin" | "member") => key(t(SERVER_ROLE_LABEL_KEYS[role]));
  const level = (value: AgentAccessLevel) => key(t(LEVEL_KEYS[value]), value);
  const change = entry.change;
  const line = (() => {
    switch (change.kind) {
      case "member-joined":
        return t("mobile.server.audit.memberJoined", {
          member: show(name(change.member)),
          role: show(memberRole(change.role)),
        });
      case "member-removed":
        // A member who removed themself left.
        return entry.actor?.id === change.member.id
          ? t("mobile.server.audit.memberLeft", { member: show(name(change.member)) })
          : t("mobile.server.audit.memberRemoved", { member: show(name(change.member)) });
      case "member-role":
        return t("mobile.server.audit.memberRole", {
          member: show(name(change.member)),
          change: step(memberRole(change.from), memberRole(change.to)),
        });
      case "role-created":
        return t("mobile.server.audit.roleCreated", { role: show(name(change.role)) });
      case "role-renamed":
        return t("mobile.server.audit.roleRenamed", { change: step(key(change.from), key(change.to)) });
      case "role-deleted":
        return t("mobile.server.audit.roleDeleted", { role: show(name(change.role)) });
      case "role-member": {
        const parts = { member: show(name(change.member)), role: show(name(change.role)) };
        return change.added
          ? t("mobile.server.audit.roleMemberAdded", parts)
          : t("mobile.server.audit.roleMemberRemoved", parts);
      }
      case "agent-level":
        return t("mobile.server.audit.agentLevel", {
          agent: show(name(change.agent)),
          role: show(change.role ? name(change.role) : key(t("mobile.server.roles.everyone"))),
          change: step(level(change.from), level(change.to)),
        });
    }
  })();
  return line
    .split(MARK)
    .flatMap((piece, index): Piece[] => {
      if (index % 2 === 0) return piece ? [{ kind: "text", text: piece }] : [];
      return values[Number(piece)] ?? [];
    })
    .map((piece, id) => ({ ...piece, id }));
}

/** The line as plain text, for the search. */
export function auditLineText(parts: readonly AuditPart[]): string {
  return parts.map((part) => (part.kind === "to" ? ` ${part.text} ` : part.text)).join("");
}

/** Who made the change. A join from an invitation has no other actor. */
export function auditActor(entry: ServerAuditEntry, t: MobileText["t"]): string {
  return entry.actor?.name ?? (entry.change.kind === "member-joined" ? "" : t("mobile.server.audit.unknownActor"));
}

/**
 * The audit log of one server (`server-audit-v1`), for its owners and admins. It is read again each
 * time the page opens, so the changes made since then appear.
 */
export function useServerAudit(serverId: string) {
  const available = useMobileWorkspaceSelector((workspace) => workspace.canReadServerAudit(serverId));
  const { loadServerAuditLog } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const log = useQuery({
    queryKey: queryKeys.serverAudit(queryScope, serverId),
    enabled: available,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    queryFn: () => loadServerAuditLog(serverId),
  });
  return { available, log };
}
