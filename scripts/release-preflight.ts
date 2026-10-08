import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { releaseNotesProblems } from "./release-notes";

const logger = createOpenBotLogger("release-preflight");

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
if (!isDynamicRecord(packageJson) || !isString(packageJson.version)) {
  throw new Error("package.json has no valid version.");
}
const changelog = await readFile("CHANGELOG.md", "utf8");
const failures: string[] = [];

if (!/^\d+\.\d+\.\d+$/.test(packageJson.version)) failures.push("package version is not semver");
failures.push(...releaseNotesProblems(changelog, packageJson.version));
if (run("git", ["status", "--porcelain"])) failures.push("working tree is not clean");
if (run("git", ["rev-list", "--left-right", "--count", "origin/main...HEAD"]) !== "0\t0") {
  failures.push("main is not synchronized with origin/main");
}
if (run("git", ["tag", "--list", `v${packageJson.version}`])) {
  failures.push(`tag v${packageJson.version} already exists`);
}

let releaseSecrets = "";
try {
  releaseSecrets = run("gh", ["secret", "list", "--env", "release"]);
} catch {
  failures.push("GitHub release secrets could not be inspected");
}
for (const name of [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "CSC_INSTALLER_LINK",
  "CSC_INSTALLER_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
  "MAC_PROVISIONING_PROFILE",
]) {
  if (!releaseSecrets.split("\n").some((line) => line.startsWith(`${name}\t`))) {
    failures.push(`GitHub release secret ${name} is missing`);
  }
}

try {
  const productionSecrets = run("gh", ["secret", "list", "--env", "cloudflare-production"]);
  for (const name of ["BOAT_TEMPLATE_API_KEY", "CLOUDFLARE_PRODUCTION_DEPLOY_TOKEN"]) {
    if (!productionSecrets.split("\n").some((line) => line.startsWith(`${name}\t`))) {
      failures.push(`GitHub cloudflare-production secret ${name} is missing`);
    }
  }
  if (!run("gh", ["variable", "get", "CLOUDFLARE_ACCOUNT_ID", "--env", "cloudflare-production"])) {
    failures.push("GitHub cloudflare-production variable CLOUDFLARE_ACCOUNT_ID is missing");
  }
  // Production previously admitted only main. The hosted release also needs stable tags.
  const environment = JSON.parse(run("gh", ["api", "repos/{owner}/{repo}/environments/cloudflare-production"]));
  if (!isDynamicRecord(environment)) throw new Error("Invalid production environment response.");
  const policy = environment.deployment_branch_policy;
  if (isDynamicRecord(policy) && policy.custom_branch_policies === true) {
    const tags = run("gh", [
      "api",
      "repos/{owner}/{repo}/environments/cloudflare-production/deployment-branch-policies",
      "--paginate",
      "--jq",
      '.branch_policies[] | select(.type == "tag") | .name',
    ]).split("\n");
    if (!tags.includes("v*.*.*")) failures.push("Allow tag pattern v*.*.* in cloudflare-production.");
  } else if (isDynamicRecord(policy) && policy.protected_branches === true) {
    failures.push("Use main and tag pattern v*.*.* deployment rules in cloudflare-production.");
  }
} catch {
  failures.push("The hosted release environment settings could not be verified.");
}

if (failures.length > 0) {
  logger.error("OpenBot release preflight failed:\n");
  for (const failure of failures) logger.error(`- ${failure}`);
  logger.error("\nNo release tag was created.");
  process.exitCode = 1;
} else {
  logger.info(`OpenBot v${packageJson.version} release preflight passed.`);
}

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}
