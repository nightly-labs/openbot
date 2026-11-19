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

/**
 * The Library folders of one server. The host holds them; this keeps the snapshot that the page
 * shows. A change shows at once, then goes to the host, and the answer of the host replaces the
 * snapshot. When the host refuses a change, the last snapshot of the host comes back with an error.
 *
 * `context` is what the folder rules need and the snapshot does not hold: the agents of the server and
 * the agent of each file.
 */
export function createLibraryFolders(
  serverId: () => string,
  context: () => LibraryFolderContext,
  calls: () => FilesPort = filesPort,
) {
  /** The first read for this server has an answer. Before it, the page does not know which Library to show. */
  const [ready, setReady] = createSignal(false);
  /** Null: the host has no folders (a client or a server before `library-folders-v1`). */
  const [snapshot, setSnapshot] = createSignal<LibraryFoldersSnapshot | null>(null);
  /** The last snapshot that the host sent. */
  let host: LibraryFoldersSnapshot | null = null;
  /** The snapshot on the screen: the host snapshot and the changes that wait for an answer. */
  let shown: LibraryFoldersSnapshot | null = null;
  /** The changes that wait for the host. A read does not replace the screen while one waits. */
  let pending = 0;
  /** Goes up when the server changes or a change fails. The work of an older run is dropped. */
  let run = 0;
  /** The host gets one request at a time, in the sequence of the user's actions. */
  let queue: Promise<void> = Promise.resolve();
  /** A read is in the queue and has not started. A second one would read the same data. */
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
        // The first read failed: the Library shows with no folders. A later read keeps the folders it has.
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
    // A change on another device, or by an agent, reaches this page at once. The read waits behind
    // the changes of this page, and their answers are newer than the event.
    return untrack(calls).onLibraryFoldersChanged?.(server, read);
  });

  /** A change failed: the changes after it were made on top of it, so they go too. */
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
    // Another member can be the cause, so the host tells what it has now.
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
      // This client can know less than the host, for example before the agents load. The host decides.
      if (!(error instanceof LibraryFolderRefusal)) throw error;
    }
    // The action changes nothing.
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
    /** The first read for this server has an answer. */
    ready,
    /** The folders to show, or null when the host has none. */
    snapshot,
    /** Reads the folders again, for example after the files of the server changed. */
    reload: read,
    change,
  };
}
