import { join } from "node:path";
import { utilityProcess } from "electron";
import { RoutineFlowDiscovery } from "../backend/routine-flows/routine-flow-discovery";

/** The packaged app uses a killable utility process; the runAsNode fuse stays disabled. */
export function createRoutineFlowDiscovery(
  userDataPath: string,
  kind: "flow" | "result" = "flow",
): RoutineFlowDiscovery {
  return new RoutineFlowDiscovery({
    spawn: () => {
      const child = utilityProcess.fork(
        join(__dirname, "routine-flow-discovery-host.js"),
        [join(userDataPath, "openbot.db")],
        {
          serviceName: kind === "result" ? "OpenBot routine result discovery" : "OpenBot routine flow discovery",
          stdio: "ignore",
        },
      );
      return {
        send: (request) => child.postMessage(request),
        onMessage: (listener) => {
          child.on("message", listener);
          return () => child.removeListener("message", listener);
        },
        onExit: (listener) => {
          child.on("exit", listener);
          return () => child.removeListener("exit", listener);
        },
        kill: () => {
          child.kill();
        },
      };
    },
  });
}
