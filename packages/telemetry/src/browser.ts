import { Effect } from "effect";
import { type ReportStorage, TelemetryFailure, telemetryIO } from "./queue";

/** Each application surface has one queue in its own origin. */
export function indexedReportStorage(name: string): ReportStorage {
  const transaction = (mode: "read" | "write" | "clear", value?: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const open = indexedDB.open(name, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore("reports");
      };
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error("Telemetry storage unavailable."));
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("reports", mode === "read" ? "readonly" : "readwrite");
        const store = tx.objectStore("reports");
        const key = "pending";
        const request = mode === "clear" ? store.clear() : mode === "write" ? store.put(value, key) : store.get(key);
        tx.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
      };
    });
  return {
    acquire: () =>
      Effect.callback<() => void, TelemetryFailure>((resume, signal) => {
        if (!navigator.locks) {
          resume(Effect.fail(new TelemetryFailure()));
          return;
        }
        void navigator.locks
          .request(
            name,
            { signal },
            () =>
              new Promise<void>((release) => {
                resume(Effect.succeed(release));
              }),
          )
          .catch(() => resume(Effect.fail(new TelemetryFailure())));
      }),
    read: () => telemetryIO(() => transaction("read")),
    clear: () =>
      telemetryIO(async () => {
        await transaction("clear");
      }),
    write: (value) =>
      telemetryIO(async () => {
        await transaction("write", value);
      }),
  };
}
