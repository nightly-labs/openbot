import type { Readable, Writable } from "node:stream";

export interface ProcessLaunchOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
}

type ExitListener = (code: number | null, signal: NodeJS.Signals | null) => void;
type ErrorListener = (error: Error) => void;

export interface LaunchedProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly killed: boolean;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "exit", listener: ExitListener): this;
  on(event: "error", listener: ErrorListener): this;
  once(event: "exit", listener: ExitListener): this;
  once(event: "error", listener: ErrorListener): this;
  off(event: "exit", listener: ExitListener): this;
  off(event: "error", listener: ErrorListener): this;
}

export type ProcessLaunch = (options: ProcessLaunchOptions) => LaunchedProcess;
