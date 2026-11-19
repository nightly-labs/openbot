import { isDynamicRecord, isString } from "./runtime-values";

export type LinkAccountState = "disconnected" | "pending" | "connected" | "expired";

function isLinkAccountState(value: unknown): value is LinkAccountState {
  return value === "disconnected" || value === "pending" || value === "connected" || value === "expired";
}

export interface LinkAccountStatus {
  state: LinkAccountState;
  email: string | null;
  error: string | null;
}

export const DISCONNECTED_LINK_ACCOUNT: LinkAccountStatus = { state: "disconnected", email: null, error: null };

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

export function parseLinkAccountStatus(value: unknown): LinkAccountStatus | null {
  if (
    !isDynamicRecord(value) ||
    !isLinkAccountState(value.state) ||
    !isNullableString(value.email) ||
    !isNullableString(value.error)
  ) {
    return null;
  }
  return { state: value.state, email: value.email, error: value.error };
}
