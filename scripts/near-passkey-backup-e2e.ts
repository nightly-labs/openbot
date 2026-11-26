import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type NearPasskeyBackup,
  type NearWalletStatus,
  parseNearWalletCreateInput,
  parseNearWalletStatus,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { z } from "zod";
import { NearWalletService } from "../src/main/near-wallet-service";
import { NEAR_SIGNING_PATH, NearOwnerSigning, type NearSigningResult } from "../src/main/near-wallet-signing";
import { type NearOwner, NearWalletStore } from "../src/main/near-wallet-store";
import {
  FakeAgentApi,
  type Json,
  jsonObjectSchema,
  KeyedNearGateway,
  PAGE_ORIGIN,
  PARTNER_KEY,
  RecordingCipher,
  toJson,
  withDeadline,
} from "./near-wallet-fake-api";

const OUT = resolve(import.meta.dirname, "../.openbot-build/near-passkey-backup-e2e");
const RP_ID = new URL(PAGE_ORIGIN).hostname;
const AGENT = "agent-a";
const UP = 0x01;
const UV = 0x04;
const BE = 0x08;
const BS = 0x10;
const DEVICE_ONLY = UP | UV;
const NOT_SYNCED = UP | UV | BE;
const SYNCED = UP | UV | BE | BS;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest();

function authenticatorData(flags: number, rpId = RP_ID): Buffer {
  return Buffer.concat([sha256(Buffer.from(rpId)), Buffer.from([flags]), Buffer.alloc(4)]);
}

const webauthnIntentSchema = z.object({
  standard: z.literal("webauthn"),
  payload: z.object({
    challenge: z.string(),
    rpId: z.string(),
    allowCredentials: z.array(z.object({ id: z.string(), type: z.literal("public-key") })),
    userVerification: z.literal("required"),
    timeout: z.number().int().positive(),
  }),
});

const fragmentSchema = z.object({
  v: z.literal(1),
  nonce: z.string(),
  kind: z.enum(["register", "sign"]),
  action: z.string(),
  summary: z.string(),
  challenge: z.string().optional(),
  userId: z.string().optional(),
  intent: webauthnIntentSchema.optional(),
  port: z.number().int(),
});
type Fragment = z.infer<typeof fragmentSchema>;

type RegisterAnswer = { kind: "flags"; flags: number } | { kind: "no-data" } | { kind: "other-rp"; flags: number };
type CheckAnswer = { kind: "honest"; flags: number } | { kind: "other-key" } | { kind: "other-challenge" };

interface Visit {
  fragment: Fragment;
  status: number | null;
}

const newKey = () => generateKeyPairSync("ec", { namedCurve: "P-256" });

class PasskeyPage {
  readonly visits: Visit[] = [];
  register: RegisterAnswer = { kind: "flags", flags: SYNCED };
  check: CheckAnswer = { kind: "honest", flags: SYNCED };
  #key = newKey();
  #credentialId = randomBytes(32).toString("base64url");
  readonly #other = newKey();
  readonly #pending = new Set<Promise<void>>();

  get credentialId(): string {
    return this.#credentialId;
  }

  newPasskey(): void {
    this.#key = newKey();
    this.#credentialId = randomBytes(32).toString("base64url");
  }

  readonly openExternal = async (url: string): Promise<void> => {
    const prefix = `${PAGE_ORIGIN}${NEAR_SIGNING_PATH}#`;
    assert.ok(url.startsWith(prefix), `the signing page URL starts with ${prefix}`);
    const fragment = fragmentSchema.parse(JSON.parse(Buffer.from(url.slice(prefix.length), "base64url").toString()));
    const visit: Visit = { fragment, status: null };
    this.visits.push(visit);
    const run = this.#answer(visit).finally(() => this.#pending.delete(run));
    this.#pending.add(run);
  };

