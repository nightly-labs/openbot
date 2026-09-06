/**
 * The message to show a user for a rejected promise, or `fallback` when the rejection
 * carries nothing readable.
 *
 * Six call sites across four features had their own byte-identical copy - five named
 * `errorMessage`, one `messageForError` - so what a user sees when a command fails was
 * six decisions that only happened to agree. It stays a renderer module: `src/main` has
 * the same three lines in `central-auth-manager.ts` and cannot import them, because
 * nothing behind the trust boundary reaches into the renderer.
 *
 * `fallback` rather than `String(error)` on purpose. A thrown non-Error stringifies to
 * "[object Object]" or "undefined", which is worse than a sentence the feature wrote.
 */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
