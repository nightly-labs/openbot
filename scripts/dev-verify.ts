import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";
import { isOrphanedDevStack, isSameWorktree, readDevStackRecords } from "./dev-automation/stack-registry";
import { supportedBunVersion } from "./prepare-dev-environment";

export type VerificationSurface = "desktop" | "renderer" | "mobile" | "api" | "remote" | "contracts" | "docs";

export interface DevVerificationReport {
  ready: boolean;
  reasons: string[];
  setup: {
    bun: { ready: boolean; current: string; expected: string };
    dependencies: boolean;
    developmentEnv: boolean;
  };
  changes: { files: string[]; surfaces: VerificationSurface[]; suggestedTests: string[] };
  runtime: {
    stackRunning: boolean;
    appRunning: boolean;
    isolatedApp: boolean;
    orphanedStack: boolean;
    ambiguousApp: boolean;
  };
  qa: {
    required: boolean;
    ready: boolean;
    reasons: string[];
    loop: string[];
  };
  commands: string[];
  runnableCommands: string[];
  qaCommands: string[];
}

const rendererQaLoop = [
  "bun run dev:automation snapshot",
  "bun run dev:automation <click|type> --role=<role> --name=<name> --allow-mutations --wait-for=<role>,<name>",
  "bun run dev:automation snapshot --wait-for=<role>,<name>",
  "bun run dev:automation screenshot --wait-for=<role>,<name>",
];

export function surfacesForFiles(files: string[]): VerificationSurface[] {
  const surfaces = new Set<VerificationSurface>();
  for (const file of files) {
    if (file.startsWith("src/renderer/")) surfaces.add("renderer");
    if (file.startsWith("src/main/") || file.startsWith("src/backend/") || file.startsWith("scripts/")) {
      surfaces.add("desktop");
    }
    if (file.startsWith("apps/mobile/")) surfaces.add("mobile");
    if (file.startsWith("apps/auth-api/") || file.startsWith("apps/site-router/")) surfaces.add("api");
    if (file.startsWith("remote/")) surfaces.add("remote");
    if (file.startsWith("packages/contracts/")) surfaces.add("contracts");
    if (file.startsWith("docs/") || file === "README.md") surfaces.add("docs");
  }
  return [...surfaces].sort();
}

const authApiClientTests = new Set([
  "apps/auth-api/test/analytics.test.ts",
  "apps/auth-api/test/content.test.tsx",
  "apps/auth-api/test/hero-download-selector.test.tsx",
  "apps/auth-api/test/join-page.test.tsx",
  "apps/auth-api/test/landing-app-preview.test.tsx",
  "apps/auth-api/test/landing-glow.test.tsx",
  "apps/auth-api/test/landing-reveal.test.tsx",
  "apps/auth-api/test/page-error.test.tsx",
]);

function isTestFile(file: string): boolean {
  return /\.(test|dom\.test)\.tsx?$/u.test(file);
}

function isDesktopTest(file: string): boolean {
  if (!isTestFile(file)) return false;
  return [
    "src/backend/",
    "src/main/",
    "src/preload/",
    "src/renderer/",
    "scripts/",
    "packages/contracts/",
    "packages/i18n/",
    "packages/logging/",
    "packages/user-errors/",
    "packages/team-client/",
    "apps/mobile/src/",
  ].some((prefix) => file.startsWith(prefix));
}

function isDelegatedTest(file: string): boolean {
  return (
    (file.startsWith("apps/auth-api/test/") ||
      file.startsWith("apps/site-router/test/") ||
      file.startsWith("remote/api/test/")) &&
    isTestFile(file)
  );
}

function isSupportedTest(file: string): boolean {
  return isDesktopTest(file) || isDelegatedTest(file);
}

export function suggestedTestsForFiles(files: string[], projectRoot = process.cwd()): string[] {
  const tests = new Set(files.filter((file) => isSupportedTest(file) && existsSync(resolve(projectRoot, file))));
  for (const file of files) {
    if (isTestFile(file)) continue;
    const extension = extname(file);
    if (extension !== ".ts" && extension !== ".tsx") continue;
    const stem = file.slice(0, -extension.length);
    for (const suffix of [`.test${extension}`, `.dom.test${extension}`]) {
      const candidate = `${stem}${suffix}`;
      if (isSupportedTest(candidate) && existsSync(resolve(projectRoot, candidate))) tests.add(candidate);
    }
  }
  return [...tests].sort();
}