  async settle(): Promise<void> {
    await Promise.all([...this.#pending]);
  }

  #registerResult(): Json {
    const publicKey = this.#key.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
    const answer = this.register;
    if (answer.kind === "no-data") return { credentialId: this.#credentialId, publicKey };
    const data =
      answer.kind === "other-rp" ? authenticatorData(answer.flags, "other.invalid") : authenticatorData(answer.flags);
    return { credentialId: this.#credentialId, publicKey, authenticatorData: data.toString("base64url") };
  }

  #checkResult(fragment: Fragment): Json {
    assert.ok(fragment.intent, "the check fragment has a webauthn intent");
    const answer = this.check;
    const challenge =
      answer.kind === "other-challenge" ? randomBytes(32).toString("base64url") : fragment.intent.payload.challenge;
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: PAGE_ORIGIN }));
    const data = authenticatorData(answer.kind === "honest" ? answer.flags : SYNCED);
    const key: KeyObject = answer.kind === "other-key" ? this.#other.privateKey : this.#key.privateKey;
    const signature = sign("sha256", Buffer.concat([data, sha256(clientData)]), key);
    return {
      credential: {
        id: this.#credentialId,
        rawId: this.#credentialId,
        type: "public-key",
        response: {
          clientDataJSON: clientData.toString("base64url"),
          authenticatorData: data.toString("base64url"),
          signature: signature.toString("base64url"),
        },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      },
    };
  }

  async #answer(visit: Visit): Promise<void> {
    const { fragment } = visit;
    const result = fragment.kind === "register" ? this.#registerResult() : this.#checkResult(fragment);
    const data = Buffer.from(JSON.stringify(result)).toString("base64url");
    const url = `http://127.0.0.1:${fragment.port}/near-signature?nonce=${encodeURIComponent(fragment.nonce)}&data=${data}`;
    const response = await fetch(url);
    visit.status = response.status;
  }
}

interface Scenario {
  name: string;
  passed: boolean;
  details: { [key: string]: Json };
  error?: string;
}

const scenarios: Scenario[] = [];

async function scenario(name: string, run: (details: { [key: string]: Json }) => Promise<void>): Promise<void> {
  const details: { [key: string]: Json } = {};
  try {
    await run(details);
    scenarios.push({ name, passed: true, details });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    scenarios.push({ name, passed: false, details, error: message });
    process.stderr.write(`FAIL ${name}\n${message}\n`);
  }
}

function newSigning(page: PasskeyPage): NearOwnerSigning {
  return new NearOwnerSigning({ pageOrigin: PAGE_ORIGIN, openExternal: page.openExternal, loopback: true });
}

const REGISTER = { kind: "register", action: "register", summary: "" } as const;
const CHECK = { kind: "check", action: "check-backup", summary: "" } as const;

