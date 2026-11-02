// Routine results: where an agent routine's answers go outside OpenBot, and what became of each one.
// Only this computer's host keeps a destination. These handlers have no remote route; a joined server's
// owner or admin uses `routine-results-v1` from the mobile app.

import { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { RoutineResultsHandle } from "../../backend/routine-results/routine-results";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import {
  parseResendRoutineResult,
  parseRoutineResultRoutine,
  parseSetRoutineResultDestination,
} from "./routine-result-inputs";

interface RoutineResultIpcDependencies {
  routineResults: RoutineResultsHandle;
}

export function routineResultIpcHandlers({
  routineResults,
}: RoutineResultIpcDependencies): Pick<IpcGroupHandlers, "routineResults"> {
  return {
    routineResults: {
      options: handler(() => Effect.runPromise(routineResults.options())),
      destination: payloadHandler(parseRoutineResultRoutine, (input) =>
        runCauseEffect(routineResults.destination(input)),
      ),
      setDestination: payloadHandler(parseSetRoutineResultDestination, (input) =>
        runCauseEffect(routineResults.setDestination(input)),
      ),
      deliveries: payloadHandler(parseRoutineResultRoutine, (input) =>
        runCauseEffect(routineResults.deliveries(input)),
      ),
      resend: payloadHandler(parseResendRoutineResult, (input) => runCauseEffect(routineResults.resend(input))),
    },
  };
}
