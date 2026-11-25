import assert from "node:assert/strict";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  type KeyObject,
  randomBytes,
  sign,
} from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type NearWalletStatus, parseNearDepositInput, parseNearWalletCreateInput } from "@openbot/contracts/ipc";
import { Effect, Result } from "effect";
import { z } from "zod";
import { NearWalletService } from "../src/main/near-wallet-service";
import { NEAR_SIGNING_PATH, NearOwnerSigning } from "../src/main/near-wallet-signing";
import { NearWalletStore } from "../src/main/near-wallet-store";
import type { SecretCipher } from "../src/main/provider-credential-store";
import { KeyedNearGateway } from "./near-wallet-fake-api";

const OUT = resolve(import.meta.dirname, "../.openbot-build/near-wallet-live");
const PAGE_ORIGIN = "https://api.openbot.run";
const BASE_URL = process.env.NEAR_LIVE_API_URL || undefined;
const AGENT_ID = "live-smoke-agent";
const FIRST_BUDGET_USD = "5";
const NEXT_BUDGET_USD = "6";
const WAIT_MS = 180_000;

const fragmentSchema = z.object({
  nonce: z.string(),
  kind: z.enum(["register", "sign"]),
  action: z.string(),
  port: z.number().int().positive(),
  intent: z
    .object({
      standard: z.literal("webauthn"),
      payload: z.object({ challenge: z.string(), rpId: z.string() }),
    })
    .optional(),
});
type Fragment = z.infer<typeof fragmentSchema>;

interface Step {
  name: string;
  passed: boolean;
  ms: number;
  details: string;
  error?: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run this script through dotenvx with apps/auth-api/.env.dev.`);
  return value;
}

class SoftwarePasskey {
  readonly privateKey: KeyObject;
  readonly publicKey: string;
  readonly credentialId: string;
  readonly signedActions: string[] = [];

  constructor(pkcs8: string) {
    this.privateKey = createPrivateKey({ key: Buffer.from(pkcs8, "base64url"), format: "der", type: "pkcs8" });
    const spki = createPublicKey(this.privateKey).export({ format: "der", type: "spki" });
    this.publicKey = spki.toString("base64url");
    this.credentialId = createHash("sha256").update(spki).digest("base64url");
  }

  readonly openExternal = async (url: string): Promise<void> => {
    const prefix = `${PAGE_ORIGIN}${NEAR_SIGNING_PATH}#`;
    assert.ok(url.startsWith(prefix), "the signing page URL uses the page origin");
    const fragment = fragmentSchema.parse(
      JSON.parse(Buffer.from(url.slice(prefix.length), "base64url").toString("utf8")),
    );
    this.signedActions.push(fragment.action);
    const data = Buffer.from(JSON.stringify(this.#answer(fragment))).toString("base64url");
    const response = await fetch(
      `http://127.0.0.1:${fragment.port}/near-signature?nonce=${encodeURIComponent(fragment.nonce)}&data=${data}`,
    );
    assert.equal(response.status, 200, "the loopback listener accepts the signature");
  };

  #answer(fragment: Fragment) {
    if (fragment.kind === "register") return { credentialId: this.credentialId, publicKey: this.publicKey };
    const payload = fragment.intent?.payload;
    assert.ok(payload, "a sign request carries a webauthn intent");
    const clientData = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge: payload.challenge, origin: PAGE_ORIGIN, crossOrigin: false }),
    );
    const userPresentAndVerified = 0x05;
    const authenticatorData = Buffer.concat([
      createHash("sha256").update(payload.rpId).digest(),
      Buffer.from([userPresentAndVerified]),
      Buffer.alloc(4),
    ]);
    const signature = sign(
      "sha256",
      Buffer.concat([authenticatorData, createHash("sha256").update(clientData).digest()]),
      this.privateKey,
    );
    return {
      credential: {
        id: this.credentialId,
        rawId: this.credentialId,
        type: "public-key",
        response: {
          clientDataJSON: clientData.toString("base64url"),
          authenticatorData: authenticatorData.toString("base64url"),
          signature: signature.toString("base64url"),
        },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      },
    };
  }
}

class KeyCipher implements SecretCipher {
  readonly #key: Buffer;

  constructor(secret: string) {
    this.#key = Buffer.from(hkdfSync("sha256", secret, "openbot-near-live", "store", 32));
  }

  encrypt = (value: string): Buffer => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  };

  decrypt = (value: Buffer): string => {
    const decipher = createDecipheriv("aes-256-gcm", this.#key, value.subarray(0, 12));
    decipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString("utf8");
  };
}

async function run<A>(effect: Effect.Effect<A, { readonly message: string }>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(effect));
  if (Result.isFailure(result)) throw new Error(result.failure.message);
  return result.success;
}

