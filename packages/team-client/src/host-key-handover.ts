import { sha256 } from "@noble/hashes/sha2.js";
import { type HostKeyHandover, hostKeyHandoverStatement } from "@openbot/contracts/host-key-handover";
import { Effect } from "effect";
import { bytesToBase64Url } from "./base64";

/**
 * Checks one base64url Ed25519 signature, and is `false` when the key or the signature is malformed.
 * The caller gives the check: desktop main uses `node:crypto`, other clients `verifyEd25519Base64Url`.
 * Main bundles this module and `remote-directory.ts`, so they must not import `./ed25519`: the
 * electron-vite ESM shim goes after the last `import` text in the bundle, and a JSDoc example in
 * `@noble/ed25519` matches it, so main then starts with no `__dirname`.
 */
export type HostKeySignatureCheck = (
  signature: string,
  message: Uint8Array,
  publicKeyPem: string,
) => Effect.Effect<boolean>;

export function remoteHostFingerprint(publicKey: string): string {
  const digest = sha256(new TextEncoder().encode(publicKey));
  return bytesToBase64Url(digest);
}

/**
 * Whether the handover chain leads from the key this client trusts to the key that the account
 * service advertises now. Each step counts only when the key before it and its own key both signed
 * it. A step that matches but does not verify stops the walk: the client keeps its pin.
 */
export const followHostKeyHandovers = Effect.fn("HostKeyHandover.follow")(function* (input: {
  hostId: string;
  trustedFingerprint: string;
  advertisedPublicKey: string;
  handovers: readonly HostKeyHandover[];
  verify: HostKeySignatureCheck;
}): Effect.fn.Return<boolean> {
  const target = remoteHostFingerprint(input.advertisedPublicKey);
  let current = input.trustedFingerprint;
  for (const handover of input.handovers) {
    if (current === target) break;
    if (handover.hostId !== input.hostId || remoteHostFingerprint(handover.previousPublicKey) !== current) continue;
    const statement = new TextEncoder().encode(hostKeyHandoverStatement(handover));
    const signedByPrevious = yield* input.verify(handover.previousSignature, statement, handover.previousPublicKey);
    const signedByNext = signedByPrevious && (yield* input.verify(handover.signature, statement, handover.publicKey));
    if (!signedByNext) return false;
    current = remoteHostFingerprint(handover.publicKey);
  }
  return current === target;
});

/**
 * When the host changed to `publicKey`: the time of the handover step that leads to it. A step
 * counts only when the key before it and its own key both signed it; otherwise this is null.
 */
export const hostKeyChangedAt = Effect.fn("HostKeyHandover.changedAt")(function* (input: {
  hostId: string;
  publicKey: string;
  handovers: readonly HostKeyHandover[];
  verify: HostKeySignatureCheck;
}): Effect.fn.Return<number | null> {
  const target = remoteHostFingerprint(input.publicKey);
  const handover = [...input.handovers]
    .reverse()
    .find((step) => step.hostId === input.hostId && remoteHostFingerprint(step.publicKey) === target);
  if (!handover) return null;
  const statement = new TextEncoder().encode(hostKeyHandoverStatement(handover));
  const signedByPrevious = yield* input.verify(handover.previousSignature, statement, handover.previousPublicKey);
  const signedByNext = signedByPrevious && (yield* input.verify(handover.signature, statement, handover.publicKey));
  return signedByNext ? handover.issuedAt : null;
});
