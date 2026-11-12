// Skills from a public GitHub repository. The host reads the link, pins the commit it read, and
// gives each skill folder an id that names that commit. An install of the id writes the files of
// that commit, so the agent gets what the user read, also when the repository changes later.

import type { MarketplaceSkillDetail } from "./ipc-skills";
import { isDynamicRecord, isString } from "./runtime-values";

/** One skill folder: a folder with a `SKILL.md`. */
export interface GithubSkill {
  /** `github:<owner>/<repo>@<commit>:<folder>`. */
  id: string;
  /** The folder of the skill, relative to the repository root. Empty for the root. */
  path: string;
  slug: string;
  name: string;
  description: string;
  /** The text of the `SKILL.md`. */
  instructions: string;
  files: string[];
}

/** The skills under one link, at one commit. */
export interface GithubSkillSource {
  owner: string;
  repo: string;
  /** The full commit SHA that the host read. */
  commit: string;
  /** The time of the commit, ISO 8601. */
  committedAt: string;
  /** The folder of the link, relative to the repository root. Empty for the root. */
  path: string;
  skills: GithubSkill[];
}

export const GITHUB_SKILL_ID_PREFIX = "github:";
/** The skill id travels in `skills-admin-v1`, which takes 256 characters at most. */
export const GITHUB_SKILL_ID_MAX_LENGTH = 256;
/** At most this many skills from one link. */
export const GITHUB_SKILLS_PER_LINK = 100;
/** The longest `SKILL.md` that a read gives in full. */
export const GITHUB_SKILL_INSTRUCTIONS_MAX_LENGTH = 128 * 1024;

export interface GithubSkillAddress {
  owner: string;
  repo: string;
  commit: string;
  path: string;
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const REPO = /^[A-Za-z0-9._-]{1,100}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;

/** A GitHub account or organization name. */
export function isGithubOwner(name: string): boolean {
  return OWNER.test(name);
}

/** A GitHub repository name. */
export function isGithubRepo(name: string): boolean {
  return REPO.test(name);
}

/** A full commit SHA. */
export function isGithubCommit(sha: string): boolean {
  return COMMIT.test(sha);
}

export function isGithubSkillId(id: string): boolean {
  return id.startsWith(GITHUB_SKILL_ID_PREFIX);
}

export function githubSkillId(address: GithubSkillAddress): string {
  return `${GITHUB_SKILL_ID_PREFIX}${address.owner}/${address.repo}@${address.commit}:${address.path}`;
}

/** The parts of a GitHub skill id, or null when the id is not one. */
export function parseGithubSkillId(id: string): GithubSkillAddress | null {
  if (!isGithubSkillId(id) || id.length > GITHUB_SKILL_ID_MAX_LENGTH) return null;
  const match = /^([^/]+)\/([^@]+)@([0-9a-f]{40}):(.*)$/u.exec(id.slice(GITHUB_SKILL_ID_PREFIX.length));
  if (!match) return null;
  const [, owner = "", repo = "", commit = "", path = ""] = match;
  if (!OWNER.test(owner) || !REPO.test(repo) || !COMMIT.test(commit) || !isGithubSkillPath(path)) return null;
  return { owner, repo, commit, path };
}

/** A folder path in a repository: no leading or trailing slash, no `.` or `..` part. */
export function isGithubSkillPath(path: string): boolean {
  if (path === "") return true;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !part.includes("\\"));
}

/** True when two ids name the same skill folder of the same repository, at different commits. */
export function isOtherGithubCommit(id: string, other: string): boolean {
  if (id === other) return false;
  const a = parseGithubSkillId(id);
  const b = parseGithubSkillId(other);
  return (
    a !== null &&
    b !== null &&
    a.owner.toLowerCase() === b.owner.toLowerCase() &&
    a.repo.toLowerCase() === b.repo.toLowerCase() &&
    a.path === b.path
  );
}

/** The page of the skill folder on GitHub, at the commit that the id names. */
export function githubSkillUrl(address: GithubSkillAddress): string {
  const base = `https://github.com/${address.owner}/${address.repo}/tree/${address.commit}`;
  return address.path ? `${base}/${address.path.split("/").map(encodeURIComponent).join("/")}` : base;
}

/**
 * A skill from GitHub in the shape of a Marketplace skill, so that the skill page and the add flow
 * show it. OpenBot did not review it: it is never `verified` or `featured`.
 */
export function githubSkillDetail(source: GithubSkillSource, skill: GithubSkill): MarketplaceSkillDetail {
  return {
    id: skill.id,
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    category: "other",
    creatorName: source.owner,
    creatorAvatarUrl: null,
    version: 1,
    installs: 0,
    featured: false,
    verified: false,
    iconUrl: null,
    updatedAt: source.committedAt,
    versionId: source.commit,
    bundleSha256: "",
    files: skill.files,
    instructions: skill.instructions,
  };
}

/** Main and the web client read a host's answer with this; a wrong shape is an error. */
export function decodeGithubSkillSource(value: unknown): GithubSkillSource {
  if (
    !isDynamicRecord(value) ||
    !isString(value.owner) ||
    !isString(value.repo) ||
    !isString(value.commit) ||
    !COMMIT.test(value.commit) ||
    !isString(value.committedAt) ||
    !isString(value.path) ||
    !Array.isArray(value.skills) ||
    value.skills.length > GITHUB_SKILLS_PER_LINK
  )
    throw new Error("Invalid GitHub skills response.");
  return {
    owner: value.owner,
    repo: value.repo,
    commit: value.commit,
    committedAt: value.committedAt,
    path: value.path,
    skills: value.skills.map(decodeGithubSkill),
  };
}

function decodeGithubSkill(value: unknown): GithubSkill {
  if (
    !isDynamicRecord(value) ||
    !isString(value.id) ||
    !parseGithubSkillId(value.id) ||
    !isString(value.path) ||
    !isString(value.slug) ||
    !isString(value.name) ||
    !isString(value.description) ||
    !isString(value.instructions) ||
    value.instructions.length > GITHUB_SKILL_INSTRUCTIONS_MAX_LENGTH ||
    !Array.isArray(value.files) ||
    !value.files.every(isString)
  )
    throw new Error("Invalid GitHub skills response.");
  return {
    id: value.id,
    path: value.path,
    slug: value.slug,
    name: value.name,
    description: value.description,
    instructions: value.instructions,
    files: value.files,
  };
}
