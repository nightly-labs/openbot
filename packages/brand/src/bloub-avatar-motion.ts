import type { ExpressionId, StateId } from "@norbert_bodziony/bloub";

export const SHAPE_SAFE_STATES = ["idle", "wink", "wide", "notify", "swirl"] as const satisfies readonly StateId[];

export type ShapeSafeStateId = (typeof SHAPE_SAFE_STATES)[number];

export type AvatarMood = "idle" | "working" | "waiting" | "failed" | "responded" | "connecting" | "asleep";

export interface AvatarMoodPresentation {
  state: ShapeSafeStateId;
  expression: ExpressionId | null;
  rings: boolean;
  breathe: number;
}

const MOOD_PRESENTATIONS: Readonly<Record<AvatarMood, AvatarMoodPresentation>> = {
  idle: { state: "idle", expression: null, rings: false, breathe: 0 },
  working: { state: "idle", expression: "attentif", rings: true, breathe: 0.03 },
  waiting: { state: "idle", expression: "curieux", rings: false, breathe: 0 },
  failed: { state: "idle", expression: "triste", rings: false, breathe: 0 },
  responded: { state: "idle", expression: "heureux", rings: false, breathe: 0 },
  connecting: { state: "swirl", expression: "attentif", rings: true, breathe: 0 },
  asleep: { state: "idle", expression: "somnolent", rings: false, breathe: 0 },
};

export function avatarMoodPresentation(mood: AvatarMood): AvatarMoodPresentation {
  return MOOD_PRESENTATIONS[mood];
}

export function avatarMoodIsBusy(mood: AvatarMood): boolean {
  const presentation = MOOD_PRESENTATIONS[mood];
  return presentation.rings || presentation.breathe > 0;
}
