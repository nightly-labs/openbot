import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentAccess,
  agentComputerUseEnabled,
  COMPUTER_USE_MCP_SERVER_ID,
  GITHUB_CONNECTOR_MCP_SERVER_ID,
  isReservedMcpServerName,
  MCP_TRANSPORTS,
  type McpKeyValue,
  type McpServerConfig,
  type McpSignInState,
  mcpConfigErrors,
  normalizeMcpConfig,
  workspaceAccessEnforced,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { isSecretName, registerSecretValues } from "@openbot/logging";
import { Effect } from "effect";
import { z } from "zod";
import type { McpSignInOffer } from "../mcp-oauth-provider";
import type { McpProbeOutcome, McpToolArguments, McpToolCallResult } from "../mcp-probe";
import { providerMcpServerName } from "../mcp-provider-shapes";
import { redactMcpSecrets } from "../mcp-redaction";
import type { DynamicToolResult } from "../protocol";
import type { McpGateway, McpGatewayFailed } from "./mcp-gateway";
import { profileToolErrorMessage } from "./profile-tools";
import { type OpenBotToolResponse, openBotToolFailure, openBotToolResult } from "./routine-tools";
import { ToolOperationFailed, toolStep } from "./tool-operation";

const APP_READY_NEXT =
  "The app answers. Use these tools when your tool search finds them. Otherwise they reach you from your next turn: ask the user to send the request again.";

const SIGNED_IN_APP_ACCOUNT_NEXT =
  "When the app answers for the wrong account, or data that the user expects is missing, tell the user that they can change the account in OpenBot: in Marketplace, Apps, open this app. With one account, the user clicks Sign in again and signs in with the correct account. With more accounts, the user clicks Add account, and can remove the wrong account. Disconnect, on the same page, removes the app. In the phone app, the user opens this app in Marketplace and uses Sign out, then signs in again. When the user does not see these controls on a joined server, a server owner or admin must do it. Do not say that a new sign-in selects a different workspace: the app's own sign-in page decides that.";

const serverName = z
  .string()
  .trim()
  .min(1)
  .max(INPUT_LIMITS.mcpServerName)
  .describe("The server name, as list_mcp_servers shows it.");

const saveMcpServerToolSchema = z.strictObject({
  name: serverName.describe("The server name. A name in use changes that server; a new name adds one."),
  transport: z
    .enum(MCP_TRANSPORTS)
    .optional()
    .describe(
      "http for an address, stdio for a local command. A new server without it uses stdio when command is set.",
    ),
  url: z.string().trim().max(INPUT_LIMITS.mcpUrl).optional().describe("The http or https address of an http server."),
  command: z.string().trim().max(INPUT_LIMITS.mcpCommand).optional().describe("The command of a stdio server."),
  args: z
    .array(z.string().max(INPUT_LIMITS.mcpArgValue))
    .max(INPUT_LIMITS.mcpArgs)
    .optional()
    .describe("The arguments of a stdio server. They replace the arguments it had."),
  workingDirectory: z.string().max(INPUT_LIMITS.path).optional(),
  headers: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(INPUT_LIMITS.mcpEnvName),
        value: z.string().max(INPUT_LIMITS.mcpHeaderValue),
      }),
    )
    .max(INPUT_LIMITS.mcpHeaders)
    .optional()
    .describe(
      "Headers that the user gave, such as Authorization: Bearer <token>. Each sets or replaces the header of its name; an empty value removes it.",
    ),
  enabled: z.boolean().optional().describe("A new server is on unless this is false."),
});

const headerValuesArgument = z.looseObject({
  headers: z.array(z.looseObject({ name: z.string(), value: z.string() })),
});

const namedServerSchema = z.strictObject({ name: serverName });
const setEnabledSchema = z.strictObject({ name: serverName, enabled: z.boolean() });

