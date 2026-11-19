import { createHash, createHmac } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createOpenBotLogger, registerSecretValue } from "@openbot/logging";
import { Schema } from "effect";
import {
  CheckResult,
  decodeStatusFile,
  Impact,
  type Incident,
  IncidentUpdate,
  ServiceId,
  type Stage,
  type StatusFile,
  serviceName,
} from "../src/model";

const logger = createOpenBotLogger("status-notify");

const { values: args } = parseArgs({
  options: {
    status: { type: "string" },
    state: { type: "string" },
    bootstrap: { type: "boolean", default: false },
    test: { type: "boolean", default: false },
    summary: { type: "string" },
    report: { type: "string" },
    now: { type: "string" },
  },
});

if (!args.status || !args.state) throw new Error("Pass --status <status.json> and --state <notify.json>.");
const STATUS_PATH = resolve(args.status);
const STATE_PATH = resolve(args.state);
const NOW = args.now ?? new Date().toISOString();
const NOW_MS = Date.parse(NOW);
if (Number.isNaN(NOW_MS)) throw new Error(`--now: "${NOW}" is not a time.`);
const IN_ACTIONS = process.env.GITHUB_ACTIONS === "true";

const SITE_URL = "https://status.openbot.run";
const TIMEOUT_MS = 10_000;
const RETRY_MINUTES = [5, 10, 20, 40, 80, 160, 320] as const;
const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
const MAX_PER_RUN = 25;
const MAX_OUTBOX = 1_000;
const SEEN_DAYS = 100;
const DAY_MS = 86_400_000;
const MIN_SECRET_LENGTH = 32;
const DISCORD_LIMIT = 2_000;
const REMOVED_AFTER_RUNS = 2;

const EVENT_TYPES = [
  "incident.created",
  "incident.updated",
  "incident.resolved",
  "maintenance.scheduled",
  "maintenance.started",
  "maintenance.updated",
  "maintenance.completed",
  "incident.removed",
  "maintenance.cancelled",
  "service.changed",
  "test",
] as const;
const EventType = Schema.Literals(EVENT_TYPES);
type EventType = typeof EventType.Type;

const DEFAULT_EVENTS: readonly EventType[] = EVENT_TYPES.filter(
  (type) => type !== "service.changed" && type !== "test",
);

const EventIncident = Schema.Struct({
  id: Schema.Int,
  url: Schema.String,
  title: Schema.String,
  kind: Schema.Literals(["incident", "maintenance"]),
  impact: Impact,
  services: Schema.Array(Schema.Struct({ id: ServiceId, name: Schema.String })),
  startedAt: Schema.String,
  resolvedAt: Schema.NullOr(Schema.String),
  update: Schema.NullOr(IncidentUpdate),
});
type EventIncident = typeof EventIncident.Type;

const EventService = Schema.Struct({
  id: ServiceId,
  name: Schema.String,
  previous: CheckResult,
  current: CheckResult,
  checkedAt: Schema.String,
});
type EventService = typeof EventService.Type;

const WebhookEvent = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  type: EventType,
  createdAt: Schema.String,
  page: Schema.String,
  incident: Schema.NullOr(EventIncident),
  service: Schema.NullOr(EventService),
});
type WebhookEvent = typeof WebhookEvent.Type;

const Delivery = Schema.Struct({
  id: Schema.String,
  subscription: Schema.String,
  event: WebhookEvent,
  attempts: Schema.Int,
  nextAt: Schema.String,
  lastError: Schema.NullOr(Schema.String),
});
type Delivery = typeof Delivery.Type;

const OpenIncident = Schema.Struct({
  incident: EventIncident,
  missing: Schema.Int,
});
type OpenIncident = typeof OpenIncident.Type;

const NotifyState = Schema.Struct({
  version: Schema.Literal(1),
  checkedAt: Schema.NullOr(Schema.String),
  services: Schema.Record(Schema.String, CheckResult),
  seen: Schema.Record(Schema.String, Schema.String),
  open: Schema.Record(Schema.String, OpenIncident),
  outbox: Schema.Array(Delivery),
});
type NotifyState = typeof NotifyState.Type;
const decodeNotifyState = Schema.decodeUnknownSync(NotifyState);

interface FoundEvent {
  id: string;
  type: EventType;
  incident: EventIncident | null;
  service: EventService | null;
  announcedBy?: string;
}

const FINAL_STAGES: ReadonlySet<Stage> = new Set(["resolved", "completed"]);

