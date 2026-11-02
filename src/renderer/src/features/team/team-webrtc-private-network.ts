/**
 * The private network route: a connection to this host uses only addresses on a local or private
 * network, such as the Wi-Fi or a Tailscale tailnet. The host gets no STUN or TURN servers, so it
 * has no relayed or server-reflexive candidates, and these filters remove every other candidate
 * that names a public address. Chats and files then never go through OpenBot servers.
 */

/** Whether an ICE candidate line names a host address on a private network, or an mDNS name. */
export function isPrivateNetworkCandidate(candidate: string): boolean {
  // candidate:<foundation> <component> <transport> <priority> <address> <port> typ <type> ...
  const fields = candidate.replace(/^a=/u, "").trim().split(/\s+/u);
  const address = fields[4];
  const type = fields[7];
  if (fields[6] !== "typ" || type !== "host" || !address) return false;
  return isPrivateNetworkAddress(address);
}

/** Removes the candidates of a session description that are not on a private network. */
export function privateNetworkSdp(sdp: string): string {
  return sdp
    .split(/\r\n/u)
    .filter((line) => !line.startsWith("a=candidate:") || isPrivateNetworkCandidate(line))
    .join("\r\n");
}

/**
 * Private IPv4 (RFC 1918), shared address space (RFC 6598, which Tailscale uses), unique local IPv6
 * (which includes the Tailscale `fd7a:115c:a1e0::/48` prefix), and mDNS `.local` names. A `.local`
 * name resolves only on the local link. Link-local and loopback addresses do not count: a phone
 * cannot use them.
 */
export function isPrivateNetworkAddress(address: string): boolean {
  const name = address.toLowerCase();
  if (name.endsWith(".local")) return true;
  if (name.includes(":")) return /^f[cd][0-9a-f]{2}:/u.test(name);
  const octets = name.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first = 0, second = 0] = octets;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}
