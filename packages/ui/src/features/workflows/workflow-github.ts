/**
 * What the GitHub trigger and output cards read from the host: the repositories that the GitHub App
 * reaches, the labels and people of one repository, the events that GitHub sent, and the actions that
 * open GitHub. The canvas gives it; the gallery and the stories give a fixed one.
 */

import type {
  WorkflowGitHubCatalog,
  WorkflowGitHubHistory,
  WorkflowGitHubItem,
  WorkflowGitHubRepository,
  WorkflowGitHubRepositoryOptions,
  WorkflowRunStatus,
} from "@openbot/contracts/ipc";
import type { GitHubConnection } from "../settings/GitHubConnectorPanel";

/** A run that the canvas has loaded. */
export interface WorkflowGitHubRun {
  number: number;
  status: WorkflowRunStatus;
}

export interface WorkflowGitHubCanvas {
  /** Undefined while the host reads it. */
  catalog: () => WorkflowGitHubCatalog | undefined;
  /** The events of the GitHub triggers of the workflow, newest first, and the items of their runs. */
  history: () => WorkflowGitHubHistory;
  /** A run that a GitHub event started. Undefined when the canvas has not loaded it. */
  run: (runId: string) => WorkflowGitHubRun | undefined;
  /** The labels and people of a repository. Undefined until the host reads them; the first call asks for them. */
  options: (repository: string) => WorkflowGitHubRepositoryOptions | undefined;
  /** The GitHub connection of the host, for the connect dialog of a card. */
  connection: () => GitHubConnection;
  /**
   * Opens the installation of the GitHub App on GitHub, where the owner chooses the repositories and
   * accepts new permissions. One page fixes access, write access and events.
   */
  openGitHub: () => void;
  opening: () => boolean;
  /** Opens an issue or a pull request on GitHub. */
  openItem: (item: WorkflowGitHubItem) => void;
  /** Runs the workflow from a GitHub trigger with the newest item that matches it. */
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
