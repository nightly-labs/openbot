export function generateKeyPair(): { pubKey: Buffer; privKey: Buffer };
export function calculateAgreement(pubKey: Uint8Array, privKey: Uint8Array): Buffer;
export function calculateSignature(privKey: Uint8Array, message: Uint8Array): Buffer;
export function verifySignature(
  pubKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
  isInit?: boolean,
): boolean;
