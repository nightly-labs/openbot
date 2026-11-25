import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { ROUTER_MEDIA_UPSTREAM } from "../src/server/media-upstream";

const AUTH_API_ROOT = resolve(import.meta.dirname, "..");
const WRANGLER = join(AUTH_API_ROOT, "..", "..", "node_modules", ".bin", "wrangler");
const CLIP_RESOLUTION = "720p";
const USD_PER_PROVIDER_CREDIT = 0.016;
const LOWEST_NET_USD_PER_CREDIT = 0.0428;
const MARGIN_FLOOR = 0.3;

type Target = "local" | "test" | "production";

interface Options {
  target: Target;
  apply: boolean;
  reprice: boolean;
  resolution: string | null;
  silent: number | "none" | null;
  persistTo: string | null;
  params: string | null;
  fields: string | null;
  specs: string | null;
  file: string | null;
  positional: string[];
}

interface RouteEntry {
  modelId: string;
  upstreamId: string;
  params: string;
  fields: string;
  specs: string;
}

interface UpstreamModel {
  id: string;
  name: string;
  kind: CreditMediaGenerationKind;
  capabilities: DynamicRecord;
  defaults: DynamicRecord;
  params: Record<string, string>;
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
  params: Record<string, string>;
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
      "  route <model> <upstream> <upstream model> [--params <json>] [--fields <json>] [--specs <json>]",
      "                                        Set how one processor runs a model; --specs narrows the options",
      '  routes <upstream> --file <json>       Set many routes: {"<model>": {"id", "params"?, "fields"?, "specs"?}}',
      "  unroute <model> <upstream>            Remove a route; the model is unavailable on that processor",
      "  switch <upstream>                     Run all models on one processor; models without a route are unavailable",
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
    params: null,
    fields: null,
    specs: null,
    file: null,
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
    } else if (arg === "--params" || arg === "--fields" || arg === "--specs" || arg === "--file") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) usage();
      if (arg === "--params") options.params = value;
      else if (arg === "--fields") options.fields = value;
      else if (arg === "--specs") options.specs = value;
      else options.file = resolve(value);
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

async function activeUpstream(options: Options): Promise<string> {
  const [row] = await query(options, "SELECT upstream FROM credit_media_settings WHERE id = 1");
  return isString(row?.upstream) ? row.upstream : ROUTER_MEDIA_UPSTREAM;
}

async function list(options: Options): Promise<void> {
  const active = await activeUpstream(options);
  const rows = await query(
    options,
    `SELECT m.model_id, m.kind, m.enabled, m.position, (
            SELECT group_concat(CASE WHEN r.upstream = ${sql(active)} THEN '*' ELSE '' END || r.upstream || '=' || r.upstream_id, ' ')
              FROM credit_media_routes r WHERE r.model_id = m.model_id) AS routes,
            group_concat(
            CASE p.resolution WHEN '' THEN '*' ELSE p.resolution END || '=' || p.credits ||
            CASE WHEN p.silent_credits IS NULL THEN '' ELSE ' (' || p.silent_credits || ' silent)' END || '/' || p.unit,
            ' ') AS prices
       FROM credit_media_models m LEFT JOIN credit_media_prices p ON p.model_id = m.model_id
      GROUP BY m.model_id ORDER BY m.kind, m.position, m.model_id`,
  );
  for (const row of rows) {
    const enabled = row.enabled === 1 ? "on " : "off";
    process.stdout.write(
      `${enabled} ${String(row.kind).padEnd(5)} ${String(row.model_id).padEnd(32)} ${row.prices ?? ""}\n` +
        `      routes: ${row.routes ?? "none"}\n`,
    );
  }
  process.stdout.write(`${rows.length} models on ${options.target}. Active processor: ${active} (* in routes).\n`);
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

function providerCreditUsd(value: unknown): number | null {
  const credits = usdNumber(value);
  return credits === null ? null : credits * USD_PER_PROVIDER_CREDIT;
}

function keepHigher(prices: Map<string, number>, key: string, amount: number): void {
  prices.set(key, Math.max(amount, prices.get(key) ?? 0));
}

function readUpstreamModel(value: unknown): UpstreamModel | null {
  if (!isDynamicRecord(value) || !isString(value.id) || !isString(value.name)) return null;
  if (value.modality !== "image" && value.modality !== "video") return null;
  if (!isDynamicRecord(value.capabilities) || !isDynamicRecord(value.pricing)) return null;
  const defaults = isDynamicRecord(value.defaults) ? value.defaults : {};
  const options = (Array.isArray(value.pricing.usd_options) ? value.pricing.usd_options : []).filter(isDynamicRecord);
  const quality =
    options.some((option) => isString(option.quality)) && isString(defaults.quality) ? defaults.quality : null;
  const usd = new Map<string, number>();
  const usdAudio = new Map<string, number>();
  let usdFlat: number | null = null;
  for (const option of options) {
    const amount = usdNumber(option.usd);
    if (amount === null || (quality !== null && option.quality !== quality)) continue;
    if (isString(option.resolution)) keepHigher(option.audio === true ? usdAudio : usd, option.resolution, amount);
    else usdFlat = Math.max(amount, usdFlat ?? 0);
  }
  const perResolution = value.pricing.usd_per_second_by_resolution;
  if (isDynamicRecord(perResolution)) {
    for (const [resolution, amount] of Object.entries(perResolution)) {
      const parsed = usdNumber(amount);
      if (parsed !== null && !usd.has(resolution)) usd.set(resolution, parsed);
    }
  }
  const creditsPerResolution = value.pricing.credits_per_second_by_resolution;
  if (isDynamicRecord(creditsPerResolution)) {
    for (const [resolution, credits] of Object.entries(creditsPerResolution)) {
      const parsed = providerCreditUsd(credits);
      if (parsed !== null && !usd.has(resolution)) usd.set(resolution, parsed);
    }
  }
  return {
    id: value.id,
    name: value.name,
    kind: value.modality,
    capabilities: value.capabilities,
    defaults,
    params: quality === null ? {} : { quality },
    usd,
    usdAudio,
    usdFlat:
      usdFlat ??
      usdNumber(value.pricing.usd_per_image) ??
      usdNumber(value.pricing.usd_per_second) ??
      providerCreditUsd(value.pricing.credits_per_image) ??
      providerCreditUsd(value.pricing.credits_per_second),
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
    const credits = flooredCredits((perUnit * audioUsd) / baseUsd, audioUsd);
    const silentCredits = flooredCredits((perUnit * silentUsd) / baseUsd, silentUsd);
    return [{ resolution, credits, silentCredits: silentCredits < credits ? silentCredits : null }];
  });
  if (priced.length > 0) return priced;
  if (upstream.usd.size > 0 || upstream.usdAudio.size > 0 || upstream.usdFlat === null) return [];
  return [{ resolution: "", credits: flooredCredits(perUnit, upstream.usdFlat), silentCredits: null }];
}

