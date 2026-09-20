import { describe, expect, it, vi } from "vitest";
import { validateTenantMetadata } from "./openbot-host-macos";
import { type HostAdminOperations, parseHostSetup, setupHost, verifyHost } from "./openbot-host-service";

function fixture() {
  const events: string[] = [];
  const ops: HostAdminOperations = {
    verifyInstallation: vi.fn(async () => undefined),
    verifyApplication: vi.fn(async () => undefined),
    prepareApplication: vi.fn(async () => {
      events.push("prepare");
    }),
    readConfig: vi.fn(async () => null),
    checkNewUsers: vi.fn(async () => undefined),
    inspectTenant: vi.fn(async (name: string) => ({ name, uid: name === "client-acme" ? 501 : 502 })),
    createUsers: vi.fn(async (names: string[]) => {
      events.push("create");
      return names.map((name) => ({
        name,
        uid: name === "client-acme" ? 501 : 502,
        password: "generated-password-only-for-test",
      }));
    }),
    register: vi.fn(async () => {
      events.push("register");
    }),
    startJobs: vi.fn(async () => {
      events.push("launchd");
    }),
    presentCredentials: vi.fn(async () => {
      events.push("passwords");
    }),
    tenantForUid: vi.fn(async (uid) => ({ uid, name: uid === 501 ? "client-acme" : "client-bravo" })),
    verifyState: vi.fn(async () => undefined),
    verifyDaemon: vi.fn(async () => undefined),
    verifyIsolation: vi.fn(async () => undefined),
  };
  return { ops, events };
}

describe("installed host setup", () => {
  it("accepts Standard private homes and rejects admin, mode, owner, symlink and ACL violations", () => {
    const safe = {
      name: "client-acme",
      uid: 501,
      groups: "20 12",
      homeAttribute: "NFSHomeDirectory: /Users/client-acme",
      owner: 501,
      mode: 0o40700,
      directory: true,
      acl: "",
    };
    expect(validateTenantMetadata(safe)).toEqual({ name: "client-acme", uid: 501 });
    for (const change of [
      { groups: "20 80" },
      { mode: 0o40755 },
      { owner: 502 },
      { directory: false },
      { acl: " 0: group:everyone allow read" },
      { homeAttribute: "NFSHomeDirectory: /Users/other" },
    ]) {
      expect(() => validateTenantMetadata({ ...safe, ...change })).toThrow();
    }
  });
  it("registers existing and newly created accounts, then shows credentials once", async () => {
    const f = fixture();
    await setupHost(parseHostSetup(["--tenant", "client-acme", "--create-user", "client-bravo"]), f.ops);
    expect(f.ops.register).toHaveBeenCalledWith([501, 502]);
    expect(f.events).toEqual(["prepare", "create", "register", "launchd", "passwords"]);
    expect(f.ops.presentCredentials).toHaveBeenCalledOnce();
  });

  it.each([
    { args: ["--tenant", "client-acme", "--create-user", "client-acme"] },
    { args: ["--create-user", "../escape"] },
    { args: ["--tenant", "acme\n"] },
    { args: ["--admin", "acme"] },
    { args: [] },
  ])("rejects invalid or duplicate setup input $args", ({ args }) => {
    expect(() => parseHostSetup(args)).toThrow();
  });

  it("checks a dry run without modifying accounts, application or launchd", async () => {
    const f = fixture();
    await setupHost(parseHostSetup(["--dry-run", "--create-user", "client-acme"]), f.ops);
    expect(f.events).toEqual([]);
    expect(f.ops.verifyApplication).toHaveBeenCalledOnce();
  });

  it("does not reset registered tenants", async () => {
    const f = fixture();
    f.ops.readConfig = async () => ({ managed: true, tenants: [501] });
    await expect(setupHost(parseHostSetup(["--tenant", "client-acme"]), f.ops)).rejects.toThrow("already registered");
    expect(f.events).toEqual([]);
  });

  it.each(["admin account", "unsafe home mode", "unsafe home ACL"])(
    "rejects %s before account creation",
    async (reason) => {
      const f = fixture();
      f.ops.inspectTenant = async () => {
        throw new Error(reason);
      };
      await expect(
        setupHost(parseHostSetup(["--tenant", "client-acme", "--create-user", "client-bravo"]), f.ops),
      ).rejects.toThrow(reason);
      expect(f.ops.createUsers).not.toHaveBeenCalled();
      expect(f.ops.register).not.toHaveBeenCalled();
    },
  );

  it("refuses an unsafe shared app before creating users", async () => {
    const f = fixture();
    f.ops.prepareApplication = async () => {
      throw new Error("unsafe app");
    };
    await expect(setupHost(parseHostSetup(["--create-user", "client-acme"]), f.ops)).rejects.toThrow("unsafe app");
    expect(f.ops.createUsers).not.toHaveBeenCalled();
  });

  it("does not claim completion or print passwords after failed registration", async () => {
    const f = fixture();
    f.ops.register = async () => {
      throw new Error("write failure");
    };
    await expect(setupHost(parseHostSetup(["--create-user", "client-acme"]), f.ops)).rejects.toThrow("write failure");
    expect(f.ops.startJobs).not.toHaveBeenCalled();
    expect(f.ops.presentCredentials).not.toHaveBeenCalled();
  });
});

describe("installed host verification", () => {
  it("reports a healthy configuration and checks both registered tenants", async () => {
    const f = fixture();
    f.ops.readConfig = async () => ({ managed: true, tenants: [501, 502] });
    const results = await verifyHost(f.ops);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(f.ops.verifyIsolation).toHaveBeenCalledWith([
      { name: "client-acme", uid: 501 },
      { name: "client-bravo", uid: 502 },
    ]);
  });

  it.each([
    "verifyApplication",
    "verifyInstallation",
    "inspectTenant",
    "verifyState",
    "verifyDaemon",
    "verifyIsolation",
  ] as const)("reports %s failure without exposing error details", async (operation) => {
    const f = fixture();
    f.ops.readConfig = async () => ({ managed: true, tenants: [501, 502] });
    f.ops[operation] = async () => {
      throw new Error("password=secret provider data");
    };
    const results = await verifyHost(f.ops);
    expect(results.some((result) => !result.ok)).toBe(true);
    expect(JSON.stringify(results)).not.toContain("secret");
  });
});
