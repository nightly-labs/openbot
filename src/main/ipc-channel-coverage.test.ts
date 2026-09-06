// @vitest-environment node

// What is left of the channel mirrors once the type checker owns the rest.
//
// The main process no longer names a channel to register one: `registerIpcGroups` in
// src/main/ipc/define-ipc-group.ts takes an object keyed by every group and every request
// endpoint IPC_ENDPOINTS declares, so a missing handler, a stray handler and an unregistered
// group are all compile errors that name what is wrong. The tests that scanned src/main for
// `handleTrusted` calls and for a registrar the dispatcher forgot are gone with them.
//
// Three links have no type to carry them, and they are what is left here:
//
//   - the preload invokes and subscribes by channel, and its API object is shaped for the
//     renderer rather than for IPC_ENDPOINTS, so nothing pairs a method with an endpoint;
//   - an event is sent from wherever it happens, by any number of call sites, so "every event
//     channel has a sender" is a property of the source and not of a type;
//   - the sender check, the rule that keeps every registration behind it, and the rule that
//     keeps the wrappers themselves reachable only from the binder.
//
// Verification is static because neither side can be imported: src/main/index.ts calls
// app.setPath, app.enableSandbox and protocol.registerSchemesAsPrivileged at module scope and
// does not export its registrations, and src/preload/index.ts calls contextBridge.exposeInMainWorld
// at module scope and exports nothing. Reading the sources is safe here because a channel name is
// never written as a literal on either side - every reference goes through IPC_CHANNELS. Two tests
// below keep that true rather than assumed: one reads the channel argument of every known call and
// rejects anything but a direct IPC_CHANNELS reference, so a string or a variable cannot slip an
// endpoint past the scan, and one rejects an IPC_CHANNELS reference no known call reads.

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { IPC_CHANNELS, IPC_ENDPOINTS, type IpcEndpoint, type IpcEndpointGroup } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

// The channel is the first argument to each of these, except sendToRenderer,
// where it follows the target window. What comes after the channel varies, and
// the scan reads only the channel position, so it does not care.
const MAIN_SEND_CALLEES = ["sendToRenderer"];
const PRELOAD_INVOKE_CALLEES = ["ipcRenderer.invoke", "invokeAgent", "invokeAgentForServer"];
const PRELOAD_SUBSCRIBE_CALLEES = ["ipcRenderer.on", "ipcRenderer.once"];
const PRELOAD_UNSUBSCRIBE_CALLEES = ["ipcRenderer.removeListener", "ipcRenderer.off"];

// IPC_ENDPOINTS says which kind each channel is; the scans below produce IPC_CHANNELS keys, so
// the wire values come back through this to compare against them.
const channelKeys = new Map(
  Object.entries(IPC_CHANNELS).map(([key, value]): readonly [string, string] => [value, key]),
);

const requestChannels = channelsOfKind("request");
const eventChannels = channelsOfKind("event");

// Two of the calls address a recipient before the channel: sendToRenderer takes
// the target window, invokeAgentForServer the server id.
const CHANNEL_AFTER_RECIPIENT = ["sendToRenderer", "invokeAgentForServer"];

// Every call shape the scan knows, with the position its channel argument sits in.
const CHANNEL_ARGUMENT_POSITION: ReadonlyMap<string, number> = new Map(
  [...MAIN_SEND_CALLEES, ...PRELOAD_INVOKE_CALLEES, ...PRELOAD_SUBSCRIBE_CALLEES, ...PRELOAD_UNSUBSCRIBE_CALLEES].map(
    (callee): readonly [string, number] => [callee, CHANNEL_AFTER_RECIPIENT.includes(callee) ? 1 : 0],
  ),
);

const CHANNEL_REFERENCE = /^IPC_CHANNELS\.([A-Za-z0-9_]+)$/;

const sources = new Map<string, string>();

const mainSources = sourceFilesUnder("src/main");
const PRELOAD_MODULE = "src/preload/index.ts";
const preloadSources = [PRELOAD_MODULE];

// The one module allowed to touch ipcMain, because it is the sender check.
const TRUSTED_IPC_MODULE = "src/main/trusted-ipc.ts";

// The one module allowed to name the wrappers, because it is the only one that reads a channel out
// of the manifest to hand them.
const BINDER_MODULE = "src/main/ipc/define-ipc-group.ts";

// The wrappers by name. The scan reads names rather than the import path because readSource strips
// string literals, and a name has to appear to be imported, called, or aliased at all.
const TRUSTED_WRAPPERS = /\bhandleTrusted(?:WithEvent)?\b/;

// The parameter both wrappers take and pass straight to ipcMain.
const WRAPPER_CHANNEL_PARAMETER = "channel";

