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
  if (previous.address === null || next.address === null || previous.address === next.address) return null;
  return DIRECT_TYPES.has(next.type) ? "moved" : "changed";
}

export function strongerChange(first: NetworkChange | null, second: NetworkChange | null): NetworkChange | null {
  return first === "moved" || second === "moved" ? "moved" : (first ?? second);
}
