import type { SpeechModelFile } from "@openbot/contracts/speech-models";
import { Directory, File } from "expo-file-system";
import { create } from "zustand";
import { speechNative } from "./speech-native";

type ModelPhase = "unknown" | "missing" | "downloading" | "ready" | "error";

export interface ModelState {
  phase: ModelPhase;
  /** 0 to 1 while it downloads. */
  progress: number;
  /** Why the last download failed: a network failure, a file that did not match, or no room. */
  failure: "download" | "verify" | null;
}

/**
 * One voice model that the phone downloads: its files, the state of the download, and the actions of
 * Settings > Voice. The model lives where the phone does not clear it when it needs room and does not
 * back it up, so the download stays until the user removes it. A verified file is marked, so the
 * check at startup does not hash the files again. Without the native module there is no model to keep.
 */
export function createModelDownload(options: {
  directory: string;
  files: readonly SpeechModelFile[];
  /** Lets go of the model files before they are deleted. */
  unload: () => Promise<void>;
}) {
  const bytes = options.files.reduce((total, file) => total + file.bytes, 0);
  const useModel = create<ModelState>(() => ({ phase: "unknown", progress: 0, failure: null }));
  let download: AbortController | null = null;

  function modelDirectory(): Directory | null {
    return speechNative ? new Directory(speechNative.modelRoot(), options.directory) : null;
  }

  const markerOf = (directory: Directory) => new File(directory, ".verified");

  /** Stops a download. The files that finished stay, so the next download goes on from them. */
  function cancel(): void {
    download?.abort();
  }

  return {
    /** The download size of all files of the model. */
    bytes,
    useModel,

    /** The model directory as a file URI, for the native module. Null until the model is ready. */
    uri(): string | null {
      return useModel.getState().phase === "ready" ? (modelDirectory()?.uri ?? null) : null;
    },

    /** Reads whether the model is on the phone, once at startup and after a removal. */
    check(): void {
      const directory = modelDirectory();
      const ready =
        directory !== null &&
        markerOf(directory).exists &&
        options.files.every((file) => new File(directory, file.name).exists);
      if (useModel.getState().phase !== "downloading")
        useModel.setState({ phase: ready ? "ready" : "missing", progress: ready ? 1 : 0 });
    },

    /**
     * Downloads the files that are missing or do not match their pinned SHA-256, the same files
     * desktop downloads. The phone keeps a file that matches, so a download that stopped goes on
     * from there.
     */
    async download(): Promise<void> {
      const directory = modelDirectory();
      if (download || !directory) return;
      const controller = new AbortController();
      download = controller;
      useModel.setState({ phase: "downloading", progress: 0, failure: null });
      let done = 0;
      try {
        directory.create({ intermediates: true, idempotent: true });
        if (markerOf(directory).exists) markerOf(directory).delete();
        for (const item of options.files) {
          const file = new File(directory, item.name);
          if (!(file.exists && file.size === item.bytes && (await file.digest("SHA-256")) === item.sha256)) {
            const partial = new File(directory, `${item.name}.download`);
            if (partial.exists) partial.delete();
            await File.downloadFileAsync(item.url, partial, {
              idempotent: true,
              signal: controller.signal,
              onProgress: ({ bytesWritten }) => useModel.setState({ progress: (done + bytesWritten) / bytes }),
            });
            if ((await partial.digest("SHA-256")) !== item.sha256) {
              partial.delete();
              useModel.setState({ phase: "error", failure: "verify" });
              return;
            }
            if (file.exists) file.delete();
            await partial.move(file);
          }
          done += item.bytes;
          useModel.setState({ progress: done / bytes });
        }
        markerOf(directory).create();
        useModel.setState({ phase: "ready", progress: 1 });
      } catch {
        useModel.setState(
          controller.signal.aborted ? { phase: "missing", progress: 0 } : { phase: "error", failure: "download" },
        );
      } finally {
        download = null;
      }
    },

    cancel,

    /** Deletes the model from the phone. The native module lets go of its files first. */
    async remove(): Promise<void> {
      cancel();
      await options.unload();
      const directory = modelDirectory();
      if (directory?.exists) directory.delete();
      useModel.setState({ phase: "missing", progress: 0, failure: null });
    },
  };
}

export type ModelDownload = ReturnType<typeof createModelDownload>;
