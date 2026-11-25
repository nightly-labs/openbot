import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAgentApi } from "@near-intents-agent-api/sdk";
import { type NearWalletStatus, parseNearRuleInput, parseNearWalletCreateInput } from "@openbot/contracts/ipc";
import { Effect, Result } from "effect";
import { z } from "zod";
import type { NearPaymentRequest } from "../src/backend/near-wallet";
import { NearWalletService } from "../src/main/near-wallet-service";
import { NearOwnerSigning } from "../src/main/near-wallet-signing";
import { NearWalletStore } from "../src/main/near-wallet-store";
import {
  FakeAgentApi,
  KeyedNearGateway,
  PAGE_ORIGIN,
  PARTNER_KEY,
  RecordingCipher,
  SigningPage,
  withDeadline,
} from "./near-wallet-fake-api";

const OUT = resolve(import.meta.dirname, "../.openbot-build/near-wallet-bench");
const AGENT = "bench-agent";
const DOMAIN = "api.example.com";
const MERCHANT = "merchant.near";
const LIVE_ROUNDS = Number(process.env.NEAR_BENCH_LIVE_ROUNDS ?? "10");
const PAYMENTS = Number(process.env.NEAR_BENCH_PAYMENTS ?? "25");
const PARALLEL = Number(process.env.NEAR_BENCH_PARALLEL ?? "10");
const FALLBACK_DELAY_MS = 250;
const REUSE_LIVE = process.env.NEAR_BENCH_REUSE_LIVE;
const savedLiveSchema = z.object({ live: z.object({ samplesMs: z.array(z.number()) }) });

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

interface Call {
  method: string;
  route: string;
  status: number;
  ms: number;
}

interface Operation {
  kind: string;
  ok: boolean;
  ms: number;
  requests: number;
  signatures: number;
  routes: string[];
  error: string | null;
}

function routeOf(path: string): string {
  return path
    .replace(/[0-9a-f]{64}/gu, ":agent")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu, ":id");
}

function timedFetch(calls: Call[]): typeof fetch {
  const timed = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const started = performance.now();
    const record = (status: number) =>
      calls.push({ method, route: routeOf(url.pathname), status, ms: performance.now() - started });
    try {
      const response = await fetch(input, init);
      record(response.status);
      return response;
    } catch (error) {
      record(0);
      throw error;
    }
  };
  return Object.assign(timed, { preconnect: fetch.preconnect });
}

function percentile(values: number[], share: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1));
  return Math.round(sorted[index] ?? 0);
}

function stats(values: number[]) {
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    min: percentile(values, 0),
    max: percentile(values, 1),
  };
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

async function attempt<A>(
  effect: Effect.Effect<A, { readonly message: string }>,
): Promise<{ value: A; error: null } | { value: null; error: string }> {
  const result = await Effect.runPromise(Effect.result(effect));
  return Result.isSuccess(result)
    ? { value: result.success, error: null }
    : { value: null, error: result.failure.message };
}

async function statusError(effect: Effect.Effect<NearWalletStatus, { readonly message: string }>) {
  const result = await attempt(effect);
  return result.error ?? result.value.error;
}

async function liveReads(calls: Call[]): Promise<{ agentFound: boolean; error: string | null }> {
  const apiKey = process.env.NEAR_INTENTS_PARTNER_KEY;
  if (!apiKey) return { agentFound: false, error: "NEAR_INTENTS_PARTNER_KEY is not set" };
  const api = createAgentApi({
    apiKey,
    fetch: timedFetch(calls),
    ...(process.env.NEAR_LIVE_API_URL ? { baseUrl: process.env.NEAR_LIVE_API_URL } : {}),
  });
  try {
    const agentId = (await api.listAgents()).data[0]?.id ?? null;
    for (let round = 0; round < LIVE_ROUNDS; round += 1) {
      await api.whoami();
      await api.getNetwork();
      await api.getTokens();
      if (!agentId) continue;
      await api.getAgent(agentId);
      await api.getBalances(agentId);
      await api.getPolicy(agentId);
      await api.listGrants(agentId);
    }
    return { agentFound: agentId !== null, error: null };
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { agentFound: false, error: message.split(apiKey).join("<partner-key>") };
  }
}

