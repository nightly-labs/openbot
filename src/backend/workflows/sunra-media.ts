/**
 * Makes the image or the video of a canvas step with the tools of Sunra's MCP server
 * (https://mcp.sunra.ai), on the Sunra sign-in that the user made for the Sunra app in Apps.
 *
 * Running a step with a Sunra model is the user's request to spend Sunra credits, so the create call
 * confirms at once (`auto_confirm`). The account that pays is the one Sunra has selected for this
 * sign-in; OpenBot never selects another one. The result goes to an "OpenBot" project in that account,
 * and OpenBot keeps a copy in Storage, as it does for the other media models.
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import type { WorkflowMediaCreditBalance, WorkflowMediaKind, WorkflowMediaSpecs } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Duration, Effect, Schema } from "effect";
import { readLimitedBody } from "../limited-body";
import { secureOAuthFetch } from "../mcp-oauth-provider";
import { hostAddresses, isPublicAddress, systemAddressLookup } from "../network-address";
import type { MediaImageRole } from "./workflow-walk";

/** The host of Sunra's MCP server. An enabled http MCP row with this host is the Sunra connection. */
export const SUNRA_MCP_HOST = "mcp.sunra.ai";

/** The hosts that Sunra serves results from. OpenBot downloads a result from these hosts only. */
const SUNRA_MEDIA_HOSTS: ReadonlySet<string> = new Set(["cdn.sunra.ai", "cdn.ponpon.ai", "assets.sunra.ai"]);

/** The project in the Sunra account that keeps the files of OpenBot's canvas. */
const SUNRA_PROJECT_NAME = "OpenBot";

/** How long a step waits for Sunra, from the create call to the finished file. */
const SUNRA_DEADLINE = { image: Duration.minutes(5), video: Duration.minutes(20) } as const;
const SUNRA_POLL = { image: Duration.seconds(3), video: Duration.seconds(6) } as const;
/** One tool call. A create can wait while Sunra copies the reference pictures. */
const SUNRA_CALL_TIMEOUT_MS = 120_000;
/** A read of the credits that takes longer shows no credits. */
const SUNRA_CREDITS_DEADLINE = Duration.seconds(20);
/** The longest time for one upload of an input picture, and for the download of the file. */
const SUNRA_TRANSFER_DEADLINE = { upload: Duration.minutes(2), download: Duration.minutes(5) } as const;
/** How many redirects the download of a file follows, each on Sunra's file hosts. */
const SUNRA_DOWNLOAD_REDIRECTS = 3;
/** How many `get_job` calls in a row can fail before the step fails. */
const SUNRA_POLL_FAILURES = 3;
/** The longest reason from Sunra that an error quotes. */
const SUNRA_REASON_LIMIT = 300;

/** The sign-in of the Sunra row: its address and its OAuth token. Never logged. */
export interface SunraSignIn {
  url: string;
  token: () => Effect.Effect<string | null, unknown>;
  /** A new token after Sunra refused `rejected`, or null. */
  refresh: (rejected: string) => Effect.Effect<string | null, unknown>;
}

export interface SunraMediaRequest {
  kind: WorkflowMediaKind;
  /** The Sunra model id, such as "nano-banana-pro". */
  model: string;
  prompt: string;
  specs: WorkflowMediaSpecs;
  images: readonly { role: MediaImageRole; attachmentId: string }[];
}

export interface SunraMediaDependencies {
  signIn: () => SunraSignIn | null;
  resolveAttachment: (attachmentId: string) => Effect.Effect<{ path: string; mimeType: string } | null, unknown>;
  store: (input: {
    bytes: Uint8Array;
    kind: WorkflowMediaKind;
    name: string;
    mimeType: string;
  }) => Effect.Effect<{ id: string }, unknown>;
}

/** A failure whose `message` the user reads. It never holds a token. */
class SunraMediaFailed extends Schema.TaggedError<SunraMediaFailed>()("SunraMediaFailed", {
  message: Schema.String,
}) {}

const fail = (message: string) => new SunraMediaFailed({ message });
const failed = () => fail(sourceText("error.workflow.mediaFailed"));