const eventIncident = (incident: Incident, update: IncidentUpdate | null): EventIncident => ({
  id: incident.id,
  url: incident.url,
  title: incident.title,
  kind: incident.kind,
  impact: incident.impact,
  services: incident.components.map((id) => ({ id, name: serviceName(id) })),
  startedAt: incident.startedAt,
  resolvedAt: incident.resolvedAt,
  update,
});

function incidentEvents(incidents: readonly Incident[]): FoundEvent[] {
  const events: FoundEvent[] = [];
  for (const incident of [...incidents].reverse()) {
    const add = (type: EventType, id: string, update: IncidentUpdate | null, announcedBy?: string) =>
      events.push({ id, type, incident: eventIncident(incident, update), service: null, announcedBy });
    const maintenance = incident.kind === "maintenance";
    const ended = incident.resolvedAt !== null && Date.parse(incident.resolvedAt) <= NOW_MS;
    const oldestFirst = [...incident.updates].reverse();
    const latest = incident.updates[0] ?? null;

    const opened = maintenance ? "maintenance.scheduled" : "incident.created";
    const openedId = `${opened}:${incident.id}`;
    add(opened, openedId, oldestFirst[0] ?? null);
    const updated = maintenance ? "maintenance.updated" : "incident.updated";
    for (const [index, update] of oldestFirst.entries()) {
      if (FINAL_STAGES.has(update.stage)) continue;
      const announcedBy = index === 0 ? openedId : undefined;
      add(updated, `${updated}:${incident.id}:${update.at}:${update.stage}`, update, announcedBy);
    }
    if (maintenance) {
      if (Date.parse(incident.startedAt) <= NOW_MS)
        add("maintenance.started", `maintenance.started:${incident.id}`, latest);
      if (ended) add("maintenance.completed", `maintenance.completed:${incident.id}`, latest);
    } else if (incident.resolvedAt !== null) {
      add("incident.resolved", `incident.resolved:${incident.id}:${incident.resolvedAt}`, latest);
    }
  }
  return events;
}

function serviceEvents(status: StatusFile, state: NotifyState): FoundEvent[] {
  const checkedAt = status.checkedAt;
  if (checkedAt === null || (state.checkedAt !== null && Date.parse(checkedAt) <= Date.parse(state.checkedAt))) {
    return [];
  }
  return status.services.flatMap((service): FoundEvent[] => {
    const previous = state.services[service.id];
    if (!previous || previous === "unknown" || service.result === "unknown" || previous === service.result) return [];
    return [
      {
        id: `service.changed:${service.id}:${checkedAt}`,
        type: "service.changed",
        incident: null,
        service: { id: service.id, name: serviceName(service.id), previous, current: service.result, checkedAt },
      },
    ];
  });
}

function openIncidents(status: StatusFile, state: NotifyState) {
  const open: Record<string, OpenIncident> = {};
  for (const incident of status.incidents) {
    if (incident.resolvedAt !== null && Date.parse(incident.resolvedAt) <= NOW_MS) continue;
    open[String(incident.id)] = { incident: eventIncident(incident, incident.updates[0] ?? null), missing: 0 };
  }
  const listed = new Set(status.incidents.map((incident) => String(incident.id)));
  const events: FoundEvent[] = [];
  for (const [id, entry] of Object.entries(state.open)) {
    if (listed.has(id)) continue;
    const missing = entry.missing + 1;
    if (missing < REMOVED_AFTER_RUNS) {
      open[id] = { ...entry, missing };
      continue;
    }
    const type = entry.incident.kind === "maintenance" ? "maintenance.cancelled" : "incident.removed";
    events.push({ id: `${type}:${id}`, type, incident: entry.incident, service: null });
  }
  return { open, events };
}

const Subscription = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,39}$/u)),
  url: Schema.String,
  secret: Schema.optionalKey(Schema.String),
  format: Schema.optionalKey(Schema.Literals(["json", "slack", "discord"])),
  events: Schema.optionalKey(Schema.Array(EventType)),
  paused: Schema.optionalKey(Schema.Boolean),
});
type Subscription = typeof Subscription.Type;

function hide(value: unknown) {
  if (typeof value !== "string" || value.length < 8) return;
  registerSecretValue(value);
  if (IN_ACTIONS) process.stdout.write(`::add-mask::${value}\n`);
}

