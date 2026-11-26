import { md5, sha1 } from "@noble/hashes/legacy.js";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { bytesToBase64 } from "@openbot/team-client/base64";
import { requireOptionalNativeModule, UnavailabilityError, uuid } from "expo";

type Hash = (data: Uint8Array) => Uint8Array;

const HASHES: Readonly<Record<string, Hash>> = {
  "SHA-1": sha1,
  "SHA-256": sha256,
  "SHA-384": sha384,
  "SHA-512": sha512,
  MD5: md5,
};

const RANDOM_HEX_PER_UUID = 30;

function hashOf(algorithm: string): Hash {
  const hash = HASHES[algorithm];
  if (!hash) throw new UnavailabilityError("expo-crypto", algorithm);
  return hash;
}

function randomHexOfUuid(): string {
  const hex = uuid.v4().replaceAll("-", "");
  return hex.slice(0, 12) + hex.slice(13, 16) + hex.slice(17);
}

function getRandomValues<T extends ArrayBufferView>(target: T): T {
  const bytes = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
  for (let offset = 0; offset < bytes.length; ) {
    const hex = randomHexOfUuid();
    for (let index = 0; index < RANDOM_HEX_PER_UUID && offset < bytes.length; index += 2) {
      bytes[offset++] = Number.parseInt(hex.slice(index, index + 2), 16);
    }
  }
  return target;
}

function digestString(algorithm: string, data: string, options: { encoding: "hex" | "base64" }): string {
  const output = hashOf(algorithm)(utf8ToBytes(data));
  return options.encoding === "base64" ? bytesToBase64(output) : bytesToHex(output);
}

const expoGoCrypto = {
  getRandomValues,
  randomUUID: (): string => uuid.v4(),
  digestString,
  digestStringAsync: async (algorithm: string, data: string, options: { encoding: "hex" | "base64" }) =>
    digestString(algorithm, data, options),
  digest: (algorithm: string, output: Uint8Array, data: ArrayBufferView): void => {
    output.set(hashOf(algorithm)(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)));
  },
};

export default requireOptionalNativeModule("ExpoCrypto") ?? expoGoCrypto;