/** The reason that Sunra gave, short and on one line, or null. */
function sunraReason(value: unknown): string | null {
  const text = typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
  if (!text) return null;
  return text.length > SUNRA_REASON_LIMIT ? `${text.slice(0, SUNRA_REASON_LIMIT - 1)}…` : text;
}

/** The error for a refusal or a failed job, from the words of Sunra. */
function sunraFailure(text: string | null): SunraMediaFailed {
  if (text && /insufficient[ _](balance|credits)/iu.test(text))
    return fail(sourceText("error.workflow.sunraNoCredits"));
  if (text && /subscription|requires? (a )?plan/iu.test(text)) return fail(sourceText("error.workflow.sunraNeedsPlan"));
  return text ? fail(sourceText("error.workflow.sunraFailed", { reason: text })) : failed();
}

const unauthorized = (cause: unknown) =>
  cause instanceof UnauthorizedError || (cause instanceof StreamableHTTPError && cause.code === 401);

/**
 * The SDK transport behind the SDK's own `Transport` type. The SDK class declares `sessionId` and its
 * callbacks without `undefined`, so `exactOptionalPropertyTypes` refuses the class itself.
 */
function forwardingTransport(inner: StreamableHTTPClientTransport): Transport {
  const transport: Transport = {
    start: () => inner.start(),
    send: (message, options) => inner.send(message, options),
    close: () => inner.close(),
    setProtocolVersion: (version) => inner.setProtocolVersion(version),
  };
  inner.onclose = () => transport.onclose?.();
  inner.onerror = (error) => transport.onerror?.(error);
  inner.onmessage = (message) => transport.onmessage?.(message);
  return transport;
}

/** A Client on Sunra's server with one token, closed when the scope ends. */
function connect(url: string, token: string) {
  return Effect.acquireRelease(
    Effect.tryPromise({
      try: async (signal) => {
        const client = new Client({ name: "openbot", version: "1" }, { capabilities: {} });
        const transport = new StreamableHTTPClientTransport(new URL(url), {
          fetch: secureOAuthFetch({ resource: url, mcpTraffic: true }),
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        });
        await client.connect(forwardingTransport(transport), { signal });
        return client;
      },
      catch: (cause) => cause,
    }),
    (client) => Effect.promise(() => client.close().catch(() => undefined)),
  );
}

/** Connects with the current token, and once more with a new one when Sunra refuses it. */
const connectSignedIn = Effect.fnUntraced(function* (signIn: SunraSignIn) {
  const notSignedIn = () => fail(sourceText("error.workflow.sunraSignIn"));
  const token = yield* signIn.token().pipe(Effect.mapError(notSignedIn));
  if (!token) return yield* notSignedIn();
  return yield* connect(signIn.url, token).pipe(
    Effect.catch((cause) =>
      unauthorized(cause)
        ? signIn.refresh(token).pipe(
            Effect.mapError(notSignedIn),
            Effect.flatMap((next) =>
              next ? connect(signIn.url, next).pipe(Effect.mapError(notSignedIn)) : Effect.fail(notSignedIn()),
            ),
          )
        : Effect.fail(failed()),
    ),
  );
});

/** The value of a tool result: its structured content, else the JSON of its first text block. */
function toolValue(result: unknown): { value: DynamicRecord | null; error: string | null } {
  if (!isDynamicRecord(result)) return { value: null, error: null };
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.find(
    (block): block is { type: "text"; text: string } =>
      isDynamicRecord(block) && block.type === "text" && typeof block.text === "string",
  )?.text;
  const parsed = (() => {
    if (isDynamicRecord(result.structuredContent)) return result.structuredContent;
    if (!text) return null;
    try {
      const value = JSON.parse(text);
      return isDynamicRecord(value) ? value : null;
    } catch {
      return null;
    }
  })();
  if (result.isError === true) {
    const reason = parsed ? (parsed.error_hint ?? parsed.message ?? parsed.error) : text;
    return { value: null, error: sunraReason(reason) ?? "" };
  }
  return { value: parsed, error: null };
}

/** The arguments of one Sunra tool call. An absent value is left out of the JSON. */
interface SunraToolArguments {
  readonly [name: string]: string | number | boolean | readonly string[] | undefined;
}

