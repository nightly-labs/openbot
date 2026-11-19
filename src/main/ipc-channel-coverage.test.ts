// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { IPC_ENDPOINTS, type IpcEndpoint, type IpcEndpointGroup } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

const MAIN_SEND_CALLEES = ["sendToRenderer"];
const PRELOAD_INVOKE_CALLEES = ["ipcRenderer.invoke", "invokeAgentForServer"];
const PRELOAD_SUBSCRIBE_CALLEES = ["ipcRenderer.on", "ipcRenderer.once", "listen"];
const PRELOAD_UNSUBSCRIBE_CALLEES = ["ipcRenderer.removeListener", "ipcRenderer.off"];
const PRELOAD_GROUP_CALLEES = ["bridgeGroup"];

const requestChannels = channelsOfKind("request");
const eventChannels = channelsOfKind("event");

const CHANNEL_AFTER_RECIPIENT = ["sendToRenderer", "invokeAgentForServer"];

const CHANNEL_ARGUMENT_POSITION: ReadonlyMap<string, number> = new Map(
  [
    ...MAIN_SEND_CALLEES,
    ...PRELOAD_INVOKE_CALLEES,
    ...PRELOAD_SUBSCRIBE_CALLEES,
    ...PRELOAD_UNSUBSCRIBE_CALLEES,
    ...PRELOAD_GROUP_CALLEES,
  ].map((callee): readonly [string, number] => [callee, CHANNEL_AFTER_RECIPIENT.includes(callee) ? 1 : 0]),
);

const PRELOAD_ONLY_CALLEES = ["listen", ...PRELOAD_GROUP_CALLEES];

const ENDPOINT_REFERENCE = /^IPC_ENDPOINTS\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)(?:\.channel)?$/;

const GROUP_REFERENCE = /^IPC_ENDPOINTS\.([A-Za-z0-9_]+)$/;

const sources = new Map<string, string>();

const mainSources = sourceFilesUnder("src/main");

const WEBRTC_PRELOAD_MODULE = "src/preload/team-webrtc.ts";
const preloadSources = sourceFilesUnder("src/preload").filter((file) => file !== WEBRTC_PRELOAD_MODULE);

const TRUSTED_IPC_MODULE = "src/main/trusted-ipc.ts";

const BINDER_MODULE = "src/main/ipc/define-ipc-group.ts";

const TRUSTED_WRAPPERS = /\bhandleTrusted(?:WithEvent)?\b/;

const WRAPPER_CHANNEL_PARAMETER = "channel";

const SENDER_CHECK = "isTrustedRendererUrl";

const TWIN_DECODER_FLOOR = 8;

const TWIN_ALIAS_FIXTURE = `
const decodeAliasedFromMain = decodeAliasedFromHost;
const decodeAnnotatedFromMain: Decoder<Alias> = shared.decodeAliasedFromHost as Decoder<Alias>;
const decodeSignedFromMain: (value: unknown) => Alias = decodeAliasedFromHost;
const decodeBuiltFromHost = guardedDecoder(isBuilt, "built");
const decodeInlineFromHost = (value: unknown) => (isInline(value) ? value : null);
function decodeWrittenFromMain(value: unknown): Written | null {
  return isWritten(value) ? value : null;
}
`;

const FORWARDED_CHANNEL_ARGUMENTS: readonly string[] = [
  "src/preload/index.ts: ipcRenderer.invoke(endpoint.channel)",
  "src/preload/index.ts: ipcRenderer.on(endpoint.channel)",
  "src/preload/index.ts: ipcRenderer.removeListener(endpoint.channel)",
  "src/preload/index.ts: listen(endpoint)",
];

const mainCalls = collectCalls(mainSources, PRELOAD_ONLY_CALLEES);
const preloadCalls = collectCalls(preloadSources, []);

const sent = channelsCalledBy(mainCalls, MAIN_SEND_CALLEES);
const bridgedGroups = groupsCalledBy(preloadCalls, PRELOAD_GROUP_CALLEES);
const invoked = union(channelsCalledBy(preloadCalls, PRELOAD_INVOKE_CALLEES), endpointsOf(bridgedGroups, "request"));
const subscribed = union(
  channelsCalledBy(preloadCalls, PRELOAD_SUBSCRIBE_CALLEES),
  endpointsOf(bridgedGroups, "event"),
);
const unsubscribed = channelsCalledBy(preloadCalls, PRELOAD_UNSUBSCRIBE_CALLEES);

