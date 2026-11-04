import { chatTagReferences, leadingAddress } from "@openbot/contracts/chat-tag-references";

/** A channel skill is usable only when its message addresses exactly one agent. */
export function channelSkillRecipient(value: string): string | null | undefined {
  if (!chatTagReferences(value).some((reference) => reference.kind === "skill")) return undefined;
  const address = leadingAddress(value);
  return !address.everyone && address.mentions.length === 1 ? (address.mentions[0]?.id ?? null) : null;
}
