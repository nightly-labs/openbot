import type {
  WorkflowGitHubCatalog,
  WorkflowGitHubHistory,
  WorkflowGitHubItem,
  WorkflowGitHubRepository,
  WorkflowGitHubRepositoryOptions,
  WorkflowRunStatus,
} from "@openbot/contracts/ipc";
import type { GitHubConnection } from "../settings/GitHubConnectorPanel";

export interface WorkflowGitHubRun {
  number: number;
  status: WorkflowRunStatus;
}

export interface WorkflowGitHubCanvas {
  catalog: () => WorkflowGitHubCatalog | undefined;
  history: () => WorkflowGitHubHistory;
  run: (runId: string) => WorkflowGitHubRun | undefined;
  options: (repository: string) => WorkflowGitHubRepositoryOptions | undefined;
  connection: () => GitHubConnection;
  openGitHub: () => void;
  opening: () => boolean;
  openItem: (item: WorkflowGitHubItem) => void;
  runLastEvent: (nodeId: string) => void;
}

export const EMPTY_GITHUB_HISTORY: WorkflowGitHubHistory = { deliveries: [], runs: [] };

export function githubItemUrl(item: WorkflowGitHubItem): string {
  return `https://github.com/${item.repository}/${item.pullRequest ? "pull" : "issues"}/${item.number}`;
}

export function githubRepository(
  github: WorkflowGitHubCanvas | undefined,
  fullName: string,
): WorkflowGitHubRepository | undefined {
  const name = fullName.toLowerCase();
  return github?.catalog()?.repositories.find((repository) => repository.fullName.toLowerCase() === name);
}
