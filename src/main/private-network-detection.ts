import { networkInterfaces } from "node:os";

// Tailscale gives each device an address in this unique local IPv6 prefix. Other VPNs, such as
// Cloudflare WARP, also use 100.64.0.0/10 for IPv4, so only this prefix identifies Tailscale.
const TAILSCALE_IPV6_PREFIX = "fd7a:115c:a1e0:";

/**
 * Whether Tailscale is connected on this computer. Reads only the network interfaces: running the
 * Tailscale CLI can show a permission prompt for the Mac App Store version.
 */
export function isTailscaleConnected(): boolean {
  return Object.values(networkInterfaces()).some((addresses) =>
    (addresses ?? []).some(
      (address) => address.family === "IPv6" && address.address.toLowerCase().startsWith(TAILSCALE_IPV6_PREFIX),
    ),
  );
}
