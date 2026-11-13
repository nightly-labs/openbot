// Routine results: where an agent routine's answers go outside OpenBot, and what became of each one.
// A joined server's owner or admin reads the host's connections and reads and sets a destination
// through `routine-results-v1`. That contract keeps the deliveries and a second send on the host's
// own computer, so `deliveries` and `resend` reach this computer only.

import { decodeRoutineResultConnectionOptions, decodeRoutineResultDestinationAnswer } from "@openbot/contracts/ipc";
import {
  ROUTINE_RESULTS_CAPABILITY,
  ROUTINE_RESULTS_ROUTES,
} from "@openbot/contracts/team-protocol/routine-results-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { RoutineResultsHandle } from "../../backend/routine-results/routine-results";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import {
  parseResendRoutineResult,
  parseRoutineResultRoutine,
  parseSetRoutineResultDestination,
} from "./routine-result-inputs";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

interface RoutineResultIpcDependencies {
  routineResults: RoutineResultsHandle;
  remoteServers: Pick<RemoteServerManager, "request" | "supportsCapability">;
}

export function routineResultIpcHandlers({
  routineResults,
  remoteServers,
}: RoutineResultIpcDependencies): Pick<IpcGroupHandlers, "routineResults"> {
  /** The renderer offers a joined server's destinations only while the host serves `routine-results-v1`. */
  function remote<T>(serverId: string, path: string, body: unknown, decoder: ResponseDecoder<T>): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, ROUTINE_RESULTS_CAPABILITY))
      throw new Error(sourceText("error.team.routineResultsUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }
  return {
    routineResults: {
      options: scopedQueryHandler({
        local: () => Effect.runPromise(routineResults.options()),
        remote: (serverId) =>
          remote(serverId, ROUTINE_RESULTS_ROUTES.options, {}, decodeRoutineResultConnectionOptions),
      }),
      destination: scopedHandler(parseRoutineResultRoutine, {
        local: (input) => runCauseEffect(routineResults.destination(input)),
        remote: (input, serverId) =>
          remote(serverId, ROUTINE_RESULTS_ROUTES.destination, input, decodeRoutineResultDestinationAnswer),
      }),
      setDestination: scopedHandler(parseSetRoutineResultDestination, {
        local: (input) => runCauseEffect(routineResults.setDestination(input)),
        remote: (input, serverId) =>
          remote(serverId, ROUTINE_RESULTS_ROUTES.setDestination, input, decodeRoutineResultDestinationAnswer),
      }),
      deliveries: payloadHandler(parseRoutineResultRoutine, (input) =>
        runCauseEffect(routineResults.deliveries(input)),
      ),
      resend: payloadHandler(parseResendRoutineResult, (input) => runCauseEffect(routineResults.resend(input))),
    },
  };
}
