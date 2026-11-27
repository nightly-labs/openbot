import { CREDIT_PACK_INDEXES } from "@openbot/contracts/credits";

export function creditColorStep(index: number): number {
  const last = CREDIT_PACK_INDEXES.length - 1;
  const next = CREDIT_PACK_INDEXES.findIndex((packIndex) => packIndex >= index);
  if (next === -1) return 1;
  const to = CREDIT_PACK_INDEXES[next];
  const from = CREDIT_PACK_INDEXES[next - 1];
  if (to === undefined || from === undefined || to === from) return next / last;
  return (next - 1 + (index - from) / (to - from)) / last;
}
