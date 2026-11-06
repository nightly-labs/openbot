// Drives `discord-mobile-release-announcement.ts` and `publish-mobile-release.ts` as processes, in
// a temporary copy of the files they read, against one local server that stands in for the account
// Worker, the GitHub API and the Discord webhook. Writes .openbot-build/mobile-release-announcement-e2e.json.
//
//   bun scripts/mobile-release-announcement-e2e.ts

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MOBILE_FEATURE_CONFIG } from "../apps/auth-api/src/server/mobile-features-config";
import { resolveMobileFeatures } from "../packages/contracts/src/mobile-features";
import { isDynamicRecord, isString } from "../packages/contracts/src/runtime-values";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = join(root, ".openbot-build", "mobile-release-announcement-e2e.json");
const ROLE_ID = "123456789012345678";
const REPOSITORY = "example/openbot";

type Store = "ios" | "android";

interface FakeState {
  /** The versions that the live /v1/mobile/changelog lists for each store. */
  live: Record<Store, string[]>;
  latest: Record<Store, string>;
  /** Live flags that differ from main. */
  wrongFlags: boolean;
  tags: Set<string>;
  posts: string[];
  discordStatus: number;
  /** The status of a tag delete. A ruleset can refuse it. */
  deleteStatus: number;
}

const state: FakeState = {
  live: { ios: [], android: [] },
  latest: { ios: "1.4.6", android: "1.4.6" },
  wrongFlags: false,
  tags: new Set(),
  posts: [],
  discordStatus: 200,
  deleteStatus: 204,
};

/** The text of `name` in a request body, or "". */
function textField(body: unknown, name: string): string {
  const value = isDynamicRecord(body) ? body[name] : undefined;
  return isString(value) ? value : "";
}

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const platform = url.searchParams.get("platform");
    const store: Store | undefined = platform === "ios" || platform === "android" ? platform : undefined;
    if (url.pathname === "/v1/mobile/changelog" && store) {
      return Response.json({
        releases: state.live[store].map((version) => ({ version, date: "2026-11-06", groups: [] })),
      });
    }
    if (url.pathname === "/v1/mobile/features" && store) {
      const features = resolveMobileFeatures(MOBILE_FEATURE_CONFIG, store, url.searchParams.get("version"));
      if (state.wrongFlags) features.browser = !features.browser;
      return Response.json({ features, latestVersion: state.latest[store] });
    }
    const prefix = `/repos/${REPOSITORY}/git/`;
    if (url.pathname === `${prefix}matching-refs/tags/mobile-announced/`) {
      return Response.json([...state.tags].map((tag) => ({ ref: `refs/tags/${tag}` })));
    }
    if (url.pathname === `${prefix}refs` && request.method === "POST") {
      const ref = textField(await request.json(), "ref");
      const tag = ref.replace("refs/tags/", "");
      if (state.tags.has(tag)) return Response.json({ message: "Reference already exists" }, { status: 422 });
      state.tags.add(tag);
      return Response.json({ ref }, { status: 201 });
    }
    if (url.pathname.startsWith(`${prefix}refs/tags/`) && request.method === "DELETE") {
      if (state.deleteStatus !== 204) return new Response("refused", { status: state.deleteStatus });
      state.tags.delete(url.pathname.slice(`${prefix}refs/tags/`.length));
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/discord" && request.method === "POST") {
      if (state.discordStatus !== 200) return new Response("unavailable", { status: state.discordStatus });
      state.posts.push(textField(await request.json(), "content"));
      return Response.json({ id: "1" });
    }
    return new Response("not found", { status: 404 });
  },
});
const site = `http://127.0.0.1:${server.port}`;

const work = mkdtempSync(join(tmpdir(), "openbot-mobile-release-e2e-"));
mkdirSync(join(work, "apps/mobile"), { recursive: true });
mkdirSync(join(work, "apps/auth-api/src/server"), { recursive: true });
cpSync(
  join(root, "apps/auth-api/src/server/mobile-features-config.ts"),
  join(work, "apps/auth-api/src/server/mobile-features-config.ts"),
);

const SECTION = "\n\n### Added\n\n- A change.\n";
function writeChangelog(headings: Record<string, string>): void {
  const sections = Object.entries(headings).map(([version, text]) => `## [${version}] - ${text}${SECTION}`);
  writeFileSync(join(work, "apps/mobile/CHANGELOG.md"), `# Changelog\n\n## [Unreleased]\n\n${sections.join("\n")}`);
}
writeFileSync(
  join(work, "apps/mobile/release-announcement.json"),
  JSON.stringify({ version: "1.4.7", highlights: ["One.", "Two.", "Three."] }),
);
writeFileSync(join(work, "apps/mobile/app.json"), JSON.stringify({ expo: { version: "1.4.7" } }));

