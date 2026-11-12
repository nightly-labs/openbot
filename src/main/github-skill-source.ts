// Skills from a public GitHub repository. The host reads them with no GitHub account: two REST calls
// (the commit and its file tree) for each read, one (the tree) for each skill download, and the
// files from raw.githubusercontent.com. The read pins the commit, and an install downloads the files
// of that commit only, so the agent gets what the user read.

import { createHash } from "node:crypto";
import {
  GITHUB_SKILL_ID_MAX_LENGTH,
  GITHUB_SKILL_INSTRUCTIONS_MAX_LENGTH,
  GITHUB_SKILLS_PER_LINK,
  type GithubSkill,
  type GithubSkillAddress,
  type GithubSkillSource,
  githubSkillDetail,
  githubSkillId,
  isGithubCommit,
  isGithubOwner,
  isGithubRepo,
  isGithubSkillPath,
  type MarketplaceSkillDetail,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema } from "effect";
import { zipSync } from "fflate";
import { causeHelpers } from "../backend/effect-boundary";
import { GITHUB_REQUEST_TIMEOUT_MS, type GitHubFetch } from "./github-device-flow";
import { inspectSkillMarkdown, isUnsafeArchivePath, MAX_BYTES, SKILL_FRONTMATTER } from "./skill-package";

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
/** The same limit as a skill package. */
const MAX_FILES = 200;
const CONCURRENCY = 8;
/** A branch or tag can have slashes, so a link can split at several places. Each try is one REST call. */
const REF_TRIES = 4;
/** The `github-skills-v1` answer takes a folder path of this length at most. */
const MAX_PATH_LENGTH = 1024;
/** The commit of an id never changes, so a download serves each agent of one add. */
const DOWNLOADS_KEPT = 8;

export class GithubSkillFailure extends Schema.TaggedError<GithubSkillFailure>()("GithubSkillFailure", {
  cause: Schema.Defect(),
}) {}

const { io, sync } = causeHelpers(GithubSkillFailure);

function failure(message: string): GithubSkillFailure {
  return new GithubSkillFailure({ cause: new Error(message) });
}

/** A link that the user pasted: the repository, and the place in it, still with the ref. */
interface GithubLink {
  owner: string;
  repo: string;
  /** `tree` and `blob` links name a ref, then a path. */
  kind: "repository" | "tree" | "blob";
  rest: string[];
}

