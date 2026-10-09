import type { AvatarHue } from "@openbot/contracts/ipc";

const ONBOARDING_AVATAR_HUES: readonly AvatarHue[] = [0, 30, 55, 100, 150, 185, 215, 245, 280, 320];

export type OnboardingAvatarVariant = {
  seed: string;
  hue: AvatarHue;
  cycleOffset: number;
  animationOffset: number;
};

/** A seed shared by the avatars of one first run, so a new first run draws a new set. */
export function onboardingSessionSeed(): string {
  return `onboarding-${randomUnit().toString(36)}-${Date.now().toString(36)}`;
}

export function createOnboardingAvatarVariant(sessionSeed: string, slot: string): OnboardingAvatarVariant {
  return {
    seed: `${sessionSeed}:${slot}:${randomUnit().toString(36)}`,
    hue: randomItem(ONBOARDING_AVATAR_HUES),
    cycleOffset: randomInt(12),
    animationOffset: randomUnit() * 2.4,
  };
}

/** A row of avatars for a layout that shows the whole team. Each one has a different hue. */
export function createOnboardingTeam(sessionSeed: string, count: number): OnboardingAvatarVariant[] {
  const hues = [...ONBOARDING_AVATAR_HUES];
  for (let index = hues.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1);
    [hues[index], hues[other]] = [hues[other] ?? 0, hues[index] ?? 0];
  }
  return Array.from({ length: count }, (_, index) => ({
    ...createOnboardingAvatarVariant(sessionSeed, `team-${index}`),
    hue: hues[index % hues.length] ?? 0,
  }));
}

function randomItem<T>(items: readonly T[]): T {
  const item = items[randomInt(items.length)];
  if (item === undefined) throw new Error("The onboarding avatar list is empty.");
  return item;
}

function randomInt(maxExclusive: number): number {
  return Math.floor(randomUnit() * maxExclusive);
}

function randomUnit(): number {
  try {
    const values = new Uint32Array(1);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(values);
      return (values[0] ?? 0) / 0x1_0000_0000;
    }
  } catch {
    // Fall back to the browser's pseudo-random source when secure random values are unavailable.
  }
  return Math.random();
}
