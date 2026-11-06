// `bun run mobile:release`: one menu for each step of a mobile release. Press a digit to select.
// Each step that changes files makes a branch from the main of GitHub, commits, pushes and opens
// the pull request, then goes back to the branch you were on. The menu never merges, except with
// the auto-merge choice, which waits for review and CI as a manual merge does.
//
// Without a terminal, use the commands under it: `bun scripts/prepare-release.ts <patch|minor|major> --mobile`,
// `bun run mobile:release:published <ios|android|both>`, `gh workflow run release-ios.yml --ref main`,
// and `bun scripts/discord-mobile-release-announcement.ts <plan|check|mark-posted>`.
// See apps/mobile/README.md#release-menu.

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { emitKeypressEvents } from "node:readline";
import {
  announcedTag,
  announcedTags,
  defaultEndpoints,
  liveProblem,
  MOBILE_ANNOUNCEMENT_FILE,
  mobileVersions,
  planPosts,
} from "./discord-mobile-release-announcement";
import {
  appVersion,
  assertCleanTree,
  type FileChange,
  MOBILE_FEATURES_CONFIG_FILE,
  olderInReview,
  openPullRequest,
  pendingFragments,
  publishPlan,
  pullRequestBody,
  readText,
  run,
  skipPlan,
  startBranch,
} from "./mobile-release-steps";
import {
  formatStoreDates,
  MOBILE_CHANGELOG,
  MOBILE_STORE_NAMES,
  MOBILE_STORES,
  MOBILE_VERSION_FILES,
  type MobileStore,
  SKIPPED,
} from "./release-notes";

const BOLD = (text: string) => `\u001b[1m${text}\u001b[22m`;
const DIM = (text: string) => `\u001b[2m${text}\u001b[22m`;

interface Choice<T> {
  key: string;
  label: string;
  value: T;
}

/** Reads one key in raw mode. Ctrl+C exits. */
function readKey(): Promise<string> {
  return new Promise((resolve) => {
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("keypress", (text: string | undefined, key: { name?: string; ctrl?: boolean }) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      if (key.ctrl && key.name === "c") process.exit(130);
      resolve(key.name === "return" ? "\r" : (text ?? ""));
    });
  });
}

/** Shows `choices` and waits for one of their keys. `Enter` selects the first one. */
async function choose<T>(title: string, choices: readonly Choice<T>[]): Promise<T> {
  process.stdout.write(`\n${BOLD(title)}\n`);
  for (const choice of choices) process.stdout.write(`  ${BOLD(choice.key)}  ${choice.label}\n`);
  for (;;) {
    const pressed = await readKey();
    const choice = pressed === "\r" ? choices[0] : choices.find((candidate) => candidate.key === pressed.toLowerCase());
    if (choice !== undefined) {
      process.stdout.write(DIM(`  > ${choice.label}\n`));
      return choice.value;
    }
  }
}

const numbered = <T>(items: readonly { label: string; value: T }[], back = "Back"): Choice<T | undefined>[] => [
  ...items.slice(0, 9).map((item, index) => ({ key: String(index + 1), ...item })),
  { key: "0", label: back, value: undefined },
];

async function confirm(question: string): Promise<boolean> {
  return (await choose(question, numbered([{ label: "Yes", value: true }], "No"))) === true;
}

function storeChoices(stores: readonly MobileStore[] = MOBILE_STORES): { label: string; value: MobileStore[] }[] {
  return [
    ...stores.map((store) => ({ label: MOBILE_STORE_NAMES[store], value: [store] })),
    ...(stores.length > 1 ? [{ label: "iOS and Android", value: [...stores] }] : []),
  ];
}

// ---------------------------------------------------------------------------------------------
// The overview.

