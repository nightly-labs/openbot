export function coordinatorText(
  author: { kind: string } | undefined,
  text: string,
  localize: (text: string) => string,
): string {
  return author?.kind === "coordinator" ? localize(text) : text;
}