const MCP_SCOPE = "The user selects which agents get each server, in Marketplace, Apps.";
const MCP_APPROVAL =
  "The user's request is the permission: call the tool without asking first. OpenBot asks the user to approve when your access needs it.";

export const MCP_SERVER_TOOL_DEFINITIONS = [
  {
    name: "list_mcp_servers",
    description: `List the MCP servers of this OpenBot server: name, transport, on or off, address or command, the names of its headers and environment variables, sign-in, and forYou: you get its tools when it is on. Values are never shown. ${MCP_SCOPE} Read-only.`,
    shape: {},
  },
  {
    name: "save_mcp_server",
    description: `Add an MCP server, or change one by its name, only when the user asks for it. ${MCP_SCOPE} ${MCP_APPROVAL} Then OpenBot connects to the server and saves it when it answers or needs only a sign-in or a key. The result is ready with its tools, needs_sign_in (a Sign in card is in the conversation: wait for the user), needs_key (save again with the key in headers when the user gave it; else the user enters it in Marketplace, Apps; never ask for a key in the chat), or the error. Put a key that the user gave in headers, never in the address. Environment values are not set here: a stdio server that cannot start without a key in its environment is added by the user in Marketplace, Apps. A server keeps the keys it holds only on its transport, address origin, command, arguments and folder. New tools reach the agents from their next turn.`,
    shape: saveMcpServerToolSchema.shape,
  },
  {
    name: "test_mcp_server",
    description:
      "Connect to one saved MCP server and report its tools, or what it needs: a sign-in, a key, or the error. Call it again after the user signs in or enters a key.",
    shape: namedServerSchema.shape,
  },
  {
    name: "set_mcp_server_enabled",
    description: `Turn one MCP server on or off when the user asks. ${MCP_SCOPE} ${MCP_APPROVAL}`,
    shape: setEnabledSchema.shape,
  },
  {
    name: "remove_mcp_server",
    description: `Remove one MCP server and its sign-in when the user asks. ${MCP_SCOPE} ${MCP_APPROVAL}`,
    shape: namedServerSchema.shape,
  },
] as const;

export type McpServerToolName = (typeof MCP_SERVER_TOOL_DEFINITIONS)[number]["name"];

const MCP_SERVER_TOOL_NAMES: ReadonlySet<string> = new Set(MCP_SERVER_TOOL_DEFINITIONS.map(({ name }) => name));

export function isMcpServerTool(tool: string): tool is McpServerToolName {
  return MCP_SERVER_TOOL_NAMES.has(tool);
}

export interface AgentMcpServers {
  list(): McpServerConfig[];
  builtIn(): readonly McpServerConfig[];
  signIns(): McpSignInState[];
  signInFailure(config: McpServerConfig): string | null;
  save(config: McpServerConfig): Effect.Effect<unknown, ToolOperationFailed>;
  setEnabled(mcpServerId: string, enabled: boolean): Effect.Effect<unknown, ToolOperationFailed>;
  remove(mcpServerId: string): Effect.Effect<unknown, ToolOperationFailed>;
  inspect(config: McpServerConfig, tested?: boolean): Effect.Effect<McpProbeOutcome, ToolOperationFailed>;
  signInOffer(config: McpServerConfig): Effect.Effect<McpSignInOffer>;
  redact(text: string): string;
  forAgent(agentId: string): McpServerConfig[];
  allowsAgent(mcpServerId: string, agentId: string): boolean;
  callTool(
    config: McpServerConfig,
    name: string,
    args: McpToolArguments,
  ): Effect.Effect<{ result: McpToolCallResult } | { error: string }, ToolOperationFailed>;
}

export function mcpFallbackRunsServer(config: McpServerConfig, agent: { access?: AgentAccess | undefined }): boolean {
  return config.transport === "http" || !workspaceAccessEnforced(agent);
}

