/**
 * The network of the phone as a bug report shows it: the kind of connection, and the VPN or mesh
 * network (Tailscale, ZeroTier) that is on. A connection problem often comes from one of them, and
 * the host cannot see it.
 *
 * No system gives an app the name of the VPN app. The name comes from the address that the VPN gives
 * its tunnel: each product has its own range. The report is public and such an address can point to
 * one phone, so the text has the name and at most the first two numbers of a private range, never an
 * address.
 */

/** The connection that carries the data, as `expo-network` reports it. */
export type PhoneConnection = "wifi" | "cellular" | "ethernet" | "vpn" | "none" | "unknown";

/** One address of a network interface of the phone. `vpn` is null when the system did not say. */
export interface InterfaceAddress {
  readonly address: string;
  readonly vpn: boolean | null;
  /** The connection below a VPN interface, when the system tells it. */
  readonly underlying: PhoneConnection | null;
}

export interface PhoneNetworkReading {
  readonly connection: PhoneConnection;
  /** Null when this app build cannot read the interfaces. */
  readonly addresses: readonly InterfaceAddress[] | null;
}

const CONNECTION_TEXT: Record<PhoneConnection, string> = {
  wifi: "Wi-Fi",
  cellular: "Mobile data",
  ethernet: "Ethernet",
  vpn: "Network type not known",
  none: "No network",
  unknown: "Network type not known",
};

function ipv4(address: string): readonly [number, number, number, number] | null {
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(address);
  if (!parts) return null;
  const [a, b, c, d] = parts.slice(1).map(Number);
  if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
  return a > 255 || b > 255 || c > 255 || d > 255 ? null : [a, b, c, d];
}

/** The eight groups of an IPv6 address, or null when the text is not one. */
function ipv6(address: string): readonly number[] | null {
  const text = address.replace(/%.*$/u, "").toLowerCase();
  if (!/^[0-9a-f:]{2,39}$/u.test(text) || !text.includes(":")) return null;
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string | undefined) => (part ? part.split(":").map((group) => Number.parseInt(group, 16)) : []);
  const head = groups(halves[0]);
  const tail = groups(halves[1]);
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array<number>(halves.length === 1 ? 0 : missing).fill(0), ...tail];
  return all.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? all : null;
}

/**
 * The product that gives its tunnel this address, or null. An IPv6 range belongs to one product, so
 * it counts on each interface. A private IPv4 address is also a home network, so it counts only on
 * an interface that the system calls a VPN. "probably" marks a name that comes from the default
 * range of a product, which a user or a later version can change.
 */
function vpnName(entry: InterfaceAddress) {
  const v6 = ipv6(entry.address);
  if (v6) {
    const [first = 0, second = 0, third = 0, , fifth = 0, sixth = 0] = v6;
    if (first === 0xfd7a && second === 0x115c && third === 0xa1e0) return "Tailscale";
    // A ZeroTier address is `fd`, the network ID, `99 93`, and the node ID.
    if (first >> 8 === 0xfd && (fifth & 0xff) === 0x99 && sixth >> 8 === 0x93) return "ZeroTier";
    if (first === 0x2606 && second === 0x4700 && third === 0x110) return "probably Cloudflare WARP";
    if (first === 0xfc00 && second === 0xbbbb && third === 0xbbbb) return "probably Mullvad";
    if (first === 0x2a07 && second === 0xb944) return "probably Proton VPN";
    return null;
  }
  const v4 = ipv4(entry.address);
  if (!v4 || entry.vpn !== true) return null;
  const [a, b, c, d] = v4;
  // Tailscale, Headscale and NetBird give addresses from the shared range. A mobile network also
  // uses it, but not on a VPN interface.
  if (a === 100 && b >= 64 && b <= 127) return "probably Tailscale or a similar mesh VPN (tunnel 100.64.x.x)";
  if (a === 10 && b === 5 && c === 0 && d === 2) return "probably NordVPN";
  if (a === 10 && b === 2 && c === 0 && d === 2) return "probably Proton VPN";
  if (a === 10 && b === 14 && c === 0 && d === 2) return "probably Surfshark";
  if (a === 172 && b === 16 && c === 0 && d === 2) return "probably Cloudflare WARP";
  if (a === 10 && b >= 64 && b <= 127) return "probably Mullvad";
  return null;
}

/** The start of a private tunnel address, such as `10.8.x.x`. It names a product, not a phone. */
function tunnelRange(entry: InterfaceAddress): string | null {
  const v4 = entry.vpn === true ? ipv4(entry.address) : null;
  if (!v4) return null;
  const [a, b] = v4;
  const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  return isPrivate ? `${a}.${b}.x.x` : null;
}

