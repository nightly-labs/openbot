import {
  agentProviderName,
  type DownloadableProviderId,
  INSTALLER_PROVIDERS,
  isDownloadableProvider,
  isKeyOnlyProvider,
  isManagedRuntimeProvider,
  MANAGED_RUNTIME_PROVIDERS,
  MANAGED_TOOL_RUNTIMES,
  type ManagedProviderId,
} from "@openbot/contracts/agent-providers";
import {
  type CustomProviderModel,
  type CustomProviderResult,
  type CustomProviderSummary,
  DEFAULT_CUSTOM_PROVIDER_HARNESS,
  type ProviderRuntimeSnapshot,
  type ProviderRuntimeStatus,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";
import {
  CUSTOM_PROVIDER_EDIT_CAPABILITY,
  CUSTOM_PROVIDER_EDIT_ROUTES,
} from "@openbot/contracts/team-protocol/custom-provider-edit-v1";
import {
  CUSTOM_PROVIDER_HARNESS_CHOICE_CAPABILITY,
  CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES,
} from "@openbot/contracts/team-protocol/custom-provider-harness-choice-v1";
import {
  CUSTOM_PROVIDER_HARNESS_CAPABILITY,
  CUSTOM_PROVIDER_HARNESS_ROUTES,
} from "@openbot/contracts/team-protocol/custom-provider-harness-v1";
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
import {
  PROVIDERS_V4_CAPABILITY,
  PROVIDERS_V4_ROUTES,
  PROVIDERS_V4_RUNTIME_PROVIDERS,
  PROVIDERS_V4_SIGN_IN_PROVIDERS,
} from "@openbot/contracts/team-protocol/providers-v4";
import {
  PROVIDERS_V5_CAPABILITY,
  PROVIDERS_V5_ROUTES,
  PROVIDERS_V5_RUNTIME_PROVIDERS,
} from "@openbot/contracts/team-protocol/providers-v5";
import { PROVIDERS_V8_CAPABILITY, PROVIDERS_V8_ROUTES } from "@openbot/contracts/team-protocol/providers-v8";
import { sourceText } from "@openbot/i18n/source";
import { redactText, registerSecretValue } from "@openbot/logging";
import { Effect } from "effect";
import { normalizePastedCode } from "../../backend/agent/cli-code-login";
import { AgentLifecycleFailed } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseProviderId } from "../ipc/app-inputs";
import {
  parseDeleteCustomProvider,
  parseSaveCustomProvider,
  parseUpdateCustomProvider,
} from "../ipc/custom-provider-inputs";
import { parseProviderApiKeyInput, signInCodexWithApiKey } from "../ipc/provider-handlers";
import { isObject } from "../ipc/validation";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

const RUNTIME_MESSAGE_LIMIT = 1024;

