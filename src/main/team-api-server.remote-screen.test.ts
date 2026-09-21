import type { RemoteDesktopSetupStatus } from "@openbot/contracts/ipc";
import { TEAM_PROTOCOL_VERSION_HEADER } from "@openbot/contracts/team-protocol";
// @vitest-environment node

// Remote control and the Remote Desktop upgrade: `src/main/team-api/route-remote-screen.ts`, plus
// the upgrade handler that answers before any of it.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTeamApiFixture,
  stopTeamApiFixtures,
  type TeamApiOptions,
  unimplemented,
} from "./team-api-server-test-harness";

afterEach(stopTeamApiFixtures);

describe("TeamApiServer remote screen", () => {
  it("requires the WebRTC protocol for legacy Remote Desktop clients", async () => {
    const { start, signIn } = await createTeamApiFixture("desktop", { configure: true });
    const { base } = await start();

    const token = await signIn();
    const legacy = await fetch(`${base}/v1/host/remote-desktop-access`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(legacy.status).toBe(426);
    await expect(legacy.json()).resolves.toEqual({ error: "Update required.", code: "protocol_mismatch" });

    const unauthorized = await fetch(`${base}/v1/host/remote-desktop-access`);
    expect(unauthorized.status).toBe(401);
  });

  it("allows an active member to create remote control and rejects an outsider", async () => {
    const { store, start } = await createTeamApiFixture("remote-screen", { configure: true });
    const invite = await store.createInvite("member");
    const joined = await store.acceptInvite(invite.token, "alice", "a secure team password");
    const now = "2026-08-20T12:00:00.000Z";
    const createSession = vi.fn(
      async (input: { serverId: string; memberId: string; teamSessionId: string; teamSessionExpiresAt: string }) => ({
        id: "remote-session-1",
        serverId: input.serverId,
        viewerUrl: "https://studio.example/v1/remote-screen/sessions/remote-session-1/viewer",
        viewerGrant: "one-use-viewer-grant",
        displays: [{ id: "primary", label: "Primary display", width: 1920, height: 1080, primary: true }],
        selectedDisplayId: "primary",
        phase: "connecting" as const,
        transport: "unknown" as const,
        errorCode: null,
        message: "Waiting for the WebRTC client…",
        createdAt: now,
        grantExpiresAt: "2026-08-20T12:01:00.000Z",
      }),
    );
    const remoteScreen: NonNullable<TeamApiOptions["remoteScreen"]> = {
      handlesHttp: () => false,
      handleHttp: unimplemented,
      handlesUpgrade: () => false,
      handleUpgrade: unimplemented,
      stop: vi.fn(async () => undefined),
      capabilities: () => ({
        ready: true,
        platform: "darwin" as const,
        unattended: false,
        runtime: "sunshine-moonlight" as const,
        protocolVersion: 2 as const,
        displays: [],
        selectedDisplayId: null,
        activeSessions: 0,
        maxSessions: 4,
      }),
      checkSetup: vi.fn(
        async (): Promise<RemoteDesktopSetupStatus> => ({
          platform: "darwin",
          hostName: "Mac mini",
          username: "tenant",
          checkedAt: "2026-09-21T10:00:00.000Z",
          screenRecording: "blocked",
          accessibility: "blocked",
          service: "allowed",
          displays: "allowed",
          guiSession: "allowed",
          restartRequired: false,
          activeSessions: 0,
          message: null,
        }),
      ),
      test: vi.fn(async () => ({ active: true, mouse: false, keyboard: false, code: "1234" })),
      createSession,
      selectDisplay: vi.fn(async () => undefined),
      closeMemberSession: vi.fn(async () => true),
      revokeTeamSession: vi.fn(async () => undefined),
      revokeMember: vi.fn(async () => undefined),
    };
    const { base } = await start({ remoteScreen });

    const outsider = await fetch(`${base}/v1/remote-screen/sessions`, { method: "POST" });
    expect(outsider.status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();

    const response = await fetch(`${base}/v1/remote-screen/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joined.sessionToken}` },
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: "remote-session-1",
      viewerGrant: "one-use-viewer-grant",
      phase: "connecting",
    });
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: store.getIdentity()?.serverId,
        memberId: joined.member.id,
        teamSessionId: expect.any(String),
        teamSessionExpiresAt: joined.sessionExpiresAt,
      }),
    );

    for (const endpoint of ["setup", "test"]) {
      const denied = await fetch(`${base}/v1/remote-screen/${endpoint}`, { method: "POST", body: "{}" });
      expect(denied.status).toBe(401);
    }
    expect(remoteScreen.checkSetup).not.toHaveBeenCalled();
    expect(remoteScreen.test).not.toHaveBeenCalled();
    const setupHeaders = {
      Authorization: `Bearer ${joined.sessionToken}`,
      "Content-Type": "application/json",
      [TEAM_PROTOCOL_VERSION_HEADER]: "4",
    };
    const setup = await fetch(`${base}/v1/remote-screen/setup`, { method: "POST", headers: setupHeaders, body: "{}" });
    expect(setup.status).toBe(200);
    await expect(setup.json()).resolves.toMatchObject({
      username: "tenant",
      screenRecording: "blocked",
      accessibility: "blocked",
    });
    const liveTest = await fetch(`${base}/v1/remote-screen/test`, {
      method: "POST",
      headers: setupHeaders,
      body: JSON.stringify({ sessionId: "remote-session-1", action: "start" }),
    });
    expect(liveTest.status).toBe(200);
    expect(remoteScreen.test).toHaveBeenCalledWith("remote-session-1", joined.member.id, "start");
    const invalid = await fetch(`${base}/v1/remote-screen/test`, {
      method: "POST",
      headers: setupHeaders,
      body: JSON.stringify({ sessionId: "remote-session-1", action: "approve" }),
    });
    expect(invalid.status).toBe(400);
    expect(remoteScreen.test).toHaveBeenCalledTimes(1);

    const owner = await store.login("owner", "correct horse battery");
    const disabled = await fetch(`${base}/v1/team/members/${joined.member.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${owner.sessionToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ disabled: true }),
    });
    expect(disabled.status).toBe(200);
    expect(remoteScreen.revokeMember).toHaveBeenCalledWith(joined.member.id);

    const blocked = await fetch(`${base}/v1/remote-screen/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${joined.sessionToken}` },
    });
    expect(blocked.status).toBe(401);
    expect(createSession).toHaveBeenCalledOnce();
  });
});