function vpnText(reading: PhoneNetworkReading): string {
  const addresses = reading.addresses ?? [];
  const names = [...new Set(addresses.flatMap((entry) => vpnName(entry) ?? []))];
  // The exact name of a product replaces the guess from its IPv4 range.
  const exact = names.filter((name) => !name.startsWith("probably "));
  const shown = exact.length > 0 ? exact : names;
  if (shown.length > 0) return `VPN: ${shown.join(" and ")}`;
  if (reading.connection === "vpn" || addresses.some((entry) => entry.vpn === true)) {
    const range = addresses.flatMap((entry) => tunnelRange(entry) ?? [])[0];
    return `VPN: on, name not known${range ? ` (tunnel ${range})` : ""}`;
  }
  // "No VPN" needs an interface list in which the system marks the VPN interfaces.
  if (addresses.some((entry) => entry.vpn === false)) return "no VPN found";
  return "VPN: not known";
}

/** Such as `Wi-Fi · VPN: Tailscale`, `Mobile data · no VPN found` or `Wi-Fi · VPN: on, name not known (tunnel 10.8.x.x)`. */
export function phoneNetworkText(reading: PhoneNetworkReading): string {
  const below = reading.addresses?.find((entry) => entry.vpn === true && entry.underlying)?.underlying;
  const connection = reading.connection === "vpn" && below ? below : reading.connection;
  if (connection === "none") return CONNECTION_TEXT.none;
  return `${CONNECTION_TEXT[connection]} · ${vpnText(reading)}`;
}

function adapterConnection(value: unknown): PhoneConnection | null {
  if (typeof value !== "string") return null;
  if (value === "wifi") return "wifi";
  if (value === "ethernet") return "ethernet";
  return value.startsWith("cellular") ? "cellular" : null;
}

/**
 * The interface addresses in the statistics of a WebRTC connection that gathered its own
 * candidates. Each local candidate has the address of one interface, and the library marks the
 * interface of a VPN (`vpn`, or `networkType` in an older version).
 */
export function interfaceAddresses(reports: Iterable<unknown>): InterfaceAddress[] {
  const found: InterfaceAddress[] = [];
  for (const report of reports) {
    if (typeof report !== "object" || report === null) continue;
    if (!("type" in report) || report.type !== "local-candidate") continue;
    const address = "address" in report ? report.address : "ip" in report ? report.ip : undefined;
    if (typeof address !== "string" || address.length === 0) continue;
    const flag = "vpn" in report && typeof report.vpn === "boolean" ? report.vpn : null;
    const type = "networkType" in report && typeof report.networkType === "string" ? report.networkType : null;
    const vpn = flag === true || type === "vpn" ? true : flag === false || type !== null ? false : null;
    const underlying = vpn && "networkAdapterType" in report ? adapterConnection(report.networkAdapterType) : null;
    if (!found.some((entry) => entry.address === address)) found.push({ address, vpn, underlying });
  }
  return found;
}

/** The address in a candidate line (`candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host ...`). */
export function candidateLineAddress(line: string): string | null {
  const parts = line.trim().split(/\s+/u);
  return parts[7] === "host" && parts[4] ? parts[4] : null;
}

/**
 * What the WebRTC library gave the probe, for the support log: the number of interfaces, and the
 * names of the fields of a local candidate and of the attributes of a candidate line. Only names,
 * never a value, so a line cannot hold an address. It shows on a device whether the library marks
 * a VPN interface.
 */
export function probeShape(reports: Iterable<unknown>, lines: readonly string[], interfaces: number): string {
  const fields = new Set<string>();
  for (const report of reports) {
    if (typeof report !== "object" || report === null) continue;
    if (!("type" in report) || report.type !== "local-candidate") continue;
    for (const key of Object.keys(report)) if (/^[A-Za-z]{1,40}$/u.test(key)) fields.add(key);
  }
  const attributes = new Set<string>();
  for (const line of lines) {
    // After `typ <type>`, a line has pairs of an attribute name and its value.
    const parts = line.trim().split(/\s+/u).slice(8);
    for (let index = 0; index < parts.length; index += 2) {
      const name = parts[index];
      if (name && /^[a-z][a-z-]{0,39}$/u.test(name)) attributes.add(name);
    }
  }
  const list = (names: Set<string>) => (names.size > 0 ? [...names].sort().join(" ") : "none");
  return `${interfaces} interfaces; candidate fields: ${list(fields)}; line attributes: ${list(attributes)}`;
}