export function agentFallbackMcpServers(
  enabled: readonly McpServerConfig[],
  savedIds: ReadonlySet<string>,
  agent: { access?: AgentAccess | undefined; computerUse?: boolean | undefined },
): McpServerConfig[] {
  return enabled.filter(
    (config) =>
      (config.id === GITHUB_CONNECTOR_MCP_SERVER_ID ||
        (config.id === COMPUTER_USE_MCP_SERVER_ID && agentComputerUseEnabled(agent)) ||
        (savedIds.has(config.id) && !isReservedMcpServerName(config.name))) &&
      mcpFallbackRunsServer(config, agent),
  );
}

export function findAgentMcpTool(
  configs: readonly McpServerConfig[],
  name: string,
): { config: McpServerConfig; tool: string } | null {
  let found: { config: McpServerConfig; tool: string; length: number } | null = null;
  for (const config of configs) {
    const provider = providerMcpServerName(config.name);
    for (const server of [config.name, provider, `openbot_${provider}`]) {
      const prefix = `${server}.`;
      if (!name.startsWith(prefix) || name.length === prefix.length) continue;
      if (!found || prefix.length > found.length)
        found = { config, tool: name.slice(prefix.length), length: prefix.length };
    }
  }
  return found && { config: found.config, tool: found.tool };
}

export function mcpToolCallResponse(answer: McpToolCallResult): DynamicToolResult {
  const decoded = CallToolResultSchema.safeParse(answer);
  if (!decoded.success) return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(answer) }] };
  const result = decoded.data;
  const contentItems: DynamicToolResult["contentItems"] = result.content.map((item) =>
    item.type === "text"
      ? { type: "inputText", text: item.text }
      : item.type === "image"
        ? { type: "inputImage", imageUrl: `data:${item.mimeType};base64,${item.data}` }
        : { type: "inputText", text: JSON.stringify(item) },
  );
  if (contentItems.length === 0)
    contentItems.push({ type: "inputText", text: JSON.stringify(result.structuredContent ?? {}) });
  return { success: result.isError !== true, contentItems };
}

export function mcpServersFromGateway(
  gateway: McpGateway,
  prepareTest?: (config: McpServerConfig) => Effect.Effect<void, unknown>,
  forAgent: (agentId: string) => McpServerConfig[] = () => [],
  allowsAgent: (mcpServerId: string, agentId: string) => boolean = () => true,
): AgentMcpServers {
  const toToolFailure = Effect.mapError(
    (failure: McpGatewayFailed) => new ToolOperationFailed({ cause: failure.cause }),
  );
  const prepared = (config: McpServerConfig) =>
    (prepareTest?.(config) ?? Effect.void).pipe(Effect.mapError((cause) => new ToolOperationFailed({ cause })));
  return {
    list: () => gateway.list(),
    builtIn: () => gateway.builtIn(),
    signIns: () => gateway.signIns(),
    signInFailure: (config) => gateway.signInFailure(config.url),
    save: (config) => gateway.save({ config }).pipe(toToolFailure),
    setEnabled: (mcpServerId, enabled) => gateway.setEnabled({ mcpServerId, enabled }).pipe(toToolFailure),
    remove: (mcpServerId) => gateway.remove({ mcpServerId }).pipe(toToolFailure),
    inspect: (config, tested) =>
      prepared(config).pipe(Effect.andThen(gateway.inspect(config, tested).pipe(toToolFailure))),
    signInOffer: (config) => gateway.signInOffer(config),
    redact: (text) => gateway.redact(text),
    forAgent,
    allowsAgent,
    callTool: (config, name, args) =>
      prepared(config).pipe(Effect.andThen(gateway.callTool(config, name, args).pipe(toToolFailure))),
  };
}

export interface McpServerToolCall {
  tool: McpServerToolName;
  agentId: string;
  arguments: unknown;
  approve(reason: string, cwd?: string | null): Effect.Effect<boolean, ToolOperationFailed>;
  keysFromPerson(values: readonly string[]): Effect.Effect<boolean>;
  requestSignIn(config: McpServerConfig): Effect.Effect<void, ToolOperationFailed>;
}

