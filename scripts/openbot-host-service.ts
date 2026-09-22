import type { HostManagerConfig } from "../packages/contracts/src/host-manager";

export interface HostTenant {
  name: string;
  uid: number;
}
export interface HostCredential extends HostTenant {
  password: string;
}
export interface HostSetupRequest {
  createUsers: string[];
  tenants: string[];
  dryRun: boolean;
}
export interface HostAdminOperations {
  verifyInstallation: () => Promise<void>;
  verifyApplication: () => Promise<void>;
  prepareApplication: () => Promise<void>;
  readConfig: () => Promise<HostManagerConfig | null>;
  checkNewUsers: (names: string[]) => Promise<void>;
  inspectTenant: (name: string) => Promise<HostTenant>;
  createUsers: (names: string[]) => Promise<HostCredential[]>;
  register: (uids: number[]) => Promise<void>;
  startJobs: (tenants: HostTenant[]) => Promise<void>;
  presentCredentials: (credentials: HostCredential[]) => Promise<void>;
  tenantForUid: (uid: number) => Promise<HostTenant>;
  verifyState: () => Promise<void>;
  verifyDaemon: () => Promise<void>;
  verifyIsolation: (tenants: HostTenant[]) => Promise<void>;
}

export function validateHostNames(names: string[]): void {
  if (
    !names.length ||
    names.length > 100 ||
    new Set(names).size !== names.length ||
    names.some((name) => !/^[a-z][a-z0-9_-]{0,30}$/.test(name) || name.includes("\n"))
  ) {
    throw new Error(
      "Use distinct lowercase tenant names of 1–31 letters, digits, hyphens or underscores, starting with a letter.",
    );
  }
}

export function parseHostSetup(args: string[]): HostSetupRequest {
  const result: HostSetupRequest = { createUsers: [], tenants: [], dryRun: false };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--dry-run" && !result.dryRun) {
      result.dryRun = true;
      continue;
    }
    const name = args[++index];
    if (!name || (flag !== "--create-user" && flag !== "--tenant")) throw new Error("Invalid setup arguments.");
    (flag === "--create-user" ? result.createUsers : result.tenants).push(name);
  }
  validateHostNames([...result.createUsers, ...result.tenants]);
  return result;
}

export async function setupHost(request: HostSetupRequest, ops: HostAdminOperations): Promise<void> {
  validateHostNames([...request.createUsers, ...request.tenants]);
  await ops.verifyInstallation();
  if (await ops.readConfig())
    throw new Error("Host is already registered. Setup never overwrites existing registration.");
  await ops.checkNewUsers(request.createUsers);
  const existing = await Promise.all(request.tenants.map((name) => ops.inspectTenant(name)));
  if (new Set(existing.map((tenant) => tenant.uid)).size !== existing.length) throw new Error("Duplicate tenant UID.");
  if (request.dryRun) {
    await ops.verifyApplication();
    return;
  }
  await ops.prepareApplication();
  const credentials = request.createUsers.length ? await ops.createUsers(request.createUsers) : [];
  const tenants = [...existing, ...(await Promise.all(credentials.map((item) => ops.inspectTenant(item.name))))];
  if (new Set(tenants.map((tenant) => tenant.uid)).size !== tenants.length) throw new Error("Duplicate tenant UID.");
  await ops.register(tenants.map((tenant) => tenant.uid));
  await ops.startJobs(tenants);
  // The only password presentation occurs after registration and launchd setup succeed.
  await ops.presentCredentials(credentials);
}

export interface HostVerification {
  label: string;
  ok: boolean;
}
export async function verifyHost(ops: HostAdminOperations): Promise<HostVerification[]> {
  const results: HostVerification[] = [];
  const check = async (label: string, run: () => Promise<void>): Promise<boolean> => {
    try {
      await run();
      results.push({ label, ok: true });
      return true;
    } catch {
      results.push({ label, ok: false });
      return false;
    }
  };
  await check("OpenBot.app signature, ownership and permissions", ops.verifyApplication);
  await check("Host executables, signatures and launchd definitions", ops.verifyInstallation);
  await check("LaunchDaemon loaded and running", ops.verifyDaemon);
  const registered: number[] = [];
  const configOk = await check("Host config secure and enabled", async () => {
    const config = await ops.readConfig();
    if (!config?.managed) throw new Error("Host not enabled.");
    registered.push(...config.tenants);
  });
  await check("Host state secure", ops.verifyState);
  const tenants: HostTenant[] = [];
  if (configOk) {
    for (const uid of registered) {
      await check(`Tenant UID ${uid}: Standard account and private home`, async () => {
        const tenant = await ops.tenantForUid(uid);
        tenants.push(await ops.inspectTenant(tenant.name));
      });
    }
    if (tenants.length === registered.length) {
      await check("Cross-tenant read/write isolation in both directions", () => ops.verifyIsolation(tenants));
    }
  }
  return results;
}
