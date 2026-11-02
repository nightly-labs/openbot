// Checks a host key rotation across restarts. A real `TeamStore` runs on a temporary profile, in a
// child process of this script, and each step is one process that stops after its step, as an app
// that quits or crashes does:
//
// 1. `begin` makes a new key and a pending handover. The host still uses the previous key.
// 2. `inspect` starts again and must find the same pending handover, so a lost answer from the
//    account service can be sent again with the same key.
// 3. `complete` makes the new key the one in use. The previous private key leaves the file.
// 4. `rotate` makes a second step, so a client that is two keys behind follows a chain.
//
// The client part runs the team client's `followHostKeyHandovers` on the handovers that the host
// signed, once with the `node:crypto` check of desktop main and once with the check of the other
// clients: a client that trusts the first key reaches the last key, and a changed signature, a step of
// another host or a key with no handover fails. `hostKeyChangedAt`, the time that Server settings
// shows, is the time of the step that leads to the key, and is null for a step that does not verify.
// Run: `bun scripts/host-key-rotation-e2e.ts`.
// Writes .openbot-build/host-key-rotation-e2e/report.json.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { decodeHostKeyHandover, type HostKeyHandover } from "@openbot/contracts/host-key-handover";
import { decodeRecord, requiredString } from "@openbot/contracts/ipc-decoding";
import { verifyEd25519Base64Url } from "@openbot/team-client/ed25519";
import {
  followHostKeyHandovers,
  hostKeyChangedAt,
  remoteHostFingerprint,
} from "@openbot/team-client/host-key-handover";
import { Effect } from "effect";
import { verifyHostKeySignature } from "../src/main/remote-server-host-directory";

const OUT = resolve(import.meta.dirname, "../.openbot-build/host-key-rotation-e2e");
const HOST_LINE = "host-key-rotation ";
const STEP_DEADLINE_MS = 30_000;

const STEPS = ["begin", "inspect", "complete", "rotate"] as const;
type Step = (typeof STEPS)[number];

function isStep(value: string | undefined): value is Step {
  return STEPS.some((step) => step === value);
}

interface StepResult {
  step: Step;
  serverId: string;
  publicKey: string;
  fingerprint: string;
  pending: HostKeyHandover | null;
  /** The handover that the `rotate` step signed and completed. */
  completed: HostKeyHandover | null;
}

// --- Host process ---

async function runHost(file: string, step: Step): Promise<void> {
  const { runCauseEffect } = await import("../src/backend/effect-boundary");
  const { TeamStore } = await import("../src/main/team-store");
  const store = new TeamStore(file);
  await runCauseEffect(store.initialize());
  if (step === "begin") {
    await runCauseEffect(store.configure("E2E Host", "owner-user", "owner-password-123"));
    await runCauseEffect(store.beginKeyRotation());
  } else if (step === "complete") {
    const pending = store.getPendingKeyHandover();
    assert.ok(pending, "A pending handover must survive the restart.");
    await runCauseEffect(store.completeKeyRotation(pending));
  }
  let completed: HostKeyHandover | null = null;
  if (step === "rotate") {
    completed = await runCauseEffect(store.beginKeyRotation());
    await runCauseEffect(store.completeKeyRotation(completed));
  }
  const identity = store.getIdentity();
  assert.ok(identity, "The host must stay configured.");
  const result: StepResult = {
    step,
    serverId: identity.serverId,
    publicKey: identity.publicKey,
    fingerprint: identity.fingerprint,
    pending: store.getPendingKeyHandover(),
    completed,
  };
  process.stdout.write(`${HOST_LINE}${JSON.stringify(result)}\n`);
}

