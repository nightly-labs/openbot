// The owner's view of a joined server's Tailscale setup: the host's snapshot (`host-tailscale-v1`)
// next to this computer's Tailscale client, and whether this computer can reach the host in Tailscale.

import type { HostTailscaleSetup, TailscaleNetworkMatch, TailscaleSetupStatus } from "@openbot/contracts/ipc";
import type { TailscaleLocalState } from "./tailscale-cli";

/**
 * `same` when both report the same tailnet; `shared` when this computer sees the host's device in
 * another tailnet, as node sharing gives it; `other` when it cannot see the host. Null until both
 * are connected.
 */
function tailscaleNetworkMatch(local: TailscaleLocalState, host: HostTailscaleSetup): TailscaleNetworkMatch | null {
  if (local.kind !== "connected" || host.state !== "connected") return null;
  if (local.tailnet && host.tailnet && local.tailnet === host.tailnet) return "same";
  if (host.dnsName && local.peerDnsNames.includes(host.dnsName)) return "shared";
  return "other";
}

export function tailscaleSetupStatus(local: TailscaleLocalState, host: HostTailscaleSetup): TailscaleSetupStatus {
  return {
    client: {
      state: local.kind,
      tailnet: local.kind === "connected" ? local.tailnet : null,
      deviceName: local.kind === "connected" ? local.deviceName || null : null,
    },
    host,
    network: tailscaleNetworkMatch(local, host),
  };
}