async function overview(): Promise<void> {
  const versions = mobileVersions(readText(MOBILE_CHANGELOG)).slice(0, 4);
  let tags: Set<string> | undefined;
  try {
    tags = await announcedTags(defaultEndpoints());
  } catch {
    tags = undefined;
  }
  const cell = (version: string, store: MobileStore, state: string | undefined) => {
    const posted = tags?.has(announcedTag(version, store)) ? " ✓ post" : "";
    return `${state ?? "In review"}${posted}`.padEnd(22);
  };
  process.stdout.write(`\n${BOLD("OpenBot mobile release")}   ${DIM(`version in app.json: ${appVersion()}`)}\n\n`);
  process.stdout.write(`  ${"Version".padEnd(10)}${"iOS".padEnd(22)}Android\n`);
  for (const { version, dates } of versions) {
    process.stdout.write(
      `  ${version.padEnd(10)}${cell(version, "ios", dates.ios)}${cell(version, "android", dates.android)}\n`,
    );
  }
  if (tags === undefined) process.stdout.write(DIM("  Could not read the post tags: run gh auth login.\n"));
}

// ---------------------------------------------------------------------------------------------
// The steps.

/** Runs `step` on a new branch, then goes back. A step that commits nothing deletes the branch. */
async function onBranch(name: string, step: (branch: string) => Promise<string | undefined>): Promise<void> {
  assertCleanTree();
  const original = run("git", ["branch", "--show-current"]);
  const branch = startBranch(name);
  let url: string | undefined;
  try {
    url = await step(branch);
  } finally {
    // A commit that did not reach a pull request, after a failed push, stays on its branch.
    const committed = run("git", ["rev-parse", "HEAD"]) !== run("git", ["rev-parse", "origin/main"]);
    if (run("git", ["status", "--porcelain"]) === "") {
      run("git", ["switch", "--quiet", original]);
      if (url === undefined && !committed) run("git", ["branch", "--quiet", "-D", branch]);
      if (url === undefined && committed) {
        process.stdout.write(`\nThe branch ${branch} keeps the commit. Push it and open the PR by hand.\n`);
      }
    } else {
      process.stdout.write(`\nThe branch ${branch} has changes that are not committed. It stays checked out.\n`);
    }
  }
  if (url !== undefined) process.stdout.write(`\n${BOLD("Pull request:")} ${url}\n`);
}

async function chooseMerge(): Promise<boolean | undefined> {
  return choose(
    "Open the pull request?",
    numbered(
      [
        { label: "Make the branch, commit, push and open the PR", value: false },
        { label: "The same, and turn on auto-merge (squash)", value: true },
      ],
      "Cancel",
    ),
  );
}

function showChanges(changes: readonly FileChange[], extra: readonly string[] = []): void {
  process.stdout.write("\n");
  for (const change of changes) process.stdout.write(`  ${change.path.padEnd(52)}${change.summary}\n`);
  for (const line of extra) process.stdout.write(`  ${line}\n`);
}

async function prepare(): Promise<void> {
  const increment = await choose(
    "Prepare a new version",
    numbered([
      { label: "Patch", value: "patch" },
      { label: "Minor", value: "minor" },
      { label: "Major", value: "major" },
    ]),
  );
  if (increment === undefined) return;
  process.stdout.write(`\n${pendingFragments()} notes wait in apps/mobile/changelog.d on this checkout.\n`);
  const autoMerge = await chooseMerge();
  if (autoMerge === undefined) return;
  await onBranch(`mobile-release/prepare-${increment}`, async () => {
    const fragments = pendingFragments();
    const result = spawnSync("bun", ["scripts/prepare-release.ts", increment, "--mobile"], { stdio: "inherit" });
    if (result.status !== 0) throw new Error("prepare-release.ts stopped. Nothing was committed.");
    const version = appVersion();
    return openPullRequest({
      title: `release: prepare the mobile app v${version}`,
      autoMerge,
      paths: [MOBILE_CHANGELOG, ...MOBILE_VERSION_FILES, "bun.lock", "apps/mobile/changelog.d"],
      body: pullRequestBody({
        linked: "None. Release preparation.",
        changed: [
          `Ran \`bun scripts/prepare-release.ts ${increment} --mobile\`. It moved ${fragments} \`apps/mobile/changelog.d/\` fragments into \`## [${version}] - In review\` in \`${MOBILE_CHANGELOG}\`.`,
          `Set the version to ${version} in \`apps/mobile/app.json\`, \`apps/mobile/package.json\` and \`bun.lock\`.`,
        ],
        surfaces: `mobile changelog and version only. \`/changelog\` does not show ${version} until a store makes it available.`,
        verification:
          "The pre-commit hook passed (Biome, release notes check, UI check, and the typecheck projects that `bun.lock` selects)",
        next: "Upgrade safety: not audited by the menu. Run the `release-upgrade-safety` audit before the build.\n\nAfter merge: build with `bun run mobile:release` (2).",
      }),
    });
  });
}

