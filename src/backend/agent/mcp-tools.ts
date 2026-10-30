import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  MCP_TRANSPORTS,
  type McpServerConfig,
  type McpSignInState,
  mcpConfigErrors,
  normalizeMcpConfig,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { z } from "zod";
import type { McpProbeOutcome } from "../mcp-probe";
import type { McpGateway, McpGatewayFailed } from "./mcp-gateway";
import { profileToolErrorMessage } from "./profile-tools";
import { type OpenBotToolResponse, openBotToolFailure, openBotToolResult } from "./routine-tools";
import { ToolOperationFailed, toolStep } from "./tool-operation";

/**
 * The MCP tools: an agent adds, changes, tests, turns on or off, and removes the MCP servers of its
 * OpenBot server when the user asks. A server applies to every agent there, so each change waits
 * for the user's approval as other tools do, and an agent with Full access is answered for.
 *
 * No value of a header or of the environment goes in or out: a key stays in Server settings, where
 * the user enters it. A sign-in is handed to the user with a card in the conversation.
 */

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
  enabled: z.boolean().optional().describe("A new server is on unless this is false."),
});

const namedServerSchema = z.strictObject({ name: serverName });
const setEnabledSchema = z.strictObject({ name: serverName, enabled: z.boolean() });

const MCP_SCOPE = "Every agent on this OpenBot server gets the tools of an enabled MCP server.";
const MCP_APPROVAL =
  "The user's request is the permission: call the tool without asking first. OpenBot asks the user to approve when your access needs it.";

export const MCP_SERVER_TOOL_DEFINITIONS = [
  {
    name: "list_mcp_servers",
    description: `List the MCP servers of this OpenBot server: name, transport, on or off, address or command, the names of its headers and environment variables, and whether it is signed in. Values are never shown. ${MCP_SCOPE} Read-only.`,
    shape: {},
  },
  {
    name: "save_mcp_server",
    description: `Add an MCP server, or change one by its name, only when the user asks for it. ${MCP_SCOPE} ${MCP_APPROVAL} Then OpenBot connects to the server and saves it when it answers or needs only a sign-in or a key. The result is ready with its tools, needs_sign_in (a Sign in card is in the conversation: wait for the user), needs_key (the user enters the key in Server settings, MCP; never ask for a key in the chat), or the error. Headers and environment values are not set here: a stdio server that cannot start without a key in its environment is added by the user in Server settings, MCP. A server that holds keys keeps its transport, address origin, command, arguments and folder. New tools reach the agents from their next turn.`,
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

/** The MCP servers of this OpenBot server, as the agent service holds them. */
export interface AgentMcpServers {
  list(): McpServerConfig[];
  signIns(): McpSignInState[];
  save(config: McpServerConfig): Effect.Effect<unknown, ToolOperationFailed>;
  setEnabled(mcpServerId: string, enabled: boolean): Effect.Effect<unknown, ToolOperationFailed>;
  remove(mcpServerId: string): Effect.Effect<unknown, ToolOperationFailed>;
  /** A silent test: stored sign-ins only, never a browser. */
  inspect(config: McpServerConfig): Effect.Effect<McpProbeOutcome, ToolOperationFailed>;
  /** Masks the MCP secret values in a text that goes back to the agent. */
  redact(text: string): string;
}

/**
 * The gateway as the MCP tools reach it. A failure keeps its cause, which says what to correct.
 * `prepareTest` is what a test waits for first, as the Test button does: the managed tool runtimes.
 */
export function mcpServersFromGateway(
  gateway: McpGateway,
  prepareTest?: (config: McpServerConfig) => Effect.Effect<void, unknown>,
): AgentMcpServers {
  const toToolFailure = Effect.mapError(
    (failure: McpGatewayFailed) => new ToolOperationFailed({ cause: failure.cause }),
  );
  return {
    list: () => gateway.list(),
    signIns: () => gateway.signIns(),
    save: (config) => gateway.save({ config }).pipe(toToolFailure),
    setEnabled: (mcpServerId, enabled) => gateway.setEnabled({ mcpServerId, enabled }).pipe(toToolFailure),
    remove: (mcpServerId) => gateway.remove({ mcpServerId }).pipe(toToolFailure),
    inspect: (config) =>
      (prepareTest?.(config) ?? Effect.void).pipe(
        Effect.mapError((cause) => new ToolOperationFailed({ cause })),
        Effect.andThen(gateway.inspect(config).pipe(toToolFailure)),
      ),
    redact: (text) => gateway.redact(text),
  };
}

export interface McpServerToolCall {
  tool: McpServerToolName;
  arguments: unknown;
  /**
   * Asks the user to approve the change that `reason` states. `cwd` is the folder a stdio server
   * starts in, when it names one. True when it is approved.
   */
  approve(reason: string, cwd?: string | null): Effect.Effect<boolean, ToolOperationFailed>;
  /** Shows the user the card that signs in to a saved http server. */
  requestSignIn(config: McpServerConfig): Effect.Effect<void, ToolOperationFailed>;
}

/**
 * Runs one MCP tool. A failure is a result the agent can correct, such as a name in use or an
 * argument out of range, with the MCP secrets masked.
 */
export const handleMcpServerTool = (servers: AgentMcpServers, call: McpServerToolCall) => {
  const failed = (error: unknown) => Effect.succeed(openBotToolFailure(servers.redact(profileToolErrorMessage(error))));
  return runMcpServerTool(servers, call).pipe(
    Effect.catch((failure) => failed(failure.cause)),
    Effect.catchDefect(failed),
  );
};

const runMcpServerTool = Effect.fn("McpServerTools.handle")(function* (
  servers: AgentMcpServers,
  call: McpServerToolCall,
) {
  switch (call.tool) {
    case "list_mcp_servers": {
      const signIns = servers.signIns();
      return openBotToolResult({ servers: servers.list().map((config) => describeServer(config, signIns)) });
    }
    case "test_mcp_server": {
      const { name } = yield* toolStep(() => namedServerSchema.parse(call.arguments));
      const config = yield* findServer(servers, name);
      return yield* report(servers, call, config, yield* servers.inspect(config), false);
    }
    case "save_mcp_server": {
      const input = yield* toolStep(() => saveMcpServerToolSchema.parse(call.arguments));
      const existing = servers.list().find((config) => config.name === input.name);
      const config = normalizeMcpConfig(mergeServer(existing, input));
      // A configuration the store would refuse is corrected before the user is asked about it.
      const errors = mcpConfigErrors(config);
      const invalid = errors.name ?? errors.command ?? errors.url;
      if (invalid) return openBotToolFailure(invalid);
      // The keys of a row were given for its server. A change that points them at another server, or
      // that drops them with the other transport, is the user's to make in Server settings.
      if (existing && holdsKeys(existing) && serverMoves(existing, config))
        return openBotToolFailure(sourceText("error.agent.mcpServerKeysMove", { name: existing.name }));
      const key = existing ? "status.agent.mcpServerChange" : "status.agent.mcpServerAdd";
      // The command line can quote a key the user typed: the reason also reaches Slack and the phone.
      const reason = servers.redact(sourceText(key, { name: config.name, target: serverTarget(config) }));
      if (!(yield* call.approve(reason, config.transport === "stdio" ? config.workingDirectory || null : null)))
        return openBotToolFailure(sourceText("error.agent.mcpServerDeclined"));
      // A server that does not answer is not saved, so no agent is given a broken entry. A server that
      // needs a sign-in or a key is saved: the sign-in and the key belong to a saved row.
      const outcome = yield* servers.inspect(config);
      if (outcome.error !== null && outcome.needs === null)
        return openBotToolFailure(
          servers.redact(sourceText("error.agent.mcpServerNotSaved", { error: outcome.error })),
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
  return config
    ? Effect.succeed(config)
    : Effect.fail(new ToolOperationFailed({ cause: new Error(sourceText("error.agent.mcpServerUnknown", { name })) }));
};

const SIGN_IN_NEXT =
  "A Sign in card is in this conversation. Tell the user, end your turn, and test again when the user says it is done.";

/**
 * A silent test of each saved http server that a tool search names and that has no sign-in on this
 * computer. A provider that reaches such a server tries its own sign-in and fails, so the search is
 * where the agent looks for its tools. A server that needs a sign-in gets its card; others are left out.
 */
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
  // Each probe can wait for its whole deadline, so the search waits for the slowest server only.
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
          next: `When the user's request needs this server: ${SIGN_IN_NEXT}`,
        };
      }),
    { concurrency: "unbounded" },
  );
  return found.filter((entry) => entry !== null);
});

