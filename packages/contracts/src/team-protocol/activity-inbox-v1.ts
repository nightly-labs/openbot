import type { ActivityInboxFollowupReceipt, ActivityInboxItem, ActivityInboxSnapshot } from "../ipc-activity-inbox";
import { isActivityInboxFollowupReceipt, isActivityInboxItem, isActivityInboxSnapshot } from "../ipc-activity-inbox";
import {
  type AdminDecoder,
  adminRoute,
  empty,
  fields,
  identifier,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const ACTIVITY_INBOX_CAPABILITY = "activity-inbox-v1";
export const ACTIVITY_INBOX_ROUTES = {
  list: "/v1/activity-inbox/list",
  classify: "/v1/activity-inbox/classify",
  followup: "/v1/activity-inbox/follow-up",
} as const;

const snapshot: AdminDecoder = (value) => {
  if (!isActivityInboxSnapshot(value)) throw new Error("Invalid activity inbox snapshot.");
  const encoded = JSON.stringify(value);
  if (!encoded) throw new Error("Invalid activity inbox snapshot.");
  return JSON.parse(encoded);
};

const inboxItem: AdminDecoder = (value) => {
  if (!isActivityInboxItem(value)) throw new Error("Invalid activity inbox item.");
  return JSON.parse(JSON.stringify(value));
};

const followupReceipt: AdminDecoder = (value) => {
  if (!isActivityInboxFollowupReceipt(value)) throw new Error("Invalid activity inbox follow-up receipt.");
  return JSON.parse(JSON.stringify(value));
};

export const ACTIVITY_INBOX_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [ACTIVITY_INBOX_ROUTES.list, adminRoute(empty, snapshot)],
  [
    ACTIVITY_INBOX_ROUTES.classify,
    adminRoute(fields({ itemId: identifier, classification: oneOf("reference", "actionable") }), inboxItem),
  ],
  [
    ACTIVITY_INBOX_ROUTES.followup,
    adminRoute(
      fields({ itemId: identifier, actionId: identifier, clientMessageId: identifier, text: string(32_000) }),
      followupReceipt,
    ),
  ],
]);

export function decodeActivityInboxResponse(value: unknown): ActivityInboxSnapshot {
  if (!isActivityInboxSnapshot(value)) throw new Error("Invalid activity inbox snapshot.");
  return value;
}

export function decodeActivityInboxItemResponse(value: unknown): ActivityInboxItem {
  if (!isActivityInboxItem(value)) throw new Error("Invalid activity inbox item.");
  return value;
}

export function decodeActivityInboxFollowupResponse(value: unknown): ActivityInboxFollowupReceipt {
  if (!isActivityInboxFollowupReceipt(value)) throw new Error("Invalid activity inbox follow-up receipt.");
  return value;
}
