import type { ServerSummary } from "@openbot/contracts/ipc";
import { BROWSER_SECRET_VAULT_CAPABILITY } from "@openbot/contracts/team-protocol/browser-secret-vault-v1";
import type { BrowserSecretVault } from "@openbot/ui/features/conversation/BrowserSecretCard";
import { serverRoleCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";

/**
 * Where the secure card can save a typed password: this computer, or the Vault of the joined server
 * that runs the agent. A member and a host without `browser-secret-vault-v1` see the box off, with the
 * reason, so the user knows why nothing was saved. The host checks the role again.
 */
export function browserSecretVault(server: ServerSummary | undefined): BrowserSecretVault | undefined {
  if (!server) return undefined;
  if (server.kind === "local") return { server: null };
  if (!serverRoleCanAdminister(server)) return { server: server.name, blocked: "role" };
  if (!serverSupportsCapability(server, BROWSER_SECRET_VAULT_CAPABILITY))
    return { server: server.name, blocked: "version" };
  return { server: server.name };
}