async function build(): Promise<void> {
  run("git", ["fetch", "origin", "main"]);
  const remote = JSON.parse(run("git", ["show", `origin/main:${MOBILE_VERSION_FILES[0]}`]));
  process.stdout.write(`\nmain on GitHub has version ${BOLD(String(remote?.expo?.version))}.\n`);
  const stores = await choose("Build and send to the stores", numbered(storeChoices()));
  if (stores === undefined) return;
  for (const store of stores) {
    const workflow = store === "ios" ? "release-ios.yml" : "release-android.yml";
    run("gh", ["workflow", "run", workflow, "--ref", "main"]);
    process.stdout.write(`Started ${workflow}. Follow it with: gh run list --workflow ${workflow}\n`);
  }
}

/** Opens the highlights file in the editor, with the version set. */
function editHighlights(version: string): void {
  const current = JSON.parse(readText(MOBILE_ANNOUNCEMENT_FILE));
  if (current?.version !== version) {
    writeFileSync(MOBILE_ANNOUNCEMENT_FILE, `${JSON.stringify({ version, highlights: ["", "", ""] }, null, 2)}\n`);
  }
  process.stdout.write(
    `\nWrite 3 to 5 highlights from the ${version} section of ${MOBILE_CHANGELOG}. Save and close the editor.\n`,
  );
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  spawnSync(editor, [MOBILE_ANNOUNCEMENT_FILE], { stdio: "inherit", shell: true });
}

function showMessages(version: string): void {
  spawnSync("bun", ["scripts/discord-mobile-release-announcement.ts", "check", version], { stdio: "inherit" });
}

async function published(): Promise<void> {
  const stores = await choose("Which store made the build available?", numbered(storeChoices()));
  if (stores === undefined) return;
  const changelog = readText(MOBILE_CHANGELOG);
  const candidates = mobileVersions(changelog)
    .filter(({ dates }) => stores.every((store) => dates[store] === undefined || dates[store] === SKIPPED))
    .slice(0, 9);
  const version = await choose(
    "Which version?",
    numbered(
      candidates.map(({ version, dates }) => ({ label: `${version}  (${formatStoreDates(dates)})`, value: version })),
    ),
  );
  if (version === undefined) return;
  const older = stores.flatMap((store) =>
    olderInReview(changelog, version, store).map((older) => `${older} on ${MOBILE_STORE_NAMES[store]}`),
  );
  const skipOlder =
    older.length > 0 &&
    (await confirm(`${older.join(", ")} still in review. ${version} replaces it. Mark it as skipped?`));

  const names = stores.map((store) => MOBILE_STORE_NAMES[store]).join(" and ");
  await onBranch(`mobile-release/v${version}-${stores.join("-")}`, async () => {
    let plan = publishPlan(version, stores, skipOlder);
    let editedHighlights = false;
    while (plan.announcementProblems.length > 0) {
      process.stdout.write(`\n${MOBILE_ANNOUNCEMENT_FILE} is not ready for the Discord post:\n`);
      for (const problem of plan.announcementProblems) process.stdout.write(`  - ${problem}\n`);
      const edit = await confirm("Write the highlights now?");
      if (!edit) {
        spawnSync("git", ["checkout", "--", MOBILE_ANNOUNCEMENT_FILE]);
        return undefined;
      }
      editHighlights(version);
      editedHighlights = true;
      plan = publishPlan(version, stores, skipOlder);
    }
    showChanges(plan.changes, [`${"Discord after the deploy".padEnd(52)}the posts below`]);
    showMessages(version);
    const autoMerge = await chooseMerge();
    if (autoMerge === undefined) {
      spawnSync("git", ["checkout", "--", MOBILE_ANNOUNCEMENT_FILE]);
      return undefined;
    }
    for (const change of plan.changes) writeFileSync(change.path, change.text);
    const changed = [
      `\`${MOBILE_CHANGELOG}\`: ${plan.changes[0]?.summary ?? ""}.`,
      ...(plan.changes.some((change) => change.path === MOBILE_FEATURES_CONFIG_FILE)
        ? [
            `\`${MOBILE_FEATURES_CONFIG_FILE}\`: ${plan.changes.find((change) => change.path === MOBILE_FEATURES_CONFIG_FILE)?.summary}. This takes effect with the Worker deploy after the merge.`,
          ]
        : []),
      editedHighlights
        ? `\`${MOBILE_ANNOUNCEMENT_FILE}\`: the highlights for ${version}.`
        : `\`${MOBILE_ANNOUNCEMENT_FILE}\` already has the highlights for ${version}.`,
      `After the Worker deploy, \`mobile-release-announcement.yml\` posts on Discord that ${version} is out on ${names}.`,
    ];
    return openPullRequest({
      title: `Mark the mobile app ${version} available on ${names}, and turn on its cloud servers and browser flags`,
      autoMerge,
      paths: [...plan.changes.map((change) => change.path), MOBILE_ANNOUNCEMENT_FILE],
      body: pullRequestBody({
        linked: "None. Release step.",
        changed,
        surfaces:
          "`apps/auth-api` (mobile feature flags and newest versions), mobile changelog, Discord announcement. No release notes: this PR records a release.",
        verification: `\`bun scripts/discord-mobile-release-announcement.ts check ${version}\` passes; the pre-commit hook passed`,
      }),
    });
  });
}

