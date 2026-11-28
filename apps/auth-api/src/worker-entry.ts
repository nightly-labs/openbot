import startHandler from "@tanstack/solid-start/server-entry";
import "./router";
import { createWorkerHandler } from "./server/worker-handler";

export { HostState } from "./server/host-state-object";

export default createWorkerHandler(startHandler.fetch);
