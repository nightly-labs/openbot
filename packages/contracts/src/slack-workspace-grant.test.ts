import { describe, expect, it } from "vitest";
import { createSlackWorkspaceKeyPair, openSlackWorkspaceGrant, sealSlackWorkspaceGrant } from "./slack-workspace-grant";

const grant = { botToken: "xoxb-1-secret", botUserId: "U1", appId: "A1", workspaceId: "T1", workspaceName: "Acme" };

// The grant carries a Slack token through a browser. Only the host that asked for it may read it.
describe("Slack workspace grant", () => {
  it("opens only with the host key and the nonce of the sign-in that asked for it", async () => {
    const host = await createSlackWorkspaceKeyPair();
    const other = await createSlackWorkspaceKeyPair();
    const sealed = await sealSlackWorkspaceGrant(host.publicKey, "nonce-1", grant);

    expect(sealed).not.toContain("xoxb");
    await expect(openSlackWorkspaceGrant(host.privateKey, "nonce-1", sealed)).resolves.toEqual(grant);
    await expect(openSlackWorkspaceGrant(other.privateKey, "nonce-1", sealed)).rejects.toThrow();
    await expect(openSlackWorkspaceGrant(host.privateKey, "nonce-2", sealed)).rejects.toThrow();
  });
});
