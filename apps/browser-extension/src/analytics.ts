import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { normalizeEmailAddress } from "@openbot/contracts/validation";
import { analyticsOnByDefault, currentAnalyticsInstallId, newAnalyticsInstallId } from "@openbot/telemetry";
import { ASK_CHOICES, ASK_KINDS, type AskChoice, type AskKind } from "./client-browser-messages";
import { type ExtensionSession, readSession } from "./extension-storage";

export const EXTENSION_ANALYTICS_GENERATION = 1;
const ANALYTICS_URL = import.meta.env.VITE_OPENBOT_ANALYTICS_URL;
const OPENPANEL_CLIENT_ID = "6c989975-87ef-4f0c-857e-ab449a65b5c2";
const CHOICE_KEY = "openbot.analytics.v1";
const INSTALL_ID_KEY = "openbot.analytics-install.v1";
const VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/u;

type Result = "succeeded" | "failed";
type ResultOrCancelled = Result | "cancelled";
export type SignInMethod = "web" | "email";
export type SignInFailureCode = (typeof SIGN_IN_FAILURE_CODES)[number];
export type XReplyAction = (typeof X_REPLY_ACTIONS)[number];

const RESULTS = ["succeeded", "failed"] as const;
const RESULTS_OR_CANCELLED = ["succeeded", "failed", "cancelled"] as const;
export const SIGN_IN_FAILURE_CODES = [
  "invalid_sign_in_code",
  "invalid_company_sign_in_code",
  "company_sign_in_required",
  "auth_api_unavailable",
  "unknown",
] as const;
const X_REPLY_ACTIONS = ["queued", "sent", "retry", "dropped", "notification_opened"] as const;

interface ExtensionEvents {
  extension_installed: { reason: "install" | "update"; from_version?: string };
  extension_opened: { signed_in: boolean };
  account_sign_in_completed: { method: SignInMethod; result: ResultOrCancelled; failure_code?: SignInFailureCode };
  account_sign_out: { reason: "user" | "session_ended" };
  message_send: { target: "chat" | "thread" | "new_thread" | "channel"; result: Result };
  voice_transcription: { result: Result; audio_duration_seconds: number; empty?: boolean };
  agent_action: { action: "create"; result: Result };
  channel_action: { action: "created"; result: Result };
  folder_action: { action: "created"; result: Result };
  agent_input_action: { kind: "prompt"; decision: "answered"; result: Result };
  x_reply_action: { action: XReplyAction; attempts?: number; reached?: boolean };
  browser_sharing_action: { action: "site_removed" };
  browser_sharing_ask: { kind: AskKind; choice: AskChoice | "timeout" };
  analytics_preference_changed: { enabled: false };
}

type EventName = keyof ExtensionEvents;
type Rule = readonly string[] | "boolean" | "count" | "version";
type Rules = { [Name in EventName]: { [Key in keyof Required<ExtensionEvents[Name]>]: Rule } };

const EVENT_RULES: Rules = {
  extension_installed: { reason: ["install", "update"], from_version: "version" },
  extension_opened: { signed_in: "boolean" },
  account_sign_in_completed: {
    method: ["web", "email"],
    result: RESULTS_OR_CANCELLED,
    failure_code: SIGN_IN_FAILURE_CODES,
  },
  account_sign_out: { reason: ["user", "session_ended"] },
  message_send: { target: ["chat", "thread", "new_thread", "channel"], result: RESULTS },
  voice_transcription: { result: RESULTS, audio_duration_seconds: "count", empty: "boolean" },
  agent_action: { action: ["create"], result: RESULTS },
  channel_action: { action: ["created"], result: RESULTS },
  folder_action: { action: ["created"], result: RESULTS },
  agent_input_action: { kind: ["prompt"], decision: ["answered"], result: RESULTS },
  x_reply_action: { action: X_REPLY_ACTIONS, attempts: "count", reached: "boolean" },
  browser_sharing_action: { action: ["site_removed"] },
  browser_sharing_ask: { kind: ASK_KINDS, choice: [...ASK_CHOICES, "timeout"] },
  analytics_preference_changed: { enabled: "boolean" },
};

