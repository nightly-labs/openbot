import type { MobileTextKey } from "@openbot/i18n/mobile";

type ServerRole = "owner" | "admin" | "member";

/** The role word inside a sentence, such as "Your role: owner". */
export const SERVER_ROLE_KEYS = {
  owner: "mobile.server.role.owner",
  admin: "mobile.server.role.admin",
  member: "mobile.server.role.member",
} as const satisfies Record<ServerRole, MobileTextKey>;

/** The role as a label on its own, such as a picker item. */
export const SERVER_ROLE_LABEL_KEYS = {
  owner: "mobile.server.role.ownerLabel",
  admin: "mobile.server.role.adminLabel",
  member: "mobile.server.role.memberLabel",
} as const satisfies Record<ServerRole, MobileTextKey>;