export const handleMcpServerTool = (servers: AgentMcpServers, call: McpServerToolCall) =>
  asToolResult(servers, runMcpServerTool(servers, call));

export interface MarketplaceAppServer {
  config: McpServerConfig;
  setupSteps: readonly string[];
}

export const marketplaceAppStatus = (
  servers: AgentMcpServers,
  app: MarketplaceAppServer,
  requestSignIn: McpServerToolCall["requestSignIn"],
) => asToolResult(servers, runMarketplaceAppStatus(servers, app, requestSignIn));

const runMarketplaceAppStatus = Effect.fn("McpServerTools.marketplaceAppStatus")(function* (
  servers: AgentMcpServers,
  { config, setupSteps }: MarketplaceAppServer,
  requestSignIn: McpServerToolCall["requestSignIn"],
) {
  const server = describeServer(config, servers.signIns());
  if (!config.enabled)
    return openBotToolResult({
      status: "disabled",
      server,
      next: "The app is installed and turned off. Tell the user to turn it on in Marketplace, Apps, or call openbot.set_mcp_server_enabled when the user asks.",
    });
  const outcome = yield* servers.inspect(config);
  if (outcome.error === null)
    return openBotToolResult({
      status: "ready",
      server,
      toolCount: outcome.toolCount,
      tools: outcome.tools,
      next:
        "signedIn" in server && server.signedIn ? `${APP_READY_NEXT} ${SIGNED_IN_APP_ACCOUNT_NEXT}` : APP_READY_NEXT,
    });
  if (outcome.needs === null && setupSteps.length > 0)
    return openBotToolResult({
      status: "not_running",
      server,
      error: servers.redact(outcome.error),
      setupSteps,
      next: "Give the user these steps, end your turn, and call openbot.test_mcp_server when the user says it is done.",
    });
  return yield* report(servers, { requestSignIn }, config, outcome, false);
});

function asToolResult(
  servers: AgentMcpServers,
  effect: Effect.Effect<OpenBotToolResponse, ToolOperationFailed>,
): Effect.Effect<OpenBotToolResponse> {
  const failed = (error: unknown) => Effect.succeed(openBotToolFailure(servers.redact(profileToolErrorMessage(error))));
  return effect.pipe(
    Effect.catch((failure) => failed(failure.cause)),
    Effect.catchDefect(failed),
  );
}