export async function routeProviders(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !isProvidersRoute(url.pathname)) return "unmatched";
  const providers = admin?.providers;
  const capability = CHOICE_ROUTES.has(url.pathname)
    ? CUSTOM_PROVIDER_HARNESS_CHOICE_CAPABILITY
    : EDIT_ROUTES.has(url.pathname)
      ? CUSTOM_PROVIDER_EDIT_CAPABILITY
      : HARNESS_ROUTES.has(url.pathname)
        ? CUSTOM_PROVIDER_HARNESS_CAPABILITY
        : V8_ROUTES.has(url.pathname)
          ? PROVIDERS_V8_CAPABILITY
          : V5_ROUTES.has(url.pathname)
            ? PROVIDERS_V5_CAPABILITY
            : V4_ROUTES.has(url.pathname)
              ? PROVIDERS_V4_CAPABILITY
              : V3_ROUTES.has(url.pathname)
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
        const id = parsed(provider, body);
        if (id !== "codex")
          throw new Error(sourceText("error.provider.noCodeSignIn", { provider: agentProviderName(id) }));
        return json(200, await runCauseEffect(service.startProviderCodeLogin(id)));
      }
      case PROVIDERS_ADMIN_ROUTES.codeLoginCancel: {
        const id = parsed(provider, body);
        if (id === "codex") await runCauseEffect(service.cancelProviderCodeLogin(id));
        return json(200, {});
      }
      case PROVIDERS_SIGN_IN_V3_ROUTES.codeLoginStart:
        return json(200, await runCauseEffect(service.startProviderCodeLogin(parsed(signInProvider, body))));
      case PROVIDERS_SIGN_IN_V3_ROUTES.codeLoginSubmit: {
        const input = parsed(codeSubmitInput, body);
        service.submitProviderCodeLogin(input.provider, input.code);
        return json(200, {});
      }
      case PROVIDERS_SIGN_IN_V3_ROUTES.codeLoginCancel:
        await runCauseEffect(service.cancelProviderCodeLogin(parsed(signInProvider, body)));
        return json(200, {});
      case PROVIDERS_V8_ROUTES.codeLoginStart:
        return json(200, await runCauseEffect(service.startProviderCodeLogin(parsed(hostProvider, body))));
      case PROVIDERS_V8_ROUTES.codeLoginSubmit: {
        const input = parsed(codeSubmitInputV8, body);
        service.submitProviderCodeLogin(input.provider, input.code);
        return json(200, {});
      }
      case PROVIDERS_V8_ROUTES.codeLoginCancel:
        await runCauseEffect(service.cancelProviderCodeLogin(parsed(hostProvider, body)));
        return json(200, {});
      case PROVIDERS_V8_ROUTES.runtimesStatus:
        return json(200, wireSnapshotV8(runtimes.getStatus()));
      case PROVIDERS_V8_ROUTES.runtimesDownload:
        return json(200, wireSnapshotV8(await runCauseEffect(runtimes.download(parsed(downloadableProviderV8, body)))));
      case PROVIDERS_V8_ROUTES.runtimesCancel:
        return json(200, wireSnapshotV8(await runCauseEffect(runtimes.cancel(parsed(downloadableProviderV8, body)))));
      case PROVIDERS_V8_ROUTES.runtimesCheck:
        return json(200, wireSnapshotV8(await runCauseEffect(runtimes.checkForUpdates())));
      case PROVIDERS_V5_ROUTES.codeLoginStart:
      case PROVIDERS_V4_ROUTES.codeLoginStart:
        return json(200, await runCauseEffect(service.startProviderCodeLogin(parsed(signInProviderV4, body))));
      case PROVIDERS_V5_ROUTES.codeLoginSubmit:
      case PROVIDERS_V4_ROUTES.codeLoginSubmit: {
        const input = parsed(codeSubmitInputV4, body);
        service.submitProviderCodeLogin(input.provider, input.code);
        return json(200, {});
      }
      case PROVIDERS_V5_ROUTES.codeLoginCancel:
      case PROVIDERS_V4_ROUTES.codeLoginCancel:
        await runCauseEffect(service.cancelProviderCodeLogin(parsed(signInProviderV4, body)));
        return json(200, {});
      case PROVIDERS_V5_ROUTES.runtimesStatus:
        return json(200, wireSnapshotV5(runtimes.getStatus()));
      case PROVIDERS_V5_ROUTES.runtimesDownload:
        return json(200, wireSnapshotV5(await runCauseEffect(runtimes.download(parsed(managedProviderV5, body)))));
      case PROVIDERS_V5_ROUTES.runtimesCancel:
        return json(200, wireSnapshotV5(await runCauseEffect(runtimes.cancel(parsed(managedProviderV5, body)))));
      case PROVIDERS_V5_ROUTES.runtimesCheck:
        return json(200, wireSnapshotV5(await runCauseEffect(runtimes.checkForUpdates())));
      case PROVIDERS_V4_ROUTES.runtimesStatus:
        return json(200, wireSnapshotV4(runtimes.getStatus()));
      case PROVIDERS_V4_ROUTES.runtimesDownload:
        return json(200, wireSnapshotV4(await runCauseEffect(runtimes.download(parsed(managedProviderV4, body)))));
      case PROVIDERS_V4_ROUTES.runtimesCancel:
        return json(200, wireSnapshotV4(await runCauseEffect(runtimes.cancel(parsed(managedProviderV4, body)))));
      case PROVIDERS_V4_ROUTES.runtimesCheck:
        return json(200, wireSnapshotV4(await runCauseEffect(runtimes.checkForUpdates())));
      case PROVIDERS_V8_ROUTES.apiKeyState:
      case PROVIDERS_V5_ROUTES.apiKeyState:
      case PROVIDERS_ADMIN_ROUTES.apiKeyState: {
        const id = parsed(
          V8_ROUTES.has(url.pathname) ? keyProviderV8 : V5_ROUTES.has(url.pathname) ? managedProviderV5 : provider,
          body,
        );
        if (id === "codex") {
          const codex = service.getStatus().providers?.find((candidate) => candidate.id === "codex");
          return json(200, { status: codex?.apiKeyInUse ? "saved" : "missing" });
        }
        return json(200, { status: credentials.status(id) });
      }
      case PROVIDERS_V8_ROUTES.apiKeySet:
      case PROVIDERS_V5_ROUTES.apiKeySet:
      case PROVIDERS_ADMIN_ROUTES.apiKeySet: {
        const input = parsed(
          V8_ROUTES.has(url.pathname)
            ? parseProviderApiKeyInput
            : V5_ROUTES.has(url.pathname)
              ? peerApiKeyInput
              : wireApiKeyInput,
          body,
        );
        if (input.provider === "codex") {
          await signInCodexWithApiKey(service, input.key);
          return json(200, {});
        }
        const save = () =>
          credentials
            .set(input.provider, input.key)
            .pipe(
              Effect.mapError(
                (error) => new AgentLifecycleFailed({ operation: "changeProviderCredential", cause: error.cause }),
              ),
            );
        const piPending = await runCauseEffect(runtimes.startKeyProviderCli(input.provider));
        await runCauseEffect(piPending ? save() : service.changeProviderCredential(input.provider, save));
        return json(200, {});
      }
      case PROVIDERS_V8_ROUTES.apiKeyClear:
      case PROVIDERS_V5_ROUTES.apiKeyClear:
      case PROVIDERS_ADMIN_ROUTES.apiKeyClear: {
        const id = parsed(
          V8_ROUTES.has(url.pathname) ? keyProviderV8 : V5_ROUTES.has(url.pathname) ? managedProviderV5 : provider,
          body,
        );
        await runCauseEffect(
          service.clearProviderCredential(id, () =>
            credentials
              .clear(id)
              .pipe(
                Effect.mapError(
                  (error) => new AgentLifecycleFailed({ operation: "changeProviderCredential", cause: error.cause }),
                ),
              ),
          ),
        );
        return json(200, {});
      }
      case PROVIDERS_ADMIN_ROUTES.runtimesStatus:
        return json(200, wireSnapshot(runtimes.getStatus()));
      case PROVIDERS_ADMIN_ROUTES.runtimesDownload:
        return json(200, wireSnapshot(await runCauseEffect(runtimes.download(parsed(managedProvider, body)))));
      case PROVIDERS_ADMIN_ROUTES.runtimesCancel:
        return json(200, wireSnapshot(await runCauseEffect(runtimes.cancel(parsed(managedProvider, body)))));
      case PROVIDERS_ADMIN_ROUTES.runtimesCheck:
        return json(200, wireSnapshot(await runCauseEffect(runtimes.checkForUpdates())));
      case PROVIDERS_RUNTIMES_V2_ROUTES.runtimesStatus:
        return json(200, wireSnapshotV2(runtimes.getStatus()));
      case PROVIDERS_RUNTIMES_V2_ROUTES.runtimesDownload:
        return json(200, wireSnapshotV2(await runCauseEffect(runtimes.download(parsed(managedProviderV2, body)))));
      case PROVIDERS_RUNTIMES_V2_ROUTES.runtimesCancel:
        return json(200, wireSnapshotV2(await runCauseEffect(runtimes.cancel(parsed(managedProviderV2, body)))));
      case PROVIDERS_RUNTIMES_V2_ROUTES.runtimesCheck:
        return json(200, wireSnapshotV2(await runCauseEffect(runtimes.checkForUpdates())));
      case PROVIDERS_ADMIN_ROUTES.customList:
        return json(200, customProviders.list().map(wireCustomProvider));
      case CUSTOM_PROVIDER_HARNESS_ROUTES.customList:
        return json(200, customProviders.list().map(wireHarnessCustomProvider));
      case CUSTOM_PROVIDER_EDIT_ROUTES.customList:
      case CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES.customList:
        return json(200, customProviders.list().map(wireEditCustomProvider));
      case CUSTOM_PROVIDER_EDIT_ROUTES.customUpdate: {
        const result = await runCauseEffect(
          customProviders.peerUpdate(parsed(parseUpdateCustomProvider, releasedSaveBody(body))),
        );
        return json(200, wireResult(url.pathname, result));
      }
      case CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES.customUpdate: {
        const { harness, ...input } = parsed(parseUpdateCustomProvider, harnessChoiceBody(body));
        if (!harness) throw new Error("Unknown harness.");
        const result = await runCauseEffect(customProviders.peerHarnessUpdate(input, harness));
        return json(200, wireResult(url.pathname, result));
      }
      case CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES.customSave: {
        const result = await runCauseEffect(
          customProviders.save(parsed(parseSaveCustomProvider, harnessChoiceBody(body))),
        );
        return json(200, wireResult(url.pathname, result));
      }
      case PROVIDERS_ADMIN_ROUTES.customSave:
      case CUSTOM_PROVIDER_HARNESS_ROUTES.customSave:
      case CUSTOM_PROVIDER_EDIT_ROUTES.customSave: {
        const result = await runCauseEffect(
          customProviders.save(parsed(parseSaveCustomProvider, releasedSaveBody(body))),
        );
        return json(200, wireResult(url.pathname, result));
      }
      default:
        return json(
          200,
          wireResult(
            url.pathname,
            await runCauseEffect(customProviders.remove(parsed(parseDeleteCustomProvider, body).id)),
          ),
        );
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error) throw new HttpError(409, redactText(error.message));
    throw error;
  }
}