async function skip(): Promise<void> {
  const changelog = readText(MOBILE_CHANGELOG);
  const entries = mobileVersions(changelog).flatMap(({ version, dates }) =>
    MOBILE_STORES.flatMap((store) =>
      dates[store] === undefined
        ? [
            {
              label: `Mark ${version} as skipped on ${MOBILE_STORE_NAMES[store]}`,
              value: { version, store, undo: false },
            },
          ]
        : dates[store] === SKIPPED
          ? [
              {
                label: `Mark ${version} as in review again on ${MOBILE_STORE_NAMES[store]}`,
                value: { version, store, undo: true },
              },
            ]
          : [],
    ),
  );
  if (entries.length === 0) {
    process.stdout.write("\nNo version is in review or skipped.\n");
    return;
  }
  const entry = await choose("Which version?", numbered(entries));
  if (entry === undefined) return;
  const changes = skipPlan(entry.version, entry.store, entry.undo);
  showChanges(changes);
  const autoMerge = await chooseMerge();
  if (autoMerge === undefined) return;
  const name = MOBILE_STORE_NAMES[entry.store];
  await onBranch(`mobile-release/v${entry.version}-${entry.undo ? "unskip" : "skip"}-${entry.store}`, async () => {
    const next = skipPlan(entry.version, entry.store, entry.undo);
    for (const change of next) writeFileSync(change.path, change.text);
    return openPullRequest({
      title: entry.undo
        ? `Show the mobile app ${entry.version} as in review on ${name} again`
        : `Mark the mobile app ${entry.version} as skipped on ${name}`,
      autoMerge,
      paths: next.map((change) => change.path),
      body: pullRequestBody({
        linked: "None. Release step.",
        changed: [
          `\`${MOBILE_CHANGELOG}\`: ${next[0]?.summary ?? ""}.`,
          entry.undo
            ? `\`/changelog\` shows ${name} as in review for ${entry.version} again.`
            : `${name} will not ship ${entry.version}, because a newer version replaced it. \`/changelog\` shows it as skipped, and Discord gets no post.`,
        ],
        surfaces: "mobile changelog and `/changelog`. No release notes: this PR records a release.",
        verification: "The pre-commit hook passed",
      }),
    });
  });
}