function readSubscriptions(): Subscription[] {
  const raw = process.env.STATUS_WEBHOOKS?.trim();
  if (!raw) return [];
  registerSecretValue(raw);
  let entries: unknown;
  try {
    entries = JSON.parse(raw);
  } catch {
    throw new Error("STATUS_WEBHOOKS is not JSON.");
  }
  if (!Array.isArray(entries)) throw new Error("STATUS_WEBHOOKS must be a JSON list.");
  const ids = new Set<string>();
  return entries.map((entry: unknown, index) => {
    const name = `STATUS_WEBHOOKS entry ${index + 1}`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry))
      throw new Error(`${name} is not an object.`);
    for (const [key, value] of Object.entries(entry)) {
      if (key === "url" || key === "secret") hide(value);
      if (!(key in Subscription.fields)) throw new Error(`${name} has an unknown field "${key.slice(0, 40)}".`);
    }
    for (const [key, field] of Object.entries(Subscription.fields)) {
      if (!Schema.is(Schema.Struct({ [key]: field }))(entry)) throw new Error(`${name}: "${key}" is not valid.`);
    }
    if (!Schema.is(Subscription)(entry)) throw new Error(`${name} is not valid.`);
    const label = `Subscription "${entry.id}"`;
    if (ids.has(entry.id)) throw new Error(`${label} is in STATUS_WEBHOOKS 2 times.`);
    ids.add(entry.id);
    let url: URL;
    try {
      url = new URL(entry.url);
    } catch {
      throw new Error(`${label}: the URL is not valid.`);
    }
    hide(`${url.pathname}${url.search}`);
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
      throw new Error(`${label}: the URL must use https.`);
    }
    if ((entry.format ?? "json") === "json" && (entry.secret?.length ?? 0) < MIN_SECRET_LENGTH) {
      throw new Error(`${label}: a json subscription needs a secret of at least ${MIN_SECRET_LENGTH} characters.`);
    }
    if (entry.events?.length === 0) throw new Error(`${label}: "events" is empty. Remove it, or set paused.`);
    return entry;
  });
}

const wants = (subscription: Subscription, type: EventType) =>
  type === "test" || (subscription.events ?? DEFAULT_EVENTS).includes(type);

const TITLES: Record<EventType, string> = {
  "incident.created": "New incident",
  "incident.updated": "Incident update",
  "incident.resolved": "Incident resolved",
  "maintenance.scheduled": "Maintenance scheduled",
  "maintenance.started": "Maintenance started",
  "maintenance.updated": "Maintenance update",
  "maintenance.completed": "Maintenance complete",
  "incident.removed": "Incident removed",
  "maintenance.cancelled": "Maintenance cancelled",
  "service.changed": "Service check changed",
  test: "Test event",
};
const IMPACTS: Record<Impact, string> = {
  degraded: "Degraded performance",
  partial: "Partial outage",
  major: "Major outage",
  maintenance: "Maintenance",
};
const STAGES: Record<Stage, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  update: "Update",
  resolved: "Resolved",
  scheduled: "Scheduled",
  completed: "Completed",
};
const RESULTS: Record<CheckResult, string> = {
  ok: "operational",
  degraded: "slow",
  down: "not available",
  unknown: "not checked",
};

const utc = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

function message(event: WebhookEvent): { headline: string; lines: string[]; link: string } {
  const { incident, service } = event;
  if (incident) {
    const lines = [`${IMPACTS[incident.impact]}: ${incident.services.map((item) => item.name).join(", ")}`];
    if (incident.kind === "maintenance" && incident.resolvedAt) {
      lines.push(`${utc(incident.startedAt)} to ${utc(incident.resolvedAt)}`);
    }
    if (incident.update) lines.push(`${STAGES[incident.update.stage]}: ${incident.update.body}`);
    return { headline: `${TITLES[event.type]}: ${incident.title}`, lines, link: incident.url };
  }
  if (service) {
    return {
      headline: `${TITLES[event.type]}: ${service.name} is ${RESULTS[service.current]}`,
      lines: [`It was ${RESULTS[service.previous]}. Checked at ${utc(service.checkedAt)}.`],
      link: SITE_URL,
    };
  }
  return { headline: "Test event from the OpenBot status page", lines: ["The webhook works."], link: SITE_URL };
}

const slackText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function render(format: NonNullable<Subscription["format"]>, event: WebhookEvent): string {
  if (format === "json") return JSON.stringify(event);
  const { headline, lines, link } = message(event);
  if (format === "slack") {
    const text = [`*${slackText(headline)}*`, ...lines.map(slackText), `<${link}|Open>`].join("\n");
    return JSON.stringify({ text });
  }
  const tail = `\n<${link}>`;
  let content = [`**${headline}**`, ...lines].join("\n");
  if (content.length + tail.length > DISCORD_LIMIT) content = `${content.slice(0, DISCORD_LIMIT - tail.length - 1)}…`;
  return JSON.stringify({ content: `${content}${tail}`, allowed_mentions: { parse: [] } });
}

