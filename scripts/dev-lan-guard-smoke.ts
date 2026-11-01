// Checks dev-service bind selection and the LAN login-code guard without starting services.
// Run: bun scripts/dev-lan-guard-smoke.ts
// It writes .openbot-build/dev-lan-guard.json and exits non-zero on a failure.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  applyLanSignInPolicy,
  assertSafeDevelopmentNetwork,
  configureMobileConnectDevelopmentNetwork,
  developmentBindHost,
  parseDevelopmentTarget,
  servicesForTarget,
} from "./dev-services";

const outputPath = join(import.meta.dirname, "..", ".openbot-build", "dev-lan-guard.json");
const projectRoot = join(import.meta.dirname, "..");
const devServicesPath = join(import.meta.dirname, "dev-services.ts");
await mkdir(dirname(outputPath), { recursive: true });
const registryPath = await mkdtemp(join(dirname(outputPath), "dev-lan-guard-registry-"));
const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
const interfaces = {
  en0: [{ address: "192.168.1.24", family: "IPv4" as const, internal: false }],
};

function check(name: string, run: () => unknown): void {
  try {
    checks.push({ name, passed: true, detail: run() });
  } catch (error) {
    checks.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

check("default binds the API and Signal to loopback", () => {
  const invocation = parseDevelopmentTarget(["app"]);
  const environment: NodeJS.ProcessEnv = {
    OPENBOT_API_PORT: "3100",
    REMOTE_SIGNAL_PORT: "3101",
  };
  configureMobileConnectDevelopmentNetwork(
    servicesForTarget(invocation.target),
    environment,
    interfaces,
    invocation.lan,
  );
  assert.equal(environment.OPENBOT_API_HOST, "127.0.0.1");
  assert.equal(environment.REMOTE_SIGNAL_HOST, "127.0.0.1");
  assert.equal(environment.REMOTE_SIGNAL_URL, "ws://127.0.0.1:3101/v1/signal");
  return { apiHost: environment.OPENBOT_API_HOST, signalHost: environment.REMOTE_SIGNAL_HOST };
});

check("--lan skips the development account role that needs an exposed sign-in code", () => {
  const lan: NodeJS.ProcessEnv = {};
  applyLanSignInPolicy(true, lan);
  assert.equal(lan.OPENBOT_DEV_REMOTE_ROLE, "none");
  const chosen: NodeJS.ProcessEnv = { OPENBOT_DEV_REMOTE_ROLE: "host" };
  applyLanSignInPolicy(true, chosen);
  assert.equal(chosen.OPENBOT_DEV_REMOTE_ROLE, "host");
  const loopback: NodeJS.ProcessEnv = {};
  applyLanSignInPolicy(false, loopback);
  assert.equal(loopback.OPENBOT_DEV_REMOTE_ROLE, undefined);
  return { lan: "none", chosen: "host", loopback: null };
});

check("--lan refuses normalized development sign-in-code flags", () => {
  const invocation = parseDevelopmentTarget(["app", "--lan"]);
  const values = ["true", "1", "TRUE", "yes", "on"];
  for (const value of values) {
    assert.throws(
      () => assertSafeDevelopmentNetwork(invocation.lan, { AUTH_EXPOSE_DEVELOPMENT_CODE: value }),
      /Cannot use --lan while AUTH_EXPOSE_DEVELOPMENT_CODE=true/u,
    );
  }
  return { lan: invocation.lan, values, developmentCode: "refused" };
});

check("--lan is the only way to open the LAN", () => {
  assert.equal(developmentBindHost(false), "127.0.0.1");
  assert.equal(developmentBindHost(true), "0.0.0.0");
  const environment: NodeJS.ProcessEnv = {
    OPENBOT_API_PORT: "3100",
    REMOTE_SIGNAL_PORT: "3101",
  };
  configureMobileConnectDevelopmentNetwork(servicesForTarget("app"), environment, interfaces, false);
  assert.equal(environment.OPENBOT_API_HOST, "127.0.0.1");
  assert.equal(environment.REMOTE_SIGNAL_HOST, "127.0.0.1");
  return { loopback: developmentBindHost(false), lan: developmentBindHost(true) };
});

check("the LAN bind refuses an exposed sign-in code", () => {
  assert.throws(
    () =>
      configureMobileConnectDevelopmentNetwork(
        servicesForTarget("app"),
        { OPENBOT_API_PORT: "3100", REMOTE_SIGNAL_PORT: "3101" },
        interfaces,
        true,
        { AUTH_EXPOSE_DEVELOPMENT_CODE: "true" },
      ),
    /Cannot use --lan while AUTH_EXPOSE_DEVELOPMENT_CODE=true/u,
  );
  // The loopback start keeps the code: nobody on the network can reach it.
  assert.doesNotThrow(() => assertSafeDevelopmentNetwork(false, { AUTH_EXPOSE_DEVELOPMENT_CODE: "true" }));
  return { lan: true, developmentCode: "refused" };
});

check("--lan keeps the phone flow with normal code delivery", () => {
  const invocation = parseDevelopmentTarget(["app", "--lan"]);
  const environment: NodeJS.ProcessEnv = {
    AUTH_EXPOSE_DEVELOPMENT_CODE: "false",
    OPENBOT_API_PORT: "3100",
    REMOTE_SIGNAL_PORT: "3101",
  };
  assert.doesNotThrow(() => assertSafeDevelopmentNetwork(invocation.lan, environment));
  configureMobileConnectDevelopmentNetwork(
    servicesForTarget(invocation.target),
    environment,
    interfaces,
    invocation.lan,
  );
  assert.equal(environment.OPENBOT_API_HOST, "0.0.0.0");
  assert.equal(environment.REMOTE_SIGNAL_HOST, "0.0.0.0");
  assert.equal(environment.OPENBOT_MOBILE_AUTH_API_URL, "http://192.168.1.24:3100");
  assert.equal(environment.REMOTE_SIGNAL_URL, "ws://192.168.1.24:3101/v1/signal");
  return {
    apiHost: environment.OPENBOT_API_HOST,
    signalHost: environment.REMOTE_SIGNAL_HOST,
    mobileApiUrl: environment.OPENBOT_MOBILE_AUTH_API_URL,
    signalUrl: environment.REMOTE_SIGNAL_URL,
    developmentCode: environment.AUTH_EXPOSE_DEVELOPMENT_CODE,
  };
});

check("--lan requires a private IPv4 address for Mobile Connect", () => {
  const invocation = parseDevelopmentTarget(["app", "--lan"]);
  const environment: NodeJS.ProcessEnv = { OPENBOT_API_PORT: "3100" };
  assert.throws(
    () =>
      configureMobileConnectDevelopmentNetwork(servicesForTarget(invocation.target), environment, {}, invocation.lan),
    /Cannot use --lan: no private IPv4 address was found for Mobile Connect/u,
  );
  return { lan: invocation.lan, address: "missing", refused: true };
});

check("CLI dry run refuses LAN when development sign-in codes are enabled", () => {
  const result = runDevServicesDryRun(["--lan"], "true");
  assert.ok(result.status !== null);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Cannot use --lan while AUTH_EXPOSE_DEVELOPMENT_CODE=true/u);
  return { status: result.status, refusal: true };
});

check("CLI loopback dry run passes the LAN guard", () => {
  const result = runDevServicesDryRun([], "true");
  assert.ok(result.status !== null);
  assert.doesNotMatch(result.output, /Cannot use --lan while AUTH_EXPOSE_DEVELOPMENT_CODE=true/u);
  if (result.status !== 0) assert.match(result.output, /Failed to listen at 127\.0\.0\.1/u);
  return { status: result.status, lan: false, guardRefusal: false };
});

function runDevServicesDryRun(args: string[], exposeCode: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [devServicesPath, "app", ...args, "--dry-run"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      AUTH_EXPOSE_DEVELOPMENT_CODE: exposeCode,
      OPENBOT_DEV_REGISTRY_DIR: registryPath,
    },
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const report = {
  generatedAt: new Date().toISOString(),
  checks,
  passed: checks.every((item) => item.passed),
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
await rm(registryPath, { recursive: true, force: true });
process.stdout.write(`Dev LAN guard report: ${outputPath}\n`);
if (!report.passed) process.exitCode = 1;
