import type { ServerSummary } from "@openbot/contracts/ipc";
import { BROWSER_SECRET_VAULT_CAPABILITY } from "@openbot/contracts/team-protocol/browser-secret-vault-v1";
import { VAULT_MEMBER_SAVE_CAPABILITY } from "@openbot/contracts/team-protocol/vault-member-save-v1";
import type { BrowserSecretVault } from "@openbot/ui/features/conversation/BrowserSecretCard";
import { serverRoleCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";

export function browserSecretVault(server: ServerSummary | undefined): BrowserSecretVault | undefined {
  if (!server) return undefined;
  if (server.kind === "local") return { server: null };
  if (!serverRoleCanAdminister(server) && !serverSupportsCapability(server, VAULT_MEMBER_SAVE_CAPABILITY))
    return { server: server.name, blocked: "role" };
  if (!serverSupportsCapability(server, BROWSER_SECRET_VAULT_CAPABILITY))
    return { server: server.name, blocked: "version" };
  return { server: server.name };
}
