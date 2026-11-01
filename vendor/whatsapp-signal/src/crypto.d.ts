export function encrypt(key: Uint8Array, data: Uint8Array, iv: Uint8Array): Buffer;
export function decrypt(key: Uint8Array, data: Uint8Array, iv: Uint8Array): Buffer;
export function calculateMAC(key: Uint8Array, data: Uint8Array): Buffer;
export function deriveSecrets(input: Uint8Array, salt: Uint8Array, info: Uint8Array, chunks?: number): Buffer[];
