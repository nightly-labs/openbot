import { Worker } from "node:worker_threads";
import { decodeHostAnalytics, type HostAnalytics, type HostAnalyticsInput } from "@openbot/contracts/ipc";
import { Effect, Schema, Semaphore } from "effect";

export interface UsageReportWorkerSource {
  readonly databasePath: string;
  readonly workerPath: string;
}

class UsageReportWorkerFailed extends Schema.TaggedError<UsageReportWorkerFailed>()("UsageReportWorkerFailed", {
  cause: Schema.Defect(),
}) {}

const workerPermits = Semaphore.makeUnsafe(2);

export const readUsageReportInWorker = (source: UsageReportWorkerSource, input: HostAnalyticsInput) =>
  workerPermits.withPermits(1)(
    Effect.callback<HostAnalytics, UsageReportWorkerFailed>((resume) => {
      let worker: Worker;
      try {
        worker = new Worker(source.workerPath, { workerData: { databasePath: source.databasePath, input } });
      } catch (cause) {
        resume(Effect.fail(new UsageReportWorkerFailed({ cause })));
        return;
      }
      worker.once("message", (report: unknown) =>
        resume(
          Effect.try({
            try: () => decodeHostAnalytics(report),
            catch: (cause) => new UsageReportWorkerFailed({ cause }),
          }),
        ),
      );
      worker.once("error", (cause) => resume(Effect.fail(new UsageReportWorkerFailed({ cause }))));
      worker.once("exit", (exitCode) => resume(Effect.fail(new UsageReportWorkerFailed({ cause: exitCode }))));
      return Effect.promise(async () => {
        await worker.terminate();
      });
    }),
  );