// Async, so that the server in this process can answer the child.
async function cli(script: string, args: readonly string[]): Promise<{ status: number; output: string }> {
  const child = Bun.spawn(["bun", join(root, "scripts", script), ...args], {
    cwd: work,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GH_TOKEN: "test-token",
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
      GITHUB_OUTPUT: "",
      DISCORD_MOBILE_RELEASE_WEBHOOK_URL: `${site}/discord`,
      DISCORD_MOBILE_RELEASE_ROLE_ID: ROLE_ID,
    },
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { status, output: `${stdout}${stderr}` };
}
const announce = () =>
  cli("discord-mobile-release-announcement.ts", ["announce", "--site", site, "--github-api", site]);

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}
const checks: Check[] = [];
function check(name: string, passed: boolean, detail: unknown): void {
  checks.push({ name, passed, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
}
const lastPost = () => state.posts.at(-1) ?? "";

try {
  // A store date that the Worker does not show yet waits.
  writeChangelog({ "1.4.7": "2026-11-06 (iOS)", "1.4.6": "2026-11-04 (iOS), 2026-11-05 (Android)" });
  let result = await announce();
  check(
    "waits for the deploy",
    result.status === 0 && state.posts.length === 0 && /waits: the live/.test(result.output),
    result.output,
  );

  // The changelog is live, but the flags are not the ones in main.
  state.live.ios = ["1.4.7", "1.4.6"];
  state.latest.ios = "1.4.7";
  state.wrongFlags = true;
  result = await announce();
  check(
    "waits for the flags",
    result.status === 0 && state.posts.length === 0 && /flags/.test(result.output),
    result.output,
  );

  // Live: the first store gets its post, and a tag.
  state.wrongFlags = false;
  result = await announce();
  check(
    "posts the first store",
    result.status === 0 &&
      state.posts.length === 1 &&
      lastPost().includes(`<@&${ROLE_ID}>`) &&
      lastPost().includes("**OpenBot v1.4.7 is out on iOS**\nThe Android version comes out later.") &&
      !lastPost().includes("[Android]") &&
      state.tags.has("mobile-announced/v1.4.7/ios"),
    { output: result.output, post: lastPost(), tags: [...state.tags] },
  );
  // 1.4.6 is older than the first tagged version, so it never posts without --version.
  check("leaves versions before the tags", !state.tags.has("mobile-announced/v1.4.6/android"), [...state.tags]);

  result = await announce();
  check("does not post twice", result.status === 0 && state.posts.length === 1, result.output);

  // A failed Discord post removes the tag, so the next run tries again.
  writeChangelog({ "1.4.7": "2026-11-06", "1.4.6": "2026-11-04 (iOS), 2026-11-05 (Android)" });
  state.live.android = ["1.4.7"];
  state.latest.android = "1.4.7";
  state.discordStatus = 500;
  result = await announce();
  check("a failed post keeps no tag", result.status !== 0 && !state.tags.has("mobile-announced/v1.4.7/android"), {
    output: result.output,
    tags: [...state.tags],
  });

  // GitHub does not remove the tag: the run says which tag to delete by hand.
  state.deleteStatus = 403;
  result = await announce();
  check(
    "names a tag that GitHub did not remove",
    result.status !== 0 && result.output.includes("Could not remove the tag mobile-announced/v1.4.7/android"),
    result.output,
  );
  state.deleteStatus = 204;
  state.tags.delete("mobile-announced/v1.4.7/android");

  state.discordStatus = 200;
  result = await announce();
  check(
    "posts the second store",
    result.status === 0 &&
      state.posts.length === 2 &&
      lastPost().includes("**OpenBot v1.4.7 is out on Android**\nIt is already out on iOS.") &&
      lastPost().includes("[iOS]") &&
      state.tags.has("mobile-announced/v1.4.7/android"),
    { output: result.output, post: lastPost() },
  );

  // Both stores at once: one post that names both.
  state.tags.clear();
  result = await announce();
  check(
    "posts both stores in one post",
    result.status === 0 &&
      state.posts.length === 3 &&
      lastPost().includes("**OpenBot v1.4.7 is out on iOS and Android**\n\n"),
    { output: result.output, post: lastPost() },
  );

  // A skipped store gets no line under the title.
  state.tags.clear();
  state.live.android = [];
  writeChangelog({ "1.4.7": "2026-11-06 (iOS), Skipped (Android)" });
  result = await announce();
  check(
    "a skipped store gets no line",
    result.status === 0 && lastPost().includes("**OpenBot v1.4.7 is out on iOS**\n\n- One."),
    { output: result.output, post: lastPost() },
  );

  // The highlights are for the next version: the post waits, and the run does not fail.
  state.tags.clear();
  writeFileSync(
    join(work, "apps/mobile/release-announcement.json"),
    JSON.stringify({ version: "1.4.8", highlights: ["One.", "Two.", "Three."] }),
  );
  const postsBefore = state.posts.length;
  result = await announce();
  check(
    "waits for the highlights",
    result.status === 0 && state.posts.length === postsBefore && /waits: .*1\.4\.8/.test(result.output),
    result.output,
  );
  writeFileSync(
    join(work, "apps/mobile/release-announcement.json"),
    JSON.stringify({ version: "1.4.7", highlights: ["One.", "Two.", "Three."] }),
  );
  state.tags.add("mobile-announced/v1.4.7/ios");

  // `--version --again` posts again, with a tag already there.
  result = await cli("discord-mobile-release-announcement.ts", [
    "announce",
    "--version",
    "1.4.7",
    "--stores",
    "ios",
    "--again",
    "--site",
    site,
    "--github-api",
    site,
  ]);
  check("--again posts again", result.status === 0 && state.posts.length === 5, result.output);

  // A feature at "0" is off for every version, so the publish step keeps it off.
  const configPath = join(work, "apps/auth-api/src/server/mobile-features-config.ts");
  const originalConfig = readFileSync(configPath, "utf8");
  writeFileSync(configPath, originalConfig.replace(/(browser: \{\s+ios: \{ upTo: ")[^"]+(")/, "$10$2"));
  writeChangelog({ "1.4.7": "In review" });
  result = await cli("publish-mobile-release.ts", ["ios"]);
  const offConfig = readFileSync(configPath, "utf8");
  check(
    'publish keeps upTo "0"',
    result.status === 0 && /browser: \{\s+ios: \{ upTo: "0" \}/.test(offConfig) && /ios: "1\.4\.7"/.test(offConfig),
    { output: result.output, config: offConfig },
  );
  writeFileSync(configPath, originalConfig);

  // `--version` posts an older version, which is not the newest one in the store.
  writeChangelog({ "1.4.7": "2026-11-06", "1.4.6": "2026-11-04" });
  state.live.ios = ["1.4.7", "1.4.6"];
  writeFileSync(
    join(work, "apps/mobile/release-announcement.json"),
    JSON.stringify({ version: "1.4.6", highlights: ["One.", "Two.", "Three."] }),
  );
  const beforeOlder = state.posts.length;
  result = await cli("discord-mobile-release-announcement.ts", [
    "announce",
    "--version",
    "1.4.6",
    "--stores",
    "ios",
    "--site",
    site,
    "--github-api",
    site,
  ]);
  check(
    "--version posts an older version",
    result.status === 0 &&
      state.posts.length === beforeOlder + 1 &&
      lastPost().includes("OpenBot v1.4.6 is out on iOS"),
    result.output,
  );
  writeFileSync(
    join(work, "apps/mobile/release-announcement.json"),
    JSON.stringify({ version: "1.4.7", highlights: ["One.", "Two.", "Three."] }),
  );

  // The publish step: Android 1.4.7 available, with the older 1.4.5 marked as skipped.
  writeChangelog({ "1.4.7": "2026-11-06 (iOS)", "1.4.6": "2026-11-04", "1.4.5": "2026-11-01 (iOS)" });
  result = await cli("publish-mobile-release.ts", ["android", "--skip-older"]);
  const changelog = readFileSync(join(work, "apps/mobile/CHANGELOG.md"), "utf8");
  const config = readFileSync(join(work, "apps/auth-api/src/server/mobile-features-config.ts"), "utf8");
  check(
    "publish dates the store and skips the older version",
    result.status === 0 &&
      /## \[1\.4\.7\] - 2026-11-06 \(iOS\), \d{4}-\d{2}-\d{2} \(Android\)|## \[1\.4\.7\] - 2026-11-06\n/.test(
        changelog,
      ) &&
      changelog.includes("## [1.4.5] - 2026-11-01 (iOS), Skipped (Android)"),
    { output: result.output, headings: changelog.split("\n").filter((line) => line.startsWith("## [")) },
  );
  check(
    "publish raises only that store's flags",
    /android: \{ upTo: "1\.4\.7" \}/.test(config) &&
      /android: "1\.4\.7"/.test(config) &&
      !/ios: \{ upTo: "1\.4\.7" \}/.test(config),
    config,
  );

  // `check` shows the post of each store.
  result = await cli("discord-mobile-release-announcement.ts", ["check", "1.4.7"]);
  check(
    "check prints both posts",
    result.status === 0 && (result.output.match(/is out on/g) ?? []).length === 2,
    result.output,
  );
} finally {
  server.stop(true);
  rmSync(work, { recursive: true, force: true });
}

mkdirSync(dirname(REPORT), { recursive: true });
const passed = checks.every((entry) => entry.passed);
writeFileSync(REPORT, `${JSON.stringify({ passed, checks }, null, 2)}\n`);
for (const entry of checks) process.stdout.write(`${entry.passed ? "pass" : "FAIL"}  ${entry.name}\n`);
for (const entry of checks.filter((candidate) => !candidate.passed))
  process.stdout.write(`\n${entry.name}:\n${entry.detail}\n`);
process.stdout.write(`\nReport: ${REPORT}\n`);
process.exit(passed ? 0 : 1);
