// The cue sheet. The scenes and the soundtrack both read these times, so a hit and the frame it
// belongs to cannot drift apart when one of them is edited.

export const CUE = {
  /** The eyes draw on from frame 0. */
  drawLeft: 0,
  drawRight: 0.06,
  drawLength: 0.34,
  blink: 0.46,
  looks: [0.66, 0.78, 0.9],
  /** The lilac square lands behind the eyes. */
  slam: 1,
  meet: 2,
  openBot: 2.5,
  dive: 2.72,
  promise: 3,
  models: 6,
  team: 9,
  local: 12,
  lock: 12.32,
  price: 13,
  platforms: 14,
  implode: 14.78,
  outro: 15,
  wordmark: 15.36,
  tagline: 15.7,
  cta: 16,
  wink: 16.45,
  blinkEnd: 17.3,
  end: 18,
} as const;

/** One word per beat. */
export const PROMISE_WORDS = [3, 3.5, 4, 4.5, 5, 5.5] as const;
/** The provider badge changes on every half beat pair. */
export const PROVIDER_SWAPS = [6, 6.5, 7, 7.5, 8] as const;
export const TEAM_MESSAGES = [9.5, 10, 10.5, 11] as const;
export const PLATFORM_CHIPS = [14.05, 14.15, 14.25, 14.35, 14.45] as const;
/** Scene changes that get a whoosh on the way in. */
export const TRANSITIONS = [CUE.promise, CUE.models, CUE.team, CUE.local] as const;
