import {
  agentProviderName,
  isManagedRuntimeProvider,
  type ManagedProviderId,
} from "@openbot/contracts/agent-providers";
import type { ProviderRuntimeSnapshot, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import { type DynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";
import { PROVIDERS_ADMIN_CAPABILITY, PROVIDERS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/providers-v1";
import {
  PROVIDERS_RUNTIMES_V2_CAPABILITY,
  PROVIDERS_RUNTIMES_V2_ROUTES,
} from "@openbot/contracts/team-protocol/providers-v2";
import {
  PROVIDERS_SIGN_IN_V3_CAPABILITY,
  PROVIDERS_SIGN_IN_V3_PROVIDERS,
  PROVIDERS_SIGN_IN_V3_ROUTES,
} from "@openbot/contracts/team-protocol/providers-v3";
import { sourceText } from "@openbot/i18n/source";
import { redactText, registerSecretValue } from "@openbot/logging";
import { normalizePastedCode } from "../../backend/agent/cli-code-login";
import { parseProviderId } from "../ipc/app-inputs";
import { parseDeleteCustomProvider, parseSaveCustomProvider } from "../ipc/custom-provider-inputs";
import { parseProviderApiKeyInput } from "../ipc/provider-handlers";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/** The bound `providers-v1` and `providers-v2` put on a runtime message. */
const RUNTIME_MESSAGE_LIMIT = 1024;

/**
 * The providers of this computer, managed from a joined server: sign-in with a device code, provider
 * API keys, the managed CLI runtimes and the custom endpoints. Frozen by `providers-v1`, by
 * `providers-v2` for the runtime routes that include Gemini, and by `providers-v3` for the Claude
 * and Grok sign-in on another device.
 *
 * `requireAdmin` runs on every route. A key or a header value only arrives here; no response
 * carries one, and no error message quotes the request.
 */
export async function routeProviders(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !isProvidersRoute(url.pathname)) return "unmatched";
  const providers = admin?.providers;
  const capability = V3_ROUTES.has(url.pathname)
    ? PROVIDERS_SIGN_IN_V3_CAPABILITY
    : V2_ROUTES.has(url.pathname)
      ? PROVIDERS_RUNTIMES_V2_CAPABILITY
      : PROVIDERS_ADMIN_CAPABILITY;
  if (!providers || !capabilities.has(capability))
    throw new HttpError(400, sourceText("error.team.providersUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  const { service, credentials, runtimes, customProviders } = providers;
  try {
    switch (url.pathname) {
      case PROVIDERS_ADMIN_ROUTES.codeLoginStart: {
        // `providers-v1` signs in Codex only; its response has no `paste` shape.
        const id = parsed(provider, body);
        if (id !== "codex")
          throw new Error(sourceText("error.provider.noCodeSignIn", { provider: agentProviderName(id) }));
        // The admin types the code in their own browser; nothing it is traded for comes back.
        return json(200, await service.startProviderCodeLogin(id));
      }
      case PROVIDERS_ADMIN_ROUTES.codeLoginCancel: {
        // A v1 client never started a Claude or Grok sign-in, so it cannot cancel one either.
        const id = parsed(provider, body);
        if (id === "codex") await service.cancelProviderCodeLogin(id);
        return json(200, {});
      }
      case PROVIDERS_SIGN_IN_V3_ROUTES.codeLoginStart:
        return json(200, await service.startProviderCodeLogin(parsed(signInProvider, body)));
      case PROVIDERS_SIGN_IN_V3_ROUTES.codeLoginSubmit: {
        // The code is a credential: it goes to the CLI's stdin, and no error quotes it.
        const input = parsed(codeSubmitInput, body);
        service.submitProviderCodeLogin(input.provider, input.code);
        return json(200, {});
      }
      case PROVIDERS_SIGN_IN_V3_ROUTES.codeLoginCancel:
        await service.cancelProviderCodeLogin(parsed(signInProvider, body));
        return json(200, {});
      case PROVIDERS_ADMIN_ROUTES.apiKeyState:
        return json(200, { status: credentials.status(parsed(provider, body)) });
      case PROVIDERS_ADMIN_ROUTES.apiKeySet: {
        const input = parsed(wireApiKeyInput, body);
        // The same step as the local handler: the key and the process that uses it change together.
        await service.changeProviderCredential(input.provider, () => credentials.set(input.provider, input.key));
        return json(200, {});
      }
      case PROVIDERS_ADMIN_ROUTES.apiKeyClear: {
        const id = parsed(provider, body);
        await service.changeProviderCredential(id, () => credentials.clear(id));
        return json(200, {});
      }
      case PROVIDERS_ADMIN_ROUTES.runtimesStatus:
        return json(200, wireSnapshot(runtimes.getStatus()));
      case PROVIDERS_ADMIN_ROUTES.runtimesDownload:
        return json(200, wireSnapshot(await runtimes.download(parsed(managedProvider, body))));
      case PROVIDERS_ADMIN_ROUTES.runtimesCancel:
        return json(200, wireSnapshot(await runtimes.cancel(parsed(managedProvider, body))));
      case PROVIDERS_ADMIN_ROUTES.runtimesCheck:
        return json(200, wireSnapshot(await runtimes.checkForUpdates()));
      case PROVIDERS_RUNTIMES_V2_ROUTES.runtimesStatus:
        return json(200, wireSnapshotV2(runtimes.getStatus()));
      case PROVIDERS_RUNTIMES_V2_ROUTES.runtimesDownload:
        return json(200, wireSnapshotV2(await runtimes.download(parsed(managedProviderV2, body))));
      case PROVIDERS_RUNTIMES_V2_ROUTES.runtimesCancel:
        return json(200, wireSnapshotV2(await runtimes.cancel(parsed(managedProviderV2, body))));
      case PROVIDERS_RUNTIMES_V2_ROUTES.runtimesCheck:
        return json(200, wireSnapshotV2(await runtimes.checkForUpdates()));
      case PROVIDERS_ADMIN_ROUTES.customList:
        return json(200, customProviders.list());
      case PROVIDERS_ADMIN_ROUTES.customSave:
        return json(200, await customProviders.save(parsed(parseSaveCustomProvider, body)));
      default:
        return json(200, await customProviders.remove(parsed(parseDeleteCustomProvider, body).id));
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // A busy provider or a failed download is a sentence for the admin, not a host fault. A provider
    // process can quote its key, so the message leaves this computer redacted.
    if (error instanceof Error) throw new HttpError(409, redactText(error.message));
    throw error;
  }
}

const V2_ROUTES = new Set<string>(Object.values(PROVIDERS_RUNTIMES_V2_ROUTES));
const V3_ROUTES = new Set<string>(Object.values(PROVIDERS_SIGN_IN_V3_ROUTES));
const ROUTES = new Set<string>([...Object.values(PROVIDERS_ADMIN_ROUTES), ...V2_ROUTES, ...V3_ROUTES]);

function isProvidersRoute(pathname: string): boolean {
  return ROUTES.has(pathname);
}

/**
 * The providers that `providers-v1` knows. Gemini (`antigravity`) stays on this computer, so a peer
 * that names it gets the same refusal as for a provider that does not exist.
 */
const WIRE_PROVIDERS = ["codex", "claude", "grok", "opencode"] as const satisfies readonly ManagedProviderId[];
type WireProviderId = (typeof WIRE_PROVIDERS)[number];

/** The `providers-v1` runtime snapshot. It has no entry for a local-only provider. */
interface WireProviderRuntimeSnapshot extends Omit<ProviderRuntimeSnapshot, "providers"> {
  providers: Record<WireProviderId, ProviderRuntimeStatus>;
}

function provider(body: DynamicRecord): WireProviderId {
  const id = parseProviderId(body.provider);
  if (!isOneOf(WIRE_PROVIDERS, id)) throw new Error("Unknown provider.");
  return id;
}

type SignInProviderId = (typeof PROVIDERS_SIGN_IN_V3_PROVIDERS)[number];

/** The providers `providers-v3` signs in. */
function signInProvider(body: DynamicRecord): SignInProviderId {
  const id = parseProviderId(body.provider);
  if (!isOneOf(PROVIDERS_SIGN_IN_V3_PROVIDERS, id)) throw new Error("Unknown provider.");
  return id;
}

/** The error never quotes the code. The CLI checks what the code is; this uses the local check. */
function codeSubmitInput(body: DynamicRecord): { provider: SignInProviderId; code: string } {
  if (typeof body.code !== "string") throw new Error("Invalid sign-in code.");
  const code = normalizePastedCode(body.code);
  // From here on, an error or a log line that quotes the code is masked, as for a provider key.
  registerSecretValue(code);
  return { provider: signInProvider(body), code };
}

function wireApiKeyInput(body: DynamicRecord) {
  const input = parseProviderApiKeyInput(body);
  if (!isOneOf(WIRE_PROVIDERS, input.provider)) throw new Error("Unknown provider.");
  return input;
}

function managedProvider(body: DynamicRecord): ManagedProviderId {
  const id = provider(body);
  if (!isManagedRuntimeProvider(id)) throw new Error(sourceText("error.team.providerNotManaged"));
  return id;
}

/** `providers-v2` knows every managed runtime, Gemini included. */
function managedProviderV2(body: DynamicRecord): ManagedProviderId {
  const id = parseProviderId(body.provider);
  if (!isManagedRuntimeProvider(id)) throw new Error(sourceText("error.team.providerNotManaged"));
  return id;
}

function parsed<T>(parse: (value: DynamicRecord) => T, body: DynamicRecord): T {
  try {
    return parse(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid provider request.");
  }
}

/** A long download error is cut to the wire bound, so the snapshot never fails closed on the client. */
function wireSnapshot(snapshot: ProviderRuntimeSnapshot): WireProviderRuntimeSnapshot {
  return {
    revision: snapshot.revision,
    providers: {
      codex: wireStatus(snapshot.providers.codex),
      claude: wireStatus(snapshot.providers.claude),
      grok: wireStatus(snapshot.providers.grok),
      opencode: wireStatus(snapshot.providers.opencode),
    },
    toolRuntimes: { bun: wireStatus(snapshot.toolRuntimes.bun) },
  };
}

/** The `providers-v2` runtime snapshot: every managed runtime. */
function wireSnapshotV2(snapshot: ProviderRuntimeSnapshot): ProviderRuntimeSnapshot {
  const wire = wireSnapshot(snapshot);
  return { ...wire, providers: { ...wire.providers, antigravity: wireStatus(snapshot.providers.antigravity) } };
}

function wireStatus(status: ProviderRuntimeStatus): ProviderRuntimeStatus {
  return { ...status, message: status.message?.slice(0, RUNTIME_MESSAGE_LIMIT) ?? null };
}