const V2_ROUTES = new Set<string>(Object.values(PROVIDERS_RUNTIMES_V2_ROUTES));
const V3_ROUTES = new Set<string>(Object.values(PROVIDERS_SIGN_IN_V3_ROUTES));
const V5_ROUTES = new Set<string>(Object.values(PROVIDERS_V5_ROUTES));
const V4_ROUTES = new Set<string>(Object.values(PROVIDERS_V4_ROUTES));
const V8_ROUTES = new Set<string>(Object.values(PROVIDERS_V8_ROUTES));
const HARNESS_ROUTES = new Set<string>(Object.values(CUSTOM_PROVIDER_HARNESS_ROUTES));
const EDIT_ROUTES = new Set<string>(Object.values(CUSTOM_PROVIDER_EDIT_ROUTES));
const CHOICE_ROUTES = new Set<string>(Object.values(CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES));
const ROUTES = new Set<string>([
  ...Object.values(PROVIDERS_ADMIN_ROUTES),
  ...V2_ROUTES,
  ...V3_ROUTES,
  ...V4_ROUTES,
  ...V5_ROUTES,
  ...V8_ROUTES,
  ...HARNESS_ROUTES,
  ...EDIT_ROUTES,
  ...CHOICE_ROUTES,
]);

function isProvidersRoute(pathname: string): boolean {
  return ROUTES.has(pathname);
}

