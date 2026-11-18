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
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { WorkflowMediaCreditBalance, WorkflowMediaKind, WorkflowMediaSpecs } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Duration, Effect } from "effect";
import {
  callMediaTool,
  connectSignedIn,
  creditCount,
  downloadMedia,
  isHttps,
  type McpMediaDependencies,
  type McpMediaFailed,
  type McpMediaSignIn,
  type McpToolArguments,
  mediaFail,
  mediaFailed,
  mediaReason,
  mediaText,
  pictureExtension,
  resolveMediaInputs,
  uploadToService,
} from "./mcp-media";
import { isSunraModelList, type SunraPlan, sunraCatalogEntry } from "./sunra-catalog";
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
/** How many `get_job` calls in a row can fail before the step fails. */
const SUNRA_POLL_FAILURES = 3;
/** A read of the model list or of a price that takes longer gives no list or no price. */
const SUNRA_CATALOG_DEADLINE = Duration.seconds(30);
const SUNRA_PRICE_DEADLINE = Duration.seconds(20);
/** The description of a price quote. Sunra prices an image by the length of its description. */
const SUNRA_PRICE_PROMPT = "A picture.";

/** The sign-in of the Sunra row: its address and its OAuth token. Never logged. */
export type SunraSignIn = McpMediaSignIn;

export interface SunraMediaRequest {
  kind: WorkflowMediaKind;
  /** The Sunra model id, such as "nano-banana-pro". */
  model: string;
  prompt: string;
  specs: WorkflowMediaSpecs;
  images: readonly { role: MediaImageRole; attachmentId: string }[];
  /** Which pictures and which background the model takes. */
  plan: SunraPlan;
}

/** The error for a refusal or a failed job, from the words of Sunra. */
function sunraFailure(text: string | null): McpMediaFailed {
  if (text && /insufficient[ _](balance|credits)/iu.test(text))
    return mediaFail(sourceText("error.workflow.sunraNoCredits"));
  if (text && /subscription|requires? (a )?plan/iu.test(text))
    return mediaFail(sourceText("error.workflow.sunraNeedsPlan"));
  return text ? mediaFail(sourceText("error.workflow.sunraFailed", { reason: text })) : mediaFailed();
}

const notSignedIn = () => mediaFail(sourceText("error.workflow.sunraSignIn"));
const timedOut = () => mediaFail(sourceText("error.workflow.sunraTimeout"));

const SUNRA_TOOLS = { timeoutMs: SUNRA_CALL_TIMEOUT_MS, refusal: sunraFailure };
const callTool = (client: Client, name: string, args: McpToolArguments) =>
  callMediaTool(client, SUNRA_TOOLS, name, args);
const text = mediaText;

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
  return id ?? (yield* mediaFailed());
});

/** Puts one input picture on Sunra's storage and answers its address there. Personal accounts only. */
const uploadPicture = Effect.fnUntraced(function* (
  client: Client,
  file: { path: string; mimeType: string },
  index: number,
) {
  const bytes = yield* Effect.tryPromise({ try: () => readFile(file.path), catch: () => mediaFailed() });
  const target = yield* callTool(client, "get_upload_url", {
    content_type: file.mimeType,
    filename: `openbot-input-${index + 1}.${pictureExtension(file.mimeType)}`,
  });
  const uploadUrl = text(target.upload_url);
  const assetUrl = text(target.asset_url);
  if (!uploadUrl || !assetUrl || !isHttps(uploadUrl) || !isHttps(assetUrl)) return yield* mediaFailed();
  const headers = isDynamicRecord(target.headers)
    ? Object.fromEntries(
        Object.entries(target.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : { "Content-Type": file.mimeType };
  // Sunra chooses the upload address. It must not point at this computer or its local network.
  yield* uploadToService(
    { url: uploadUrl, method: text(target.method) ?? "PUT", headers, body: bytes },
    SUNRA_TRANSFER_DEADLINE.upload,
    timedOut,
  );
  return assetUrl;
});

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
      return file ?? (yield* mediaFailed());
    }
    if (status === "FAILED" || status === "ERROR" || status === "CANCELLED" || status === "CANCELED")
      return yield* sunraFailure(mediaReason(job.error_hint) ?? mediaReason(job.error_reason));
    yield* Effect.sleep(SUNRA_POLL[kind]);
  }
});

/** Downloads the file from Sunra's file hosts. */
const download = (url: string, kind: WorkflowMediaKind) =>
  downloadMedia(url, kind, { allowed: isSunraMedia, deadline: SUNRA_TRANSFER_DEADLINE.download, timedOut });

/** The choices of the step as Sunra takes them: aspect, resolution, length and background. */
function sunraChoices(kind: WorkflowMediaKind, specs: WorkflowMediaSpecs, plan: SunraPlan): McpToolArguments {
  return {
    aspect_ratio: specs.aspect,
    ...(specs.resolution ? { resolution: specs.resolution } : {}),
    ...(kind === "video" ? { duration: specs.duration } : {}),
    ...(kind === "image" && plan.transparent && specs.transparent ? { background: "transparent" } : {}),
  };
}

/**
 * Makes one file with Sunra and keeps it in Storage. Answers the id of the stored attachment.
 */