// The call that makes a registration a trusted one.
const SENDER_CHECK = "isTrustedRendererUrl";

// How many twin decoders the pair currently has. The comparison below is between
// two sets, so a regex that stopped matching would leave both empty and green;
// this is the floor that makes that failure loud instead.
const TWIN_DECODER_FLOOR = 8;

// Every twin in the tree is a `function` today, so the alias check below matches
// nothing and would stay green even if its pattern stopped working. This is that
// check's fixture: each line it must reject beside a correct one it must leave
// alone, the way a rule under `tools/biome/anti-slop/rules` carries one.
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

// The preload's agent helpers take the channel as a parameter and pass it on,
// so the forwarding call names a variable by design. Their own call sites carry
// the IPC_CHANNELS reference and are what the scan checks, which is why the
// helpers are listed as callees above.
const FORWARDED_CHANNEL_ARGUMENTS: readonly string[] = [
  "src/preload/index.ts: invokeAgentForServer(channel)",
  "src/preload/index.ts: ipcRenderer.invoke(channel)",
];

const mainCalls = collectCalls(mainSources);
const preloadCalls = collectCalls(preloadSources);

const sent = channelsCalledBy(mainCalls, MAIN_SEND_CALLEES);
const invoked = channelsCalledBy(preloadCalls, PRELOAD_INVOKE_CALLEES);
const subscribed = channelsCalledBy(preloadCalls, PRELOAD_SUBSCRIBE_CALLEES);
const unsubscribed = channelsCalledBy(preloadCalls, PRELOAD_UNSUBSCRIBE_CALLEES);

