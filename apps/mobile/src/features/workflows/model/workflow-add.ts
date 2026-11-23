import type { WorkflowFieldValue, WorkflowNodeKind } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";

export const ADD_KEYS = [
  "prompt",
  "asset",
  "llm",
  "agent",
  "image",
  "video",
  "condition",
  "approval",
  "output",
] as const;
export type AddKey = (typeof ADD_KEYS)[number];

type AddableKind = Exclude<AddKey, "video"> | "image";

export function addKind(key: AddKey): AddableKind {
  return key === "video" ? "image" : key;
}

const NEW_FIELDS: Record<AddKey, Record<string, WorkflowFieldValue>> = {
  prompt: {},
  asset: {},
  llm: {},
  agent: {},
  image: {},
  video: { media: "video" },
  condition: {},
  approval: {},
  output: { target: "notify" },
};

export function addFields(key: AddKey): Record<string, WorkflowFieldValue> {
  return { ...NEW_FIELDS[key] };
}

export const ADD_GROUPS = [
  { label: "mobile.workflow.add.group.inputs", keys: ["prompt", "asset"] },
  { label: "mobile.workflow.add.group.steps", keys: ["llm", "agent", "image", "video"] },
  { label: "mobile.workflow.add.group.flow", keys: ["condition", "approval", "output"] },
] as const satisfies readonly { label: MobileTextKey; keys: readonly AddKey[] }[];

export function isFeederKind(kind: WorkflowNodeKind): boolean {
  return kind === "prompt" || kind === "asset";
}