function wireCustomProvider({
  headerNames: _headerNames,
  harness: _harness,
  ...provider
}: CustomProviderSummary): CustomProviderSummary {
  return { ...provider, models: provider.models.map(wireCustomModel) };
}

function releasedSaveBody({ harness: _harness, ...body }: DynamicRecord): DynamicRecord {
  if (!Array.isArray(body.models)) return body;
  return {
    ...body,
    models: body.models.map((model: unknown) => {
      if (!isObject(model)) return model;
      const {
        contextWindow: _contextWindow,
        maxOutput: _maxOutput,
        reasoningEfforts: _reasoningEfforts,
        inputs: _inputs,
        ...released
      } = model;
      return released;
    }),
  };
}

function harnessChoiceBody(body: DynamicRecord): DynamicRecord {
  return { ...releasedSaveBody(body), harness: body.harness };
}

function wireCustomModel({ id, name }: CustomProviderModel): CustomProviderModel {
  return { id, name };
}

function wireHarnessCustomProvider(provider: CustomProviderSummary): CustomProviderSummary {
  return { ...wireCustomProvider(provider), harness: provider.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS };
}

function wireEditCustomProvider(provider: CustomProviderSummary): CustomProviderSummary {
  return { ...wireHarnessCustomProvider(provider), headerNames: provider.headerNames ?? [] };
}

