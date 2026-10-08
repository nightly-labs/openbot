import { mkdir, writeFile } from "node:fs/promises";
import type { HostReleaseStatus } from "@openbot/contracts/ipc";
import { HOST_RELEASE_CAPABILITY, HOST_RELEASE_ROUTES } from "@openbot/contracts/team-protocol/host-release-v1";
import { Deferred, Effect } from "effect";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { HostReleaseService } from "./host-release-service";
import { createTeamApiFixture, stopTeamApiFixtures } from "./team-api-server-test-harness";

afterEach(stopTeamApiFixtures);
const report: { scenario: string; status: HostReleaseStatus }[] = [];
afterAll(async () => {
  await mkdir(".openbot-build", { recursive: true });
  await writeFile(".openbot-build/host-release-report.json", JSON.stringify(report, null, 2));
});

function manifest(version: string, asset = `OpenBot-${version}-x86_64.AppImage`) {
  return new Response(`version: ${version}\nfiles:\n  - url: ${asset}\n`);
}

async function setup(
  options: {
    fetch?: typeof fetch;
    version?: string;
    mode?: string;
    managed?: boolean;
    environment?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    arch?: string;
    packaged?: boolean;
  } = {},
) {
  const release = new HostReleaseService({
    currentVersion: options.version ?? "0.25.2",
    packaged: options.packaged ?? true,
    platform: options.platform ?? "linux",
    arch: options.arch ?? "x64",
    environment: options.environment ?? { OPENBOT_HOSTED_SERVER: "1" },
    installationMode: options.mode ?? null,
    updateStatus: () => ({ phase: "unsupported", managedByHost: options.managed ?? false }),
    fetch: options.fetch ?? vi.fn(async () => manifest("0.26.0")),
  });
  const fixture = await createTeamApiFixture("host-release", { configure: true });
  const { base } = await fixture.start({ admin: { release } });
  const headers = {
    Authorization: `Bearer ${await fixture.signIn()}`,
    "OpenBot-Protocol-Version": "3",
    "OpenBot-Capabilities": HOST_RELEASE_CAPABILITY,
    "Content-Type": "application/json",
  };
  const post = (path: string, override = headers) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: override,
      body: "{}",
    });
  const check = async (): Promise<HostReleaseStatus> => {
    const response = await post(HOST_RELEASE_ROUTES.check);
    expect(response.status).toBe(200);
    return response.json();
  };
  return { fixture, base, headers, post, check, release };
}

describe("host-release-v1", () => {
  it("allows release discovery for active members that negotiated the capability", async () => {
    const requestFeed = vi.fn(async () => manifest("0.26.0"));
    const { fixture, base, headers, post, check } = await setup({ fetch: requestFeed });
    const invite = await Effect.runPromise(fixture.store.createInvite("member"));
    const member = await Effect.runPromise(fixture.store.acceptInvite(invite.token, "member", "member password"));
    for (const route of Object.values(HOST_RELEASE_ROUTES)) {
      expect((await post(route, { ...headers, "OpenBot-Capabilities": "" })).status).toBe(400);
      expect((await post(route, { ...headers, Authorization: "" })).status).toBe(401);
    }
    expect(requestFeed).not.toHaveBeenCalled();
    const compatibility = await (await fetch(`${base}/v1/compatibility`)).json();
    expect(compatibility.capabilities).toContain(HOST_RELEASE_CAPABILITY);
    for (const route of Object.values(HOST_RELEASE_ROUTES)) {
      expect((await post(route, { ...headers, Authorization: `Bearer ${member.sessionToken}` })).status).toBe(200);
    }
    await Effect.runPromise(fixture.store.updateMember(member.member.id, { disabled: true }));
    expect(
      (await post(HOST_RELEASE_ROUTES.check, { ...headers, Authorization: `Bearer ${member.sessionToken}` })).status,
    ).toBe(401);
    const status = await check();
    expect(status).toEqual({ currentVersion: "0.25.2", latestVersion: "0.26.0", phase: "available", method: "hosted" });
    report.push({ scenario: "hosted update available", status });
  });

  it.each([
    { version: "0.26.0", phase: "up-to-date" },
    { version: "0.27.0", phase: "up-to-date" },
    { version: "0.26.0-beta.1", phase: "available" },
  ])("compares the release with installed $version", async ({ version, phase }) => {
    const { check } = await setup({ version });
    const status = await check();
    expect(status.phase).toBe(phase);
    expect(status.latestVersion).toBe("0.26.0");
    report.push({ scenario: `installed ${version}`, status });
  });

  it.each([
    { name: "network failure", response: () => Promise.reject(new Error("private-network-detail")) },
    { name: "feed unavailable", response: async () => new Response("private-service-detail", { status: 503 }) },
    { name: "malformed feed", response: async () => new Response("version: false") },
    { name: "wrong architecture", response: async () => manifest("0.26.0", "OpenBot-0.26.0-arm64.AppImage") },
    { name: "prerelease", response: async () => manifest("0.26.0-beta.1") },
    { name: "oversized feed", response: async () => new Response("x".repeat(65_537)) },
  ])("returns safe retryable status after $name", async ({ name, response }) => {
    const feed = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(response)
      .mockImplementation(async () => manifest("0.26.0"));
    const { check } = await setup({ fetch: feed });
    const failed = await check();
    expect(failed).toEqual({ currentVersion: "0.25.2", latestVersion: null, phase: "error", method: "hosted" });
    expect((await check()).phase).toBe("available");
    report.push({ scenario: name, status: failed });
  });

  it.each([
    { name: "host manager", managed: true, method: "host-manager" },
    { name: "system service", mode: "self", environment: { OPENBOT_SERVER: "1" }, method: "system" },
    { name: "container", mode: "container", method: "container" },
    { name: "manual installation", environment: {}, method: "manual" },
  ])("identifies the update path for $name", async ({ name, method, ...options }) => {
    const { check } = await setup(options);
    const status = await check();
    expect(status.method).toBe(method);
    expect(status.phase).toBe("available");
    report.push({ scenario: name, status });
  });

  it.each([{ packaged: false }, { arch: "ia32" }, { version: "unknown" }, { platform: "freebsd" as const }])(
    "does not check a build without a compatible feed: %j",
    async (options) => {
      const feed = vi.fn(async () => manifest("0.26.0"));
      const { check } = await setup({ ...options, fetch: feed });
      expect((await check()).phase).toBe("unavailable");
      expect(feed).not.toHaveBeenCalled();
    },
  );

  it("shares a pending check and reports checking to a reconnected client", async () => {
    const answer = Deferred.makeUnsafe<Response>();
    const feed = vi.fn(() => Effect.runPromise(Deferred.await(answer)));
    const { post, check, release } = await setup({ fetch: feed });
    const checks = vi.spyOn(release, "check");
    const first = check();
    await vi.waitFor(() => expect(feed).toHaveBeenCalledOnce());
    const statusResponse = await post(HOST_RELEASE_ROUTES.status);
    expect((await statusResponse.json()).phase).toBe("checking");
    const second = check();
    await vi.waitFor(() => expect(checks).toHaveBeenCalledTimes(2));
    Effect.runSync(Deferred.succeed(answer, manifest("0.26.0")));
    expect((await first).phase).toBe("available");
    expect((await second).phase).toBe("available");
    expect(feed).toHaveBeenCalledOnce();
    // The final read also works from a new HTTP request after the original check ends.
    expect((await (await post(HOST_RELEASE_ROUTES.status)).json()).latestVersion).toBe("0.26.0");
  });
});
