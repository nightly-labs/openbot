export type NetworkChange = "moved" | "changed";

export interface NetworkPoint {
  type: string;
  address: string | null;
}

const DIRECT_TYPES = new Set(["WIFI", "CELLULAR", "ETHERNET"]);
const NO_ADDRESS = new Set(["0.0.0.0", "::"]);

export function usableAddress(address: string | null | undefined): string | null {
  return address && !NO_ADDRESS.has(address) ? address : null;
}

export function networkChange(previous: NetworkPoint, next: NetworkPoint): NetworkChange | null {
  const direct = DIRECT_TYPES.has(previous.type) && DIRECT_TYPES.has(next.type);
  if (previous.type !== next.type) return direct ? "moved" : "changed";
  if (previous.address === next.address) return null;
  if (!DIRECT_TYPES.has(next.type)) return "changed";
  return previous.address === null || next.address === null ? null : "moved";
}

export function rememberedPoint(previous: NetworkPoint | undefined, next: NetworkPoint): NetworkPoint {
  const keepAddress = next.address === null && previous?.type === next.type && DIRECT_TYPES.has(next.type);
  return keepAddress ? { ...next, address: previous.address } : next;
}

export function strongerChange(first: NetworkChange | null, second: NetworkChange | null): NetworkChange | null {
  return first === "moved" || second === "moved" ? "moved" : (first ?? second);
}
