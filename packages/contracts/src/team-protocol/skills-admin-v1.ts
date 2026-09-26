// Frozen optional skills-admin-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can list the skills of one agent on the host, install a marketplace skill for it, remove
// one, and turn one on or off. Only ids cross the wire: the host downloads the skill from the
// marketplace with its own account, so a client never sends skill files. A member cannot use any
// route; `requireAdmin` on the host is the only gate. Widening any of it needs a second capability.
import {
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  identifier,
  list,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const SKILLS_ADMIN_CAPABILITY = "skills-admin-v1";

export const SKILLS_ADMIN_ROUTES = {
  list: "/v1/admin/skills/list",
  install: "/v1/admin/skills/install",
  uninstall: "/v1/admin/skills/uninstall",
  setEnabled: "/v1/admin/skills/set-enabled",
} as const;

const skillId = string(256);
const note = string(1024);
const installedSkill = fields(
  {
    skillId,
    slug: string(256),
    name: string(256),
    installedVersion: count,
    availableVersion: count,
    state: oneOf("installed", "update-available", "modified", "needs-repair"),
  },
  {
    enabled: boolean,
    origin: oneOf("marketplace", "managed", "local", "workspace"),
    description: note,
    location: note,
    problem: note,
  },
);

export const SKILLS_ADMIN_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [SKILLS_ADMIN_ROUTES.list, adminRoute(fields({ agentId: identifier }), list(installedSkill, 1_000))],
  [
    SKILLS_ADMIN_ROUTES.install,
    adminRoute(
      fields({ agentId: identifier, skillId }, { versionId: identifier, replaceModified: boolean }),
      installedSkill,
    ),
  ],
  [
    SKILLS_ADMIN_ROUTES.uninstall,
    adminRoute(fields({ agentId: identifier, skillId }, { removeModified: boolean }), empty),
  ],
  [
    SKILLS_ADMIN_ROUTES.setEnabled,
    adminRoute(fields({ agentId: identifier, skillId, enabled: boolean }), installedSkill),
  ],
]);
