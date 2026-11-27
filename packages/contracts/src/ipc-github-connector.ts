import { isBoolean, isDynamicRecord, isNumber, isString } from "./runtime-values";

export type GitHubConnectorState = "disconnected" | "pending" | "connected" | "expired";

function isGitHubConnectorState(value: unknown): value is GitHubConnectorState {
  return value === "disconnected" || value === "pending" || value === "connected" || value === "expired";
}

export interface GitHubConnectorStatus {
  available: boolean;
  state: GitHubConnectorState;
  login: string | null;
  avatarUrl: string | null;
  userCode: string | null;
  verificationUri: string | null;
  error: string | null;
}

export const DISCONNECTED_GITHUB_CONNECTOR: GitHubConnectorStatus = {
  available: false,
  state: "disconnected",
  login: null,
  avatarUrl: null,
  userCode: null,
  verificationUri: null,
  error: null,
};

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

export function parseGitHubConnectorStatus(value: unknown): GitHubConnectorStatus | null {
  if (
    !isDynamicRecord(value) ||
    !isBoolean(value.available) ||
    !isGitHubConnectorState(value.state) ||
    !isNullableString(value.login) ||
    !isNullableString(value.avatarUrl) ||
    !isNullableString(value.userCode) ||
    !isNullableString(value.verificationUri) ||
    !isNullableString(value.error)
  ) {
    return null;
  }
  return {
    available: value.available,
    state: value.state,
    login: value.login,
    avatarUrl: value.avatarUrl,
    userCode: value.userCode,
    verificationUri: value.verificationUri,
    error: value.error,
  };
}

export interface GitHubConnectorRepository {
  fullName: string;
  private: boolean;
}

export interface GitHubConnectorRepositories {
  repositories: GitHubConnectorRepository[];
  total: number;
}

function parseGitHubConnectorRepository(value: unknown): GitHubConnectorRepository | null {
  if (!isDynamicRecord(value) || !isString(value.fullName) || !isBoolean(value.private)) return null;
  return { fullName: value.fullName, private: value.private };
}

export function parseGitHubConnectorRepositories(value: unknown): GitHubConnectorRepositories | null {
  if (!isDynamicRecord(value) || !Array.isArray(value.repositories) || !isNumber(value.total)) return null;
  const repositories: GitHubConnectorRepository[] = [];
  for (const item of value.repositories) {
    const repository = parseGitHubConnectorRepository(item);
    if (!repository) return null;
    repositories.push(repository);
  }
  return { repositories, total: value.total };
}

export interface HostGitHubConnectorStatus extends GitHubConnectorStatus {
  installUrl: string | null;
  revokeUrl: string | null;
}

export function parseHostGitHubConnectorStatus(value: unknown): HostGitHubConnectorStatus | null {
  const status = parseGitHubConnectorStatus(value);
  if (!status || !isDynamicRecord(value) || !isNullableString(value.installUrl) || !isNullableString(value.revokeUrl))
    return null;
  return { ...status, installUrl: value.installUrl, revokeUrl: value.revokeUrl };
}

export function decodeHostGitHubConnectorStatus(value: unknown): HostGitHubConnectorStatus {
  const status = parseHostGitHubConnectorStatus(value);
  if (!status) throw new Error("Invalid GitHub connector response.");
  return status;
}

export function decodeHostGitHubConnectorRepositories(value: unknown): GitHubConnectorRepositories {
  const repositories = parseGitHubConnectorRepositories(value);
  if (!repositories) throw new Error("Invalid GitHub connector response.");
  return repositories;
}

export function withoutGitHubPages(status: HostGitHubConnectorStatus): GitHubConnectorStatus {
  const { available, state, login, avatarUrl, userCode, verificationUri, error } = status;
  return { available, state, login, avatarUrl, userCode, verificationUri, error };
}

export function githubPage(address: string | null): string | null {
  const url = address === null ? null : URL.parse(address);
  return url?.protocol === "https:" && url.hostname === "github.com" && url.port === "" ? url.toString() : null;
}
