import { BotEngine, EXPRESSION_BY_ID, POSES, RAYON, SHAPE_BY_ID, STATES, type StateId } from "@norbert_bodziony/bloub";
import { describe, expect, it } from "vitest";
import { type AvatarMood, avatarMoodPresentation, SHAPE_SAFE_STATES } from "./bloub-avatar-motion";

const MOODS = [
  "idle",
  "working",
  "waiting",
  "failed",
  "responded",
  "connecting",
  "asleep",
] as const satisfies readonly AvatarMood[];

/** Two silhouettes far enough apart that any state honouring them must draw a different body. */
function radiiOf(shape: "cercle" | "triangle"): number[] {
  const silhouette = SHAPE_BY_ID.get(shape);
  if (!silhouette) throw new Error(`Bloub has no ${shape} silhouette.`);
  return silhouette.radii;
}

function bodyPathAt(state: StateId, radii: number[]): string {
  return new BotEngine(RAYON, state, radii, null).sample(POSES[state]).bodyPath;
}

/** States that draw their own body, so the silhouette they are given makes no difference. */
const SHAPE_BLIND_STATES = ["orbit", "thinking", "burst", "egg"] as const satisfies readonly StateId[];

describe("shape-safe states", () => {
  it("lists exactly the states that keep the avatar's silhouette", () => {
    const fromCatalogue = STATES.filter((state) => state.baseBody).map((state) => state.id);
    expect([...SHAPE_SAFE_STATES].sort()).toEqual([...fromCatalogue].sort());
  });

  // The assertion the whole change exists for: an avatar animates its own shape and no other.
  it.each(SHAPE_SAFE_STATES)("draws the chosen silhouette in %s", (state) => {
    expect(bodyPathAt(state, radiiOf("cercle"))).not.toEqual(bodyPathAt(state, radiiOf("triangle")));
  });

  // The failing case this replaces, kept so the reason for the allowlist stays visible: these
  // states ignore the silhouette entirely, so two different agents render the same body.
  it.each(SHAPE_BLIND_STATES)("ignores the chosen silhouette in %s", (state) => {
    expect(bodyPathAt(state, radiiOf("cercle"))).toEqual(bodyPathAt(state, radiiOf("triangle")));
  });
});

describe("avatarMoodPresentation", () => {
  it.each(MOODS)("gives %s a shape-safe state and a real expression", (mood) => {
    const presentation = avatarMoodPresentation(mood);
    expect(SHAPE_SAFE_STATES).toContain(presentation.state);
    if (presentation.expression !== null) expect(EXPRESSION_BY_ID.get(presentation.expression)).toBeDefined();
  });

  it("only asks for an expression on a state that can wear one", () => {
    for (const mood of MOODS) {
      const presentation = avatarMoodPresentation(mood);
      if (presentation.expression === null) continue;
      expect(STATES.find((state) => state.id === presentation.state)?.baseFace).toBe(true);
    }
  });

  it("keeps breathing small enough to stay a scale rather than a shape change", () => {
    for (const mood of MOODS) expect(avatarMoodPresentation(mood).breathe).toBeLessThanOrEqual(0.06);
  });
});