describe("IPC channel coverage", () => {
  // Every assertion below is only as complete as the scan, so these two run
  // first. This one reads each known call's channel argument and demands a
  // direct IPC_CHANNELS reference: a string names a channel the contract never
  // declared, and a variable hides the wire endpoint from the scan entirely.
  // Either way the call would contribute nothing to the sets compared below
  // while sitting on the trust boundary, so it fails here instead.
  it("names every channel through a direct IPC_CHANNELS reference", () => {
    const opaque = [...mainCalls, ...preloadCalls]
      .filter((call) => !CHANNEL_REFERENCE.test(call.argument))
      .map((call) => `${call.file}: ${call.callee}(${call.argument})`)
      .filter((site) => !FORWARDED_CHANNEL_ARGUMENTS.includes(site))
      .sort();

    expect(opaque).toEqual([]);
  });

  // The other half: a reference the scan does not read as a channel argument.
  // A new helper wrapping IPC_CHANNELS, or a reference sitting in a handler
  // body, would otherwise quietly shrink the compared sets rather than fail.
  it("reads every IPC_CHANNELS reference as the channel argument of a known call", () => {
    const stray = [...strayReferences(mainSources, mainCalls), ...strayReferences(preloadSources, preloadCalls)];

    expect(stray).toEqual([]);
  });

  // The main side of these three is now the type checker's: `registerIpcGroups` cannot compile
  // unless every request endpoint has exactly one handler behind it. What no type reaches is the
  // preload, whose API object is shaped for the renderer, and the event senders, which are
  // ordinary calls scattered wherever the event happens.
  it("invokes exactly the request endpoints from the preload", () => {
    expect(invoked).toEqual(requestChannels);
  });

  it("subscribes to exactly the event endpoints from the preload", () => {
    expect(subscribed).toEqual(eventChannels);
  });

  it("sends exactly the event endpoints from the main process", () => {
    expect(sent).toEqual(eventChannels);
  });

  // ipcMain.handle throws on a second registration for the same channel, and `registerIpcGroups`
  // walks every group, so one channel named by two groups - or twice inside one - crashes the app
  // on every launch. The type-level coverage assertion in packages/contracts compares sets and so
  // says nothing about it; this does. It reads the manifest rather than the sources, because after
  // the migration the manifest is the only place a registration is named.
  it("declares each channel in exactly one endpoint group", () => {
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

  // Everything above compares IPC_CHANNELS keys, but Electron sees the values.
  // Two keys carrying one wire string satisfy the exactly-once assertion, since
  // the keys differ, and still register two handlers for the same channel.
  it("gives every declared channel its own wire value", () => {
    const wireValues = new Map<string, string[]>();
    for (const [key, value] of Object.entries(IPC_CHANNELS)) {
      wireValues.set(value, [...(wireValues.get(value) ?? []), key]);
    }

    const shared = [...wireValues]
      .filter(([, keys]) => keys.length > 1)
      .map(([value, keys]) => `${value}: ${keys.join(", ")}`)
      .sort();

    expect(shared).toEqual([]);
  });

  // The scan reads the wrappers, and the wrappers are also what enforces sender
  // validation: handleTrusted rejects a request whose frame is not a trusted
  // renderer URL. A bare ipcMain.handle elsewhere in the main process is both an
  // endpoint this file cannot see and one with no sender check at all, so the
  // registration primitive stays where its wrapper lives.
  it("registers handlers only through the trusted wrappers", () => {
    // The name, not the call: an `import { ipcMain as rawIpc }` elsewhere would
    // register through a spelling no scan of `ipcMain.` can see, and the binding
    // has to be named to be aliased.
    const raw = mainSources
      .filter((file) => file !== TRUSTED_IPC_MODULE)
      .flatMap((file) => [...readSource(file).matchAll(/\bipcMain\b/g)].map(() => `${file} names ipcMain`))
      .sort();

    expect(raw).toEqual([]);
  });

  // The wrappers take a `string` channel, because ipcMain does. That is the last way a privileged
  // handler can exist outside IPC_ENDPOINTS: `handleTrusted("undeclared:channel", …)` compiles, gets
  // the sender check, and belongs to no group, so neither the coverage assertion in
  // packages/contracts nor anything above notices it. Keeping the call site in one module is what
  // closes it - `registerIpcGroup` and `registerIpcGroups` are both handed a group name and read the
  // channel out of the manifest, so a channel the manifest does not declare has no way in.
  it("calls the trusted wrappers only from the endpoint binder", () => {
    // The list below is empty when the rule holds and empty when the pattern stops matching, so the
    // binder naming them is the fixture that tells the two apart.
    expect(TRUSTED_WRAPPERS.test(readSource(BINDER_MODULE))).toBe(true);

    const callers = mainSources
      .filter((file) => file !== BINDER_MODULE && file !== TRUSTED_IPC_MODULE)
      .filter((file) => TRUSTED_WRAPPERS.test(readSource(file)))
      .map((file) => `${file} names a trusted wrapper`)
      .sort();

    expect(callers).toEqual([]);
  });

  // Exempting the wrapper module is what makes the assertion above possible, and
  // the exemption is only safe while everything it exempts is a wrapper. Two ways
  // it stops being one: a registration with a channel of its own, which is an
  // endpoint outside IPC_CHANNELS entirely, and a registration that runs the
  // handler without the sender check, which is the trust boundary itself. Both
  // are properties rather than a count of calls, so a third wrapper that has them
  // stays green.
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

  // Every value the preload hands the renderer is validated by a guard in
  // packages/contracts, the same one the main process uses. A guard written here
  // instead is a second rule for one type, and the second rule is always the
  // looser one - the preload's own isAgentSummary never checked `provider` and its
  // isConversationWithReadState accepted any array as the message list. An empty
  // list is the only form that stays honest: it says the preload declares no rule
  // of its own rather than counting the ones it does.
  //
  // This catches the predicate-shaped recurrence, which is the shape that
  // actually diverged. A rule inlined into a decodeX body is still invisible here.
  it("declares no type predicate of its own in the preload", () => {
    const declared = [...readSource(PRELOAD_MODULE).matchAll(/^function (\w+)\([^)]*\):\s*[\w.<>[\]|" ]+ is /gm)]
      .map((match) => match[1])
      .sort();

    expect(declared).toEqual([]);
  });

  // `decodeXFromHost` here and `decodeXFromMain` in the preload are deliberately two
  // functions for one shape: the preload checks what the main process sent the
  // renderer, which is a trusted sender, while these check a remote team server,
  // which is not.
  //
  // What this enforces is the naming bijection, and only that: neither half may lose
  // its twin. That catches the way the pair actually gets merged - one is deleted and
  // its callers point at the other, which reads in review as a tidy deduplication and
  // passes every other assertion in this file. It does not prove the two names have
  // separate implementations - the test below covers the one aliasing spelling a
  // source scan can recognise, and a wrapper that forwards to the other decoder is
  // still review's job.
  //
  // Names only, never the file list: the headers describe four wire-area siblings,
  // but two of them hold no suffixed decoder at all, so where the twin lives is not
  // the invariant. Nor is `export` - the preload exports nothing, and one FromHost
  // decoder is module-private.
  it("gives every FromHost decoder a FromMain twin, and the reverse", () => {
    const host = twinDecoders(mainSources, "Host");
    const main = twinDecoders(preloadSources, "Main");

    expect(host.length).toBeGreaterThanOrEqual(TWIN_DECODER_FLOOR);
    expect(host).toEqual(main);
  });

  // The bijection above is satisfied by two names, so it survives
  // `const decodeXFromMain = decodeXFromHost` - which would hand a remote team
  // server the validation written for a trusted sender while keeping both names in
  // place. An initializer that is a bare reference is that merge; an initializer
  // that calls something is an implementation, which is what keeps the factory
  // spelling this family already uses (`remote-agent-decoding.ts:162`) accepted.
  it("declares each twin decoder rather than aliasing the other", () => {
    expect(aliasedTwinsIn(TWIN_ALIAS_FIXTURE)).toEqual([
      "decodeAliasedFromMain",
      "decodeAnnotatedFromMain",
      "decodeSignedFromMain",
    ]);

    expect(aliasedTwins([...mainSources, ...preloadSources])).toEqual([]);
  });
});

// One occurrence of a known call, with the source text of its channel argument
// and the span that argument occupies. The span is what lets a reference be
// matched back to the call that reads it.
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

// Every channel of one kind, as the IPC_CHANNELS key the source scans produce.
function channelsOfKind(kind: IpcEndpoint["kind"]): readonly string[] {
  const keys = new Set<string>();
  for (const group of Object.values<IpcEndpointGroup>(IPC_ENDPOINTS)) {
    for (const endpoint of Object.values<IpcEndpoint>(group)) {
      if (endpoint.kind !== kind) continue;
      const key = channelKeys.get(endpoint.channel);
      if (key !== undefined) keys.add(key);
    }
  }
  return [...keys].sort();
}

// Every decoder declared with the given suffix, the suffix removed so the two
// sides compare directly. `const` counts as well as `function`: the family already
// builds decoders out of guardedDecoder factories, and a regex blind to that
// spelling would drop one silently here and fail on the opposite side.
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

// A suffixed decoder bound straight to another name: `= other`, `= module.other`,
// either of them with a trailing `as T`. An initializer holding a call, an arrow or a
// body is an implementation and is left alone. The annotation this skips over may itself
// be a function type, so `=>` has to be consumed there rather than mistaken for the
// assignment - otherwise `const decodeXFromMain: (value: unknown) => X = other` is read
// from the arrow onwards and escapes.
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

// Reads each known call forwards from its own name to the argument in the
// channel position, rather than walking back from an IPC_CHANNELS reference to
// whatever call appears to enclose it. Only the forward direction sees a call
// whose channel is a variable or a string, and those are the calls that would
// otherwise leave the trust boundary unscanned. A `function` keyword before the
// name marks a declaration of the helper rather than a call to it.
function collectCalls(files: readonly string[]): readonly ChannelCall[] {
  const calls: ChannelCall[] = [];
  for (const file of files) {
    const source = readSource(file);
    for (const [callee, position] of CHANNEL_ARGUMENT_POSITION) {
      const pattern = new RegExp(`(?<![A-Za-z0-9_$.])${callee.replaceAll(".", "\\.")}\\s*\\(`, "g");
      for (const match of source.matchAll(pattern)) {
        if (/\bfunction\s*$/.test(source.slice(Math.max(0, match.index - 20), match.index))) continue;
        const span = argumentAt(source, match.index + match[0].length, position);
        if (span !== null) calls.push({ file, callee, ...span });
      }
    }
  }
  return calls;
}

// Reads the argument at `position` from a call whose opening parenthesis has
// already been passed, splitting on the commas that sit at the call's own
// nesting depth so a nested call or object literal is not mistaken for a
// separator.
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

// The whole argument list of a call whose opening parenthesis has been passed,
// which is where a registration's handler body sits.
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
  return CHANNEL_REFERENCE.exec(call.argument)?.[1] ?? null;
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

// Every IPC_CHANNELS reference that does not sit inside a channel argument the
// scan read.
function strayReferences(files: readonly string[], calls: readonly ChannelCall[]): readonly string[] {
  const stray: string[] = [];
  for (const file of files) {
    const source = readSource(file);
    const spans = calls.filter((call) => call.file === file);
    for (const match of source.matchAll(/IPC_CHANNELS\.([A-Za-z0-9_]+)/g)) {
      const read = spans.some((span) => span.start <= match.index && match.index < span.end);
      if (!read) stray.push(`${file}: ${match[0]}`);
    }
  }
  return stray.sort();
}

// Blanks comments and the insides of string, template and regular expression
// literals, keeping every other character at its original offset so the walk
// above still lines up. A commented-out registration must not read as a
// registration.
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

// A slash opens a regular expression only where a value may start; after a
// value it is division. Only the operators that actually precede a literal in
// these files need to be recognised, and a wrong guess surfaces as an
// unattributed reference rather than a silent miss.
function startsRegularExpression(characters: readonly string[], index: number): boolean {
  let position = index - 1;
  while (position >= 0 && /\s/.test(characters[position] ?? "")) position -= 1;
  const previous = characters[position];
  return previous === undefined || "(,=:[!&|?{};+-*%~^".includes(previous);
}