function flooredCredits(credits: number, costUsd: number): number {
  return Math.max(creditUnitRate(credits), creditUnitRate(costUsd / (LOWEST_NET_USD_PER_CREDIT * (1 - MARGIN_FLOOR))));
}

function pageKind(page: CreditModelCost): CreditMediaGenerationKind | null {
  if (page.kind === "image") return "image";
  if (page.kind === "video") return "video";
  return null;
}

function pricedSpecs(specs: DynamicRecord, prices: readonly SeedPrice[]): DynamicRecord {
  if (prices.some((price) => price.resolution === "")) return specs;
  const priced = new Set(prices.map((price) => price.resolution));
  const resolutions = specValues(specs.resolutions).filter((resolution) => priced.has(resolution));
  return { ...specs, resolutions, defaultResolution: chooseDefault(resolutions, specs.defaultResolution) };
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
    const prices = match && specs ? pricesOf(match, page, specs) : [];
    if (!match || !specs || prices.length === 0 || !isCreditMediaModelId(page.modelId)) {
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
      specs: pricedSpecs(specs, prices),
      params: match.params,
      prices,
    });
  });
  return { models, skipped };
}

function routerOnly(column: "upstream_id" | "upstream_params"): string {
  return `CASE WHEN credit_media_models.upstream = ${sql(ROUTER_MEDIA_UPSTREAM)} THEN excluded.${column} ELSE credit_media_models.${column} END`;
}

function routeStatement(upstream: string, route: RouteEntry, now: number): string {
  return `INSERT INTO credit_media_routes(model_id, upstream, upstream_id, upstream_params, upstream_fields, specs, updated_at)
       VALUES (${sql(route.modelId)}, ${sql(upstream)}, ${sql(route.upstreamId)}, ${sql(route.params)}, ${sql(route.fields)}, ${sql(route.specs)}, ${now})
       ON CONFLICT(model_id, upstream) DO UPDATE SET upstream_id = excluded.upstream_id,
         upstream_params = excluded.upstream_params, upstream_fields = excluded.upstream_fields, specs = excluded.specs,
         updated_at = excluded.updated_at;`;
}

