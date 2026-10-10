import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type {
  EventRoutine,
  EventRoutineOwner,
  EventStatus,
  SaveEventRoutineInput,
} from "@openbot/contracts/ipc-events";
import { clone } from "./mock-support";

function sameOwner(left: EventRoutineOwner, right: EventRoutineOwner): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function mockSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `whsec_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** The preview host's event routines. Like the real host, it makes each webhook URL and secret itself. */
export function createMockEvents(): OpenBotDesktopApi["events"] {
  let routines: EventRoutine[] = [];
  let sequence = 0;
  const status: EventStatus = { supported: true, connected: true };
  const nextId = (prefix: string) => `${prefix}-${++sequence}`;
  const findRoutine = (id: string, owner: EventRoutineOwner) =>
    routines.find((routine) => routine.id === id && sameOwner(routine.owner, owner));

  return {
    getStatus: async () => clone(status),
    listRoutines: async ({ owner }) => clone(routines.filter((routine) => sameOwner(routine.owner, owner))),
    saveRoutine: async (input: SaveEventRoutineInput) => {
      const now = new Date().toISOString();
      const existing = input.id ? findRoutine(input.id, input.owner) : undefined;
      const id = existing?.id ?? input.id ?? nextId("routine");
      const wasWebhook = existing?.trigger.kind === "webhook";
      const secret = input.trigger.kind === "webhook" && !wasWebhook ? mockSecret() : null;
      const routine: EventRoutine = {
        id,
        owner: clone(input.owner),
        name: input.name,
        instruction: input.instruction,
        active: input.active,
        timezone: input.timezone,
        trigger:
          input.trigger.kind === "webhook"
            ? { ...clone(input.trigger), url: `https://hooks.example.test/openbot/${id}` }
            : clone(input.trigger),
        ...(input.limitPolicy === undefined ? {} : { limitPolicy: input.limitPolicy }),
        ...(input.missedPolicy === undefined ? {} : { missedPolicy: input.missedPolicy }),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      routines = existing ? routines.map((item) => (item.id === id ? routine : item)) : [routine, ...routines];
      return { routine: clone(routine), secret };
    },
    deleteRoutine: async ({ id, owner }) => {
      routines = routines.filter((routine) => !(routine.id === id && sameOwner(routine.owner, owner)));
    },
    testRoutine: async () => {},
    rotateSecret: async ({ id, owner }) => {
      const routine = findRoutine(id, owner);
      if (routine?.trigger.kind !== "webhook") throw new Error("This routine has no webhook trigger.");
      return { secret: mockSecret() };
    },
    // The preview host receives no webhook requests.
    listActivity: async () => [],
  };
}
