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

export const SUNRA_MCP_HOST = "mcp.sunra.ai";

const SUNRA_MEDIA_HOSTS: ReadonlySet<string> = new Set(["cdn.sunra.ai", "cdn.ponpon.ai", "assets.sunra.ai"]);

const SUNRA_PROJECT_NAME = "OpenBot";

const SUNRA_DEADLINE = { image: Duration.minutes(5), video: Duration.minutes(20) } as const;
const SUNRA_POLL = { image: Duration.seconds(3), video: Duration.seconds(6) } as const;
const SUNRA_CALL_TIMEOUT_MS = 120_000;
const SUNRA_CREDITS_DEADLINE = Duration.seconds(20);
const SUNRA_TRANSFER_DEADLINE = { upload: Duration.minutes(2), download: Duration.minutes(5) } as const;
const SUNRA_POLL_FAILURES = 3;
const SUNRA_CATALOG_DEADLINE = Duration.seconds(30);
const SUNRA_PRICE_DEADLINE = Duration.seconds(20);
const SUNRA_PRICE_PROMPT = "A picture.";

export type SunraSignIn = McpMediaSignIn;

export interface SunraMediaRequest {
  kind: WorkflowMediaKind;
  model: string;
  prompt: string;
  specs: WorkflowMediaSpecs;
  images: readonly { role: MediaImageRole; attachmentId: string }[];
  plan: SunraPlan;
}

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

const selectedTeam = Effect.fnUntraced(function* (client: Client) {
  const answer = yield* callTool(client, "list_workspaces", {});
  return text(answer.selectedWorkspaceId);
});

const openBotProject = Effect.fnUntraced(function* (client: Client, team: string | null) {
  const listed = yield* callTool(client, "list_projects", { limit: 100 });
  const projects = Array.isArray(listed.projects) ? listed.projects.filter(isDynamicRecord) : [];
  const found = text(projects.find((project) => project.name === SUNRA_PROJECT_NAME)?.project_id);
  if (found) return found;
  const made = yield* callTool(client, "create_project", {
    name: SUNRA_PROJECT_NAME,
    ...(team
      ? { workspace_id: team, request_id: `openbot-project-${team.replace(/[^A-Za-z0-9_-]/gu, "")}`.slice(0, 128) }
      : {}),
  });
  const id = text(made.project_id) ?? (isDynamicRecord(made.project) ? text(made.project.project_id) : null);
  return id ?? (yield* mediaFailed());
});

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
  yield* uploadToService(
    { url: uploadUrl, method: text(target.method) ?? "PUT", headers, body: bytes },
    SUNRA_TRANSFER_DEADLINE.upload,
    timedOut,
  );
  return assetUrl;
});

function isSunraMedia(value: string): boolean {
  return isHttps(value) && SUNRA_MEDIA_HOSTS.has(new URL(value).hostname);
}

function taskId(answer: DynamicRecord): string | null {
  const one = text(answer.task_id);
  if (one) return one;
  const many = Array.isArray(answer.task_ids) ? answer.task_ids : [];
  return text(many[0]);
}

const waitForFile = Effect.fnUntraced(function* (client: Client, task: string, kind: WorkflowMediaKind) {
  let failures = 0;
  while (true) {
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

const download = (url: string, kind: WorkflowMediaKind) =>
  downloadMedia(url, kind, { allowed: isSunraMedia, deadline: SUNRA_TRANSFER_DEADLINE.download, timedOut });

function sunraChoices(kind: WorkflowMediaKind, specs: WorkflowMediaSpecs, plan: SunraPlan): McpToolArguments {
  return {
    aspect_ratio: specs.aspect,
    ...(specs.resolution ? { resolution: specs.resolution } : {}),
    ...(kind === "video" ? { duration: specs.duration } : {}),
    ...(kind === "image" && plan.transparent && specs.transparent ? { background: "transparent" } : {}),
  };
}

export const generateSunraMedia = Effect.fn("generateSunraMedia")(function* (
  dependencies: McpMediaDependencies,
  request: SunraMediaRequest,
) {
  const signIn = dependencies.signIn();
  if (!signIn) return yield* notSignedIn();
  const all = yield* resolveMediaInputs(dependencies, request.images);
  const { plan } = request;
  const startFile = plan.start ? all.find((file) => file.role === "first") : undefined;
  const endFile = plan.end && startFile ? all.find((file) => file.role === "last") : undefined;
  const referenceFiles = all.filter((file) => file.role === "reference").slice(0, plan.references);
  const files = [...(startFile ? [startFile] : []), ...(endFile ? [endFile] : []), ...referenceFiles];
  const made = yield* Effect.scoped(
    Effect.gen(function* () {
      const client = yield* connectSignedIn(signIn, notSignedIn);
      const team = yield* selectedTeam(client);
      if (team && files.length > 0) return yield* mediaFail(sourceText("error.workflow.sunraTeamInputs"));
      const project = yield* openBotProject(client, team);
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

function sunraCredits(answer: DynamicRecord): WorkflowMediaCreditBalance | null {
  const member = isDynamicRecord(answer.memberQuota) ? answer.memberQuota.effectiveQuota : null;
  if (isDynamicRecord(member)) {
    const remaining = creditCount(member.remaining);
    const limit = creditCount(member.limit);
    return remaining === null ? null : { available: remaining, quota: limit && limit > 0 ? limit : null };
  }
  if (answer.memberQuota !== undefined) return null;
  const balance = isDynamicRecord(answer.balance) ? answer.balance : null;
  const available = creditCount(answer.availableBalance) ?? creditCount(balance?.availableBalance);
  return available === null ? null : { available, quota: null };
}

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

const priceValue = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

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
      return quotedCredits(answer) ?? (yield* mediaFailed());
    }),
  ).pipe(Effect.timeoutOrElse({ duration: SUNRA_PRICE_DEADLINE, orElse: () => Effect.fail(timedOut()) }));
});