function seedStatements(models: readonly SeedModel[], reprice: boolean, now: number): string[] {
  return models.flatMap((model) => {
    const unit = model.kind === "image" ? "item" : "second";
    const priceConflict = reprice
      ? "DO UPDATE SET unit = excluded.unit, credits = excluded.credits, silent_credits = excluded.silent_credits, updated_at = excluded.updated_at"
      : "DO NOTHING";
    return [
      `INSERT INTO credit_media_models(model_id, upstream_id, kind, name, maker, variant, position, enabled, specs, upstream_params, updated_at)
       VALUES (${sql(model.id)}, ${sql(model.upstreamId)}, ${sql(model.kind)}, ${sql(model.name)}, ${sql(model.maker)}, ${sql(model.variant)}, ${model.position}, 0, ${sql(JSON.stringify(model.specs))}, ${sql(JSON.stringify(model.params))}, ${now})
       ON CONFLICT(model_id) DO UPDATE SET upstream_id = ${routerOnly("upstream_id")}, kind = excluded.kind, name = excluded.name,
         maker = excluded.maker, variant = excluded.variant, position = excluded.position, specs = excluded.specs,
         upstream_params = ${routerOnly("upstream_params")}, updated_at = excluded.updated_at;`,
      `INSERT INTO credit_media_routes(model_id, upstream, upstream_id, upstream_params, updated_at)
       VALUES (${sql(model.id)}, ${sql(ROUTER_MEDIA_UPSTREAM)}, ${sql(model.upstreamId)}, ${sql(JSON.stringify(model.params))}, ${now})
       ON CONFLICT(model_id, upstream) DO UPDATE SET upstream_id = excluded.upstream_id,
         upstream_params = excluded.upstream_params, updated_at = excluded.updated_at;`,
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

function jsonText(text: string | null, label: string): string {
  if (text === null) return "{}";
  const value = JSON.parse(text);
  if (!isDynamicRecord(value)) throw new Error(`${label} must be a JSON object.`);
  return JSON.stringify(value);
}

function isUpstreamName(value: string | undefined): value is string {
  return value !== undefined && /^[a-z][a-z0-9-]{0,39}$/.test(value);
}

async function setRoute(options: Options): Promise<void> {
  const [modelId, upstream, upstreamId] = options.positional;
  if (!isCreditMediaModelId(modelId) || !isUpstreamName(upstream) || !upstreamId || upstreamId.length > 200) usage();
  const route = {
    modelId,
    upstreamId,
    params: jsonText(options.params, "--params"),
    fields: jsonText(options.fields, "--fields"),
    specs: jsonText(options.specs, "--specs"),
  };
  await execute(options, [routeStatement(upstream, route, Date.now())], `${modelId} on ${upstream} = ${upstreamId}`);
}

function routeEntries(value: unknown): RouteEntry[] {
  if (!isDynamicRecord(value)) throw new Error("The routes file must be a JSON object.");
  return Object.entries(value).map(([modelId, entry]) => {
    if (
      !isCreditMediaModelId(modelId) ||
      !isDynamicRecord(entry) ||
      !isString(entry.id) ||
      entry.id.length === 0 ||
      entry.id.length > 200
    )
      throw new Error(`The route of ${modelId} needs an "id" of 1 to 200 characters.`);
    const params = entry.params ?? {};
    const fields = entry.fields ?? {};
    const specs = entry.specs ?? {};
    if (!isDynamicRecord(params) || !isDynamicRecord(fields) || !isDynamicRecord(specs))
      throw new Error(`The params, fields and specs of ${modelId} must be JSON objects.`);
    return {
      modelId,
      upstreamId: entry.id,
      params: JSON.stringify(params),
      fields: JSON.stringify(fields),
      specs: JSON.stringify(specs),
    };
  });
}

async function setRoutes(options: Options): Promise<void> {
  const [upstream] = options.positional;
  if (!isUpstreamName(upstream) || options.file === null) usage();
  const routes = routeEntries(JSON.parse(await readFile(options.file, "utf8")));
  const now = Date.now();
  for (const route of routes) process.stdout.write(`${route.modelId.padEnd(32)} ${upstream}=${route.upstreamId}\n`);
  await execute(
    options,
    routes.map((route) => routeStatement(upstream, route, now)),
    `${routes.length} routes on ${upstream}`,
  );
}

async function removeRoute(options: Options): Promise<void> {
  const [modelId, upstream] = options.positional;
  if (!isCreditMediaModelId(modelId) || !isUpstreamName(upstream)) usage();
  await execute(
    options,
    [`DELETE FROM credit_media_routes WHERE model_id = ${sql(modelId)} AND upstream = ${sql(upstream)};`],
    `remove the ${upstream} route of ${modelId}`,
  );
}

async function switchUpstream(options: Options): Promise<void> {
  const [upstream] = options.positional;
  if (!isUpstreamName(upstream)) usage();
  const missing = await query(
    options,
    `SELECT m.model_id FROM credit_media_models m
      WHERE m.enabled = 1 AND NOT EXISTS (
        SELECT 1 FROM credit_media_routes r WHERE r.model_id = m.model_id AND r.upstream = ${sql(upstream)})
      ORDER BY m.kind, m.position, m.model_id`,
  );
  if (missing.length > 0)
    process.stdout.write(
      `Unavailable after the switch (no ${upstream} route): ${missing.map((row) => String(row.model_id)).join(", ")}\n`,
    );
  await execute(
    options,
    [
      `INSERT INTO credit_media_settings(id, upstream, updated_at) VALUES (1, ${sql(upstream)}, ${Date.now()})
       ON CONFLICT(id) DO UPDATE SET upstream = excluded.upstream, updated_at = excluded.updated_at;`,
    ],
    `run all models on ${upstream}; ${missing.length} enabled models become unavailable`,
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
  if (command === "route") return setRoute(options);
  if (command === "routes") return setRoutes(options);
  if (command === "unroute") return removeRoute(options);
  if (command === "switch") return switchUpstream(options);
  usage();
}

await main();
