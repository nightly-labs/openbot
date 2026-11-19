export function isPrivateNetworkCandidate(candidate: string): boolean {
  const fields = candidate.replace(/^a=/u, "").trim().split(/\s+/u);
  const address = fields[4];
  const type = fields[7];
  if (fields[6] !== "typ" || type !== "host" || !address) return false;
  return isPrivateNetworkAddress(address);
}

export function privateNetworkSdp(sdp: string): string {
  return sdp
    .split(/\r\n/u)
    .filter((line) => !line.startsWith("a=candidate:") || isPrivateNetworkCandidate(line))
    .join("\r\n");
}

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
