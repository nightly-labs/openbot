import { isDynamicRecord, isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const SERVER_AUDIT_CAPABILITY = "server-audit-v1";

export const SERVER_AUDIT_ROUTES = {
  read: "/v1/admin/host/audit",
} as const;

const name = fields({ id: identifier, name: string(200) });
const memberRole = oneOf("admin", "member");
const level = oneOf("none", "view", "chat", "manage");
const kind = (value: string): AdminDecoder => oneOf(value);

const KNOWN_CHANGES = new Map<string, AdminDecoder>([
  ["member-joined", fields({ kind: kind("member-joined"), member: name, role: memberRole })],
  ["member-removed", fields({ kind: kind("member-removed"), member: name })],
  ["member-role", fields({ kind: kind("member-role"), member: name, from: memberRole, to: memberRole })],
  ["role-created", fields({ kind: kind("role-created"), role: name })],
  ["role-renamed", fields({ kind: kind("role-renamed"), roleId: identifier, from: string(200), to: string(200) })],
  ["role-deleted", fields({ kind: kind("role-deleted"), role: name })],
  ["role-member", fields({ kind: kind("role-member"), role: name, member: name, added: boolean })],
  ["agent-level", fields({ kind: kind("agent-level"), role: nullable(name), agent: name, from: level, to: level })],
]);

const change: AdminDecoder = (value) => {
  if (!isDynamicRecord(value) || !isString(value.kind) || !value.kind.length || value.kind.length > 64)
    throw new Error("Invalid admin variant.");
  const decode = KNOWN_CHANGES.get(value.kind);
  return decode ? decode(value) : { kind: value.kind };
};

const entry = fields({ id: identifier, at: string(40), actor: nullable(name), change });

export const SERVER_AUDIT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [SERVER_AUDIT_ROUTES.read, adminRoute(empty, fields({ entries: list(entry, 500) }))],
]);