function testCommands(tests: string[]): string[] {
  const desktop = tests.filter(isDesktopTest);
  const authServer = tests.filter((file) => file.startsWith("apps/auth-api/test/") && !authApiClientTests.has(file));
  const authClient = tests.filter((file) => authApiClientTests.has(file));
  const sites = tests.filter((file) => file.startsWith("apps/site-router/test/"));
  const remote = tests.filter((file) => file.startsWith("remote/api/test/"));
  const commands: string[] = [];
  if (desktop.length > 0) commands.push(`bun run test:desktop -- ${desktop.join(" ")}`);
  if (authServer.length > 0) {
    commands.push(
      `bun run --cwd apps/auth-api test:server -- ${authServer.map((file) => file.slice("apps/auth-api/".length)).join(" ")}`,
    );
  }
  if (authClient.length > 0) {
    commands.push(
      `bun run --cwd apps/auth-api test:client -- ${authClient.map((file) => file.slice("apps/auth-api/".length)).join(" ")}`,
    );
  }
  if (sites.length > 0) {
    commands.push(
      `bun run --cwd apps/site-router test -- ${sites.map((file) => file.slice("apps/site-router/".length)).join(" ")}`,
    );
  }
  if (remote.length > 0) {
    commands.push(
      `bun run --cwd remote/api test -- ${remote.map((file) => file.slice("remote/api/".length)).join(" ")}`,
    );
  }
  return commands;
}

function workspaceTestCommands(files: string[], suggestedTests: string[]): string[] {
  const commands: string[] = [];
  if (
    files.some((file) => file.startsWith("apps/auth-api/")) &&
    !suggestedTests.some((file) => file.startsWith("apps/auth-api/"))
  ) {
    commands.push("bun run test:api");
  }
  if (
    files.some((file) => file.startsWith("apps/site-router/")) &&
    !suggestedTests.some((file) => file.startsWith("apps/site-router/"))
  ) {
    commands.push("bun run test:sites");
  }
  if (
    files.some((file) => file.startsWith("remote/api/")) &&
    !suggestedTests.some((file) => file.startsWith("remote/api/"))
  ) {
    commands.push("bun run test:remote");
  }
  return commands;
}

export function verificationCommands(
  files: string[],
  surfaces: VerificationSurface[],
  setupReady: boolean,
  isolatedApp: boolean,
  projectRoot = process.cwd(),
): { commands: string[]; runnableCommands: string[]; qaCommands: string[]; suggestedTests: string[] } {
  const commands: string[] = [];
  const runnableCommands: string[] = [];
  const qaCommands: string[] = [];
  if (!setupReady) commands.push("bun run dev:prepare");

  const suggestedTests = suggestedTestsForFiles(files, projectRoot);
  for (const testCommand of testCommands(suggestedTests)) {
    commands.push(testCommand);
    runnableCommands.push(testCommand);
  }

  for (const command of ["bun run lint", "bun run typecheck", ...workspaceTestCommands(files, suggestedTests)]) {
    if (!commands.includes(command)) commands.push(command);
    if (!runnableCommands.includes(command)) runnableCommands.push(command);
  }
  if (surfaces.includes("api")) commands.push("bun run check:api");
  if (surfaces.includes("renderer")) {
    commands.push("bun run check:ui");
    runnableCommands.push("bun run check:ui");
  }
  if (surfaces.includes("renderer") && !isolatedApp) commands.push("bun run dev --isolated");
  if (surfaces.includes("renderer")) {
    qaCommands.push("bun run dev:automation snapshot", "bun run dev:automation screenshot");
    commands.push(...qaCommands);
  }
  return { commands, runnableCommands, qaCommands, suggestedTests };
}

function changedFiles(projectRoot: string): string[] {
  const tracked = execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd: projectRoot, encoding: "utf8" });
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return [
    ...new Set(
      `${tracked}\n${untracked}`
        .split("\n")
        .map((file) => file.trim())
        .filter(Boolean),
    ),
  ].sort();
}

function readinessReasons(setup: DevVerificationReport["setup"], runtime: DevVerificationReport["runtime"]): string[] {
  const reasons: string[] = [];
  if (!setup.bun.ready) reasons.push(`Bun ${setup.bun.expected} is required; current version is ${setup.bun.current}.`);
  if (!setup.dependencies) reasons.push("node_modules is missing. Run bun run dev:prepare.");
  if (!setup.developmentEnv) reasons.push("apps/auth-api/.env.dev is missing. Run bun run dev:prepare.");
  if (runtime.orphanedStack) reasons.push("This worktree has an orphaned dev stack. Inspect bun run dev:status.");
  if (runtime.ambiguousApp) reasons.push("More than one app instance matches this worktree.");
  return reasons;
}

export function qaReadinessReasons(
  surfaces: VerificationSurface[],
  setupReady: boolean,
  runtime: DevVerificationReport["runtime"],
): string[] {
  if (!surfaces.includes("renderer")) return [];

  const reasons: string[] = [];
  if (!setupReady) reasons.push("Development setup is incomplete. Run bun run dev:prepare before renderer QA.");
  if (runtime.orphanedStack) reasons.push("This worktree has an orphaned dev stack. Inspect bun run dev:status.");
  if (runtime.ambiguousApp) reasons.push("More than one app instance matches this worktree.");
  if (!runtime.appRunning && !runtime.ambiguousApp) reasons.push("No running app matches this worktree.");
  if (runtime.appRunning && !runtime.isolatedApp) {
    reasons.push("The running app uses the default profile. Start bun run dev --isolated for isolated renderer QA.");
  }
  return reasons;
}

