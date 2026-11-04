import type { KeyPair } from '../Types';
export declare function md5(buffer: Uint8Array): NonSharedBuffer;
/** HKDF-SHA256 (RFC 5869). */
export declare function hkdf(buffer: Uint8Array, expandedLength: number, info: {
    salt?: Uint8Array;
    info?: string;
}): Buffer<ArrayBuffer>;
/** prefix version byte to the pub keys, required for some curve crypto functions */
export declare const generateSignalPubKey: (pubKey: Uint8Array | Buffer) => Buffer<ArrayBufferLike> | Uint8Array<ArrayBufferLike>;
export declare const Curve: {
    generateKeyPair: () => KeyPair;
    sharedKey: (privateKey: Uint8Array, publicKey: Uint8Array) => Buffer<ArrayBuffer>;
    sign: (privateKey: Uint8Array, buf: Uint8Array) => Buffer<ArrayBuffer>;
    verify: (pubKey: Uint8Array, message: Uint8Array, signature: Uint8Array) => boolean;
};
export declare const signedKeyPair: (identityKeyPair: KeyPair, keyId: number) => {
    keyPair: KeyPair;
    signature: Buffer<ArrayBuffer>;
    keyId: number;
};
/**
 * encrypt AES 256 GCM;
 * where the tag tag is suffixed to the ciphertext
 * */
export declare function aesEncryptGCM(plaintext: Uint8Array, key: Uint8Array, iv: Uint8Array, additionalData: Uint8Array): Buffer<ArrayBuffer>;
/**
 * decrypt AES 256 GCM;
 * where the auth tag is suffixed to the ciphertext
 * */
export declare function aesDecryptGCM(ciphertext: Uint8Array, key: Uint8Array, iv: Uint8Array, additionalData: Uint8Array): Buffer<ArrayBuffer>;
export declare function aesEncryptCTR(plaintext: Uint8Array, key: Uint8Array, iv: Uint8Array): Buffer<ArrayBuffer>;
export declare function aesDecryptCTR(ciphertext: Uint8Array, key: Uint8Array, iv: Uint8Array): Buffer<ArrayBuffer>;
/** decrypt AES 256 CBC; where the IV is prefixed to the buffer */
export declare function aesDecrypt(buffer: Uint8Array, key: Uint8Array): Buffer<ArrayBuffer>;
/** decrypt AES 256 CBC */
export declare function aesDecryptWithIV(buffer: Uint8Array, key: Uint8Array, IV: Uint8Array): Buffer<ArrayBuffer>;
export declare function aesEncrypt(buffer: Uint8Array, key: Uint8Array): Buffer<ArrayBuffer>;
export declare function aesEncrypWithIV(buffer: Buffer, key: Buffer, IV: Buffer): Buffer<ArrayBuffer>;
export declare function hmacSign(buffer: Buffer | Uint8Array, key: Buffer | Uint8Array, variant?: 'sha256' | 'sha512'): NonSharedBuffer;
export declare function sha256(buffer: Buffer): NonSharedBuffer;
export declare function derivePairingCodeKey(pairingCode: string, salt: Buffer): Promise<Buffer>;