function hostStep(file: string, step: Step): Promise<StepResult> {
  return new Promise((resolveStep, rejectStep) => {
    const child = spawn(process.execPath, [import.meta.filename, "--host", file, step], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let output = "";
    const deadline = setTimeout(() => {
      child.kill("SIGKILL");
      rejectStep(new Error(`The ${step} step did not finish.`));
    }, STEP_DEADLINE_MS);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.on("error", rejectStep);
    child.on("exit", (code) => {
      clearTimeout(deadline);
      const line = output.split("\n").find((entry) => entry.startsWith(HOST_LINE));
      if (code !== 0 || !line) return rejectStep(new Error(`The ${step} step exited with ${code}.`));
      resolveStep(decodeStepResult(JSON.parse(line.slice(HOST_LINE.length))));
    });
  });
}

function decodeStepResult(value: unknown): StepResult {
  const record = decodeRecord(value, "host step");
  const step = requiredString(record, "step");
  assert.ok(isStep(step), "The host printed an unknown step.");
  return {
    step,
    serverId: requiredString(record, "serverId"),
    publicKey: requiredString(record, "publicKey"),
    fingerprint: requiredString(record, "fingerprint"),
    pending: record.pending === null ? null : decodeHostKeyHandover(record.pending),
    completed: record.completed === null ? null : decodeHostKeyHandover(record.completed),
  };
}

// --- Checks ---

async function follows(input: {
  hostId: string;
  trustedFingerprint: string;
  advertisedPublicKey: string;
  handovers: readonly HostKeyHandover[];
}): Promise<boolean> {
  // Desktop main checks with `node:crypto`, the other clients with `@noble/ed25519`. Both must agree.
  const [desktop, client] = await Promise.all([
    Effect.runPromise(followHostKeyHandovers({ ...input, verify: verifyHostKeySignature })),
    Effect.runPromise(followHostKeyHandovers({ ...input, verify: verifyEd25519Base64Url })),
  ]);
  assert.equal(desktop, client, "The desktop check and the client check must agree.");
  return desktop;
}

async function changedAt(input: {
  hostId: string;
  publicKey: string;
  handovers: readonly HostKeyHandover[];
}): Promise<number | null> {
  const [desktop, client] = await Promise.all([
    Effect.runPromise(hostKeyChangedAt({ ...input, verify: verifyHostKeySignature })),
    Effect.runPromise(hostKeyChangedAt({ ...input, verify: verifyEd25519Base64Url })),
  ]);
  assert.equal(desktop, client, "The desktop check and the client check must agree.");
  return desktop;
}

/** The fingerprint that the desktop main process stores, from `src/main/team-store.ts`. */
function hostFingerprint(publicKey: string): string {
  return createHash("sha256").update(publicKey).digest("base64url");
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const root = await mkdtemp(join(tmpdir(), "openbot-host-key-rotation-"));
  const file = join(root, "openbot-team-server-v2.json");
  const checks: Record<string, boolean> = {};
  try {
    const begun = await hostStep(file, "begin");
    assert.ok(begun.pending, "Begin must leave a pending handover.");
    const first = begun.pending;
    assert.equal(first.previousPublicKey, begun.publicKey, "The host must keep its key until completion.");
    assert.notEqual(first.publicKey, begun.publicKey);
    checks.beginKeepsCurrentKey = true;

    const inspected = await hostStep(file, "inspect");
    assert.deepEqual(inspected.pending, first, "A restart must keep the same pending handover.");
    assert.equal(inspected.publicKey, begun.publicKey);
    checks.pendingSurvivesRestart = true;

    const completed = await hostStep(file, "complete");
    assert.equal(completed.publicKey, first.publicKey, "Completion must use the new key.");
    assert.equal(completed.serverId, begun.serverId, "The host ID must not change.");
    assert.equal(completed.pending, null);
    // The file is JSON, so the PEM text of the previous key is in it only with escaped line ends.
    const afterComplete = readFileSync(file, "utf8");
    assert.ok(!afterComplete.includes(JSON.stringify(begun.publicKey)), "The previous key pair must leave the file.");
    checks.completeUsesNewKeyAndKeepsHostId = true;

    const rotated = await hostStep(file, "rotate");
    const second = rotated.completed;
    assert.ok(second, "The rotate step must sign a handover.");
    assert.notEqual(rotated.publicKey, completed.publicKey);
    assert.equal(second.previousPublicKey, completed.publicKey);
    assert.equal(rotated.serverId, begun.serverId);
    checks.secondRotationKeepsHostId = true;
    const hostId = begun.serverId;
    assert.equal(remoteHostFingerprint(begun.publicKey), hostFingerprint(begun.publicKey));
    checks.fingerprintsMatchBetweenHostAndClient = true;

    assert.ok(
      await follows({
        hostId,
        trustedFingerprint: begun.fingerprint,
        advertisedPublicKey: completed.publicKey,
        handovers: [first],
      }),
      "A client that trusts the first key must follow one step.",
    );
    checks.clientFollowsOneStep = true;

    assert.ok(
      await follows({
        hostId,
        trustedFingerprint: begun.fingerprint,
        advertisedPublicKey: rotated.publicKey,
        handovers: [first, second],
      }),
      "A client that is two keys behind must follow the chain.",
    );
    assert.equal(
      await follows({
        hostId,
        trustedFingerprint: begun.fingerprint,
        advertisedPublicKey: rotated.publicKey,
        handovers: [second],
      }),
      false,
      "A chain with a missing step must fail.",
    );
    checks.clientFollowsTwoStepsAndNeedsEachStep = true;

    assert.ok(
      await follows({
        hostId,
        trustedFingerprint: completed.fingerprint,
        advertisedPublicKey: completed.publicKey,
        handovers: [],
      }),
      "A client that already trusts the key needs no handover.",
    );

    const tampered = { ...first, signature: first.previousSignature };
    assert.equal(
      await follows({
        hostId,
        trustedFingerprint: begun.fingerprint,
        advertisedPublicKey: completed.publicKey,
        handovers: [tampered],
      }),
      false,
      "A changed signature must fail.",
    );
    checks.changedSignatureFails = true;

    assert.equal(
      await follows({
        hostId: "another-host",
        trustedFingerprint: begun.fingerprint,
        advertisedPublicKey: completed.publicKey,
        handovers: [first],
      }),
      false,
      "A step of another host must fail.",
    );
    checks.otherHostStepFails = true;

    assert.equal(
      await changedAt({ hostId, publicKey: rotated.publicKey, handovers: [first, second] }),
      second.issuedAt,
      "The change time must be the time of the step that leads to the key.",
    );
    assert.equal(
      await changedAt({ hostId, publicKey: completed.publicKey, handovers: [tampered] }),
      null,
      "A step with a changed signature must give no change time.",
    );
    assert.equal(
      await changedAt({ hostId: "another-host", publicKey: completed.publicKey, handovers: [first] }),
      null,
      "A step of another host must give no change time.",
    );
    checks.changeTimeNeedsVerifiedStep = true;

    const stranger = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    }).publicKey;
    assert.equal(
      await follows({
        hostId,
        trustedFingerprint: begun.fingerprint,
        advertisedPublicKey: stranger,
        handovers: [first],
      }),
      false,
      "A key with no handover must fail.",
    );
    checks.keyWithoutHandoverFails = true;

    const report = { ok: true, hostId, steps: [begun.step, inspected.step, completed.step, rotated.step], checks };
    writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--host") {
  const step = process.argv[4];
  if (!isStep(step)) throw new Error("Name a host step.");
  await runHost(process.argv[3] ?? "", step);
} else {
  await main();
}