export const generateSunraMedia = Effect.fn("generateSunraMedia")(function* (
  dependencies: McpMediaDependencies,
  request: SunraMediaRequest,
) {
  const signIn = dependencies.signIn();
  if (!signIn) return yield* notSignedIn();
  const all = yield* resolveMediaInputs(dependencies, request.images);
  // Only the pictures that the model takes. A last frame alone is not sent: most models refuse it.
  const { plan } = request;
  const startFile = plan.start ? all.find((file) => file.role === "first") : undefined;
  const endFile = plan.end && startFile ? all.find((file) => file.role === "last") : undefined;
  const referenceFiles = all.filter((file) => file.role === "reference").slice(0, plan.references);
  const files = [...(startFile ? [startFile] : []), ...(endFile ? [endFile] : []), ...referenceFiles];
  const made = yield* Effect.scoped(
    Effect.gen(function* () {
      const client = yield* connectSignedIn(signIn, notSignedIn);
      const team = yield* selectedTeam(client);
      // A Team upload needs a published workspace asset. Until OpenBot does that, a Team makes files
      // from the description alone.
      if (team && files.length > 0) return yield* mediaFail(sourceText("error.workflow.sunraTeamInputs"));
      const project = yield* openBotProject(client, team);
      // One upload for each file, also when a picture is both frames.
      const uploaded = new Map<string, string>();
      for (const file of files) {
        if (uploaded.has(file.path)) continue;
        uploaded.set(file.path, yield* uploadPicture(client, file, uploaded.size));
      }
      const url = (file: { path: string } | undefined) => (file ? uploaded.get(file.path) : undefined);
      const references = referenceFiles.flatMap((file) => uploaded.get(file.path) ?? []);
      const common = {
        project_id: project,
        prompt: request.prompt,
        model: request.model,
        ...sunraChoices(request.kind, request.specs, plan),
        auto_confirm: true,
        // A new id for each run: Sunra makes one file for one id, so a resent create does not charge twice.
        ...(team ? {} : { request_id: `openbot-${randomUUID()}` }),
      };
      const answer =
        request.kind === "video"
          ? yield* callTool(client, "create_video", {
              ...common,
              start_image: url(startFile),
              end_image: url(endFile),
              ...(references.length > 0 ? { reference_images: references } : {}),
            })
          : yield* callTool(client, "create_image", {
              ...common,
              count: 1,
              ...(references.length > 0 ? { image_urls: references } : {}),
            });
      const task = taskId(answer);
      if (!task) return yield* mediaFailed();
      return yield* waitForFile(client, task, request.kind).pipe(
        Effect.timeoutOrElse({
          duration: SUNRA_DEADLINE[request.kind],
          orElse: () => Effect.fail(timedOut()),
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
    .pipe(Effect.mapError(() => mediaFailed()));
  return stored.id;
});

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
      const client = yield* connectSignedIn(signIn, notSignedIn);
      return sunraCredits(yield* callTool(client, "get_balance", {}));
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: SUNRA_CREDITS_DEADLINE,
      orElse: () => Effect.fail(timedOut()),
    }),
  );
});

/**
 * The image and video models of Sunra's catalog that the canvas can run, with their plans.
 * `list_models` only reads the catalog: it spends no credits.
 */
export const readSunraCatalog = Effect.fn("readSunraCatalog")(function* (signIn: SunraSignIn) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const client = yield* connectSignedIn(signIn, notSignedIn);
      const answer = yield* callTool(client, "list_models", {});
      const models = isSunraModelList(answer.models) ? answer.models : [];
      const seen = new Set<string>();
      return models.flatMap((item) => {
        const entry = sunraCatalogEntry(item);
        if (!entry || seen.has(entry.model.id)) return [];
        seen.add(entry.model.id);
        return [entry];
      });
    }),
  ).pipe(Effect.timeoutOrElse({ duration: SUNRA_CATALOG_DEADLINE, orElse: () => Effect.fail(timedOut()) }));
});

/** A price in credits: a finite number that is not negative. */
const priceValue = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/**
 * The total of an `estimate_cost` answer. Its fields are not documented, so the usual names of a
 * total are read, at the top and in a `cost` or `estimate` record.
 */
function quotedCredits(answer: DynamicRecord): number | null {
  const names = ["total_credits", "totalCredits", "credits", "estimated_credits", "estimatedCredits", "total"];
  for (const record of [answer, answer.cost, answer.estimate]) {
    if (!isDynamicRecord(record)) continue;
    for (const name of names) {
      const value = priceValue(record[name]);
      if (value !== null) return value;
    }
  }
  return priceValue(answer.cost) ?? priceValue(answer.estimate);
}

export interface SunraPriceRequest {
  kind: WorkflowMediaKind;
  model: string;
  specs: WorkflowMediaSpecs;
  plan: SunraPlan;
}

/**
 * What one file costs with the choices of the step, in credits, or null when Sunra gives no price.
 * `estimate_cost` only asks for the price and spends no credits. Sunra quotes the Personal account
 * only, so a Team sign-in gets no price. The quote sends no picture.
 */
export const readSunraPrice = Effect.fn("readSunraPrice")(function* (signIn: SunraSignIn, request: SunraPriceRequest) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const client = yield* connectSignedIn(signIn, notSignedIn);
      if (yield* selectedTeam(client)) return null;
      const answer = yield* callTool(client, "estimate_cost", {
        type: request.kind,
        model: request.model,
        prompt: SUNRA_PRICE_PROMPT,
        count: 1,
        ...sunraChoices(request.kind, request.specs, request.plan),
      });
      return quotedCredits(answer);
    }),
  ).pipe(Effect.timeoutOrElse({ duration: SUNRA_PRICE_DEADLINE, orElse: () => Effect.fail(timedOut()) }));
});