const callTool = (client: Client, name: string, args: SunraToolArguments) =>
  Effect.tryPromise({
    try: (signal) => client.callTool({ name, arguments: args }, undefined, { signal, timeout: SUNRA_CALL_TIMEOUT_MS }),
    catch: () => failed(),
  }).pipe(
    Effect.flatMap((result) => {
      const { value, error } = toolValue(result);
      if (error !== null) return Effect.fail(sunraFailure(error || null));
      return value ? Effect.succeed(value) : Effect.fail(failed());
    }),
  );

const text = (value: unknown) => (typeof value === "string" && value ? value : null);

/** The selected Team of the sign-in, or null for the Personal account. */
const selectedTeam = Effect.fnUntraced(function* (client: Client) {
  const answer = yield* callTool(client, "list_workspaces", {});
  return text(answer.selectedWorkspaceId);
});

/** The "OpenBot" project of the paying account, made on first use. */
const openBotProject = Effect.fnUntraced(function* (client: Client, team: string | null) {
  const listed = yield* callTool(client, "list_projects", { limit: 100 });
  const projects = Array.isArray(listed.projects) ? listed.projects.filter(isDynamicRecord) : [];
  const found = text(projects.find((project) => project.name === SUNRA_PROJECT_NAME)?.project_id);
  if (found) return found;
  const made = yield* callTool(client, "create_project", {
    name: SUNRA_PROJECT_NAME,
    // A Team checks the selected Team and keeps one project for a repeated request.
    ...(team
      ? { workspace_id: team, request_id: `openbot-project-${team.replace(/[^A-Za-z0-9_-]/gu, "")}`.slice(0, 128) }
      : {}),
  });
  const id = text(made.project_id) ?? (isDynamicRecord(made.project) ? text(made.project.project_id) : null);
  return id ?? (yield* failed());
});

