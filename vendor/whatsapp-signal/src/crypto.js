// The symmetric functions that Baileys imports from `libsignal/src/crypto.js`, on node:crypto.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync } from "node:crypto";
import { toBuffer } from "./keys.js";

export function encrypt(key, data, iv) {
  const cipher = createCipheriv("aes-256-cbc", toBuffer(key), toBuffer(iv));
  return Buffer.concat([cipher.update(toBuffer(data)), cipher.final()]);
}

export function decrypt(key, data, iv) {
  const decipher = createDecipheriv("aes-256-cbc", toBuffer(key), toBuffer(iv));
  return Buffer.concat([decipher.update(toBuffer(data)), decipher.final()]);
}

export function calculateMAC(key, data) {
  return createHmac("sha256", toBuffer(key)).update(toBuffer(data)).digest();
}

/** HKDF-SHA256 (RFC 5869) with a 32-byte salt, returned as `chunks` keys of 32 bytes (1 to 3). */
export function deriveSecrets(input, salt, info, chunks = 3) {
  if (toBuffer(salt).byteLength !== 32) throw new Error("Got salt of incorrect length");
  if (!Number.isInteger(chunks) || chunks < 1 || chunks > 3) throw new Error("Invalid chunk count");
  const output = Buffer.from(hkdfSync("sha256", toBuffer(input), toBuffer(salt), toBuffer(info), 32 * chunks));
  return Array.from({ length: chunks }, (_, index) => output.subarray(index * 32, index * 32 + 32));
}
