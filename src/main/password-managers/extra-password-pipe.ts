// Gives the Proton Pass CLI the extra password of an account during a `browser` sign-in. The CLI
// reads the password from the file that `PROTON_PASS_EXTRA_PASSWORD_FILE` names, so the password
// never goes into an argument or onto the disk: the file is a FIFO on macOS and Linux, and a named
// pipe on Windows. Each time the CLI opens it, this module calls `onRead`; the CLI opens it again
// after an incorrect password.

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";

export interface ExtraPasswordPipe {
  readonly path: string;
  close(): Promise<void>;
}

/** Sends one password to the CLI that reads now. */
export type ExtraPasswordAnswer = (password: string) => Promise<void>;

const POLL_MS = 500;

/** `directory` must belong to this user only. */
export function openExtraPasswordPipe(
  directory: string,
  onRead: (answer: ExtraPasswordAnswer) => void,
): Promise<ExtraPasswordPipe> {
  return process.platform === "win32" ? namedPipe(onRead) : fifo(directory, onRead);
}

async function namedPipe(onRead: (answer: ExtraPasswordAnswer) => void): Promise<ExtraPasswordPipe> {
  const path = `\\\\.\\pipe\\openbot-protonpass-${randomBytes(12).toString("hex")}`;
  const server = createServer((socket) => {
    socket.on("error", () => socket.destroy());
    onRead(
      (password) =>
        new Promise((resolve) => {
          socket.end(password, () => resolve());
        }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => resolve());
  });
  return { path, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

async function fifo(directory: string, onRead: (answer: ExtraPasswordAnswer) => void): Promise<ExtraPasswordPipe> {
  const path = join(directory, "extra-password");
  await new Promise<void>((resolve, reject) => {
    execFile("mkfifo", ["-m", "600", path], { windowsHide: true }, (error) => (error ? reject(error) : resolve()));
  });
  let closed = false;
  let writer: FileHandle | null = null;
  // After an answer, the CLI can still hold the pipe while it reads. A new read counts only after the
  // pipe had no reader.
  let armed = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    if (closed || writer) return;
    // With no reader, a non-blocking open for writing fails with ENXIO; the CLI waits in its open.
    const handle = await open(path, constants.O_WRONLY | constants.O_NONBLOCK).catch(() => null);
    if (!handle) armed = true;
    else if (closed || !armed) await handle.close().catch(() => undefined);
    else {
      writer = handle;
      armed = false;
      onRead(async (password) => {
        if (writer !== handle) return;
        try {
          await handle.write(password);
        } finally {
          writer = null;
          await handle.close().catch(() => undefined);
          schedule();
        }
      });
      return;
    }
    schedule();
  };
  const schedule = () => {
    if (!closed) timer = setTimeout(() => void poll(), POLL_MS);
  };
  schedule();
  return {
    path,
    close: async () => {
      closed = true;
      clearTimeout(timer);
      const handle = writer;
      writer = null;
      await handle?.close().catch(() => undefined);
    },
  };
}