function safeValue(rule: Rule, value: unknown): string | number | boolean | undefined {
  if (rule === "boolean") return isBoolean(value) ? value : undefined;
  if (rule === "count")
    return isNumber(value) && Number.isSafeInteger(value) && value >= 0 && value <= 10_000 ? value : undefined;
  if (rule === "version") return isString(value) && VERSION_PATTERN.test(value) ? value : undefined;
  return isOneOf(rule, value) ? value : undefined;
}

function safeProperties<Name extends EventName>(name: Name, properties: ExtensionEvents[Name]) {
  const rules: Record<string, Rule> = EVENT_RULES[name];
  return Object.fromEntries(
    Object.entries(properties).flatMap(([key, value]) => {
      const rule = rules[key];
      const safe = rule ? safeValue(rule, value) : undefined;
      return safe === undefined ? [] : [[key, safe]];
    }),
  );
}

function regionDefault(): boolean {
  try {
    const region = new Intl.Locale(navigator.language).region;
    return region !== undefined && analyticsOnByDefault(region, Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return false;
  }
}

export async function analyticsLinked(session: ExtensionSession | null): Promise<boolean> {
  const choice = (await chrome.storage.local.get(CHOICE_KEY))[CHOICE_KEY];
  if (isDynamicRecord(choice) && isBoolean(choice.enabled)) return choice.enabled;
  return session?.user.analyticsEnabled ?? regionDefault();
}

async function installId(): Promise<string> {
  const now = Date.now();
  const saved = currentAnalyticsInstallId((await chrome.storage.local.get(INSTALL_ID_KEY))[INSTALL_ID_KEY], now);
  if (saved) return saved.id;
  const created = newAnalyticsInstallId(crypto.randomUUID(), now);
  await chrome.storage.local.set({ [INSTALL_ID_KEY]: { id: created.id, createdAt: created.createdAt } });
  return created.id;
}

type OpenPanelBody =
  | {
      type: "track";
      payload: {
        name: EventName;
        profileId: string;
        properties: ReturnType<typeof safeProperties> & ReturnType<typeof globalProperties>;
      };
    }
  | { type: "identify"; payload: { profileId: string; email: string } };

async function post(body: OpenPanelBody): Promise<void> {
  const response = await fetch(`${ANALYTICS_URL}/track`, {
    method: "POST",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    keepalive: true,
    headers: { "content-type": "application/json", "openpanel-client-id": OPENPANEL_CLIENT_ID },
    body: JSON.stringify(body),
  });
  await response.body?.cancel();
}

function globalProperties() {
  return {
    surface: "extension",
    environment: "production",
    event_schema_version: EXTENSION_ANALYTICS_GENERATION,
    app_version: chrome.runtime.getManifest().version,
    platform: "chrome",
    __referrer: "",
    __path: "",
  };
}

async function profileFor(session: ExtensionSession | null): Promise<string> {
  return session && (await analyticsLinked(session)) ? session.user.id : installId();
}

function send<Name extends EventName>(name: Name, properties: ExtensionEvents[Name], profileId: string): void {
  void post({
    type: "track",
    payload: { name, profileId, properties: { ...safeProperties(name, properties), ...globalProperties() } },
  }).catch(() => undefined);
}

export async function track<Name extends EventName>(name: Name, properties: ExtensionEvents[Name]): Promise<void> {
  if (!ANALYTICS_URL) return;
  try {
    send(name, properties, await profileFor(await readSession()));
  } catch {}
}

export function withResult<T>(work: Promise<T>, record: (result: Result) => unknown): Promise<T> {
  return work.then(
    (value) => {
      void record("succeeded");
      return value;
    },
    (error: unknown) => {
      void record("failed");
      throw error;
    },
  );
}

export async function identify(session: ExtensionSession): Promise<void> {
  if (!ANALYTICS_URL) return;
  try {
    const email = normalizeEmailAddress(session.user.email);
    if (!email || !(await analyticsLinked(session))) return;
    await post({ type: "identify", payload: { profileId: session.user.id, email } });
  } catch {}
}

export async function setAnalyticsLinked(enabled: boolean): Promise<void> {
  const session = await readSession();
  if (!enabled && ANALYTICS_URL && session && (await analyticsLinked(session)))
    send("analytics_preference_changed", { enabled: false }, session.user.id);
  await chrome.storage.local.set({ [CHOICE_KEY]: { enabled, at: Date.now() } });
  if (enabled && session) await identify(session);
}
