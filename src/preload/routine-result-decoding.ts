import {
  isNullableRoutineResultDestination,
  isRoutineResultConnectionOptions,
  isRoutineResultDeliveries,
} from "@openbot/contracts/ipc";
import { guardedDecoder } from "@openbot/contracts/ipc-decoding";

export const decodeRoutineResultOptions = guardedDecoder(
  isRoutineResultConnectionOptions,
  "routine result options response",
);
export const decodeRoutineResultDestination = guardedDecoder(
  isNullableRoutineResultDestination,
  "routine result destination response",
);
export const decodeRoutineResultDeliveries = guardedDecoder(
  isRoutineResultDeliveries,
  "routine result deliveries response",
);
