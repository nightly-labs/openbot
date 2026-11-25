import type { CreditMediaInputRole, CreditMediaJobStatus } from "@openbot/contracts/credit-media";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import {
  inputsOf,
  invalidResponse,
  type MediaGeneration,
  type MediaGenerationInput,
  type MediaUpstream,
  type MediaUpstreamArtifact,
  MediaUpstreamError,
  type MediaUpstreamField,
  type MediaUpstreamFields,
  MediaUpstreamHttp,
  type MediaUpstreamJob,
  type MediaUpstreamOptions,
  type MediaUpstreamReply,
  type MediaUpstreamValue,
  mediaType,
  optionalNumber,
  payload,
  pollSeconds,
  present,
  readStatus,
  validJobId,
} from "./media-upstream";

const UPLOAD_RETENTION_DAYS = 3;
const REFUSED_IN_BODY = "refused";
const INPUT_ROLES: Readonly<Record<CreditMediaInputRole, string>> = {
  first: "first_frame",
  last: "last_frame",
  reference: "reference_image",
};
const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};
const RESULT_TYPES = [
  ["images", "image/png"],
  ["videos", "video/mp4"],
] as const;

interface RoleImage {
  url: string;
  role: string;
}

type TasksValue = MediaUpstreamValue | readonly RoleImage[];

function taskStatus(value: unknown): CreditMediaJobStatus | null {
  if (value === "pending" || value === "submitted") return "queued";
  return readStatus(value);
}

function refused(reply: MediaUpstreamReply): MediaUpstreamError | null {
  const code = reply.body?.code;
  if (!isNumber(code) || code < 400 || code > 599) return null;
  return new MediaUpstreamError({ status: code, code: REFUSED_IN_BODY, retryAfterSeconds: null });
}

function firstRecord(value: unknown): DynamicRecord | null {
  if (Array.isArray(value)) return isDynamicRecord(value[0]) ? value[0] : null;
  return isDynamicRecord(value) ? value : null;
}

function readSubmitted(body: DynamicRecord | null): MediaUpstreamJob | null {
  const task = firstRecord(body && "data" in body ? body.data : body);
  if (!task) return null;
  const id = task.task_id ?? task.id;
  if (!validJobId(id)) return null;
  return { id, status: taskStatus(task.status) ?? "queued", pollAfterSeconds: pollSeconds(null) };
}

function readTask(body: DynamicRecord | null): MediaUpstreamJob | null {
  const task = payload(body);
  if (!task) return null;
  const id = task.id ?? task.task_id;
  const status = taskStatus(task.status);
  if (!validJobId(id) || !status) return null;
  return { id, status, pollAfterSeconds: pollSeconds(null) };
}

function typeOfUrl(url: string, fallback: string): string {
  const extension = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[extension] ?? fallback;
}

function urlsOf(value: unknown): string[] {
  const urls = Array.isArray(value) ? value : [value];
  return urls.filter((url): url is string => isString(url) && url.startsWith("https://") && URL.canParse(url));
}

function readArtifacts(body: DynamicRecord | null): MediaUpstreamArtifact[] | null {
  const task = payload(body);
  if (!task || !isDynamicRecord(task.result)) return null;
  const result = task.result;
  return RESULT_TYPES.flatMap(([key, fallback]) => {
    const items = result[key];
    if (!Array.isArray(items)) return [];
    return items.flatMap((item) => {
      const entry: DynamicRecord = isDynamicRecord(item) ? item : { url: item };
      const seconds = optionalNumber(entry.duration);
      return urlsOf(entry.url).map((url) => ({
        url,
        mimeType: mediaType(entry.content_type) ?? typeOfUrl(url, fallback),
        width: optionalNumber(entry.width),
        height: optionalNumber(entry.height),
        durationMs: seconds === null ? null : seconds * 1_000,
      }));
    });
  });
}

function readUploadedUrl(body: DynamicRecord | null): string | null {
  const upload = payload(body);
  const url = upload?.url;
  return isString(url) && url.startsWith("https://") ? url : null;
}

function fileName(input: MediaGenerationInput, index: number): string {
  const extension = input.mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
  return `${input.role}-${index}.${extension}`;
}

function isRoleImages(value: TasksValue): value is readonly RoleImage[] {
  return Array.isArray(value) && value.every((item) => isDynamicRecord(item));
}

function renamedRoles(field: MediaUpstreamField, images: readonly RoleImage[]): RoleImage[] {
  return images.map((image) => {
    const role = field.values[image.role];
    return { url: image.url, role: isString(role) ? role : image.role };
  });
}

function mappedValue(field: MediaUpstreamField, value: TasksValue): TasksValue {
  if (isRoleImages(value)) return renamedRoles(field, value);
  const mapped = field.values[String(value)] ?? value;
  if (field.role !== null && Array.isArray(mapped)) {
    const role = field.role;
    return mapped.map((url) => ({ url, role }));
  }
  if (!field.single || !Array.isArray(mapped)) return mapped;
  return mapped[0] ?? null;
}

function roleFields(field: MediaUpstreamField, images: readonly RoleImage[]): Record<string, TasksValue> {
  const named = new Map<string, { urls: string[]; list: boolean }>();
  for (const image of images) {
    const name = field.roles[image.role];
    if (!name) continue;
    const entry = named.get(name) ?? { urls: [], list: false };
    entry.urls.push(image.url);
    entry.list ||= image.role === INPUT_ROLES.reference || entry.urls.length > 1;
    named.set(name, entry);
  }
  return Object.fromEntries([...named].map(([name, { urls, list }]) => [name, list ? urls : (urls[0] ?? null)]));
}

