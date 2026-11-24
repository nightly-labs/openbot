export const PROCESS_LAUNCHER_START_DEADLINE_MS = 10_000;

export type ProcessLauncherRequest =
  | {
      readonly kind: "spawn";
      readonly id: number;
      readonly command: string;
      readonly args: readonly string[];
      readonly cwd: string | undefined;
      readonly env: Readonly<Record<string, string>>;
    }
  | { readonly kind: "stdin"; readonly id: number; readonly data: Uint8Array }
  | { readonly kind: "stdin-end"; readonly id: number }
  | { readonly kind: "kill"; readonly id: number; readonly signal: NodeJS.Signals };

export type ProcessLauncherEvent =
  | { readonly kind: "ready" }
  | { readonly kind: "stdout"; readonly id: number; readonly data: Uint8Array }
  | { readonly kind: "stderr"; readonly id: number; readonly data: Uint8Array }
  | {
      readonly kind: "error";
      readonly id: number;
      readonly message: string;
      readonly code: string | null;
      readonly spawnFailed: boolean;
    }
  | {
      readonly kind: "exit";
      readonly id: number;
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    };

const REQUEST_KINDS: ReadonlySet<unknown> = new Set(["spawn", "stdin", "stdin-end", "kill"]);

export function isProcessLauncherRequest(value: unknown): value is ProcessLauncherRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    REQUEST_KINDS.has(value.kind) &&
    "id" in value &&
    typeof value.id === "number"
  );
}
