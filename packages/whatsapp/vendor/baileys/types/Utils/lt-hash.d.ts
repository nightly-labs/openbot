declare class LTHash {
    private readonly salt;
    constructor(salt: string);
    subtractThenAdd(base: Uint8Array, subtract: Uint8Array[], add: Uint8Array[]): Uint8Array;
    private pointwise;
}
export declare const LT_HASH_ANTI_TAMPERING: LTHash;
export {};