function wireResult(route: string, result: CustomProviderResult): CustomProviderResult {
  const wire =
    EDIT_ROUTES.has(route) || CHOICE_ROUTES.has(route)
      ? wireEditCustomProvider
      : HARNESS_ROUTES.has(route)
        ? wireHarnessCustomProvider
        : wireCustomProvider;
  return { ...result, providers: result.providers.map(wire) };
}

const WIRE_PROVIDERS = ["codex", "claude", "grok", "opencode"] as const satisfies readonly ManagedProviderId[];
type WireProviderId = (typeof WIRE_PROVIDERS)[number];

interface WireProviderRuntimeSnapshot extends Omit<ProviderRuntimeSnapshot, "providers"> {
  providers: Record<WireProviderId, ProviderRuntimeStatus>;
}

function provider(body: DynamicRecord): WireProviderId {
  const id = parseProviderId(body.provider);
  if (!isOneOf(WIRE_PROVIDERS, id)) throw new Error("Unknown provider.");
  return id;
}

type SignInProviderId = (typeof PROVIDERS_SIGN_IN_V3_PROVIDERS)[number];

function signInProvider(body: DynamicRecord): SignInProviderId {
  const id = parseProviderId(body.provider);
  if (!isOneOf(PROVIDERS_SIGN_IN_V3_PROVIDERS, id)) throw new Error("Unknown provider.");
  return id;
}

function codeSubmitInput(body: DynamicRecord): { provider: SignInProviderId; code: string } {
  return { provider: signInProvider(body), code: pastedCode(body) };
}

function pastedCode(body: DynamicRecord): string {
  if (typeof body.code !== "string") throw new Error("Invalid sign-in code.");
  const code = normalizePastedCode(body.code);
  registerSecretValue(code);
  return code;
}

type SignInProviderIdV4 = (typeof PROVIDERS_V4_SIGN_IN_PROVIDERS)[number];

function signInProviderV4(body: DynamicRecord): SignInProviderIdV4 {
  const id = parseProviderId(body.provider);
  if (!isOneOf(PROVIDERS_V4_SIGN_IN_PROVIDERS, id)) throw new Error("Unknown provider.");
  return id;
}

function codeSubmitInputV4(body: DynamicRecord): { provider: SignInProviderIdV4; code: string } {
  return { provider: signInProviderV4(body), code: pastedCode(body) };
}

