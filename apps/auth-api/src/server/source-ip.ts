/**
 * The client that Cloudflare connects: its IPv4 address, or the /64 of its IPv6 address. One IPv6
 * subscriber usually has a full /64, so each address in it would get its own rate limit. A client sets
 * `X-Forwarded-For` itself, so a rate limit never reads it. A request with no Cloudflare address, as in
 * local development, shares one key.
 */
export function requestSourceIp(request: Request): string {
  const address = request.headers.get("CF-Connecting-IP") ?? "127.0.0.1";
  return address.includes(":") ? ipv6Prefix(address) : address;
}

/** The first 64 bits of an IPv6 address, as `2001:db8:0:1::/64`. A value that is not IPv6 stays as it is. */
function ipv6Prefix(address: string): string {
  const halves = address.toLowerCase().split("::");
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const gap = 8 - head.length - tail.length;
  const groups = halves.length === 2 && gap > 0 ? [...head, ...Array<string>(gap).fill("0"), ...tail] : head;
  if (halves.length > 2 || groups.length !== 8 || !groups.every((group) => /^[0-9a-f]{1,4}$/.test(group)))
    return address;
  return `${groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(":")}::/64`;
}
