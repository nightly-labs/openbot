import type { ExpressionId, StateId } from "@norbert_bodziony/bloub";

/**
 * The bloub states an avatar is allowed to play.
 *
 * A state carries `baseBody`, and the catalogue is explicit about what it means: when it is false
 * the state draws its own body, because "that shape IS the animation" - the egg, the hexagon, the
 * exclamation mark, the burst of particles. `BotEngine.posed` only substitutes the avatar's radii
 * on the states where it is true, so playing any of the others throws the agent's silhouette away
 * and hands back a different creature for the length of the block. An agent is recognised by that
 * silhouette, so it is an identity trait and not a frame of animation.
 *
 * Listing the ids gives the type that locks every call site down to this set. The list is not the
 * authority, though: `bloub-avatar-motion.test.ts` checks it against the catalogue's own
 * `baseBody` flags, so a library bump that adds a state or reclassifies one fails a test rather
 * than quietly changing a shape.
 */
export const SHAPE_SAFE_STATES = ["idle", "wink", "wide", "notify", "swirl"] as const satisfies readonly StateId[];

export type ShapeSafeStateId = (typeof SHAPE_SAFE_STATES)[number];

/**
 * What an agent is doing, as far as its face is concerned.
 *
 * `idle`, `working`, `waiting`, `failed` and `responded` are derived from the agent's own runtime
 * signals. `connecting` and `asleep` belong to the surface around it - a remote desktop dialling
 * in, a snoozed or disconnected agent - so they are passed in rather than derived.
 */
export type AvatarMood = "idle" | "working" | "waiting" | "failed" | "responded" | "connecting" | "asleep";

export interface AvatarMoodPresentation {
  state: ShapeSafeStateId;
  /** `null` = wear the expression the seed chose, which is the avatar's resting face. */
  expression: ExpressionId | null;
  /** Orbit rings, drawn around the body rather than in place of it. */
  rings: boolean;
  /**
   * Amplitude of the breathing scale, as a fraction of the avatar's size. It moves the whole
   * rendered avatar, so it can never edit a silhouette - 0 holds still.
   */
  breathe: number;
}

/**
 * How each mood reads on the face.
 *
 * Only `idle` and `swirl` carry `baseFace`, so only they wear the expression asked for here; the
 * others hold the face the pose was drawn with, which is the point of using them. `notify` is the
 * one state whose own face already says what the mood says, so it asks for nothing.
 *
 * The expressions are chosen to agree with what the body is doing rather than to decorate it: an
 * agent that is working looks attentive, one that is waiting on an answer looks curious, a failed
 * turn looks sad, and a fresh reply looks pleased before it settles back to the resting face.
 */
const MOOD_PRESENTATIONS: Readonly<Record<AvatarMood, AvatarMoodPresentation>> = {
  idle: { state: "idle", expression: null, rings: false, breathe: 0 },
  working: { state: "idle", expression: "attentif", rings: true, breathe: 0.03 },
  waiting: { state: "notify", expression: null, rings: false, breathe: 0 },
  failed: { state: "idle", expression: "triste", rings: false, breathe: 0 },
  responded: { state: "idle", expression: "heureux", rings: false, breathe: 0 },
  connecting: { state: "swirl", expression: "attentif", rings: true, breathe: 0 },
  asleep: { state: "idle", expression: "somnolent", rings: false, breathe: 0 },
};

export function avatarMoodPresentation(mood: AvatarMood): AvatarMoodPresentation {
  return MOOD_PRESENTATIONS[mood];
}

/**
 * Whether a mood keeps moving on its own, rather than only settling into a face.
 *
 * A busy mood needs an animation clock: rings turn, or the body breathes. Every other mood is a
 * held expression, which glides into place through `BotEngine.setExpression` and then rests. The
 * distinction decides whether a surface starts a loop, so it lives here with the table it reads.
 */
export function avatarMoodIsBusy(mood: AvatarMood): boolean {
  const presentation = MOOD_PRESENTATIONS[mood];
  return presentation.rings || presentation.breathe > 0;
}
