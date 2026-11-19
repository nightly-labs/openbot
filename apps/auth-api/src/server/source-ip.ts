export function requestSourceIp(request: Request): string {
  const address = request.headers.get("CF-Connecting-IP") ?? "127.0.0.1";
  return address.includes(":") ? ipv6Prefix(address) : address;
}

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
