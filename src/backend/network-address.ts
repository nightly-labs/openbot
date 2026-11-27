import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Effect, Schema } from "effect";
import { causeHelpers } from "./effect-boundary";

export class AddressLookupError extends Schema.TaggedError<AddressLookupError>()("AddressLookupError", {
  cause: Schema.Defect(),
}) {}

const { io } = causeHelpers(AddressLookupError);

export type AddressLookup = (hostname: string) => Effect.Effect<readonly string[], AddressLookupError>;

export const systemAddressLookup: AddressLookup = Effect.fn("NetworkAddress.lookup")(function* (hostname: string) {
  const answers = yield* io(() => lookup(hostname, { all: true, verbatim: true }));
  return answers.map(({ address }) => address);
});

export function isPublicAddress(address: string): boolean {
  const bare = address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
  const version = isIP(bare);
  if (version === 4) return isPublicIpv4(ipv4Octets(bare));
  if (version === 6) return isPublicIpv6(bare);
  return false;
}

export function hostAddresses(url: URL, resolve: AddressLookup): Effect.Effect<readonly string[], AddressLookupError> {
  const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  return isIP(host) ? Effect.succeed([host]) : resolve(host);
}

function ipv4Octets(address: string): number[] {
  return address.split(".").map(Number);
}

function isPublicIpv4([a = 0, b = 0]: readonly number[]): boolean {
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  return a < 224;
}

function isPublicIpv6(address: string): boolean {
  const groups = ipv6Groups(address);
  if (!groups) return false;
  const [first = 0] = groups;
  if (groups.slice(0, 7).every((group) => group === 0) && (groups[7] ?? 0) <= 1) return false;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const high = groups[6] ?? 0;
    return isPublicIpv4([high >> 8, high & 0xff]);
  }
  if (groups.slice(0, 4).every((group) => group === 0)) return false;
  if (first === 0x64 && groups[1] === 0xff9b) {
    if (groups[2] === 1) return false;
    if (!groups.slice(2, 6).every((group) => group === 0)) return false;
    const high = groups[6] ?? 0;
    return isPublicIpv4([high >> 8, high & 0xff]);
  }
  if (first === 0x2002) {
    const high = groups[1] ?? 0;
    return isPublicIpv4([high >> 8, high & 0xff]);
  }
  if ((first & 0xfe00) === 0xfc00) return false;
  if ((first & 0xffc0) === 0xfe80) return false;
  return (first & 0xff00) !== 0xff00;
}

function ipv6Groups(address: string): number[] | null {
  let text = address.split("%")[0] ?? "";
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    text = `${text.slice(0, tail.index)}${(((a ?? 0) << 8) | (b ?? 0)).toString(16)}:${(((c ?? 0) << 8) | (d ?? 0)).toString(16)}`;
  }
  const [head = "", rest] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = rest ? rest.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (rest === undefined ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array<string>(rest === undefined ? 0 : missing).fill("0"), ...right];
  return groups.map((group) => Number.parseInt(group, 16));
}