/** Puts one input picture on Sunra's storage and answers its address there. Personal accounts only. */
const uploadPicture = Effect.fnUntraced(function* (
  client: Client,
  file: { path: string; mimeType: string },
  index: number,
) {
  const bytes = yield* Effect.tryPromise({ try: () => readFile(file.path), catch: () => failed() });
  const extension = file.mimeType.split("/")[1] ?? "png";
  const target = yield* callTool(client, "get_upload_url", {
    content_type: file.mimeType,
    filename: `openbot-input-${index + 1}.${extension}`,
  });
  const uploadUrl = text(target.upload_url);
  const assetUrl = text(target.asset_url);
  if (!uploadUrl || !assetUrl || !isHttps(uploadUrl) || !isHttps(assetUrl)) return yield* failed();
  const headers = isDynamicRecord(target.headers)
    ? Object.fromEntries(
        Object.entries(target.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : { "Content-Type": file.mimeType };
  const method = text(target.method) ?? "PUT";
  // Sunra chooses the upload address. It must not point at this computer or its local network.
  const addresses = yield* hostAddresses(new URL(uploadUrl), systemAddressLookup).pipe(Effect.mapError(() => failed()));
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) return yield* failed();
  const response = yield* Effect.tryPromise({
    try: (signal) => fetch(uploadUrl, { method, headers, body: bytes, signal, redirect: "error" }),
    catch: () => failed(),
  }).pipe(
    Effect.timeoutOrElse({
      duration: SUNRA_TRANSFER_DEADLINE.upload,
      orElse: () => Effect.fail(fail(sourceText("error.workflow.sunraTimeout"))),
    }),
  );
  if (!response.ok) return yield* failed();
  return assetUrl;
});

function isHttps(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Whether a result address is on Sunra's file hosts, over https. */
function isSunraMedia(value: string): boolean {
  return isHttps(value) && SUNRA_MEDIA_HOSTS.has(new URL(value).hostname);
}

/** The id of the one job that a confirmed create started. */
function taskId(answer: DynamicRecord): string | null {
  const one = text(answer.task_id);
  if (one) return one;
  const many = Array.isArray(answer.task_ids) ? answer.task_ids : [];
  return text(many[0]);
}

/** Asks for the job until it is done, and answers the address of its file. */
const waitForFile = Effect.fnUntraced(function* (client: Client, task: string, kind: WorkflowMediaKind) {
  let failures = 0;
  while (true) {
    // A short network failure must not lose a job that Sunra already charged for.
    const answer = yield* callTool(client, "get_job", { task_id: task }).pipe(Effect.result);
    if (answer._tag === "Failure") {
      failures += 1;
      if (failures >= SUNRA_POLL_FAILURES) return yield* answer.failure;
      yield* Effect.sleep(SUNRA_POLL[kind]);
      continue;
    }
    failures = 0;
    const job = answer.success;
    const status = (text(job.task_status) ?? text(job.status) ?? "").toUpperCase();
    if (status === "COMPLETED" || status === "SUCCEEDED" || status === "SUCCESS") {
      const urls = Array.isArray(job.urls) ? job.urls : [];
      const file = [text(kind === "video" ? job.out_video : job.out_image), ...urls.map(text)].find(
        (url): url is string => url !== null && isSunraMedia(url),
      );
      return file ?? (yield* failed());
    }
    if (status === "FAILED" || status === "ERROR" || status === "CANCELLED" || status === "CANCELED")
      return yield* sunraFailure(sunraReason(job.error_hint) ?? sunraReason(job.error_reason));
    yield* Effect.sleep(SUNRA_POLL[kind]);
  }
});

const MEDIA_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

/** Downloads the file, with the size limit of a stored attachment. */
const download = Effect.fnUntraced(function* (url: string, kind: WorkflowMediaKind) {
  const tooLarge = () =>
    fail(
      sourceText(kind === "video" ? "error.backend.generatedVideoTooLarge" : "error.backend.generatedImageTooLarge"),
    );
  const { response, bytes } = yield* Effect.gen(function* () {
    // Each hop must be on Sunra's file hosts before OpenBot asks for it, so a redirect is followed here.
    let address = url;
    let response: Response | null = null;
    for (let hop = 0; hop <= SUNRA_DOWNLOAD_REDIRECTS; hop += 1) {
      if (!isSunraMedia(address)) return yield* failed();
      const next = address;
      const answer = yield* Effect.tryPromise({
        try: (signal) => fetch(next, { signal, redirect: "manual" }),
        catch: () => failed(),
      });
      const location = answer.status >= 300 && answer.status < 400 ? answer.headers.get("location") : null;
      if (!location) {
        response = answer;
        break;
      }
      yield* Effect.promise(() => answer.body?.cancel().catch(() => undefined) ?? Promise.resolve());
      address = URL.canParse(location, next) ? new URL(location, next).href : "";
    }
    if (!response?.ok) return yield* failed();
    const bytes = yield* readLimitedBody(response, ATTACHMENT_LIMITS.fileBytes, (reason) =>
      reason === "too-large" ? tooLarge() : failed(),
    );
    return { response, bytes: new Uint8Array(bytes) };
  }).pipe(
    Effect.timeoutOrElse({
      duration: SUNRA_TRANSFER_DEADLINE.download,
      orElse: () => Effect.fail(fail(sourceText("error.workflow.sunraTimeout"))),
    }),
  );
  if (bytes.byteLength === 0) return yield* failed();
  const header = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const mimeType = MEDIA_TYPES[header] ? header : kind === "video" ? "video/mp4" : "image/png";
  return { bytes, mimeType, extension: MEDIA_TYPES[mimeType] ?? (kind === "video" ? "mp4" : "png") };
});

/**
 * Makes one file with Sunra and keeps it in Storage. Answers the id of the stored attachment.
 */
export const generateSunraMedia = Effect.fn("generateSunraMedia")(function* (
  dependencies: SunraMediaDependencies,
  request: SunraMediaRequest,
) {
  const signIn = dependencies.signIn();
  if (!signIn) return yield* fail(sourceText("error.workflow.sunraSignIn"));
  const files: { role: MediaImageRole; path: string; mimeType: string }[] = [];
  for (const image of request.images) {
    const file = yield* dependencies
      .resolveAttachment(image.attachmentId)
      .pipe(Effect.mapError(() => fail(sourceText("error.workflow.mediaInputMissing"))));
    if (!file) return yield* fail(sourceText("error.workflow.mediaInputMissing"));
    if (!file.mimeType.startsWith("image/")) return yield* fail(sourceText("error.workflow.mediaInputNotImage"));
    files.push({ role: image.role, ...file });
  }
  const made = yield* Effect.scoped(
    Effect.gen(function* () {
      const client = yield* connectSignedIn(signIn);
      const team = yield* selectedTeam(client);
      // A Team upload needs a published workspace asset. Until OpenBot does that, a Team makes files
      // from the description alone.
      if (team && files.length > 0) return yield* fail(sourceText("error.workflow.sunraTeamInputs"));
      const project = yield* openBotProject(client, team);
      // One upload for each file, also when a picture is both frames.
      const uploaded = new Map<string, string>();
      for (const file of files) {
        if (uploaded.has(file.path)) continue;
        uploaded.set(file.path, yield* uploadPicture(client, file, uploaded.size));
      }
      const urls = (role: MediaImageRole) =>
        files.filter((file) => file.role === role).flatMap((file) => uploaded.get(file.path) ?? []);
      const common = {
        project_id: project,
        prompt: request.prompt,
        model: request.model,
        aspect_ratio: request.specs.aspect,
        ...(request.specs.resolution ? { resolution: request.specs.resolution } : {}),
        auto_confirm: true,
        // A new id for each run: Sunra makes one file for one id, so a resent create does not charge twice.
        ...(team ? {} : { request_id: `openbot-${randomUUID()}` }),
      };
      const first = urls("first")[0];
      const last = urls("last")[0];
      const references = urls("reference");
      const answer =
        request.kind === "video"
          ? yield* callTool(client, "create_video", {
              ...common,
              duration: request.specs.duration,
              ...(first ? { start_image: first } : {}),
              ...(last ? { end_image: last } : {}),
              ...(references.length > 0 ? { reference_images: references } : {}),
            })
          : yield* callTool(client, "create_image", {
              ...common,
              count: 1,
              ...(references.length > 0 ? { image_urls: references } : {}),
            });
      const task = taskId(answer);
      if (!task) return yield* failed();
      return yield* waitForFile(client, task, request.kind).pipe(
        Effect.timeoutOrElse({
          duration: SUNRA_DEADLINE[request.kind],
          orElse: () => Effect.fail(fail(sourceText("error.workflow.sunraTimeout"))),
        }),
      );
    }),
  );
  const file = yield* download(made, request.kind);
  const stored = yield* dependencies
    .store({
      bytes: file.bytes,
      kind: request.kind,
      name: `sunra-${request.kind}.${file.extension}`,
      mimeType: file.mimeType,
    })
    .pipe(Effect.mapError(() => failed()));
  return stored.id;
});

/** A count of credits: a finite number that is not negative, rounded down. */
function creditCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

/**
 * The credits in a `get_balance` answer. A Sunra team member has `memberQuota.effectiveQuota`: its
 * `remaining` and its `limit`. The team balance is not the member's to spend, so it is not used. A
 * Personal account has `availableBalance`, which already holds the plan, top-up and reward credits.
 */
function sunraCredits(answer: DynamicRecord): WorkflowMediaCreditBalance | null {
  const member = isDynamicRecord(answer.memberQuota) ? answer.memberQuota.effectiveQuota : null;
  if (isDynamicRecord(member)) {
    const remaining = creditCount(member.remaining);
    const limit = creditCount(member.limit);
    return remaining === null ? null : { available: remaining, quota: limit && limit > 0 ? limit : null };
  }
  // A team answer without the quota of the member has no number that is the member's.
  if (answer.memberQuota !== undefined) return null;
  const balance = isDynamicRecord(answer.balance) ? answer.balance : null;
  const available = creditCount(answer.availableBalance) ?? creditCount(balance?.availableBalance);
  return available === null ? null : { available, quota: null };
}

/**
 * The credits that the Sunra sign-in can spend now, or null when Sunra does not tell them.
 * `get_balance` only reads the balance: it spends no credits.
 */
export const readSunraCredits = Effect.fn("readSunraCredits")(function* (signIn: SunraSignIn) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const client = yield* connectSignedIn(signIn);
      return sunraCredits(yield* callTool(client, "get_balance", {}));
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: SUNRA_CREDITS_DEADLINE,
      orElse: () => Effect.fail(fail(sourceText("error.workflow.sunraTimeout"))),
    }),
  );
});
