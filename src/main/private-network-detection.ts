import { networkInterfaces } from "node:os";

const TAILSCALE_IPV6_PREFIX = "fd7a:115c:a1e0:";

export function isTailscaleConnected(): boolean {
  return Object.values(networkInterfaces()).some((addresses) =>
    (addresses ?? []).some(
      (address) => address.family === "IPv6" && address.address.toLowerCase().startsWith(TAILSCALE_IPV6_PREFIX),
    ),
  );
}
