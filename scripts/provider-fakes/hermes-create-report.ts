import type { CreateAgentInput } from "@openbot/contracts/ipc";

export interface HermesCreateDraft
  extends Pick<
      CreateAgentInput,
      "name" | "avatarSeed" | "avatarHue" | "avatarColor" | "reasoningEffort" | "providerAccountId" | "hermesProfileId"
    >,
    Required<Pick<CreateAgentInput, "provider" | "model">> {
  purpose: string;
  suggestionId: string | null;
}

export const HERMES_CREATE_CASES = [
  "selected-readiness",
  "global-available",
  "selected-loading",
  "selected-error",
  "selected-empty",
  "selected-retry",
  "dormant-work",
  "dormant-default",
  "unrelated-draft",
  "inherited-readiness",
  "inherited-available",
  "other-provider",
  "download-missing",
  "download-retry",
  "download-cancel",
  "runtime-ready-error",
  "inherited-runtime-connect",
  "codex-connect",
  "blocked-joined",
  "blocked-connect",
] as const;

export type HermesCreateCase = (typeof HERMES_CREATE_CASES)[number];

export interface HermesCreateResult {
  name: HermesCreateCase;
  interface: "create-adapter" | "shared-picker";
  passed: boolean;
  checks: string[];
  requests: string[];
  connected: string[];
  downloaded: string[];
  canceled: string[];
  draft: HermesCreateDraft | null;
  submitted: HermesCreateDraft[];
  failureKind?: "assertion" | "harness";
  error?: string;
}

export interface HermesCreateReport {
  passed: boolean;
  interface: string;
  cases: HermesCreateResult[];
}
