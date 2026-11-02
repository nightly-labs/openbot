// The curve functions that Baileys imports from `libsignal/src/curve.js`, on the Curve25519
// implementation of whatsapp-rust-bridge (MIT).
import * as bridge from "whatsapp-rust-bridge";
import { keyPair, prefixedPublicKey, privateKey, toBuffer } from "./keys.js";

export function generateKeyPair() {
  const pair = bridge.generateKeyPair();
  return keyPair({ pubKey: Buffer.from(pair.pubKey), privKey: Buffer.from(pair.privKey) });
}

export function calculateAgreement(pubKey, privKey) {
  return Buffer.from(bridge.calculateAgreement(prefixedPublicKey(pubKey), privateKey(privKey)));
}

export function calculateSignature(privKey, message) {
  if (!message) throw new Error("Invalid message");
  return Buffer.from(bridge.calculateSignature(privateKey(privKey), toBuffer(message)));
}

/** Returns whether the signature is valid. Throws only for a key, message or signature of a bad shape. */
export function verifySignature(pubKey, message, signature, isInit) {
  const key = prefixedPublicKey(pubKey);
  if (!message) throw new Error("Invalid message");
  if (signature?.byteLength !== 64) throw new Error("Invalid signature");
  if (isInit) return true;
  return bridge.verifySignature(key, toBuffer(message), toBuffer(signature));
}