async function highlights(): Promise<void> {
  const version = appVersion();
  await onBranch(`mobile-release/v${version}-highlights`, async () => {
    editHighlights(version);
    showMessages(version);
    if (run("git", ["status", "--porcelain"]) === "") return undefined;
    const autoMerge = await chooseMerge();
    if (autoMerge === undefined) {
      spawnSync("git", ["checkout", "--", MOBILE_ANNOUNCEMENT_FILE]);
      return undefined;
    }
    return openPullRequest({
      title: `Write the Discord highlights of the mobile app v${version}`,
      autoMerge,
      paths: [MOBILE_ANNOUNCEMENT_FILE],
      body: pullRequestBody({
        linked: "None. Release step.",
        changed: [`\`${MOBILE_ANNOUNCEMENT_FILE}\`: the highlights for ${version}.`],
        surfaces: "Discord announcement only. No release notes: this PR records a release.",
        verification: `\`bun scripts/discord-mobile-release-announcement.ts check ${version}\` shows the posts`,
      }),
    });
  });
}

async function live(): Promise<void> {
  const endpoints = defaultEndpoints();
  const changelog = readText(MOBILE_CHANGELOG);
  process.stdout.write("\n");
  for (const store of MOBILE_STORES) {
    const newest = mobileVersions(changelog).find(
      ({ dates }) => dates[store] !== undefined && dates[store] !== SKIPPED,
    );
    if (newest === undefined) continue;
    const problem = await liveProblem(endpoints.site, newest.version, store);
    process.stdout.write(
      `  ${MOBILE_STORE_NAMES[store].padEnd(9)}${newest.version.padEnd(8)}${problem === undefined ? "live, flags as in main" : `not live: ${problem}`}\n`,
    );
  }
  const plan = await planPosts(changelog, endpoints);
  for (const post of plan.due) {
    process.stdout.write(
      `  Post due: ${post.version} on ${post.stores.map((store) => MOBILE_STORE_NAMES[store]).join(" and ")}. The next run sends it.\n`,
    );
  }
  for (const entry of plan.waiting) {
    process.stdout.write(`  Post waits: ${entry.version} on ${MOBILE_STORE_NAMES[entry.store]}: ${entry.reason}.\n`);
  }
  if (plan.due.length === 0 && plan.waiting.length === 0) process.stdout.write("  No post is due or waiting.\n");

  const action = await choose(
    "Posts",
    numbered([
      { label: "Run the announcement workflow now", value: "run" as const },
      { label: "Record a post that I sent by hand", value: "mark" as const },
    ]),
  );
  if (action === "run") {
    run("gh", ["workflow", "run", "mobile-release-announcement.yml", "--ref", "main"]);
    process.stdout.write("Started mobile-release-announcement.yml.\n");
  }
  if (action === "mark") {
    // Only a post that the workflow would send: the version and store that it is due or waits for.
    const posts = [
      ...plan.due.flatMap((post) => post.stores.map((store) => ({ version: post.version, store }))),
      ...plan.waiting.map(({ version, store }) => ({ version, store })),
    ];
    if (posts.length === 0) {
      process.stdout.write("\nNo post is due or waiting, so there is nothing to record.\n");
      return;
    }
    const post = await choose(
      "Which post did you send by hand?",
      numbered(
        posts.map((entry) => ({ label: `${entry.version} on ${MOBILE_STORE_NAMES[entry.store]}`, value: entry })),
      ),
    );
    if (post === undefined) return;
    spawnSync("bun", ["scripts/discord-mobile-release-announcement.ts", "mark-posted", post.version, post.store], {
      stdio: "inherit",
    });
  }
}

// ---------------------------------------------------------------------------------------------

if (!process.stdin.isTTY) {
  process.stderr.write(
    "bun run mobile:release needs a terminal. See the commands at the top of scripts/mobile-release.ts.\n",
  );
  process.exit(1);
}

const STEPS = {
  prepare,
  build,
  published,
  skip,
  highlights,
  live,
} as const;

for (;;) {
  await overview();
  const step = await choose(
    "Select a step",
    numbered(
      [
        { label: "Prepare a new version (patch, minor, major)", value: "prepare" as const },
        { label: "Build and send to TestFlight or Google Play", value: "build" as const },
        { label: "Mark a version as available in a store", value: "published" as const },
        { label: "Mark a version as skipped, or in review again", value: "skip" as const },
        { label: "Write the Discord highlights", value: "highlights" as const },
        { label: "Show the live state and the posts", value: "live" as const },
      ],
      "Exit",
    ),
  );
  if (step === undefined) break;
  try {
    await STEPS[step]();
  } catch (error) {
    process.stdout.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  }
}