function peerApiKeyInput(body: DynamicRecord) {
  const input = parseProviderApiKeyInput(body);
  if (isKeyOnlyProvider(input.provider)) throw new Error("Unknown provider.");
  return input;
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

const WIRE_PROVIDERS_V2 = [...WIRE_PROVIDERS, "antigravity"] as const satisfies readonly ManagedProviderId[];
type WireProviderIdV2 = (typeof WIRE_PROVIDERS_V2)[number];

interface WireProviderRuntimeSnapshotV2 extends Omit<ProviderRuntimeSnapshot, "providers"> {
  providers: Record<WireProviderIdV2, ProviderRuntimeStatus>;
}

function managedProviderV2(body: DynamicRecord): WireProviderIdV2 {
  const id = parseProviderId(body.provider);
  if (!isManagedRuntimeProvider(id)) throw new Error(sourceText("error.team.providerNotManaged"));
  if (!isOneOf(WIRE_PROVIDERS_V2, id)) throw new Error("Unknown provider.");
  return id;
}

type WireProviderIdV4 = (typeof PROVIDERS_V4_RUNTIME_PROVIDERS)[number];

interface WireProviderRuntimeSnapshotV4 extends Omit<ProviderRuntimeSnapshot, "providers"> {
  providers: Record<WireProviderIdV4, ProviderRuntimeStatus>;
}

function managedProviderV4(body: DynamicRecord): WireProviderIdV4 {
  const id = parseProviderId(body.provider);
  if (!isManagedRuntimeProvider(id)) throw new Error(sourceText("error.team.providerNotManaged"));
  if (!isOneOf(PROVIDERS_V4_RUNTIME_PROVIDERS, id)) throw new Error("Unknown provider.");
  return id;
}

function parsed<T>(parse: (value: DynamicRecord) => T, body: DynamicRecord): T {
  try {
    return parse(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid provider request.");
  }
}

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

function wireSnapshotV2(snapshot: ProviderRuntimeSnapshot): WireProviderRuntimeSnapshotV2 {
  const wire = wireSnapshot(snapshot);
  return { ...wire, providers: { ...wire.providers, antigravity: wireStatus(snapshot.providers.antigravity) } };
}

function wireSnapshotV4(snapshot: ProviderRuntimeSnapshot): WireProviderRuntimeSnapshotV4 {
  const wire = wireSnapshotV2(snapshot);
  return {
    ...wire,
    providers: {
      ...wire.providers,
      cursor: wireStatus(snapshot.providers.cursor),
      cline: wireStatus(snapshot.providers.cline),
    },
  };
}

function wireStatus(status: ProviderRuntimeStatus): ProviderRuntimeStatus {
  return { ...status, message: status.message?.slice(0, RUNTIME_MESSAGE_LIMIT) ?? null };
}

function managedProviderV5(body: DynamicRecord): ManagedProviderId {
  const id = parseProviderId(body.provider);
  if (!isOneOf(PROVIDERS_V5_RUNTIME_PROVIDERS, id)) throw new Error("Unknown provider.");
  return id;
}
interface WireProviderRuntimeSnapshotV5 extends Omit<ProviderRuntimeSnapshot, "providers"> {
  providers: Record<(typeof PROVIDERS_V5_RUNTIME_PROVIDERS)[number], ProviderRuntimeStatus>;
}
function wireSnapshotV5(snapshot: ProviderRuntimeSnapshot): WireProviderRuntimeSnapshotV5 {
  const wire = wireSnapshotV4(snapshot);
  return {
    ...wire,
    providers: { ...wire.providers, pi: wireStatus(snapshot.providers.pi), muse: wireStatus(snapshot.providers.muse) },
  };
}

function hostProvider(body: DynamicRecord) {
  return parseProviderId(body.provider);
}

function codeSubmitInputV8(body: DynamicRecord) {
  return { provider: hostProvider(body), code: pastedCode(body) };
}

function managedProviderV8(body: DynamicRecord): ManagedProviderId {
  const id = hostProvider(body);
  if (!isManagedRuntimeProvider(id)) throw new Error(sourceText("error.team.providerNotManaged"));
  return id;
}

function downloadableProviderV8(body: DynamicRecord): DownloadableProviderId {
  const id = hostProvider(body);
  if (!isDownloadableProvider(id)) throw new Error(sourceText("error.team.providerNotManaged"));
  return id;
}

function keyProviderV8(body: DynamicRecord) {
  const id = hostProvider(body);
  return isKeyOnlyProvider(id) ? id : managedProviderV8(body);
}

function wireSnapshotV8(snapshot: ProviderRuntimeSnapshot) {
  const installers = INSTALLER_PROVIDERS.flatMap((id) => {
    const status = snapshot.providers[id];
    return status ? [{ id, ...wireStatus(status) }] : [];
  });
  return {
    revision: snapshot.revision,
    providers: [
      ...MANAGED_RUNTIME_PROVIDERS.map((id) => ({ id, ...wireStatus(snapshot.providers[id]) })),
      ...installers,
    ],
    toolRuntimes: MANAGED_TOOL_RUNTIMES.map((id) => ({ id, ...wireStatus(snapshot.toolRuntimes[id]) })),
  };
}
