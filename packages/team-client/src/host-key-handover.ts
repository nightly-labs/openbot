import { sha256 } from "@noble/hashes/sha2.js";
import { type HostKeyHandover, hostKeyHandoverStatement } from "@openbot/contracts/host-key-handover";
import { Effect } from "effect";
import { bytesToBase64Url } from "./base64";

export type HostKeySignatureCheck = (
  signature: string,
  message: Uint8Array,
  publicKeyPem: string,
) => Effect.Effect<boolean>;

export function remoteHostFingerprint(publicKey: string): string {
  const digest = sha256(new TextEncoder().encode(publicKey));
  return bytesToBase64Url(digest);
}

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