describe("IPC channel coverage", () => {
  it("names every endpoint through a direct IPC_ENDPOINTS reference", () => {
    const opaque = [...mainCalls, ...preloadCalls]
      .filter((call) =>
        PRELOAD_GROUP_CALLEES.includes(call.callee) ? groupOf(call) === null : !ENDPOINT_REFERENCE.test(call.argument),
      )
      .map((call) => `${call.file}: ${call.callee}(${call.argument})`)
      .filter((site) => !FORWARDED_CHANNEL_ARGUMENTS.includes(site))
      .sort();

    expect(opaque).toEqual([]);
  });

  it("reads every endpoint reference as the endpoint argument of a known call", () => {
    const stray = [
      ...strayReferences(mainSources, mainCalls),
      ...strayReferences(preloadSources, preloadCalls),
      ...strayGroupReferences(preloadSources, preloadCalls),
    ];

    expect(stray).toEqual([]);
  });

  it("bridges a group whole or not at all", () => {
    const bridged = preloadCalls.map(groupOf).filter((group) => group !== null);
    const twice = bridged.filter((group, index) => bridged.indexOf(group) !== index);
    const mixed = preloadCalls
      .filter((call) => !PRELOAD_GROUP_CALLEES.includes(call.callee))
      .map(channelOf)
      .filter((channel) => channel !== null && bridgedGroups.includes(channel.slice(0, channel.indexOf("."))));

    expect(twice).toEqual([]);
    expect(mixed).toEqual([]);
  });

  it("invokes exactly the request endpoints from the preload", () => {
    expect(invoked).toEqual(requestChannels);
  });

  it("subscribes to exactly the event endpoints from the preload", () => {
    expect(subscribed).toEqual(eventChannels);
  });

  it("sends exactly the event endpoints from the main process", () => {
    expect(sent).toEqual(eventChannels);
  });

  it("gives every endpoint its own wire value", () => {
    const declarations = new Map<string, string[]>();
    for (const [group, endpoints] of Object.entries<IpcEndpointGroup>(IPC_ENDPOINTS)) {
      for (const [name, endpoint] of Object.entries<IpcEndpoint>(endpoints)) {
        declarations.set(endpoint.channel, [...(declarations.get(endpoint.channel) ?? []), `${group}.${name}`]);
      }
    }

    const shared = [...declarations]
      .filter(([, sites]) => sites.length > 1)
      .map(([channel, sites]) => `${channel}: ${sites.join(", ")}`)
      .sort();

    expect(shared).toEqual([]);
  });

  it("registers handlers only through the trusted wrappers", () => {
    const raw = mainSources
      .filter((file) => file !== TRUSTED_IPC_MODULE)
      .flatMap((file) => [...readSource(file).matchAll(/\bipcMain\b/g)].map(() => `${file} names ipcMain`))
      .sort();

    expect(raw).toEqual([]);
  });

  it("calls the trusted wrappers only from the endpoint binder", () => {
    expect(TRUSTED_WRAPPERS.test(readSource(BINDER_MODULE))).toBe(true);

    const callers = mainSources
      .filter((file) => file !== BINDER_MODULE && file !== TRUSTED_IPC_MODULE)
      .filter((file) => TRUSTED_WRAPPERS.test(readSource(file)))
      .map((file) => `${file} names a trusted wrapper`)
      .sort();

    expect(callers).toEqual([]);
  });

  it("validates the sender of every channel it is handed inside the trusted module", () => {
    const source = readSource(TRUSTED_IPC_MODULE);
    const unguarded: string[] = [];
    for (const match of source.matchAll(/\bipcMain\.([A-Za-z0-9_]+)\s*\(/g)) {
      const start = match.index + match[0].length;
      const channel = argumentAt(source, start, 0)?.argument ?? "(unreadable)";
      if (channel !== WRAPPER_CHANNEL_PARAMETER) unguarded.push(`${match[1]} registers ${channel}`);
      else if (!callArguments(source, start).includes(SENDER_CHECK)) {
        unguarded.push(`${match[1]}(${channel}) runs its handler without ${SENDER_CHECK}`);
      }
    }

    expect(unguarded).toEqual([]);
  });

  it("only removes listeners for channels the preload subscribes to", () => {
    expect(unsubscribed.filter((channel) => !subscribed.includes(channel))).toEqual([]);
  });

  it("declares no type predicate of its own in the preload", () => {
    const declared = preloadSources
      .flatMap((file) => [...readSource(file).matchAll(/^(?:export )?function (\w+)\([^)]*\):\s*[\w.<>[\]|" ]+ is /gm)])
      .map((match) => match[1])
      .sort();

    expect(declared).toEqual([]);
  });

  it("gives every FromHost decoder a FromMain twin, and the reverse", () => {
    const host = twinDecoders(mainSources, "Host");
    const main = twinDecoders(preloadSources, "Main");

    expect(host.length).toBeGreaterThanOrEqual(TWIN_DECODER_FLOOR);
    expect(host).toEqual(main);
  });

  it("declares each twin decoder rather than aliasing the other", () => {
    expect(aliasedTwinsIn(TWIN_ALIAS_FIXTURE)).toEqual([
      "decodeAliasedFromMain",
      "decodeAnnotatedFromMain",
      "decodeSignedFromMain",
    ]);

    expect(aliasedTwins([...mainSources, ...preloadSources])).toEqual([]);
  });
});

interface ChannelCall {
  readonly file: string;
  readonly callee: string;
  readonly argument: string;
  readonly start: number;
  readonly end: number;
}

function sourceFilesUnder(directory: string): readonly string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(repositoryRoot, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...sourceFilesUnder(path));
    else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) files.push(path);
  }
  return files;
}

function channelsOfKind(kind: IpcEndpoint["kind"]): readonly string[] {
  const ids: string[] = [];
  for (const [group, endpoints] of Object.entries<IpcEndpointGroup>(IPC_ENDPOINTS)) {
    for (const [name, endpoint] of Object.entries<IpcEndpoint>(endpoints)) {
      if (endpoint.kind === kind) ids.push(`${group}.${name}`);
    }
  }
  return ids.sort();
}

function twinDecoders(files: readonly string[], side: "Host" | "Main"): readonly string[] {
  const declaration = new RegExp(`(?:function|const)\\s+(decode[A-Za-z0-9_]*)From${side}\\b`, "g");
  const names = new Set<string>();
  for (const file of files) {
    for (const match of readSource(file).matchAll(declaration)) {
      const name = match[1];
      if (name !== undefined) names.add(name);
    }
  }
  return [...names].sort();
}

const TWIN_ASSIGNMENT = /const\s+(decode[A-Za-z0-9_]*From(?:Host|Main))\s*(?::(?:[^=;]|=>)+)?=\s*([^;]+);/g;
const BARE_REFERENCE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\s+as\s+[\w$.<>[\], |]+)?$/;