const runMcpServerTool = Effect.fn("McpServerTools.handle")(function* (
  servers: AgentMcpServers,
  call: McpServerToolCall,
) {
  switch (call.tool) {
    case "list_mcp_servers": {
      const signIns = servers.signIns();
      return openBotToolResult({
        servers: [
          ...servers.list().map((config) => ({
            ...describeServer(config, signIns),
            forYou: servers.allowsAgent(config.id, call.agentId),
          })),
          ...servers.builtIn().map(describeBuiltInServer),
        ],
      });
    }
    case "test_mcp_server": {
      const { name } = yield* toolStep(() => namedServerSchema.parse(call.arguments));
      const config = yield* findServer(servers, name);
      const outcome = yield* servers.inspect(config, true);
      const offer = outcome.error === null ? yield* servers.signInOffer(config) : "none";
      if (offer === "refused")
        return openBotToolResult({
          status: "ready",
          server: describeServer(config, servers.signIns()),
          toolCount: outcome.toolCount,
          tools: outcome.tools,
          error: sourceText("error.backend.mcpRegistrationUnavailable"),
          next: "The tools that need a sign-in fail until the user adds a sign-in app to this server. Tell the user what the error says, in plain words. Do not offer a Sign in card or ask the user to sign in before the sign-in app is there.",
        });
      if (offer === "offered") {
        yield* call.requestSignIn(config);
        return openBotToolResult({
          status: "ready",
          server: describeServer(config, servers.signIns()),
          toolCount: outcome.toolCount,
          tools: outcome.tools,
          next: `The server offers a sign-in, which some tools can need. When the user's request needs such a tool: ${SIGN_IN_NEXT}`,
        });
      }
      return yield* report(servers, call, config, outcome, false);
    }
    case "save_mcp_server": {
      registerHeaderSecrets(call.arguments);
      const input = yield* toolStep(() => saveMcpServerToolSchema.parse(call.arguments));
      const existing = servers.list().find((config) => config.name === input.name);
      const config = normalizeMcpConfig(mergeServer(existing, input));
      const errors = mcpConfigErrors(config);
      const invalid = errors.name ?? errors.command ?? errors.url;
      if (invalid) return openBotToolFailure(invalid);
      const headers = input.headers ?? [];
      if (headers.length > 0 && config.transport !== "http")
        return openBotToolFailure(sourceText("error.agent.mcpServerHeadersNeedHttp", { name: config.name }));
      const givenKeys = headers.flatMap(({ value }) => (value ? [value] : []));
      if (givenKeys.length > 0 && !(yield* call.keysFromPerson(givenKeys)))
        return openBotToolFailure(sourceText("error.agent.mcpServerHeadersNeedPerson", { name: config.name }));
      if (
        existing &&
        holdsKeys({ ...existing, headers: unreplacedHeaders(existing.headers, headers) }) &&
        serverMoves(existing, config)
      )
        return openBotToolFailure(sourceText("error.agent.mcpServerKeysMove", { name: existing.name }));
      const key = existing ? "status.agent.mcpServerChange" : "status.agent.mcpServerAdd";
      const change = sourceText(key, { name: config.name, target: serverTarget(config) });
      const reason = servers.redact(
        headers.length > 0
          ? `${change} ${sourceText("status.agent.mcpServerHeaders", { names: headerNames(headers) })}`
          : change,
      );
      if (!(yield* call.approve(reason, config.transport === "stdio" ? config.workingDirectory || null : null)))
        return openBotToolFailure(sourceText("error.agent.mcpServerDeclined"));
      if (!config.enabled) {
        yield* servers.save(config);
        const saved = servers.list().find((candidate) => candidate.name === config.name) ?? config;
        return openBotToolResult({
          status: "disabled",
          server: describeServer(saved, servers.signIns()),
          appliesFrom: "the next turn of each agent",
        });
      }
      const outcome = yield* servers.inspect(config);
      if (outcome.error !== null && outcome.needs === null)
        return openBotToolFailure(
          redactMcpSecrets(
            servers.redact(sourceText("error.agent.mcpServerNotSaved", { error: outcome.error })),
            config,
          ),
        );
      yield* servers.save(config);
      return yield* report(servers, call, config, outcome, true);
    }
    case "set_mcp_server_enabled": {
      const { name, enabled } = yield* toolStep(() => setEnabledSchema.parse(call.arguments));
      const config = yield* findServer(servers, name);
      const key = enabled ? "status.agent.mcpServerEnable" : "status.agent.mcpServerDisable";
      if (!(yield* call.approve(sourceText(key, { name: config.name }))))
        return openBotToolFailure(sourceText("error.agent.mcpServerDeclined"));
      yield* servers.setEnabled(config.id, enabled);
      return openBotToolResult({ name: config.name, enabled, appliesFrom: "the next turn of each agent" });
    }
    case "remove_mcp_server": {
      const { name } = yield* toolStep(() => namedServerSchema.parse(call.arguments));
      const config = yield* findServer(servers, name);
      if (!(yield* call.approve(sourceText("status.agent.mcpServerRemove", { name: config.name }))))
        return openBotToolFailure(sourceText("error.agent.mcpServerDeclined"));
      yield* servers.remove(config.id);
      return openBotToolResult({ name: config.name, removed: true, appliesFrom: "the next turn of each agent" });
    }
  }
});