function payment(requestId: string, amount: string): NearPaymentRequest {
  return {
    agentId: AGENT,
    threadId: "bench-thread",
    requestId,
    domain: DOMAIN,
    recipient: MERCHANT,
    asset: "USDC",
    amount,
    reason: "A paid API call in the wallet benchmark",
  };
}

async function devnet(delays: number[]) {
  const dir = await mkdtemp(join(tmpdir(), "openbot-near-wallet-bench-"));
  const api = new FakeAgentApi();
  const calls: Call[] = [];
  const operations: Operation[] = [];
  const random = seeded(7133);
  const pick = () => (delays.length ? (delays[Math.floor(random() * delays.length)] ?? 0) : FALLBACK_DELAY_MS);
  api.latencyMs = () => pick();
  await api.start();
  const page = new SigningPage();
  const store = new NearWalletStore(join(dir, "near-wallet.json"), new RecordingCipher());
  const signing = new NearOwnerSigning({ pageOrigin: PAGE_ORIGIN, openExternal: page.openExternal, loopback: true });
  const gateway = new KeyedNearGateway(PARTNER_KEY, timedFetch(calls));
  const service = new NearWalletService({ store, signing, gateway, baseUrl: api.baseUrl });

  const waitFor = (label: string, matches: (status: NearWalletStatus) => boolean) =>
    withDeadline(
      label,
      new Promise<NearWalletStatus>((done) => {
        if (matches(service.status())) return done(service.status());
        const stop = service.onChanged((status) => {
          if (!matches(status)) return;
          stop();
          done(status);
        });
      }),
    );

  const measure = async (kind: string, body: () => Promise<string | null>): Promise<void> => {
    const callMark = calls.length;
    const visitMark = page.visits.length;
    const started = performance.now();
    const error = await body().catch((cause: unknown) => (cause instanceof Error ? cause.message : String(cause)));
    await page.settle();
    const made = calls.slice(callMark);
    operations.push({
      kind,
      ok: error === null,
      ms: Math.round(performance.now() - started),
      requests: made.length,
      signatures: page.visits.length - visitMark,
      routes: made.map((call) => `${call.method} ${call.route}`),
      error,
    });
  };

  const payOnce = async (requestId: string, amount: string, expected: "paid" | "failed") => {
    const plan = await attempt(service.prepare(payment(requestId, amount)));
    if (plan.error !== null) return `prepare: ${plan.error}`;
    const paid = await attempt(service.pay(requestId));
    if (paid.error !== null) return `pay: ${paid.error}`;
    return paid.value.status === expected ? null : `status ${paid.value.status}: ${paid.value.detail ?? ""}`;
  };

  try {
    await Effect.runPromise(service.load());
    await measure("create wallet", async () => {
      const input = parseNearWalletCreateInput({ dailyBudgetUsd: "500", agentIds: [AGENT] });
      assert.ok(input);
      await Effect.runPromise(service.create(input));
      const status = await waitFor(
        "create",
        (current) => (current.state === "ready" && current.signing === null) || current.error !== null,
      );
      return status.error;
    });
    for (let index = 0; index < PAYMENTS; index += 1)
      await measure("payment with owner approval", () => payOnce(`ask-${index}`, "1", "paid"));
    for (let index = 0; index < 5; index += 1)
      await measure("payment over the daily budget", () => payOnce(`over-${index}`, "600", "failed"));
    for (let index = 0; index < 3; index += 1) {
      await measure("change budget", () => statusError(service.setBudget(index % 2 ? "500" : "400")));
      await measure("freeze", () => statusError(service.freeze()));
      await measure("unfreeze", () => statusError(service.unfreeze()));
    }
    await measure("turn on auto-pay rule", async () => {
      const rule = parseNearRuleInput({ domain: DOMAIN, recipients: [MERCHANT], dailyUsd: 100 });
      assert.ok(rule);
      return statusError(service.saveRule(rule));
    });
    for (let index = 0; index < PAYMENTS; index += 1)
      await measure("auto payment", () => payOnce(`auto-${index}`, "1", "paid"));
    const parallelMs: number[] = [];
    await measure(`${PARALLEL} auto payments at once`, async () => {
      const errors = await Promise.all(
        Array.from({ length: PARALLEL }, async (_, index) => {
          const started = performance.now();
          const error = await payOnce(`parallel-${index}`, "1", "paid");
          parallelMs.push(performance.now() - started);
          return error;
        }),
      );
      const failed = errors.filter((error) => error !== null);
      return failed.length ? `${failed.length} failed: ${failed[0]}` : null;
    });
    for (let index = 0; index < 5; index += 1) await measure("refresh", () => statusError(service.refresh()));
    const agentId = store.read().wallet?.agentId ?? "";
    return { calls, operations, parallelMs, spentUsd: api.spentUsd(agentId), balanceLeftRaw: String(api.balanceRaw) };
  } finally {
    await Effect.runPromise(service.dispose());
    await api.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

function summarizeCalls(calls: Call[]) {
  return [...groupBy(calls, (call) => `${call.method} ${call.route}`)].map(([route, items]) => ({
    route,
    errors: items.filter((item) => item.status === 0 || item.status >= 500).length,
    ...stats(items.map((item) => item.ms)),
  }));
}

function summarizeOperations(operations: Operation[]) {
  return [...groupBy(operations, (item) => item.kind)].map(([kind, items]) => ({
    kind,
    ok: items.filter((item) => item.ok).length,
    failed: items.filter((item) => !item.ok).length,
    requestsPerOp: stats(items.map((item) => item.requests)).p50,
    signaturesPerOp: stats(items.map((item) => item.signatures)).p50,
    errors: [...new Set(items.flatMap((item) => (item.error ? [item.error] : [])))],
    ...stats(items.map((item) => item.ms)),
  }));
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const liveCalls: Call[] = [];
  const saved = REUSE_LIVE ? savedLiveSchema.parse(JSON.parse(await readFile(REUSE_LIVE, "utf8"))) : null;
  process.stdout.write(
    saved ? `live: reuse samples from ${REUSE_LIVE}\n` : `live: ${LIVE_ROUNDS} rounds of read-only calls\n`,
  );
  const live = saved ? { agentFound: true, error: null } : await liveReads(liveCalls);
  const warm = liveCalls.slice(1).filter((call) => call.status > 0 && call.status < 500);
  const delays = saved ? saved.live.samplesMs : warm.map((call) => Math.round(call.ms));
  process.stdout.write(`live: ${liveCalls.length} calls, error ${live.error ?? "none"}\n`);
  process.stdout.write(`devnet: delay from ${delays.length ? `${delays.length} live samples` : "fallback"}\n`);
  const local = await devnet(delays);
  const report = {
    at: new Date().toISOString(),
    live: {
      ...live,
      rounds: LIVE_ROUNDS,
      firstCallMs: Math.round(liveCalls[0]?.ms ?? 0),
      routes: summarizeCalls(liveCalls.slice(1)),
      reused: REUSE_LIVE ?? null,
      samplesMs: delays,
    },
    devnet: {
      delayModel: delays.length ? "random pick from the live samples" : `${FALLBACK_DELAY_MS} ms`,
      payments: PAYMENTS,
      parallel: PARALLEL,
      parallelEach: stats(local.parallelMs),
      spentUsd: local.spentUsd,
      balanceLeftRaw: local.balanceLeftRaw,
      operations: summarizeOperations(local.operations),
      routes: summarizeCalls(local.calls),
      samples: local.operations.map(({ kind, ok, ms, requests, signatures }) => ({
        kind,
        ok,
        ms,
        requests,
        signatures,
      })),
      requestsByOperation: [...groupBy(local.operations, (item) => item.kind)].map(([kind, items]) => ({
        kind,
        routes: items[0]?.routes ?? [],
      })),
    },
  };
  const key = process.env.NEAR_INTENTS_PARTNER_KEY;
  const text = JSON.stringify(report, null, 2);
  const safe = key ? text.split(key).join("<partner-key>") : text;
  const name = process.env.NEAR_BENCH_NAME ?? "report";
  await writeFile(join(OUT, `${name}.json`), `${safe}\n`);
  for (const item of report.devnet.operations)
    process.stdout.write(
      `${item.ok}/${item.ok + item.failed} ${item.kind}: p50 ${item.p50} ms, p95 ${item.p95} ms, ${item.requestsPerOp} requests, ${item.signaturesPerOp} signatures${item.errors.length ? ` errors=${item.errors.join(" | ")}` : ""}\n`,
    );
  process.stdout.write(`report: ${join(OUT, `${name}.json`)}\n`);
}

await main();
