import { avatarCandidateSeeds } from "@openbot/brand/bloub-avatar";

interface AvatarCandidates {
  namespace: string;
  batch: number;
  seeds: string[];
}

export function createAvatarCandidates(seed: string, previous?: AvatarCandidates): AvatarCandidates {
  const namespace = previous?.namespace ?? seed;
  const batch = previous ? previous.batch + 1 : 0;
  return { namespace, batch, seeds: avatarCandidateSeeds(namespace, seed, batch) };
}