const findServer = (servers: AgentMcpServers, name: string) => {
  const config = servers.list().find((candidate) => candidate.name === name);
  if (config) return Effect.succeed(config);
  const key = servers.builtIn().some((candidate) => candidate.name === name)
    ? "error.agent.mcpServerBuiltIn"
    : "error.agent.mcpServerUnknown";
  return Effect.fail(new ToolOperationFailed({ cause: new Error(sourceText(key, { name })) }));
};

const SIGN_IN_NEXT =
  "A Sign in card is in this conversation. Only the user sees it: do not check it, and do not test again in this turn. Tell the user to press Sign in on it, end your turn, and test again when the user says it is done. Another needs_sign_in means only that the sign-in is not done; it is not an OpenBot fault. If the user sees no card, tell them to sign in from Marketplace, Apps, the server's page, and end your turn. Do not send openbot.send_feedback about the card unless the user asks for it, or says that the sign-in there failed too.";

function signInNeeded(servers: AgentMcpServers, config: McpServerConfig, when = "") {
  const failure = servers.signInFailure(config);
  if (failure === null) return { next: `${when}${SIGN_IN_NEXT}` };
  return {
    lastSignInError: servers.redact(failure),
    next: `${when}The user's last sign-in to this server failed with lastSignInError. Tell the user this reason in plain words first. ${SIGN_IN_NEXT}`,
  };
}

export const searchSignIns = Effect.fn("McpServerTools.searchSignIns")(function* (
  servers: AgentMcpServers,
  named: readonly McpServerConfig[],
  requestSignIn: McpServerToolCall["requestSignIn"],
) {
  const signIns = servers.signIns();
  const signedIn = new Set(signIns.flatMap((state) => (state.signedIn ? [state.mcpServerId] : [])));
  const candidates = named.filter(
    (config) => config.enabled && config.transport === "http" && !signedIn.has(config.id),
  );
  const found = yield* Effect.forEach(
    candidates,
    (config) =>
      Effect.gen(function* () {
        const outcome = yield* servers.inspect(config);
        if (outcome.needs !== "sign_in") return null;
        yield* requestSignIn(config);
        return {
          status: "needs_sign_in",
          server: describeServer(config, signIns),
          ...signInNeeded(servers, config, "When the user's request needs this server: "),
        };
      }),
    { concurrency: "unbounded" },
  );
  return found.filter((entry) => entry !== null);
});

const report = Effect.fnUntraced(function* (
  servers: AgentMcpServers,
  call: Pick<McpServerToolCall, "requestSignIn">,
  config: McpServerConfig,
  outcome: McpProbeOutcome,
  justSaved: boolean,
): Effect.fn.Return<OpenBotToolResponse, ToolOperationFailed> {
  const saved = servers.list().find((candidate) => candidate.name === config.name) ?? config;
  const server = describeServer(saved, servers.signIns());
  if (outcome.error === null)
    return openBotToolResult({
      status: "ready",
      server,
      toolCount: outcome.toolCount,
      tools: outcome.tools,
      ...(justSaved ? { appliesFrom: "the next turn of each agent" } : {}),
    });
  const error = servers.redact(outcome.error);
  if (outcome.needs === "sign_in") {
    yield* call.requestSignIn(saved);
    return openBotToolResult({
      status: "needs_sign_in",
      server,
      ...signInNeeded(servers, saved),
    });
  }
  if (outcome.needs === "key")
    return openBotToolResult({
      status: "needs_key",
      server,
      error,
      next: "When the user gave the key, call openbot.save_mcp_server again with it in headers, such as Authorization: Bearer <token>. Otherwise ask the user to enter the key with Edit on the server's page in Marketplace, Apps. Do not ask for the key in the chat or show it.",
    });
  return openBotToolResult({ status: "error", server, error });
});

