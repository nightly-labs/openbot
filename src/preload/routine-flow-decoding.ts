// What main answers for routine flows: one agent's canvas, a new link, and which canvases changed.

import { isRoutineFlowCanvas, isRoutineFlowLink, isRoutineFlowsChanged } from "@openbot/contracts/ipc";
import { guardedDecoder } from "@openbot/contracts/ipc-decoding";

export const decodeRoutineFlowCanvas = guardedDecoder(isRoutineFlowCanvas, "routine flow canvas response");
export const decodeRoutineFlowLink = guardedDecoder(isRoutineFlowLink, "routine flow link response");
export const decodeRoutineFlowsChanged = guardedDecoder(isRoutineFlowsChanged, "routine flows change event");
