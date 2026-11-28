/** Only an unambiguous batch can name one authenticated member. */
export function authenticatedBatchUser(batch: readonly { kind: string; id?: string }[]): string | undefined {
  const id = batch[0]?.id;
  return id && batch.every((item) => item.kind === "user" && item.id === id) ? id : undefined;
}

/** Optional ACP metadata, not a signed assertion. A session may serve different members; check each prompt. */
export function acpUserMeta(id: string | undefined): { "openbot.dev/userId": string } | undefined {
  return id ? { "openbot.dev/userId": id } : undefined;
}