interface Outcome {
  ok: boolean;
  status: number | null;
  reason: string | null;
}

async function send(subscription: Subscription, delivery: Delivery): Promise<Outcome> {
  const body = render(subscription.format ?? "json", delivery.event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "openbot-status-webhook",
    "x-openbot-event": delivery.event.type,
    "x-openbot-delivery-id": delivery.id,
    "x-openbot-timestamp": timestamp,
  };
  if (subscription.secret) {
    const signature = createHmac("sha256", subscription.secret)
      .update(`${timestamp}.${delivery.id}.${body}`)
      .digest("hex");
    headers["x-openbot-signature"] = `sha256=${signature}`;
  }
  try {
    const response = await fetch(subscription.url, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await response.body?.cancel();
    if (response.status >= 200 && response.status < 300) return { ok: true, status: response.status, reason: null };
    return { ok: false, status: response.status, reason: `HTTP ${response.status}` };
  } catch (error) {
    const timeout = error instanceof Error && error.name === "TimeoutError";
    return { ok: false, status: null, reason: timeout ? "no response in 10 s" : "request failed" };
  }
}

const deliveryId = (subscription: string, event: string) =>
  createHash("sha256").update(`${subscription}\n${event}`).digest("hex").slice(0, 32);

function readState(): NotifyState {
  if (!existsSync(STATE_PATH)) {
    if (!args.bootstrap) throw new Error(`${STATE_PATH} does not exist. Run with --bootstrap only for the first run.`);
    return { version: 1, checkedAt: null, services: {}, seen: {}, open: {}, outbox: [] };
  }
  if (args.bootstrap) throw new Error(`${STATE_PATH} exists. Run without --bootstrap.`);
  return decodeNotifyState(JSON.parse(readFileSync(STATE_PATH, "utf8")));
}

const writeFile = (path: string, content: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const subscriptions = readSubscriptions();
const active = subscriptions.filter((subscription) => !subscription.paused);
const activeIds = new Set(active.map((subscription) => subscription.id));
const status = decodeStatusFile(JSON.parse(readFileSync(STATUS_PATH, "utf8")));
const previous = readState();

const incidents = openIncidents(status, previous);
const found = [...incidentEvents(status.incidents), ...incidents.events, ...serviceEvents(status, previous)];
const unseen = args.bootstrap ? [] : found.filter((event) => !Object.hasOwn(previous.seen, event.id));
const unseenIds = new Set(unseen.map((event) => event.id));
const fresh = unseen.filter((event) => !(event.announcedBy && unseenIds.has(event.announcedBy)));
if (args.test) fresh.push({ id: `test:${NOW}`, type: "test", incident: null, service: null });
if (args.bootstrap) logger.warn(`Bootstrap: ${found.length} current events are marked as sent.`);
if (subscriptions.length === 0) logger.info("STATUS_WEBHOOKS has no subscriptions.");

interface Dropped {
  delivery: string;
  subscription: string;
  type: EventType;
  reason: string;
}
const dropped: Dropped[] = [];
const drop = (delivery: Delivery, reason: string) =>
  dropped.push({ delivery: delivery.id, subscription: delivery.subscription, type: delivery.event.type, reason });

let outbox: Delivery[] = [];
for (const delivery of previous.outbox) {
  if (activeIds.has(delivery.subscription)) outbox.push(delivery);
  else drop(delivery, "The subscription is paused or removed.");
}
const waiting = new Set(outbox.map((delivery) => delivery.id));
const queued: Delivery[] = fresh.flatMap((event) =>
  active
    .filter((subscription) => wants(subscription, event.type))
    .map(
      (subscription): Delivery => ({
        id: deliveryId(subscription.id, event.id),
        subscription: subscription.id,
        event: {
          version: 1,
          id: event.id,
          type: event.type,
          createdAt: NOW,
          page: SITE_URL,
          incident: event.incident,
          service: event.service,
        },
        attempts: 0,
        nextAt: NOW,
        lastError: null,
      }),
    )
    .filter((delivery) => !waiting.has(delivery.id)),
);
outbox.push(...queued);
for (const delivery of outbox.splice(0, Math.max(0, outbox.length - MAX_OUTBOX))) drop(delivery, "The outbox is full.");

interface Sent extends Outcome {
  delivery: string;
  subscription: string;
  type: EventType;
  attempt: number;
}
const sent: Sent[] = [];
await Promise.all(
  active.map(async (subscription) => {
    const due = outbox
      .filter((delivery) => delivery.subscription === subscription.id && Date.parse(delivery.nextAt) <= NOW_MS)
      .slice(0, MAX_PER_RUN);
    for (const delivery of due) {
      const outcome = await send(subscription, delivery);
      sent.push({
        ...outcome,
        delivery: delivery.id,
        subscription: subscription.id,
        type: delivery.event.type,
        attempt: delivery.attempts + 1,
      });
      if (!outcome.ok) break;
    }
  }),
);

const outcomes = new Map(sent.map((item) => [item.delivery, item]));
outbox = outbox.flatMap((delivery): Delivery[] => {
  const outcome = outcomes.get(delivery.id);
  if (!outcome) return [delivery];
  if (outcome.ok) return [];
  const attempts = delivery.attempts + 1;
  const wait = RETRY_MINUTES[attempts - 1];
  if (wait === undefined) {
    drop(delivery, `Failed after ${attempts} tries: ${outcome.reason}`);
    return [];
  }
  return [
    {
      ...delivery,
      attempts,
      nextAt: new Date(NOW_MS + wait * 60_000).toISOString(),
      lastError: outcome.reason,
    },
  ];
});

const live = new Set(status.incidents.map((incident) => String(incident.id)));
const seen = Object.fromEntries(
  Object.entries(previous.seen).filter(
    ([id, at]) => NOW_MS - Date.parse(at) < SEEN_DAYS * DAY_MS || live.has(id.split(":")[1] ?? ""),
  ),
);
for (const event of found) seen[event.id] ??= NOW;

const newer =
  status.checkedAt !== null &&
  (previous.checkedAt === null || Date.parse(status.checkedAt) > Date.parse(previous.checkedAt));
const state: NotifyState = {
  version: 1,
  checkedAt: newer ? status.checkedAt : previous.checkedAt,
  services: newer
    ? Object.fromEntries(status.services.map((service) => [service.id, service.result]))
    : previous.services,
  seen,
  open: incidents.open,
  outbox,
};
writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);

for (const item of sent) {
  const text = `${item.subscription}: ${item.type}, try ${item.attempt} of ${MAX_ATTEMPTS}`;
  if (item.ok) logger.info(`${text}: delivered (HTTP ${item.status}).`);
  else logger.warn(`${text}: ${item.reason}.`);
}
for (const item of dropped) {
  logger.error(`${item.subscription}: ${item.type} is not delivered. ${item.reason}`);
  if (IN_ACTIONS)
    process.stdout.write(`::warning title=Status webhook::${item.subscription}: ${item.type}. ${item.reason}\n`);
}
const delivered = sent.filter((item) => item.ok).length;
const totals = `${queued.length} queued, ${delivered} delivered, ${outbox.length} waiting, ${dropped.length} not delivered.`;
logger.info(totals);

if (args.summary) {
  const rows = [
    ...sent.map((item) => {
      const next = outbox.find((delivery) => delivery.id === item.delivery)?.nextAt;
      const result = item.ok
        ? `Delivered (HTTP ${item.status})`
        : next
          ? `${item.reason}. Next try at ${utc(next)}`
          : `${item.reason}. No more tries`;
      return `| ${item.subscription} | ${item.type} | ${item.attempt} | ${result} |`;
    }),
    ...dropped
      .filter((item) => !outcomes.has(item.delivery))
      .map((item) => `| ${item.subscription} | ${item.type} | - | ${item.reason} |`),
  ];
  const table = rows.length
    ? ["| Subscription | Event | Try | Result |", "| --- | --- | --- | --- |", ...rows].join("\n")
    : "No deliveries in this run.";
  appendFileSync(resolve(args.summary), `### Status webhooks\n\n${table}\n\n${totals}\n`);
}

if (args.report) {
  const report = {
    now: NOW,
    bootstrap: args.bootstrap,
    test: args.test,
    found: found.map((event) => event.id),
    queued: queued.map((item) => ({ delivery: item.id, subscription: item.subscription, type: item.event.type })),
    sent,
    dropped,
    waiting: outbox.length,
  };
  writeFile(resolve(args.report), `${JSON.stringify(report, null, 2)}\n`);
}
