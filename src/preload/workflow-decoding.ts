import {
  decodeWorkflowFoldersSnapshot,
  isWorkflowDetail,
  isWorkflowGitHubCatalog,
  isWorkflowGitHubHistory,
  isWorkflowGitHubRepositoryOptions,
  isWorkflowGraph,
  isWorkflowMediaCatalog,
  isWorkflowMediaCredits,
  isWorkflowMediaPrice,
  isWorkflowMediaProviders,
  isWorkflowRunDetail,
  isWorkflowRunPage,
  isWorkflowSaveResult,
  isWorkflowStep,
  isWorkflowStepSettings,
  isWorkflowSummary,
  isWorkflowVersion,
  isWorkflowWebhookSecret,
  type WorkflowFoldersSnapshot,
} from "@openbot/contracts/ipc";
import { guardedDecoder, guardedListDecoder } from "@openbot/contracts/ipc-decoding";

export const decodeWorkflowSummaries = guardedListDecoder(isWorkflowSummary, "workflow list response");
export const decodeWorkflowSummary = guardedDecoder(isWorkflowSummary, "workflow summary response");
export const decodeWorkflowDetail = guardedDecoder(isWorkflowDetail, "workflow response");
export const decodeWorkflowGraph = guardedDecoder(isWorkflowGraph, "workflow version response");
export const decodeWorkflowSaveResult = guardedDecoder(isWorkflowSaveResult, "workflow save response");
export const decodeWorkflowVersions = guardedListDecoder(isWorkflowVersion, "workflow versions response");
export const decodeWorkflowRunDetail = guardedDecoder(isWorkflowRunDetail, "workflow run response");
export const decodeWorkflowRunPage = guardedDecoder(isWorkflowRunPage, "workflow runs response");
export const decodeWorkflowStep = guardedDecoder(isWorkflowStep, "workflow step response");
export const decodeWorkflowStepSettings = guardedDecoder(isWorkflowStepSettings, "workflow step settings response");
export const decodeWorkflowWebhookSecret = guardedDecoder(isWorkflowWebhookSecret, "workflow webhook secret response");
export const decodeWorkflowGitHubCatalog = guardedDecoder(isWorkflowGitHubCatalog, "workflow GitHub catalog response");
export const decodeWorkflowGitHubOptions = guardedDecoder(
  isWorkflowGitHubRepositoryOptions,
  "workflow GitHub options response",
);
export const decodeWorkflowGitHubHistory = guardedDecoder(isWorkflowGitHubHistory, "workflow GitHub history response");
export const decodeWorkflowMediaCredits = guardedDecoder(isWorkflowMediaCredits, "workflow media credits response");
export const decodeWorkflowMediaCatalog = guardedDecoder(isWorkflowMediaCatalog, "workflow media catalog response");
export const decodeWorkflowMediaPrice = guardedDecoder(isWorkflowMediaPrice, "workflow media price response");
export const decodeWorkflowMediaProviders = guardedDecoder(
  isWorkflowMediaProviders,
  "workflow media providers response",
);

export function decodeWorkflowPictureId(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Invalid workflow picture response.");
  return value;
}

export function decodeWorkflowFoldersSnapshotFromMain(value: unknown): WorkflowFoldersSnapshot {
  return decodeWorkflowFoldersSnapshot(value);
}