async function failureOf(promise: Promise<NearSigningResult>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

class Wallet {
  readonly store: NearWalletStore;
  readonly signing: NearOwnerSigning;
  readonly service: NearWalletService;
  readonly page: PasskeyPage;
  #clock = Date.parse("2026-11-25T12:00:00.000Z");

  constructor(path: string, page: PasskeyPage, api: FakeAgentApi) {
    this.page = page;
    this.store = new NearWalletStore(path, new RecordingCipher());
    this.signing = newSigning(page);
    this.service = new NearWalletService({
      store: this.store,
      signing: this.signing,
      gateway: new KeyedNearGateway(PARTNER_KEY),
      baseUrl: api.baseUrl,
      now: () => {
        this.#clock += 1_000;
        return this.#clock;
      },
    });
  }

  status(): NearWalletStatus {
    const status = this.service.status();
    assert.notEqual(parseNearWalletStatus(structuredClone(status)), null, "status passes the IPC decoder");
    return status;
  }

  waitFor(label: string, matches: (status: NearWalletStatus) => boolean): Promise<NearWalletStatus> {
    return withDeadline(
      label,
      new Promise((done) => {
        const now = this.status();
        if (matches(now)) return done(now);
        const stop = this.service.onChanged((status) => {
          if (!matches(status)) return;
          stop();
          done(status);
        });
      }),
    );
  }

  async create(
    passkey: "keep" | "replace" | undefined,
    until: (status: NearWalletStatus) => boolean,
  ): Promise<NearWalletStatus> {
    const input = parseNearWalletCreateInput({
      dailyBudgetUsd: "25",
      ...(passkey ? { passkey } : {}),
    });
    assert.ok(input, "the contract parser takes the setup input");
    const ended = this.waitFor("create ends", until);
    await Effect.runPromise(this.service.create(input));
    const status = await ended;
    await Effect.runPromise(this.service.setAgents({ allAgents: false, agentIds: [AGENT] }));
    await this.page.settle();
    return status;
  }

  async checkBackup(): Promise<NearWalletStatus> {
    const status = await Effect.runPromise(this.service.checkBackup());
    await this.page.settle();
    assert.notEqual(parseNearWalletStatus(structuredClone(status)), null, "status passes the IPC decoder");
    return status;
  }
}

const generated = (api: FakeAgentApi, from: number) =>
  api.requests.slice(from).filter((request) => request.path === "/v1/generate-intent");

const ownerTypeSchema = z.object({ owner: z.object({ type: z.string(), credential_id: z.string() }) });

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const dir = await mkdtemp(join(tmpdir(), "openbot-near-passkey-backup-e2e-"));
  const api = new FakeAgentApi();
  await api.start();

  try {
    const cases: { name: string; answer: RegisterAnswer; expected: NearPasskeyBackup | null }[] = [
      { name: "BE=0 BS=0", answer: { kind: "flags", flags: DEVICE_ONLY }, expected: "deviceOnly" },
      { name: "BE=1 BS=0", answer: { kind: "flags", flags: NOT_SYNCED }, expected: "notSynced" },
      { name: "BE=1 BS=1", answer: { kind: "flags", flags: SYNCED }, expected: "synced" },
      { name: "BE=0 BS=1", answer: { kind: "flags", flags: UP | UV | BS }, expected: null },
      { name: "no authenticator data", answer: { kind: "no-data" }, expected: null },
      { name: "other rpIdHash", answer: { kind: "other-rp", flags: SYNCED }, expected: null },
    ];
    for (const item of cases) {
      await scenario(`register reads the backup flags: ${item.name}`, async (details) => {
        const page = new PasskeyPage();
        page.register = item.answer;
        const signing = newSigning(page);
        const result = await withDeadline("register", signing.sign(REGISTER, null));
        await page.settle();
        const fragment = page.visits[0]?.fragment;
        details.result = toJson(result);
        assert.equal(fragment?.kind, "register");
        assert.ok(fragment?.challenge, "the register fragment has a challenge");
        assert.ok(fragment?.userId, "the register fragment has a user id");
        assert.equal(page.visits[0]?.status, 200);
        assert.equal(result.kind, "owner");
        assert.equal(result.kind === "owner" ? result.backup : "wrong kind", item.expected);
        await signing.dispose();
      });
    }

    const page = new PasskeyPage();
    page.register = { kind: "flags", flags: NOT_SYNCED };
    const signing = newSigning(page);
    const registered = await withDeadline("register owner", signing.sign(REGISTER, null));
    assert.equal(registered.kind, "owner");
    const owner: NearOwner | null = registered.kind === "owner" ? registered.owner : null;

    await scenario("check-backup verifies the passkey signature and reads the flags", async (details) => {
      page.check = { kind: "honest", flags: SYNCED };
      const result = await withDeadline("check", signing.sign(CHECK, owner));
      await page.settle();
      const fragment = page.visits.at(-1)?.fragment;
      details.fragment = toJson({ kind: fragment?.kind, action: fragment?.action, intent: fragment?.intent });
      details.result = toJson(result);
      assert.equal(fragment?.kind, "sign");
      assert.equal(fragment?.action, "check-backup");
      assert.equal(fragment?.intent?.payload.rpId, RP_ID);
      assert.deepEqual(fragment?.intent?.payload.allowCredentials, [{ id: page.credentialId, type: "public-key" }]);
      assert.deepEqual(result, { kind: "backup", backup: "synced" });
    });

    await scenario("check-backup refuses a signature from another key", async (details) => {
      page.check = { kind: "other-key" };
      const failure = await failureOf(withDeadline("check other key", signing.sign(CHECK, owner)));
      await page.settle();
      details.failure = failure;
      assert.equal(failure, sourceText("error.connector.nearSigningInvalid"));
    });

    await scenario("check-backup refuses a signature for another challenge", async (details) => {
      page.check = { kind: "other-challenge" };
      const failure = await failureOf(withDeadline("check other challenge", signing.sign(CHECK, owner)));
      await page.settle();
      details.failure = failure;
      assert.equal(failure, sourceText("error.connector.nearSigningInvalid"));
    });

    await signing.dispose();

    const walletPage = new PasskeyPage();
    const wallet = new Wallet(join(dir, "near-wallet.json"), walletPage, api);
    await Effect.runPromise(wallet.service.load());

    let firstCredential = "";
    let firstCheckedAt = "";
    await scenario("create stops before the account when the passkey is device-only", async (details) => {
      walletPage.register = { kind: "flags", flags: DEVICE_ONLY };
      const mark = api.requests.length;
      const status = await wallet.create(
        undefined,
        (current) => current.signing === null && current.ownerBackup?.state === "deviceOnly",
      );
      const record = wallet.store.read();
      details.status = toJson({ state: status.state, ownerBackup: status.ownerBackup, error: status.error });
      details.actions = walletPage.visits.map((visit) => visit.fragment.action);
      assert.equal(status.error, null);
      assert.equal(status.state, "no-wallet");
      assert.equal(status.ownerBackup?.state, "deviceOnly");
      assert.deepEqual(details.actions, ["register"]);
      assert.equal(generated(api, mark).length, 0, "no generate-intent is sent");
      assert.equal(record.owner?.type, "passkey");
      assert.equal(record.wallet, null);
      firstCredential = record.owner?.credential_id ?? "";
      firstCheckedAt = status.ownerBackup?.checkedAt ?? "";
    });

    await scenario("create without a choice stops again and does not register again", async (details) => {
      const mark = api.requests.length;
      const visits = walletPage.visits.length;
      await wallet.create(undefined, () => true);
      const status = wallet.status();
      details.status = toJson({ state: status.state, ownerBackup: status.ownerBackup, error: status.error });
      assert.equal(walletPage.visits.length, visits, "no new signing page opens");
      assert.equal(status.ownerBackup?.state, "deviceOnly");
      assert.equal(status.ownerBackup?.checkedAt, firstCheckedAt);
      assert.equal(generated(api, mark).length, 0, "no generate-intent is sent");
    });

    await scenario("replace registers a new passkey and checks it again", async (details) => {
      walletPage.newPasskey();
      walletPage.register = { kind: "flags", flags: DEVICE_ONLY };
      const mark = api.requests.length;
      const status = await wallet.create(
        "replace",
        (current) => current.signing === null && current.ownerBackup?.checkedAt !== firstCheckedAt,
      );
      const record = wallet.store.read();
      const credential = record.owner?.credential_id ?? "";
      details.status = toJson({ state: status.state, ownerBackup: status.ownerBackup, error: status.error });
      assert.equal(walletPage.visits.at(-1)?.fragment.action, "register");
      assert.notEqual(credential, firstCredential, "the new passkey replaces the old owner");
      assert.equal(credential, walletPage.credentialId);
      assert.equal(status.ownerBackup?.state, "deviceOnly");
      assert.notEqual(status.ownerBackup?.checkedAt, firstCheckedAt, "the new passkey has a new check time");
      assert.equal(generated(api, mark).length, 0, "no generate-intent is sent");
    });

    await scenario("checkBackup updates the stored backup state", async (details) => {
      walletPage.check = { kind: "honest", flags: SYNCED };
      const before = wallet.status().ownerBackup?.checkedAt;
      const status = await wallet.checkBackup();
      details.status = toJson({ ownerBackup: status.ownerBackup, error: status.error });
      assert.equal(status.error, null);
      assert.equal(status.ownerBackup?.state, "synced");
      assert.notEqual(status.ownerBackup?.checkedAt, before);
      assert.equal(wallet.store.read().ownerBackup?.state, "synced");
      assert.equal(walletPage.visits.at(-1)?.fragment.action, "check-backup");
    });

    await scenario("a refused checkBackup keeps the stored state", async (details) => {
      walletPage.check = { kind: "other-key" };
      const before = wallet.status().ownerBackup;
      const status = await wallet.checkBackup();
      details.status = toJson({ ownerBackup: status.ownerBackup, error: status.error });
      assert.equal(status.error, sourceText("error.connector.nearSigningInvalid"));
      assert.deepEqual(status.ownerBackup, before);
    });

    await scenario("keep goes on to the account with the device-only passkey", async (details) => {
      walletPage.check = { kind: "honest", flags: DEVICE_ONLY };
      const checked = await wallet.checkBackup();
      assert.equal(checked.ownerBackup?.state, "deviceOnly");
      const mark = api.requests.length;
      const visits = walletPage.visits.length;
      const status = await wallet.create("keep", (current) => current.error !== null || current.state !== "no-wallet");
      const sent = generated(api, mark);
      const body = jsonObjectSchema.parse(sent[0]?.body);
      const intent = ownerTypeSchema.safeParse(body).data;
      details.status = toJson({ state: status.state, error: status.error });
      details.generated = sent.map((request) => toJson({ answered: request.answered, owner: intent?.owner ?? null }));
      const actions = walletPage.visits.slice(visits).map((visit) => visit.fragment.action);
      details.actions = actions;
      assert.ok(!actions.includes("register"), "keep does not register again");
      assert.ok(sent.length > 0, "keep sends generate-intent");
      assert.equal(body.type, "agent_create");
      assert.equal(intent?.owner.type, "passkey");
      assert.equal(intent?.owner.credential_id, walletPage.credentialId);
    });

    await Effect.runPromise(wallet.service.dispose());
  } finally {
    await api.stop();
    await rm(dir, { recursive: true, force: true });
  }

  const passed = scenarios.every((item) => item.passed);
  await writeFile(
    join(OUT, "report.json"),
    `${JSON.stringify({ passed, scenarios, finishedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  process.stdout.write(`report: ${join(OUT, "report.json")}\n`);
  if (!passed) process.exitCode = 1;
}

await main();
