import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type {
  EventActivity,
  EventRoutine,
  EventSource,
  EventStatus,
  SaveEventRoutineInput,
  SaveEventSourceInput,
  SaveWebhookDestinationInput,
  WebhookDestination,
} from "@openbot/contracts/ipc-events";
import { clone } from "./mock-support";

export function createMockEvents(): OpenBotDesktopApi["events"] {
  let sources: EventSource[] = [
    {
      id: "source-preview",
      name: "Preview webhook",
      active: true,
      url: "https://events.example.test/openbot/source-preview",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  let destinations: WebhookDestination[] = [];
  let routines: EventRoutine[] = [];
  const activity: EventActivity[] = [];
  const status: EventStatus = { supported: true, connected: true };
  return {
    getStatus: async () => clone(status),
    listSources: async () => clone(sources),
    saveSource: async (input: SaveEventSourceInput) => {
      const now = new Date().toISOString();
      const existing = input.id ? sources.find((source) => source.id === input.id) : undefined;
      const source: EventSource = {
        id: input.id ?? `source-${sources.length + 1}`,
        name: input.name,
        active: input.active,
        url: existing?.url ?? `https://events.example.test/source-${sources.length + 1}`,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      sources = existing ? sources.map((item) => (item.id === source.id ? source : item)) : [source, ...sources];
      return clone(source);
    },
    deleteSource: async ({ id }) => {
      sources = sources.filter((source) => source.id !== id);
    },
    listDestinations: async () => clone(destinations),
    saveDestination: async (input: SaveWebhookDestinationInput) => {
      const now = new Date().toISOString();
      const existing = input.id ? destinations.find((destination) => destination.id === input.id) : undefined;
      const destination: WebhookDestination = {
        id: input.id ?? `destination-${destinations.length + 1}`,
        name: input.name,
        active: input.active,
        url: input.url,
        method: input.method,
        eventTypes: [...input.eventTypes],
        routineIds: [...input.routineIds],
        payloadTemplate: clone(input.payloadTemplate),
        hasSecret: input.secret !== undefined || existing?.hasSecret === true,
        headerNames: input.headers ? Object.keys(input.headers) : (existing?.headerNames ?? []),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      destinations = existing
        ? destinations.map((item) => (item.id === destination.id ? destination : item))
        : [destination, ...destinations];
      return clone(destination);
    },
    deleteDestination: async ({ id }) => {
      destinations = destinations.filter((destination) => destination.id !== id);
    },
    listActivity: async () => clone(activity),
    retryDelivery: async () => undefined,
    listRoutines: async ({ owner }) =>
      clone(routines.filter((routine) => routine.owner.kind === owner.kind && routine.owner.id === owner.id)),
    saveRoutine: async (input: SaveEventRoutineInput) => {
      const now = new Date().toISOString();
      const existing = input.id ? routines.find((routine) => routine.id === input.id) : undefined;
      const routine: EventRoutine = {
        id: input.id ?? `routine-${routines.length + 1}`,
        owner: clone(input.owner),
        name: input.name,
        instruction: input.instruction,
        active: input.active,
        timezone: input.timezone,
        trigger: clone(input.trigger),
        ...(input.limitPolicy === undefined ? {} : { limitPolicy: input.limitPolicy }),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      routines = existing ? routines.map((item) => (item.id === routine.id ? routine : item)) : [routine, ...routines];
      return clone(routine);
    },
    deleteRoutine: async ({ id }) => {
      routines = routines.filter((routine) => routine.id !== id);
    },
    testRoutine: async () => undefined,
  };
}
