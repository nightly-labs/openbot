import type { TeamRole } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";

export const SERVER_ROLE_KEYS = {
  owner: "mobile.server.role.owner",
  admin: "mobile.server.role.admin",
  member: "mobile.server.role.member",
} as const satisfies Record<TeamRole, MobileTextKey>;

export const SERVER_ROLE_LABEL_KEYS = {
  owner: "mobile.server.role.ownerLabel",
  admin: "mobile.server.role.adminLabel",
  member: "mobile.server.role.memberLabel",
} as const satisfies Record<TeamRole, MobileTextKey>;
