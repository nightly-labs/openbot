// Key formats. A Signal public key is 33 bytes: the type byte 5, then 32 bytes of the X25519 key.
// Some callers keep the 32 bytes only; every function here accepts both and returns 33 bytes.
const KEY_TYPE = 5;

export function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("Expected bytes.");
}

export function prefixedPublicKey(value) {
  const key = toBuffer(value);
  if (key.byteLength === 33 && key[0] === KEY_TYPE) return key;
  if (key.byteLength === 32) return Buffer.concat([Buffer.of(KEY_TYPE), key]);
  throw new Error("Invalid public key");
}

export function privateKey(value) {
  const key = toBuffer(value);
  if (key.byteLength !== 32) throw new Error(`Incorrect private key length: ${key.byteLength}`);
  return key;
}

export function keyPair(value) {
  return { pubKey: prefixedPublicKey(value.pubKey), privKey: privateKey(value.privKey) };
}
