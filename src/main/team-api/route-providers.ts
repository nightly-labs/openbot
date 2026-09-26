import { isManagedRuntimeProvider, type ManagedProviderId } from "@openbot/contracts/agent-providers";
import type { ProviderRuntimeSnapshot, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { PROVIDERS_ADMIN_CAPABILITY, PROVIDERS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/providers-v1";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { parseProviderId } from "../ipc/app-inputs";
import { parseDeleteCustomProvider, parseSaveCustomProvider } from "../ipc/custom-provider-inputs";
import { parseProviderApiKeyInput } from "../ipc/provider-handlers";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/** The bound `providers-v1` puts on a runtime message. */
const RUNTIME_MESSAGE_LIMIT = 1024;

/**
 * The providers of this computer, managed from a joined server: sign-in with a device code, provider
 * API keys, the managed CLI runtimes and the custom endpoints. Frozen by `providers-v1`.
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
  if (!providers || !capabilities.has(PROVIDERS_ADMIN_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providersUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  const { service, credentials, runtimes, customProviders } = providers;
  try {
    switch (url.pathname) {
      case PROVIDERS_ADMIN_ROUTES.codeLoginStart:
        // The admin types the code in their own browser; nothing it is traded for comes back.
        return json(200, await service.startProviderCodeLogin(parsed(provider, body)));
      case PROVIDERS_ADMIN_ROUTES.codeLoginCancel:
        await service.cancelProviderCodeLogin(parsed(provider, body));
        return json(200, {});
      case PROVIDERS_ADMIN_ROUTES.apiKeyState:
        return json(200, { status: credentials.status(parsed(provider, body)) });
      case PROVIDERS_ADMIN_ROUTES.apiKeySet: {
        const input = parsed(parseProviderApiKeyInput, body);
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

const ROUTES = new Set<string>(Object.values(PROVIDERS_ADMIN_ROUTES));

function isProvidersRoute(pathname: string): boolean {
  return ROUTES.has(pathname);
}

function provider(body: DynamicRecord) {
  return parseProviderId(body.provider);
}

function managedProvider(body: DynamicRecord): ManagedProviderId {
  const id = provider(body);
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
function wireSnapshot(snapshot: ProviderRuntimeSnapshot): ProviderRuntimeSnapshot {
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

function wireStatus(status: ProviderRuntimeStatus): ProviderRuntimeStatus {
  return { ...status, message: status.message?.slice(0, RUNTIME_MESSAGE_LIMIT) ?? null };
}