function aliasedTwinsIn(source: string): readonly string[] {
  const aliases: string[] = [];
  for (const match of source.matchAll(TWIN_ASSIGNMENT)) {
    const [, name, initializer] = match;
    if (name !== undefined && initializer !== undefined && BARE_REFERENCE.test(initializer.trim())) aliases.push(name);
  }
  return aliases;
}

function aliasedTwins(files: readonly string[]): readonly string[] {
  return files.flatMap((file) => aliasedTwinsIn(readSource(file)).map((name) => `${file} aliases ${name}`));
}

function readSource(file: string): string {
  const cached = sources.get(file);
  if (cached !== undefined) return cached;
  const source = withoutCommentsAndLiterals(readFileSync(join(repositoryRoot, file), "utf8"));
  sources.set(file, source);
  return source;
}

function collectCalls(files: readonly string[], skipped: readonly string[]): readonly ChannelCall[] {
  const calls: ChannelCall[] = [];
  for (const file of files) {
    const source = readSource(file);
    for (const [callee, position] of CHANNEL_ARGUMENT_POSITION) {
      if (skipped.includes(callee)) continue;
      const pattern = new RegExp(`(?:(?<![A-Za-z0-9_$.])|(?<=\\.\\.\\.))${callee.replaceAll(".", "\\.")}\\s*\\(`, "g");
      for (const match of source.matchAll(pattern)) {
        if (/\bfunction\s*$/.test(source.slice(Math.max(0, match.index - 20), match.index))) continue;
        const span = argumentAt(source, match.index + match[0].length, position);
        if (span !== null) calls.push({ file, callee, ...span });
      }
    }
  }
  return calls;
}

function argumentAt(
  source: string,
  start: number,
  position: number,
): { readonly argument: string; readonly start: number; readonly end: number } | null {
  let depth = 0;
  let index = start;
  let argumentStart = start;
  let remaining = position;
  while (index < source.length) {
    const character = source[index];
    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" && depth === 0) break;
    else if (character === ")" || character === "]" || character === "}") depth -= 1;
    else if (character === "," && depth === 0) {
      if (remaining === 0) break;
      remaining -= 1;
      argumentStart = index + 1;
    }
    index += 1;
  }
  if (remaining !== 0) return null;
  return { argument: source.slice(argumentStart, index).trim(), start: argumentStart, end: index };
}

