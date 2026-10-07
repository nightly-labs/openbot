import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type {
  EventActivity,
  EventRoutine,
  EventRoutineOwner,
  EventStatus,
  SaveEventRoutineInput,
  SaveWebhookDestinationInput,
  WebhookDestination,
} from "@openbot/contracts/ipc-events";
import { clone } from "./mock-support";

type StoredDestination = WebhookDestination & { owner: EventRoutineOwner };
type StoredActivity = EventActivity & { routineId: string };

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
  let destinations: StoredDestination[] = [];
  let activity: StoredActivity[] = [];
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
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      routines = existing ? routines.map((item) => (item.id === id ? routine : item)) : [routine, ...routines];
      return { routine: clone(routine), secret };
    },
    deleteRoutine: async ({ id, owner }) => {
      routines = routines.filter((routine) => !(routine.id === id && sameOwner(routine.owner, owner)));
      destinations = destinations.filter((destination) => destination.routineId !== id);
      activity = activity.filter((item) => item.routineId !== id);
    },
    testRoutine: async ({ id, owner }) => {
      const runId = nextId("run");
      const occurredAt = new Date().toISOString();
      for (const destination of destinations) {
        if (destination.routineId !== id || !sameOwner(destination.owner, owner) || !destination.active) continue;
        if (!destination.eventTypes.includes("routine.run.started")) continue;
        activity = [
          {
            kind: "delivery",
            id: nextId("delivery"),
            routineId: id,
            destinationId: destination.id,
            eventType: "routine.run.started",
            status: "succeeded",
            attempt: 1,
            statusCode: 200,
            runId,
            occurredAt,
          },
          ...activity,
        ];
      }
    },
    rotateSecret: async ({ id, owner }) => {
      const routine = findRoutine(id, owner);
      if (routine?.trigger.kind !== "webhook") throw new Error("This routine has no webhook trigger.");
      return { secret: mockSecret() };
    },
    listDestinations: async ({ owner, routineId }) =>
      clone(
        destinations
          .filter((destination) => destination.routineId === routineId && sameOwner(destination.owner, owner))
          .map(({ owner: _owner, ...destination }) => destination),
      ),
    saveDestination: async (input: SaveWebhookDestinationInput) => {
      const now = new Date().toISOString();
      const existing = input.id ? destinations.find((destination) => destination.id === input.id) : undefined;
      const destination: StoredDestination = {
        id: existing?.id ?? nextId("destination"),
        owner: clone(input.owner),
        routineId: input.routineId,
        active: input.active,
        url: input.url,
        method: input.method,
        eventTypes: [...input.eventTypes],
        payloadTemplate: clone(input.payloadTemplate),
        // Left out keeps the stored secret, an empty string removes it.
        hasSecret: input.secret === undefined ? existing?.hasSecret === true : input.secret !== "",
        headerNames: input.headers ? Object.keys(input.headers) : (existing?.headerNames ?? []),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      destinations = existing
        ? destinations.map((item) => (item.id === destination.id ? destination : item))
        : [destination, ...destinations];
      const { owner: _owner, ...result } = destination;
      return clone(result);
    },
    deleteDestination: async ({ id, routineId }) => {
      destinations = destinations.filter(
        (destination) => !(destination.id === id && destination.routineId === routineId),
      );
    },
    listActivity: async ({ routineId, limit }) =>
      clone(
        activity
          .filter((item) => item.routineId === routineId)
          .slice(0, limit ?? 100)
          .map(({ routineId: _routineId, ...item }) => item),
      ),
    retryDelivery: async ({ id, routineId }) => {
      activity = activity.map((item) =>
        item.kind === "delivery" && item.id === id && item.routineId === routineId
          ? { ...item, status: "succeeded", attempt: item.attempt + 1, statusCode: 200 }
          : item,
      );
    },
  };
}
