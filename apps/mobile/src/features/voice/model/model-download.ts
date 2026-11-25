import type { SpeechModelFile } from "@openbot/contracts/speech-models";
import { Directory, type DownloadProgress, File } from "expo-file-system";
import { Platform } from "react-native";
import { create } from "zustand";
import { speechNative } from "./speech-native";

async function transferFile(
  url: string,
  destination: File,
  signal: AbortSignal,
  onBytesWritten: (bytesWritten: number) => void,
): Promise<void> {
  const onProgress = ({ bytesWritten }: DownloadProgress) => onBytesWritten(Number(bytesWritten));
  if (Platform.OS === "ios")
    await File.createDownloadTask(url, destination, { sessionType: "background", signal, onProgress }).downloadAsync();
  else await File.downloadFileAsync(url, destination, { idempotent: true, signal, onProgress });
}

type ModelPhase = "unknown" | "missing" | "downloading" | "ready" | "error";

export interface ModelState {
  phase: ModelPhase;
  progress: number;
  failure: "download" | "verify" | null;
}

export function createModelDownload(options: {
  directory: string;
  files: readonly SpeechModelFile[];
  unload: () => Promise<void>;
}) {
  const bytes = options.files.reduce((total, file) => total + file.bytes, 0);
  const useModel = create<ModelState>(() => ({ phase: "unknown", progress: 0, failure: null }));
  let download: AbortController | null = null;

  function modelDirectory(): Directory | null {
    return speechNative ? new Directory(speechNative.modelRoot(), options.directory) : null;
  }

  const markerOf = (directory: Directory) => new File(directory, ".verified");

  function cancel(): void {
    download?.abort();
  }

  return {
    bytes,
    useModel,

    uri(): string | null {
      return useModel.getState().phase === "ready" ? (modelDirectory()?.uri ?? null) : null;
    },

    check(): void {
      const directory = modelDirectory();
      const ready =
        directory !== null &&
        markerOf(directory).exists &&
        options.files.every((file) => new File(directory, file.name).exists);
      if (useModel.getState().phase !== "downloading")
        useModel.setState({ phase: ready ? "ready" : "missing", progress: ready ? 1 : 0 });
    },

    async download(): Promise<void> {
      const directory = modelDirectory();
      if (download || !directory) return;
      const controller = new AbortController();
      download = controller;
      useModel.setState({ phase: "downloading", progress: 0, failure: null });
      const written = options.files.map(() => 0);
      const showProgress = () =>
        useModel.setState({ progress: written.reduce((sum, value) => sum + value, 0) / bytes });
      try {
        directory.create({ intermediates: true, idempotent: true });
        if (markerOf(directory).exists) markerOf(directory).delete();
        const missing: { item: SpeechModelFile; index: number; file: File }[] = [];
        for (const [index, item] of options.files.entries()) {
          const file = new File(directory, item.name);
          if (file.exists && file.size === item.bytes && (await file.digest("SHA-256")) === item.sha256)
            written[index] = item.bytes;
          else missing.push({ item, index, file });
        }
        showProgress();
        const transfers = missing.map(({ item, index, file }) => {
          const partial = new File(directory, `${item.name}.download`);
          if (partial.exists) partial.delete();
          const done = transferFile(item.url, partial, controller.signal, (bytesWritten) => {
            written[index] = bytesWritten;
            showProgress();
          });
          done.catch(() => {});
          return { item, index, file, partial, done };
        });
        for (const { item, index, file, partial, done } of transfers) {
          await done;
          if ((await partial.digest("SHA-256")) !== item.sha256) {
            partial.delete();
            useModel.setState({ phase: "error", failure: "verify" });
            return;
          }
          if (file.exists) file.delete();
          await partial.move(file);
          written[index] = item.bytes;
          showProgress();
        }
        markerOf(directory).create();
        useModel.setState({ phase: "ready", progress: 1 });
      } catch {
        useModel.setState(
          controller.signal.aborted ? { phase: "missing", progress: 0 } : { phase: "error", failure: "download" },
        );
      } finally {
        controller.abort();
        download = null;
      }
    },

    cancel,

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