function mergeServer(existing: McpServerConfig | undefined, input: z.infer<typeof saveMcpServerToolSchema>) {
  const base: McpServerConfig = existing ?? {
    id: "",
    name: input.name,
    transport: input.command ? "stdio" : "http",
    enabled: true,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
  };
  const transport = input.transport ?? (input.url ? "http" : input.command ? "stdio" : base.transport);
  return {
    ...base,
    transport,
    enabled: input.enabled ?? base.enabled,
    url: input.url ?? base.url,
    command: input.command ?? base.command,
    args: input.args ?? base.args,
    workingDirectory: input.workingDirectory ?? base.workingDirectory,
    headers: mergeHeaders(base.headers, input.headers),
  } satisfies McpServerConfig;
}

type HeaderInput = NonNullable<z.infer<typeof saveMcpServerToolSchema>["headers"]>;

const sameHeader = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase();

function registerHeaderSecrets(input: unknown): void {
  const raw = headerValuesArgument.safeParse(input);
  if (raw.success)
    registerSecretValues(raw.data.headers.filter(({ name }) => isSecretName(name)).map(({ value }) => value));
}

function unreplacedHeaders(saved: readonly McpKeyValue[], input: HeaderInput): McpKeyValue[] {
  return saved.filter((pair) => !input.some(({ name }) => sameHeader(name, pair.key)));
}

function mergeHeaders(saved: readonly McpKeyValue[], input: HeaderInput | undefined): McpKeyValue[] {
  if (!input) return [...saved];
  const latest = input.filter(
    (header, index) => !input.slice(index + 1).some(({ name }) => sameHeader(name, header.name)),
  );
  return [
    ...unreplacedHeaders(saved, input),
    ...latest.flatMap(({ name, value }) => (value ? [{ key: name, value }] : [])),
  ];
}

function headerNames(input: HeaderInput): string {
  return [...new Set(input.map(({ name }) => name))].join(", ");
}

function describeBuiltInServer(config: McpServerConfig) {
  return { name: config.name, transport: config.transport, enabled: true, builtIn: true };
}

function describeServer(config: McpServerConfig, signIns: readonly McpSignInState[]) {
  if (config.transport === "http") {
    const signIn = signIns.find((state) => state.mcpServerId === config.id);
    return {
      name: config.name,
      transport: config.transport,
      enabled: config.enabled,
      url: addressWithoutQuery(config.url),
      headerNames: config.headers.map(({ key }) => key),
      signedIn: signIn?.signedIn ?? false,
      ...(signIn?.needsSignIn ? { needsSignIn: true } : {}),
    };
  }
  return {
    name: config.name,
    transport: config.transport,
    enabled: config.enabled,
    command: config.command,
    argumentCount: config.args.length,
    ...(config.workingDirectory ? { workingDirectory: config.workingDirectory } : {}),
    environmentNames: [...config.env.map(({ key }) => key), ...config.envPassthrough],
  };
}

function holdsKeys(config: McpServerConfig): boolean {
  return config.headers.length > 0 || config.env.length > 0 || config.envPassthrough.length > 0;
}

function serverMoves(saved: McpServerConfig, next: McpServerConfig): boolean {
  if (saved.transport !== next.transport) return true;
  if (saved.transport === "stdio")
    return (
      saved.command !== next.command ||
      saved.workingDirectory !== next.workingDirectory ||
      saved.args.length !== next.args.length ||
      saved.args.some((arg, index) => arg !== next.args[index])
    );
  if (!URL.canParse(saved.url) || !URL.canParse(next.url)) return saved.url !== next.url;
  return new URL(saved.url).origin !== new URL(next.url).origin;
}

function serverTarget(config: McpServerConfig): string {
  if (config.transport === "http") return addressWithoutQuery(config.url);
  const line = [config.command, ...config.args].join(" ");
  return line.length > 500 ? `${line.slice(0, 499)}…` : line;
}

function addressWithoutQuery(url: string): string {
  if (!URL.canParse(url)) return url;
  const address = new URL(url);
  return `${address.origin}${address.pathname}`;
}