export function createDevVerificationReport(projectRoot = process.cwd()): DevVerificationReport {
  const files = changedFiles(projectRoot);
  const surfaces = surfacesForFiles(files);
  const bunCurrent = process.versions.bun ?? "unknown";
  const setup = {
    bun: { ready: bunCurrent === supportedBunVersion, current: bunCurrent, expected: supportedBunVersion },
    dependencies: existsSync(resolve(projectRoot, "node_modules")),
    developmentEnv: existsSync(resolve(projectRoot, "apps/auth-api/.env.dev")),
  };
  const setupReady = setup.bun.ready && setup.dependencies && setup.developmentEnv;

  const localStacks = readDevStackRecords().filter((stack) => isSameWorktree(stack, projectRoot));
  const appInstances = readDevInstanceRecords().filter(
    (instance) => resolve(instance.projectRoot) === resolve(projectRoot) && instance.service === "app",
  );
  const isolatedApp = appInstances.length === 1 && appInstances[0]?.instanceId !== "default";
  const runtime = {
    stackRunning: localStacks.length > 0,
    appRunning: appInstances.length === 1,
    isolatedApp,
    orphanedStack: localStacks.some((stack) => isOrphanedDevStack(stack)),
    ambiguousApp: appInstances.length > 1,
  };
  const reasons = readinessReasons(setup, runtime);
  const plan = verificationCommands(files, surfaces, setupReady, isolatedApp, projectRoot);
  const qaReasons = qaReadinessReasons(surfaces, setupReady, runtime);
  const qaRequired = surfaces.includes("renderer");

  return {
    ready: reasons.length === 0,
    reasons,
    setup,
    changes: { files, surfaces, suggestedTests: plan.suggestedTests },
    runtime,
    qa: {
      required: qaRequired,
      ready: !qaRequired || qaReasons.length === 0,
      reasons: qaReasons,
      loop: qaRequired ? rendererQaLoop : [],
    },
    commands: plan.commands,
    runnableCommands: plan.runnableCommands,
    qaCommands: plan.qaCommands,
  };
}

function runBun(projectRoot: string, args: string[]): void {
  process.stderr.write(`dev:verify running: bun ${args.join(" ")}\n`);
  const result = spawnSync(process.execPath, args, { cwd: projectRoot, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runRecommendedChecks(report: DevVerificationReport, projectRoot: string): void {
  const suggestedTests = report.changes.suggestedTests;
  const desktop = suggestedTests.filter(isDesktopTest);
  if (desktop.length > 0) runBun(projectRoot, ["run", "test:desktop", "--", ...desktop]);
  const authServer = suggestedTests.filter(
    (file) => file.startsWith("apps/auth-api/test/") && !authApiClientTests.has(file),
  );
  if (authServer.length > 0) {
    runBun(projectRoot, [
      "run",
      "--cwd",
      "apps/auth-api",
      "test:server",
      "--",
      ...authServer.map((file) => file.slice("apps/auth-api/".length)),
    ]);
  }
  const authClient = suggestedTests.filter((file) => authApiClientTests.has(file));
  if (authClient.length > 0) {
    runBun(projectRoot, [
      "run",
      "--cwd",
      "apps/auth-api",
      "test:client",
      "--",
      ...authClient.map((file) => file.slice("apps/auth-api/".length)),
    ]);
  }
  const sites = suggestedTests.filter((file) => file.startsWith("apps/site-router/test/"));
  if (sites.length > 0) {
    runBun(projectRoot, [
      "run",
      "--cwd",
      "apps/site-router",
      "test",
      "--",
      ...sites.map((file) => file.slice("apps/site-router/".length)),
    ]);
  }
  const remote = suggestedTests.filter((file) => file.startsWith("remote/api/test/"));
  if (remote.length > 0) {
    runBun(projectRoot, [
      "run",
      "--cwd",
      "remote/api",
      "test",
      "--",
      ...remote.map((file) => file.slice("remote/api/".length)),
    ]);
  }
  runBun(projectRoot, ["run", "lint"]);
  runBun(projectRoot, ["run", "typecheck"]);
  for (const command of workspaceTestCommands(report.changes.files, suggestedTests)) {
    const [, , script] = command.split(" ");
    if (script) runBun(projectRoot, ["run", script]);
  }
  if (report.changes.surfaces.includes("renderer")) runBun(projectRoot, ["run", "check:ui"]);
}

if (import.meta.main) {
  const projectRoot = process.cwd();
  const report = createDevVerificationReport(projectRoot);
  if (process.argv.includes("--run")) runRecommendedChecks(report, projectRoot);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