/** What a test found, in words the agent acts on. A sign-in also puts its card in the conversation. */
const report = Effect.fnUntraced(function* (
  servers: AgentMcpServers,
  call: McpServerToolCall,
  config: McpServerConfig,
  outcome: McpProbeOutcome,
  /** The server was just saved, so the agents get it from their next turn. */
  justSaved: boolean,
): Effect.fn.Return<OpenBotToolResponse, ToolOperationFailed> {
  // By name: a new row has its id only once it is saved.
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
      next: SIGN_IN_NEXT,
    });
  }
  if (outcome.needs === "key")
    return openBotToolResult({
      status: "needs_key",
      server,
      error,
      next: "Ask the user to enter the key in Server settings, MCP. Do not ask for the key in the chat.",
    });
  return openBotToolResult({ status: "error", server, error });
});

/** A new server from the input, or the saved one with the input over it. Headers and environment stay. */
function mergeServer(existing: McpServerConfig | undefined, input: z.infer<typeof saveMcpServerToolSchema>) {
  // A new row carries an empty id: the store gives it one.
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
  // An address or a command alone says which transport the agent means.
  const transport = input.transport ?? (input.url ? "http" : input.command ? "stdio" : base.transport);
  return {
    ...base,
    transport,
    enabled: input.enabled ?? base.enabled,
    url: input.url ?? base.url,
    command: input.command ?? base.command,
    args: input.args ?? base.args,
    workingDirectory: input.workingDirectory ?? base.workingDirectory,
  } satisfies McpServerConfig;
}

/**
 * One server without a secret: an address without its query, which can hold a key, and a command
 * without its arguments. Headers and variables by name only.
 */
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

/**
 * Whether the change gives the row's keys to another server: another transport, origin, or program.
 * For stdio the arguments and the folder choose the program too, as `npx -y <package>` does.
 */
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

/** What the approval names: the address without its query, or the whole command line the server runs. */
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