/** Reads `https://github.com/<owner>/<repo>[/tree|blob/<ref>/<path>]`, with or without the scheme. */
function parseGithubLink(text: string): GithubLink | null {
  const trimmed = text.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;
  let parts: string[];
  try {
    parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
  const [owner = "", rawRepo = "", kind, ...rest] = parts;
  const repo = rawRepo.replace(/\.git$/u, "");
  if (!isGithubOwner(owner) || !isGithubRepo(repo)) return null;
  if (kind === undefined) return { owner, repo, kind: "repository", rest: [] };
  if ((kind === "tree" || kind === "blob") && rest.length > 0) return { owner, repo, kind, rest };
  return null;
}

interface TreeEntry {
  path: string;
  size: number;
  /** A symbolic link. raw.githubusercontent.com gives its target as the file text. */
  link: boolean;
}

/** The files of a commit. `truncated` when GitHub did not list all of them. */
interface Tree {
  files: TreeEntry[];
  truncated: boolean;
}

export function githubSkillSource(fetchImpl: GitHubFetch) {
  const downloads = new Map<string, { detail: MarketplaceSkillDetail; bundle: Uint8Array }>();
  const request = (url: string) =>
    io((signal) =>
      fetchImpl(url, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "OpenBot" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS)]),
      }),
    ).pipe(Effect.mapError(() => failure(sourceText("error.skill.githubUnavailable"))));

  /** A REST call. Null on 404 and 422, which GitHub sends for a missing repository or ref. */
  const api = Effect.fn("GithubSkillSource.api")(function* (path: string) {
    const response = yield* request(`${API}${path}`);
    if (response.status === 404 || response.status === 422) return null;
    if ((response.status === 403 || response.status === 429) && response.headers.get("x-ratelimit-remaining") === "0")
      return yield* failure(sourceText("error.skill.githubRateLimited"));
    if (!response.ok) return yield* failure(sourceText("error.skill.githubUnavailable"));
    return yield* io(() => response.json()).pipe(
      Effect.mapError(() => failure(sourceText("error.skill.githubUnavailable"))),
    );
  });

  const raw = Effect.fn("GithubSkillSource.raw")(function* (address: GithubSkillAddress, file: string) {
    const path = [address.owner, address.repo, address.commit, ...file.split("/")].map(encodeURIComponent).join("/");
    const response = yield* request(`${RAW}/${path}`);
    if (!response.ok) return yield* failure(sourceText("error.skill.githubUnavailable"));
    return new Uint8Array(
      yield* io(() => response.arrayBuffer()).pipe(
        Effect.mapError(() => failure(sourceText("error.skill.githubUnavailable"))),
      ),
    );
  });

  const commit = Effect.fn("GithubSkillSource.commit")(function* (owner: string, repo: string, ref: string) {
    const ref_ = ref.split("/").map(encodeURIComponent).join("/");
    const body = yield* api(`/repos/${owner}/${repo}/commits/${ref_}`);
    if (body === null) return null;
    const date =
      isDynamicRecord(body) && isDynamicRecord(body.commit) && isDynamicRecord(body.commit.committer)
        ? body.commit.committer.date
        : undefined;
    if (!isDynamicRecord(body) || !isString(body.sha) || !isGithubCommit(body.sha))
      return yield* failure(sourceText("error.skill.githubUnavailable"));
    return { sha: body.sha, committedAt: isString(date) ? date : new Date(0).toISOString() };
  });

  /** The files of the commit. A read shows the skills of a tree that GitHub cuts off; a download refuses it. */
  const tree = Effect.fn("GithubSkillSource.tree")(function* (address: Omit<GithubSkillAddress, "path">) {
    const body = yield* api(`/repos/${address.owner}/${address.repo}/git/trees/${address.commit}?recursive=1`);
    if (!isDynamicRecord(body) || !Array.isArray(body.tree))
      return yield* failure(sourceText("error.skill.githubUnavailable"));
    const files: TreeEntry[] = [];
    for (const entry of body.tree)
      if (isDynamicRecord(entry) && entry.type === "blob" && isString(entry.path) && isNumber(entry.size))
        files.push({ path: entry.path, size: entry.size, link: entry.mode === "120000" });
    const result: Tree = { files, truncated: body.truncated === true };
    return result;
  });

  /** The files under `folder`, with names relative to it. */
  function filesIn(files: TreeEntry[], folder: string): TreeEntry[] {
    if (!folder) return files;
    const prefix = `${folder}/`;
    return files
      .filter((file) => file.path.startsWith(prefix))
      .map((file) => ({ ...file, path: file.path.slice(prefix.length) }));
  }

  const resolve = Effect.fn("GithubSkillSource.resolve")(function* (link: GithubLink) {
    const repository = `${link.owner}/${link.repo}`;
    const notFound = () => failure(sourceText("error.skill.githubNotFound", { repository }));
    if (link.kind === "repository") {
      const found = yield* commit(link.owner, link.repo, "HEAD");
      if (!found) return yield* notFound();
      return { ...found, path: "" };
    }
    for (let split = 1; split <= Math.min(link.rest.length, REF_TRIES); split += 1) {
      const found = yield* commit(link.owner, link.repo, link.rest.slice(0, split).join("/"));
      if (!found) continue;
      const after = link.rest.slice(split);
      // A blob link names a file: the skill is its folder.
      const path = (link.kind === "blob" ? after.slice(0, -1) : after).join("/");
      if (!isGithubSkillPath(path) || path.length > MAX_PATH_LENGTH)
        return yield* failure(sourceText("error.skill.githubLinkInvalid"));
      return { ...found, path };
    }
    return yield* notFound();
  });

  const readSkill = Effect.fn("GithubSkillSource.readSkill")(function* (
    address: GithubSkillAddress,
    files: TreeEntry[],
  ) {
    const own = filesIn(files, address.path);
    const markdownFile = own.find((file) => file.path === "SKILL.md");
    if (!markdownFile || markdownFile.size > GITHUB_SKILL_INSTRUCTIONS_MAX_LENGTH) return null;
    const id = githubSkillId(address);
    if (id.length > GITHUB_SKILL_ID_MAX_LENGTH) return null;
    const bytes = yield* raw(address, address.path ? `${address.path}/SKILL.md` : "SKILL.md");
    const text = new TextDecoder("utf-8").decode(bytes);
    const metadata = yield* Effect.result(sync(() => inspectSkillMarkdown(text)));
    if (Result.isFailure(metadata)) return null;
    const skill: GithubSkill = {
      id,
      path: address.path,
      slug: metadata.success.slug,
      name: metadata.success.name,
      description: metadata.success.description,
      instructions: text.slice(text.match(SKILL_FRONTMATTER)?.[0].length ?? 0).trim(),
      // The answer lists as many files as a skill package can hold; a download refuses a longer list.
      files: own
        .map((file) => file.path)
        .sort()
        .slice(0, MAX_FILES),
    };
    return skill;
  });

  return {
    /** The skill folders under a link: the folders with a `SKILL.md` that no other skill folder holds. */
    read: Effect.fn("GithubSkillSource.read")(function* (text: string) {
      const link = parseGithubLink(text);
      if (!link) return yield* failure(sourceText("error.skill.githubLinkInvalid"));
      const resolved = yield* resolve(link);
      const base = { owner: link.owner, repo: link.repo, commit: resolved.sha };
      const { files } = yield* tree(base);
      const inside = filesIn(files, resolved.path);
      const folders = inside
        .filter((file) => file.path === "SKILL.md" || file.path.endsWith("/SKILL.md"))
        .map((file) => file.path.slice(0, -"SKILL.md".length).replace(/\/$/u, ""))
        .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
      const tops: string[] = [];
      for (const folder of folders)
        if (!tops.some((top) => top === "" || folder.startsWith(`${top}/`))) tops.push(folder);
      const skills = yield* Effect.forEach(
        tops
          .map((folder) => [resolved.path, folder].filter(Boolean).join("/"))
          .filter(isGithubSkillPath)
          .slice(0, GITHUB_SKILLS_PER_LINK),
        (path) => readSkill({ ...base, path }, files),
        { concurrency: CONCURRENCY },
      );
      const found = skills.filter((skill): skill is GithubSkill => skill !== null);
      if (!found.length)
        return yield* failure(
          sourceText("error.skill.githubNoSkills", {
            folder: [`${link.owner}/${link.repo}`, resolved.path].filter(Boolean).join("/"),
          }),
        );
      const source: GithubSkillSource = {
        owner: link.owner,
        repo: link.repo,
        commit: resolved.sha,
        committedAt: resolved.committedAt,
        path: resolved.path,
        skills: found.sort((a, b) => a.name.localeCompare(b.name)),
      };
      return source;
    }),

    /** The files of one skill folder at the pinned commit, as a skill package, and its detail. */
    download: Effect.fn("GithubSkillSource.download")(function* (address: GithubSkillAddress) {
      const id = githubSkillId(address);
      const kept = downloads.get(id);
      if (kept) return kept;
      const { files, truncated } = yield* tree(address);
      if (truncated)
        return yield* failure(
          sourceText("error.skill.githubTooLarge", { repository: `${address.owner}/${address.repo}` }),
        );
      const skill = yield* readSkill(address, files);
      if (!skill)
        return yield* failure(
          sourceText("error.skill.githubNoSkills", {
            folder: [`${address.owner}/${address.repo}`, address.path].filter(Boolean).join("/"),
          }),
        );
      // A file that a skill package must not carry stays on GitHub.
      const own = filesIn(files, address.path).filter((file) => !isUnsafeArchivePath(file.path));
      if (own.some((file) => file.link)) return yield* failure(sourceText("error.skill.symlinks"));
      if (own.length > MAX_FILES) return yield* failure(sourceText("error.skill.tooManyFiles", { limit: MAX_FILES }));
      if (own.reduce((total, file) => total + file.size, 0) > MAX_BYTES)
        return yield* failure(sourceText("error.skill.expandedTooLarge"));
      const contents = yield* Effect.forEach(
        own,
        (file) =>
          raw(address, address.path ? `${address.path}/${file.path}` : file.path).pipe(
            Effect.map((bytes) => [file.path, bytes] as const),
          ),
        { concurrency: CONCURRENCY },
      );
      const bundle = yield* sync(() => zipSync(Object.fromEntries(contents), { level: 6 }));
      const detail: MarketplaceSkillDetail = {
        ...githubSkillDetail(
          { ...address, committedAt: new Date(0).toISOString(), skills: [skill] },
          { ...skill, files: own.map((file) => file.path).sort() },
        ),
        bundleSha256: createHash("sha256").update(bundle).digest("hex"),
      };
      const result = { detail, bundle };
      downloads.set(id, result);
      if (downloads.size > DOWNLOADS_KEPT) downloads.delete(downloads.keys().next().value ?? id);
      return result;
    }),
  };
}

export type GithubSkillSourceReader = ReturnType<typeof githubSkillSource>;
