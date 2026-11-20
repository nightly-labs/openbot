import type { MarketplaceSkillDetail } from "./ipc-skills";
import { isDynamicRecord, isString } from "./runtime-values";

export interface GithubSkill {
  id: string;
  path: string;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  files: string[];
}

export interface GithubSkillSource {
  owner: string;
  repo: string;
  commit: string;
  committedAt: string;
  path: string;
  skills: GithubSkill[];
}

export const GITHUB_SKILL_ID_PREFIX = "github:";
export const GITHUB_SKILL_ID_MAX_LENGTH = 256;
export const GITHUB_SKILLS_PER_LINK = 100;
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

export function isGithubOwner(name: string): boolean {
  return OWNER.test(name);
}

export function isGithubRepo(name: string): boolean {
  return REPO.test(name);
}

export function isGithubCommit(sha: string): boolean {
  return COMMIT.test(sha);
}

export function isGithubSkillId(id: string): boolean {
  return id.startsWith(GITHUB_SKILL_ID_PREFIX);
}

export function githubSkillId(address: GithubSkillAddress): string {
  return `${GITHUB_SKILL_ID_PREFIX}${address.owner}/${address.repo}@${address.commit}:${address.path}`;
}

export function parseGithubSkillId(id: string): GithubSkillAddress | null {
  if (!isGithubSkillId(id) || id.length > GITHUB_SKILL_ID_MAX_LENGTH) return null;
  const match = /^([^/]+)\/([^@]+)@([0-9a-f]{40}):(.*)$/u.exec(id.slice(GITHUB_SKILL_ID_PREFIX.length));
  if (!match) return null;
  const [, owner = "", repo = "", commit = "", path = ""] = match;
  if (!OWNER.test(owner) || !REPO.test(repo) || !COMMIT.test(commit) || !isGithubSkillPath(path)) return null;
  return { owner, repo, commit, path };
}

export function isGithubSkillPath(path: string): boolean {
  if (path === "") return true;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !part.includes("\\"));
}

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

export function githubSkillUrl(address: GithubSkillAddress): string {
  const base = `https://github.com/${address.owner}/${address.repo}/tree/${address.commit}`;
  return address.path ? `${base}/${address.path.split("/").map(encodeURIComponent).join("/")}` : base;
}

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
