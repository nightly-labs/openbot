import {
  applyLibraryFolderAction,
  type LibraryFolderAction,
  type LibraryFolderContext,
  LibraryFolderRefusal,
  type LibraryFoldersSnapshot,
} from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import { currentText } from "@openbot/ui/text";
import { createEffect, createSignal, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { type FilesPort, filesPort } from "./files-port";

export function createLibraryFolders(
  serverId: () => string,
  context: () => LibraryFolderContext,
  calls: () => FilesPort = filesPort,
) {
  const [ready, setReady] = createSignal(false);
  const [snapshot, setSnapshot] = createSignal<LibraryFoldersSnapshot | null>(null);
  let host: LibraryFoldersSnapshot | null = null;
  let shown: LibraryFoldersSnapshot | null = null;
  let pending = 0;
  let run = 0;
  let queue: Promise<void> = Promise.resolve();
  let readWaits = false;

  function show(next: LibraryFoldersSnapshot | null): void {
    shown = next;
    setSnapshot(next);
  }

  function enqueue(job: () => Promise<void>): void {
    const id = run;
    queue = queue.then(() => (id === run ? job() : undefined));
  }

  function read(): void {
    if (readWaits) return;
    readWaits = true;
    const id = run;
    const server = untrack(serverId);
    enqueue(async () => {
      readWaits = false;
      let answer: LibraryFoldersSnapshot | null;
      try {
        answer = (await untrack(calls).storage.getLibraryFolders?.(server)) ?? null;
      } catch {
        if (id !== run) return;
        setReady(true);
        return;
      }
      if (id !== run) return;
      host = answer;
      if (pending === 0) show(answer);
      setReady(true);
    });
  }

  createEffect(serverId, (server) => {
    run += 1;
    pending = 0;
    readWaits = false;
    host = null;
    show(null);
    setReady(false);
    read();
    return untrack(calls).onLibraryFoldersChanged?.(server, read);
  });

  function fail(error: unknown): void {
    run += 1;
    pending = 0;
    readWaits = false;
    show(host);
    const text = currentText();
    actionToast.error(text.t("files.folder.changeFailed"), {
      description: text.errorMessage(error, text.t("files.storage.tryAgain")),
      report: { operation: "other", source: "action", cause_code: classifyFailure(error) },
    });
    read();
  }

  function change(action: LibraryFolderAction): void {
    const base = shown;
    const send = untrack(calls).storage.changeLibraryFolders;
    if (!base || !send) return;
    let next: LibraryFoldersSnapshot | null = null;
    try {
      next = applyLibraryFolderAction(base, action, untrack(context));
    } catch (error) {
      if (!(error instanceof LibraryFolderRefusal)) throw error;
    }
    if (next === base) return;
    if (next) show(next);
    pending += 1;
    const id = run;
    const server = untrack(serverId);
    enqueue(async () => {
      try {
        const answer = await send(action, server);
        if (id !== run) return;
        pending -= 1;
        host = answer;
        if (pending === 0) show(answer);
      } catch (error) {
        if (id === run) fail(error);
      }
    });
  }

  return {
    ready,
    snapshot,
    reload: read,
    change,
  };
}
