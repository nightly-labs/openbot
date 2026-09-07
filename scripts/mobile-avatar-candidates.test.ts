import { isAvatarSeed } from "@openbot/contracts/ipc";
import { expect, it } from "vitest";
import { createAvatarCandidates } from "../apps/mobile/src/features/agents/model/avatar-candidates";

it("keeps every selectable avatar valid after repeated selections and More faces", () => {
  let candidates = createAvatarCandidates("mobile:0123456789abcdef0123456789abcdef");
  for (let generation = 0; generation < 100; generation += 1) {
    for (const seed of candidates.seeds) expect(isAvatarSeed(seed)).toBe(true);
    const selected = candidates.seeds[1];
    if (!selected) throw new Error("The picker must offer an alternative face.");
    const next = createAvatarCandidates(selected, candidates);
    expect(next.seeds[0]).toBe(selected);
    expect(next.seeds.slice(1)).not.toEqual(candidates.seeds.slice(1));
    candidates = next;
  }
  expect(candidates.seeds.every(isAvatarSeed)).toBe(true);
});