function waitFor(
  service: NearWalletService,
  label: string,
  matches: (status: NearWalletStatus) => boolean,
): Promise<NearWalletStatus> {
  return new Promise((done, fail) => {
    const now = service.status();
    if (matches(now)) return done(now);
    const timer = setTimeout(() => {
      stop();
      fail(new Error(`${label} did not end in ${WAIT_MS} ms`));
    }, WAIT_MS);
    const stop = service.onChanged((status) => {
      if (!matches(status)) return;
      clearTimeout(timer);
      stop();
      done(status);
    });
  });
}

function summary(status: NearWalletStatus): string {
  return JSON.stringify({
    state: status.state,
    accountId: status.account?.accountId ?? null,
    dailyBudgetUsd: status.account?.dailyBudgetUsd ?? null,
    grantExpiresAt: status.account?.grantExpiresAt ?? null,
    balances: status.balances.map((balance) => `${balance.amount} ${balance.symbol}`),
    depositAssets: status.depositAssets.length,
    error: status.error,
  });
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const partnerKey = required("NEAR_INTENTS_PARTNER_KEY").trim();
  const ownerKey = required("NEAR_TEST_OWNER_PASSKEY");
  const passkey = new SoftwarePasskey(ownerKey);
  const store = new NearWalletStore(join(OUT, "near-wallet.json"), new KeyCipher(ownerKey));
  const signing = new NearOwnerSigning({ pageOrigin: PAGE_ORIGIN, openExternal: passkey.openExternal, loopback: true });
  const gateway = new KeyedNearGateway(partnerKey);
  const service = new NearWalletService({ store, signing, gateway, ...(BASE_URL ? { baseUrl: BASE_URL } : {}) });
  const steps: Step[] = [];

  const step = async (name: string, body: () => Promise<string>): Promise<boolean> => {
    const started = Date.now();
    try {
      const details = await body();
      steps.push({ name, passed: true, ms: Date.now() - started, details });
      process.stdout.write(`PASS ${name}: ${details}\n`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      steps.push({ name, passed: false, ms: Date.now() - started, details: summary(service.status()), error: message });
      process.stdout.write(`FAIL ${name}: ${message}\n`);
      return false;
    }
  };

  try {
    await run(service.load());
    const ready = await step("create the wallet with a passkey owner", async () => {
      if (store.read().wallet?.grant?.active) return `already created: ${summary(service.status())}`;
      const input = parseNearWalletCreateInput({ dailyBudgetUsd: FIRST_BUDGET_USD, agentIds: [AGENT_ID] });
      assert.ok(input);
      await run(service.create(input));
      const status = await waitFor(
        service,
        "create",
        (current) => (current.state === "ready" && current.signing === null) || current.error !== null,
      );
      assert.equal(status.error, null);
      return `${summary(status)} signed=${passkey.signedActions.join(",")}`;
    });
    if (ready) {
      await step("refresh reads balances and tokens", async () => {
        const status = await run(service.refresh());
        assert.equal(status.error, null);
        assert.ok(status.depositAssets.length > 0, "the wallet lists deposit assets");
        return summary(status);
      });
      await step("change the daily budget", async () => {
        const target = store.read().wallet?.dailyBudgetUsd === NEXT_BUDGET_USD ? FIRST_BUDGET_USD : NEXT_BUDGET_USD;
        const status = await run(service.setBudget(target));
        assert.equal(status.error, null);
        assert.equal(status.account?.dailyBudgetUsd, target);
        return summary(status);
      });
      await step("freeze the wallet", async () => {
        const status = await run(service.freeze());
        assert.equal(status.error, null);
        assert.equal(status.state, "frozen");
        return summary(status);
      });
      await step("unfreeze the wallet", async () => {
        const status = await run(service.unfreeze());
        assert.equal(status.error, null);
        assert.equal(status.state, "ready");
        return summary(status);
      });
      await step("get a deposit address (no funds sent)", async () => {
        const assets = service.status().depositAssets;
        const asset =
          assets.find((item) => item.symbol === "USDC" && item.blockchain === "near") ??
          assets.find((item) => item.symbol === "USDC") ??
          assets[0];
        assert.ok(asset, "a deposit asset exists");
        const input = parseNearDepositInput({ assetId: asset.assetId });
        assert.ok(input);
        const address = await run(service.deposit(input));
        assert.ok(address.address.length > 0);
        return JSON.stringify({ asset: asset.symbol, ...address });
      });
    }
  } finally {
    await run(service.dispose());
    const report = {
      at: new Date().toISOString(),
      api: BASE_URL ?? "sdk default",
      agentId: store.read().wallet?.agentId ?? null,
      signedActions: passkey.signedActions,
      steps,
    };
    const text = JSON.stringify(report, null, 2).split(partnerKey).join("<partner-key>");
    await writeFile(join(OUT, "report.json"), `${text}\n`);
    process.stdout.write(`report: ${join(OUT, "report.json")}\n`);
    if (steps.some((item) => !item.passed)) process.exitCode = 1;
  }
}

await main();