function callArguments(source: string, start: number): string {
  let depth = 0;
  let index = start;
  while (index < source.length) {
    const character = source[index];
    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" && depth === 0) break;
    else if (character === ")" || character === "]" || character === "}") depth -= 1;
    index += 1;
  }
  return source.slice(start, index);
}

function channelOf(call: ChannelCall): string | null {
  const match = ENDPOINT_REFERENCE.exec(call.argument);
  return match ? `${match[1]}.${match[2]}` : null;
}

function groupOf(call: ChannelCall): string | null {
  if (!PRELOAD_GROUP_CALLEES.includes(call.callee)) return null;
  const group = GROUP_REFERENCE.exec(call.argument)?.[1];
  return group !== undefined && Object.hasOwn(IPC_ENDPOINTS, group) ? group : null;
}

function groupsCalledBy(calls: readonly ChannelCall[], callees: readonly string[]): readonly string[] {
  const groups = new Set<string>();
  for (const call of calls) {
    const group = callees.includes(call.callee) ? groupOf(call) : null;
    if (group !== null) groups.add(group);
  }
  return [...groups].sort();
}

function endpointsOf(groups: readonly string[], kind: IpcEndpoint["kind"]): readonly string[] {
  return channelsOfKind(kind).filter((channel) => groups.includes(channel.slice(0, channel.indexOf("."))));
}

function union(first: readonly string[], second: readonly string[]): readonly string[] {
  return [...new Set([...first, ...second])].sort();
}

function channelsCalledBy(calls: readonly ChannelCall[], callees: readonly string[]): readonly string[] {
  const channels = new Set<string>();
  for (const call of calls) {
    if (!callees.includes(call.callee)) continue;
    const channel = channelOf(call);
    if (channel !== null) channels.add(channel);
  }
  return [...channels].sort();
}

function strayReferences(files: readonly string[], calls: readonly ChannelCall[]): readonly string[] {
  const stray: string[] = [];
  for (const file of files) {
    const source = readSource(file);
    const spans = calls.filter((call) => call.file === file);
    for (const match of source.matchAll(/IPC_ENDPOINTS\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+/g)) {
      const read = spans.some((span) => span.start <= match.index && match.index < span.end);
      if (!read) stray.push(`${file}: ${match[0]}`);
    }
  }
  return stray.sort();
}

function strayGroupReferences(files: readonly string[], calls: readonly ChannelCall[]): readonly string[] {
  const stray: string[] = [];
  for (const file of files) {
    const source = readSource(file);
    const spans = calls.filter((call) => call.file === file && PRELOAD_GROUP_CALLEES.includes(call.callee));
    for (const match of source.matchAll(/IPC_ENDPOINTS\.[A-Za-z0-9_]+(?![A-Za-z0-9_.])/g)) {
      const read = spans.some((span) => span.start <= match.index && match.index < span.end);
      if (!read) stray.push(`${file}: ${match[0]}`);
    }
  }
  return stray.sort();
}

function withoutCommentsAndLiterals(source: string): string {
  const characters = [...source];
  let index = 0;

  const blankUntil = (isEnd: (position: number) => boolean, escapes: boolean): void => {
    while (index < characters.length && !isEnd(index)) {
      if (escapes && characters[index] === "\\") {
        characters[index] = " ";
        index += 1;
      }
      if (index < characters.length && characters[index] !== "\n") characters[index] = " ";
      index += 1;
    }
  };

  while (index < characters.length) {
    const character = characters[index];
    const next = characters[index + 1];

    if (character === "/" && next === "/") {
      index += 2;
      blankUntil((position) => characters[position] === "\n", false);
      continue;
    }
    if (character === "/" && next === "*") {
      characters[index] = " ";
      characters[index + 1] = " ";
      index += 2;
      blankUntil((position) => characters[position] === "*" && characters[position + 1] === "/", false);
      if (index < characters.length) {
        characters[index] = " ";
        characters[index + 1] = " ";
        index += 2;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      index += 1;
      blankUntil((position) => characters[position] === character, true);
      index += 1;
      continue;
    }
    if (character === "/" && startsRegularExpression(characters, index)) {
      index += 1;
      blankUntil((position) => characters[position] === "/", true);
      index += 1;
      continue;
    }
    index += 1;
  }

  return characters.join("");
}

function startsRegularExpression(characters: readonly string[], index: number): boolean {
  let position = index - 1;
  while (position >= 0 && /\s/.test(characters[position] ?? "")) position -= 1;
  const previous = characters[position];
  return previous === undefined || "(,=:[!&|?{};+-*%~^".includes(previous);
}
