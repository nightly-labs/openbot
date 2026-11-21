import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  CREDIT_MEDIA_COUNT_LIMIT,
  CREDIT_MEDIA_REFERENCE_LIMIT,
  type CreditMediaGenerationKind,
  isCreditMediaModelId,
  isCreditMediaSpecValue,
} from "@openbot/contracts/credit-media";
import {
  CREDIT_CLIP_SECONDS,
  CREDIT_MODEL_COSTS,
  CREDIT_MODEL_MAKERS,
  type CreditModelCost,
  creditUnitRate,
} from "@openbot/contracts/credits";
import { type DynamicRecord, isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";

const AUTH_API_ROOT = resolve(import.meta.dirname, "..");
const WRANGLER = join(AUTH_API_ROOT, "..", "..", "node_modules", ".bin", "wrangler");
const CLIP_RESOLUTION = "720p";

type Target = "local" | "test" | "production";

interface Options {
  target: Target;
  apply: boolean;
  reprice: boolean;
  resolution: string | null;
  silent: number | "none" | null;
  persistTo: string | null;
  positional: string[];
}

interface UpstreamModel {
  id: string;
  name: string;
  kind: CreditMediaGenerationKind;
  capabilities: DynamicRecord;
  defaults: DynamicRecord;
  usd: Map<string, number>;
  usdAudio: Map<string, number>;
  usdFlat: number | null;
}

interface SeedPrice {
  resolution: string;
  credits: number;
  silentCredits: number | null;
}

interface SeedModel {
  id: string;
  upstreamId: string;
  kind: CreditMediaGenerationKind;
  name: string;
  maker: string;
  variant: string | null;
  position: number;
  specs: DynamicRecord;
  prices: SeedPrice[];
}

function usage(): never {
  process.stdout.write(
    [
      "Usage: bun apps/auth-api/scripts/media-catalog.ts <command> [target] [--apply]",
      "Commands:",
      "  list                                  Show models and prices",
      "  seed [--reprice]                      Add or refresh models from the media API; new models are disabled",
      "  price <model> <credits> [--resolution <r>] [--silent <credits>|none]",
      "                                        Set one price (credits per image or per second); --silent is the",
      "                                        lower price with audio off",
      "  enable <model>... | disable <model>...",
      "Targets: --local [--persist-to <dir>] (default), --test, --production --confirm-production",
      "Changes run only with --apply. seed reads MEDIA_API_URL and MEDIA_API_KEY.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

function readOptions(args: string[]): Options {
  const options: Options = {
    target: "local",
    apply: false,
    reprice: false,
    resolution: null,
    silent: null,
    persistTo: null,
    positional: [],
  };
  let confirmed = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--local") options.target = "local";
    else if (arg === "--test") options.target = "test";
    else if (arg === "--production") options.target = "production";
    else if (arg === "--confirm-production") confirmed = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--reprice") options.reprice = true;
    else if (arg === "--resolution") {
      options.resolution = args[index + 1] ?? null;
      index += 1;
    } else if (arg === "--silent") {
      const value = args[index + 1] ?? "";
      options.silent = value === "none" ? "none" : Number(value);
      index += 1;
    } else if (arg === "--persist-to") {
      options.persistTo = args[index + 1] ? resolve(args[index + 1] ?? "") : null;
      index += 1;
    } else if (arg.startsWith("--")) usage();
    else options.positional.push(arg);
  }
  if (options.persistTo !== null && options.target !== "local") usage();
  if (options.target === "production" && options.apply && !confirmed) {
    throw new Error("Production changes need --confirm-production.");
  }
  return options;
}

function sql(value: string | number | null): string {
  if (value === null) return "NULL";
  if (isNumber(value)) return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function wranglerArgs(options: Options): string[] {
  const database = options.target === "test" ? "openbot-auth-test" : "openbot-auth";
  const mode = options.target === "local" ? ["--local"] : ["--remote"];
  const environment = options.target === "test" ? ["--env", "test"] : [];
  const persist = options.persistTo ? ["--persist-to", options.persistTo] : [];
  return ["d1", "execute", database, ...mode, ...environment, ...persist];
}

function runWrangler(args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(WRANGLER, args, { cwd: AUTH_API_ROOT, stdio: ["ignore", "pipe", "inherit"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolvePromise(output) : reject(new Error(`wrangler failed with exit code ${code ?? "unknown"}.`)),
    );
  });
}

async function query(options: Options, statement: string): Promise<DynamicRecord[]> {
  const output = await runWrangler([...wranglerArgs(options), "--json", "--command", statement]);
  const parsed = JSON.parse(output.slice(output.indexOf("[")));
  const first = Array.isArray(parsed) ? parsed[0] : null;
  if (!isDynamicRecord(first) || !Array.isArray(first.results)) throw new Error("wrangler returned no results.");
  return first.results.filter(isDynamicRecord);
}

async function execute(options: Options, statements: string[], summary: string): Promise<void> {
  if (!options.apply) {
    process.stdout.write(`Dry run on ${options.target}: ${summary}. Add --apply to write.\n`);
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), "openbot-media-catalog-"));
  try {
    const file = join(directory, "change.sql");
    await writeFile(file, `${statements.join("\n")}\n`, { mode: 0o600 });
    await runWrangler([...wranglerArgs(options), "--file", file, "--yes"]);
    process.stdout.write(`Applied on ${options.target}: ${summary}.\n`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function list(options: Options): Promise<void> {
  const rows = await query(
    options,
    `SELECT m.model_id, m.kind, m.enabled, m.position, group_concat(
            CASE p.resolution WHEN '' THEN '*' ELSE p.resolution END || '=' || p.credits ||
            CASE WHEN p.silent_credits IS NULL THEN '' ELSE ' (' || p.silent_credits || ' silent)' END || '/' || p.unit,
            ' ') AS prices
       FROM credit_media_models m LEFT JOIN credit_media_prices p ON p.model_id = m.model_id
      GROUP BY m.model_id ORDER BY m.kind, m.position, m.model_id`,
  );
  for (const row of rows) {
    const enabled = row.enabled === 1 ? "on " : "off";
    process.stdout.write(
      `${enabled} ${String(row.kind).padEnd(5)} ${String(row.model_id).padEnd(32)} ${row.prices ?? ""}\n`,
    );
  }
  process.stdout.write(`${rows.length} models on ${options.target}.\n`);
}

function normalizedName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function usdNumber(value: unknown): number | null {
  const number = isString(value) ? Number(value) : isNumber(value) ? value : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

function readUpstreamModel(value: unknown): UpstreamModel | null {
  if (!isDynamicRecord(value) || !isString(value.id) || !isString(value.name)) return null;
  if (value.modality !== "image" && value.modality !== "video") return null;
  if (!isDynamicRecord(value.capabilities) || !isDynamicRecord(value.pricing)) return null;
  const usd = new Map<string, number>();
  const usdAudio = new Map<string, number>();
  const options = Array.isArray(value.pricing.usd_options) ? value.pricing.usd_options : [];
  for (const option of options) {
    const amount = isDynamicRecord(option) ? usdNumber(option.usd) : null;
    if (!isDynamicRecord(option) || !isString(option.resolution) || amount === null) continue;
    (option.audio === true ? usdAudio : usd).set(option.resolution, amount);
  }
  const perResolution = value.pricing.usd_per_second_by_resolution;
  if (isDynamicRecord(perResolution)) {
    for (const [resolution, amount] of Object.entries(perResolution)) {
      const parsed = usdNumber(amount);
      if (parsed !== null && !usd.has(resolution)) usd.set(resolution, parsed);
    }
  }
  return {
    id: value.id,
    name: value.name,
    kind: value.modality,
    capabilities: value.capabilities,
    defaults: isDynamicRecord(value.defaults) ? value.defaults : {},
    usd,
    usdAudio,
    usdFlat: usdNumber(value.pricing.usd_per_image) ?? usdNumber(value.pricing.usd_per_second),
  };
}

async function fetchUpstreamModels(): Promise<UpstreamModel[]> {
  const baseUrl = process.env.MEDIA_API_URL?.replace(/\/+$/, "");
  const apiKey = process.env.MEDIA_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("MEDIA_API_URL and MEDIA_API_KEY are required for seed.");
  const models: UpstreamModel[] = [];
  for (const kind of ["image", "video"]) {
    const response = await fetch(`${baseUrl}/v1/${kind}-router/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`The media API returned ${response.status} for the ${kind} models.`);
    const body = await response.json();
    const data = isDynamicRecord(body) && isDynamicRecord(body.data) ? body.data : null;
    const items = data && Array.isArray(data.models) ? data.models : [];
    for (const item of items) {
      const model = readUpstreamModel(item);
      if (model) models.push(model);
    }
  }
  return models;
}

function specValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isCreditMediaSpecValue) : [];
}

function chooseDefault(values: readonly string[], preferred: unknown): string | null {
  if (isString(preferred) && values.includes(preferred)) return preferred;
  return values[0] ?? null;
}

function durationRange(value: unknown): number[] {
  if (!isDynamicRecord(value) || !isNumber(value.min) || !isNumber(value.max)) return [];
  const min = Math.max(1, Math.ceil(value.min));
  const max = Math.min(60, Math.floor(value.max));
  return Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index);
}

function specsOf(upstream: UpstreamModel): DynamicRecord | null {
  const capabilities = upstream.capabilities;
  const aspects = specValues(capabilities.aspect_ratios);
  const resolutions = specValues(capabilities.resolutions);
  const shared = {
    aspects,
    defaultAspect: chooseDefault(aspects, upstream.defaults.aspect_ratio),
    resolutions,
    defaultResolution: chooseDefault(resolutions, upstream.defaults.resolution),
  };
  if (upstream.kind === "image") {
    const textToImage = capabilities.text_to_image !== false;
    if (!textToImage && capabilities.image_edit !== true) return null;
    return {
      ...shared,
      durations: [],
      defaultDuration: null,
      frames: 0,
      references: capabilities.image_edit === true ? CREDIT_MEDIA_REFERENCE_LIMIT : 0,
      audio: false,
      maxCount: Math.min(
        CREDIT_MEDIA_COUNT_LIMIT,
        isNumber(capabilities.max_images) ? Math.max(1, capabilities.max_images) : 1,
      ),
      promptRequired: textToImage,
    };
  }
  const imageToVideo = capabilities.image_to_video === true;
  if (capabilities.text_to_video !== true && !imageToVideo) return null;
  const durations = durationRange(capabilities.duration_seconds);
  if (durations.length === 0) return null;
  const preferredDuration = isNumber(upstream.defaults.duration) ? upstream.defaults.duration : CREDIT_CLIP_SECONDS;
  return {
    ...shared,
    durations,
    defaultDuration: durations.includes(preferredDuration) ? preferredDuration : (durations[0] ?? null),
    frames: imageToVideo ? (capabilities.end_frame === true ? 2 : 1) : 0,
    references: capabilities.reference_images === true ? CREDIT_MEDIA_REFERENCE_LIMIT : 0,
    audio: isBoolean(capabilities.audio) ? capabilities.audio : false,
    maxCount: 1,
    promptRequired: capabilities.text_to_video === true,
  };
}

function pricesOf(upstream: UpstreamModel, page: CreditModelCost, specs: DynamicRecord): SeedPrice[] {
  const resolutions = specValues(specs.resolutions);
  const perUnit = page.unit === "clip" ? page.credits / CREDIT_CLIP_SECONDS : page.credits;
  const baseResolution =
    page.unit === "clip" && resolutions.includes(CLIP_RESOLUTION)
      ? CLIP_RESOLUTION
      : isString(specs.defaultResolution)
        ? specs.defaultResolution
        : null;
  const baseUsd = (baseResolution ? upstream.usd.get(baseResolution) : undefined) ?? upstream.usdFlat;
  const audio = specs.audio === true;
  const priced = resolutions.flatMap((resolution) => {
    const silentUsd = upstream.usd.get(resolution);
    if (!silentUsd || !baseUsd) return [];
    const audioUsd = audio ? Math.max(silentUsd, upstream.usdAudio.get(resolution) ?? silentUsd) : silentUsd;
    const credits = creditUnitRate((perUnit * audioUsd) / baseUsd);
    const silentCredits = creditUnitRate((perUnit * silentUsd) / baseUsd);
    return [{ resolution, credits, silentCredits: silentCredits < credits ? silentCredits : null }];
  });
  if (priced.length > 0) return priced;
  if (audio && upstream.usdAudio.size > 0) throw new Error(`${upstream.id} has audio prices with no resolution.`);
  return [{ resolution: "", credits: creditUnitRate(perUnit), silentCredits: null }];
}

function pageKind(page: CreditModelCost): CreditMediaGenerationKind | null {
  if (page.kind === "image") return "image";
  if (page.kind === "video") return "video";
  return null;
}

function seedModels(upstream: readonly UpstreamModel[]): { models: SeedModel[]; skipped: string[] } {
  const models: SeedModel[] = [];
  const skipped: string[] = [];
  CREDIT_MODEL_COSTS.forEach((page, position) => {
    const kind = pageKind(page);
    const names = [page.variant ? `${page.name} ${page.variant}` : null, page.name]
      .filter(isString)
      .map(normalizedName);
    const match = names
      .flatMap((name) => upstream.filter((model) => normalizedName(model.name) === name))
      .find((model) => model.kind === kind);
    const specs = match ? specsOf(match) : null;
    if (!match || !specs || !isCreditMediaModelId(page.modelId)) {
      skipped.push(page.modelId);
      return;
    }
    models.push({
      id: page.modelId,
      upstreamId: match.id,
      kind: match.kind,
      name: page.name,
      maker: CREDIT_MODEL_MAKERS[page.maker],
      variant: page.variant ?? null,
      position,
      specs,
      prices: pricesOf(match, page, specs),
    });
  });
  return { models, skipped };
}

function seedStatements(models: readonly SeedModel[], reprice: boolean, now: number): string[] {
  return models.flatMap((model) => {
    const unit = model.kind === "image" ? "item" : "second";
    const priceConflict = reprice
      ? "DO UPDATE SET unit = excluded.unit, credits = excluded.credits, silent_credits = excluded.silent_credits, updated_at = excluded.updated_at"
      : "DO NOTHING";
    return [
      `INSERT INTO credit_media_models(model_id, upstream_id, kind, name, maker, variant, position, enabled, specs, upstream_params, updated_at)
       VALUES (${sql(model.id)}, ${sql(model.upstreamId)}, ${sql(model.kind)}, ${sql(model.name)}, ${sql(model.maker)}, ${sql(model.variant)}, ${model.position}, 0, ${sql(JSON.stringify(model.specs))}, '{}', ${now})
       ON CONFLICT(model_id) DO UPDATE SET upstream_id = excluded.upstream_id, kind = excluded.kind, name = excluded.name,
         maker = excluded.maker, variant = excluded.variant, position = excluded.position, specs = excluded.specs,
         updated_at = excluded.updated_at;`,
      ...(reprice ? [`DELETE FROM credit_media_prices WHERE model_id = ${sql(model.id)};`] : []),
      ...model.prices.map(
        (price) =>
          `INSERT INTO credit_media_prices(model_id, resolution, unit, credits, silent_credits, updated_at)
           VALUES (${sql(model.id)}, ${sql(price.resolution)}, ${sql(unit)}, ${price.credits}, ${sql(price.silentCredits)}, ${now})
           ON CONFLICT(model_id, resolution) ${priceConflict};`,
      ),
    ];
  });
}

async function seed(options: Options): Promise<void> {
  const { models, skipped } = seedModels(await fetchUpstreamModels());
  if (skipped.length > 0) process.stdout.write(`Not seeded (no supported match): ${skipped.join(", ")}\n`);
  for (const model of models) {
    const prices = model.prices
      .map(
        (price) =>
          `${price.resolution || "*"}=${price.credits}${price.silentCredits === null ? "" : ` (${price.silentCredits} silent)`}`,
      )
      .join(" ");
    process.stdout.write(`${model.kind.padEnd(5)} ${model.id.padEnd(32)} ${prices}\n`);
  }
  await execute(
    options,
    seedStatements(models, options.reprice, Date.now()),
    `${models.length} models${options.reprice ? " with new prices" : ""}`,
  );
}

async function setPrice(options: Options): Promise<void> {
  const [modelId, creditsText] = options.positional;
  const credits = Number(creditsText);
  if (!isCreditMediaModelId(modelId) || !Number.isFinite(credits) || credits <= 0) usage();
  if (options.resolution !== null && !isCreditMediaSpecValue(options.resolution)) usage();
  const silent = options.silent;
  if (silent !== null && silent !== "none" && !(Number.isFinite(silent) && silent > 0 && silent < credits)) usage();
  const resolution = options.resolution ?? "";
  const now = Date.now();
  const silentValue = silent === null ? "NULL" : sql(silent === "none" ? null : silent);
  const silentUpdate =
    silent === null
      ? "CASE WHEN silent_credits < excluded.credits THEN silent_credits ELSE NULL END"
      : "excluded.silent_credits";
  await execute(
    options,
    [
      `INSERT INTO credit_media_prices(model_id, resolution, unit, credits, silent_credits, updated_at)
       SELECT model_id, ${sql(resolution)}, CASE kind WHEN 'image' THEN 'item' ELSE 'second' END, ${credits}, ${silentValue}, ${now}
         FROM credit_media_models WHERE model_id = ${sql(modelId)}
       ON CONFLICT(model_id, resolution) DO UPDATE SET credits = excluded.credits,
         silent_credits = ${silentUpdate}, updated_at = excluded.updated_at;`,
    ],
    `${modelId} ${resolution || "*"} = ${credits} credits${typeof silent === "number" ? `, ${silent} silent` : ""}`,
  );
}

async function setEnabled(options: Options, enabled: boolean): Promise<void> {
  const ids = options.positional;
  if (ids.length === 0 || !ids.every(isCreditMediaModelId)) usage();
  await execute(
    options,
    [
      `UPDATE credit_media_models SET enabled = ${enabled ? 1 : 0}, updated_at = ${Date.now()}
        WHERE model_id IN (${ids.map(sql).join(", ")});`,
    ],
    `${enabled ? "enable" : "disable"} ${ids.join(", ")}`,
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const options = readOptions(rest);
  if (command === "list") return list(options);
  if (command === "seed") return seed(options);
  if (command === "price") return setPrice(options);
  if (command === "enable") return setEnabled(options, true);
  if (command === "disable") return setEnabled(options, false);
  usage();
}

await main();