function withFields(
  body: Readonly<Record<string, TasksValue>>,
  fields: MediaUpstreamFields,
): Readonly<Record<string, TasksValue>> {
  const mapped: Record<string, TasksValue> = {};
  for (const [key, value] of Object.entries(body)) {
    const field = fields[key];
    if (!field) mapped[key] = value;
    else if (isRoleImages(value) && Object.keys(field.roles).length > 0)
      Object.assign(mapped, roleFields(field, value));
    else if (field.name !== null) mapped[field.name] = mappedValue(field, value);
  }
  return present<TasksValue>(mapped);
}

function generationBody(
  generation: MediaGeneration,
  urls: ReadonlyMap<MediaGenerationInput, string>,
): Readonly<Record<string, TasksValue>> {
  return withFields(defaultBody(generation, urls), generation.fields);
}

function defaultBody(
  generation: MediaGeneration,
  urls: ReadonlyMap<MediaGenerationInput, string>,
): Readonly<Record<string, TasksValue>> {
  const urlOf = (input: MediaGenerationInput) => urls.get(input) ?? "";
  const shared = {
    ...generation.params,
    model: generation.model,
    prompt: generation.prompt,
    size: generation.aspect,
    resolution: generation.resolution,
  };
  if (generation.kind === "image") {
    const references = inputsOf(generation, "reference").map(urlOf);
    return present<TasksValue>({
      ...shared,
      n: generation.count,
      image_urls: references.length > 0 ? references : undefined,
    });
  }
  const withRoles = generation.inputs.some((input) => input.role !== "first");
  const firstFrames = inputsOf(generation, "first").map(urlOf);
  return present<TasksValue>({
    ...shared,
    duration: generation.duration,
    generate_audio: generation.audio,
    image_urls: !withRoles && firstFrames.length > 0 ? firstFrames : undefined,
    image_with_roles: withRoles
      ? generation.inputs.map((input) => ({ url: urlOf(input), role: INPUT_ROLES[input.role] }))
      : undefined,
  });
}

export class TasksMediaUpstream implements MediaUpstream {
  readonly #http: MediaUpstreamHttp;

  constructor(options: MediaUpstreamOptions) {
    this.#http = new MediaUpstreamHttp(options);
  }

  #call(path: string, init: RequestInit & { idempotencyKey?: string }) {
    return this.#http.request(path, init).pipe(
      Effect.flatMap((reply) => {
        const error = refused(reply);
        return error ? Effect.fail(error) : Effect.succeed(reply);
      }),
    );
  }

  #task(providerJobId: string) {
    return this.#call(`/v1/tasks/${encodeURIComponent(providerJobId)}`, {}).pipe(
      Effect.mapError((error) =>
        error.status === 400 && error.code !== REFUSED_IN_BODY
          ? new MediaUpstreamError({ status: 404, code: error.code, retryAfterSeconds: null })
          : error,
      ),
    );
  }

  #upload(input: MediaGenerationInput, index: number): Effect.Effect<string, MediaUpstreamError> {
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), fileName(input, index));
    return this.#call(`/v1/uploads/images?retention_days=${UPLOAD_RETENTION_DAYS}`, {
      method: "POST",
      body: form,
    }).pipe(
      Effect.flatMap(({ body }) => {
        const url = readUploadedUrl(body);
        return url ? Effect.succeed(url) : Effect.fail(invalidResponse());
      }),
    );
  }

  readonly submit = Effect.fn("TasksMediaUpstream.submit")(function* (
    this: TasksMediaUpstream,
    idempotencyKey: string,
    generation: MediaGeneration,
  ): Effect.fn.Return<MediaUpstreamJob, MediaUpstreamError> {
    const uploaded = yield* Effect.forEach(generation.inputs, (input, index) => this.#upload(input, index), {
      concurrency: "unbounded",
    });
    const urls = new Map(generation.inputs.map((input, index) => [input, uploaded[index] ?? ""]));
    const { body } = yield* this.#call(`/v1/${generation.kind}s/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(generationBody(generation, urls)),
      idempotencyKey,
    });
    const job = readSubmitted(body);
    if (!job) return yield* invalidResponse();
    return job;
  }).bind(this);

  readonly status = Effect.fn("TasksMediaUpstream.status")(function* (
    this: TasksMediaUpstream,
    providerJobId: string,
  ): Effect.fn.Return<MediaUpstreamJob, MediaUpstreamError> {
    const { body } = yield* this.#task(providerJobId);
    const job = readTask(body);
    if (!job) return yield* invalidResponse();
    return job;
  }).bind(this);

  readonly result = Effect.fn("TasksMediaUpstream.result")(function* (
    this: TasksMediaUpstream,
    providerJobId: string,
  ): Effect.fn.Return<MediaUpstreamArtifact[], MediaUpstreamError> {
    const { body } = yield* this.#task(providerJobId);
    const artifacts = readArtifacts(body);
    if (!artifacts) return yield* invalidResponse();
    return artifacts;
  }).bind(this);

  download(url: string): Effect.Effect<Response, MediaUpstreamError> {
    return this.#http.download(url);
  }
}
