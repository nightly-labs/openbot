export function failureText(error: unknown): string | null {
  return error instanceof Error && error.message ? error.message : null;
}
