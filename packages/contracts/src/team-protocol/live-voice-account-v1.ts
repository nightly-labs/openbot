import { isProviderAccountId } from "../ipc-agent-status";
import { isDynamicRecord } from "../runtime-values";
import { adminRoute, empty, fields, nullable, type OptionalRouteCodec } from "./admin-wire";
import { PROVIDER_ACCOUNT_ID } from "./provider-accounts-v1";

export const LIVE_VOICE_ACCOUNT_CAPABILITY = "live-voice-account-v1";

export const LIVE_VOICE_ACCOUNT_ROUTES = {
  settings: "/v1/admin/providers/accounts/live-voice",
  update: "/v1/admin/providers/accounts/live-voice/update",
} as const;

const choice = fields({ accountId: nullable(PROVIDER_ACCOUNT_ID) });

export const LIVE_VOICE_ACCOUNT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [LIVE_VOICE_ACCOUNT_ROUTES.settings, adminRoute(empty, choice)],
  [LIVE_VOICE_ACCOUNT_ROUTES.update, adminRoute(choice, empty)],
]);

export function decodeLiveVoiceAccount(value: unknown): string | null {
  if (!isDynamicRecord(value) || (value.accountId !== null && !isProviderAccountId(value.accountId)))
    throw new Error("Invalid live voice account.");
  return value.accountId;
}
