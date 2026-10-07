import { EVENTS_CAPABILITY, EVENTS_ROUTES } from "@openbot/contracts/team-protocol/events-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { type HostEventsApi, HostEventsFailure, hostEventsFailureMessage } from "../host-events-api";
import {
  parseEventDeliveryId,
  parseEventRoutineAction,
  parseListEventActivity,
  parseListEventRoutines,
  parseSaveEventRoutine,
  parseSaveEventSource,
  parseSaveWebhookDestination,
  requiredEventString,
} from "../host-events-inputs";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

export interface EventsRouteDependencies {
  events?: HostEventsApi;
}

async function runEventsEffect<A>(operation: Effect.Effect<A, HostEventsFailure>): Promise<A> {
  try {
    return await Effect.runPromise(operation);
  } catch (error) {
    if (error instanceof HostEventsFailure) {
      throw new HttpError(400, hostEventsFailureMessage(error));
    }
    throw error;
  }
}

function parseEventsInput<A>(parse: () => A): A {
  try {
    return parse();
  } catch {
    throw new HttpError(400, sourceText("error.backend.webhookSettingsInvalid"));
  }
}

export async function routeEvents(
  context: TeamApiRequestContext,
  { events }: EventsRouteDependencies,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const path = url.pathname;
  const isEventRoute = new Set<string>(Object.values(EVENTS_ROUTES)).has(path);
  if (!isEventRoute || method !== "POST") return "unmatched";
  if (!events || !capabilities.has(EVENTS_CAPABILITY)) {
    throw new HttpError(400, sourceText("error.backend.eventsUnavailable"));
  }
  requireAdmin(member);
  const body = await readJson(request);
  if (path === EVENTS_ROUTES.status) return json(200, await runEventsEffect(events.getStatus()));
  if (path === EVENTS_ROUTES.listSources) return json(200, await runEventsEffect(events.listSources()));
  if (path === EVENTS_ROUTES.saveSource) {
    return json(200, await runEventsEffect(events.saveSource(parseEventsInput(() => parseSaveEventSource(body)))));
  }
  if (path === EVENTS_ROUTES.deleteSource) {
    await runEventsEffect(
      events.deleteSource({ id: parseEventsInput(() => requiredEventString(body.id, "source id", 128)) }),
    );
    return json(200, {});
  }
  if (path === EVENTS_ROUTES.listDestinations) return json(200, await runEventsEffect(events.listDestinations()));
  if (path === EVENTS_ROUTES.saveDestination) {
    return json(
      200,
      await runEventsEffect(events.saveDestination(parseEventsInput(() => parseSaveWebhookDestination(body)))),
    );
  }
  if (path === EVENTS_ROUTES.deleteDestination) {
    await runEventsEffect(
      events.deleteDestination({ id: parseEventsInput(() => requiredEventString(body.id, "destination id", 128)) }),
    );
    return json(200, {});
  }
  if (path === EVENTS_ROUTES.listActivity) {
    return json(200, await runEventsEffect(events.listActivity(parseEventsInput(() => parseListEventActivity(body)))));
  }
  if (path === EVENTS_ROUTES.retryDelivery) {
    await runEventsEffect(events.retryDelivery(parseEventsInput(() => parseEventDeliveryId(body))));
    return json(200, {});
  }
  if (path === EVENTS_ROUTES.listRoutines) {
    return json(200, await runEventsEffect(events.listRoutines(parseEventsInput(() => parseListEventRoutines(body)))));
  }
  if (path === EVENTS_ROUTES.saveRoutine) {
    return json(200, await runEventsEffect(events.saveRoutine(parseEventsInput(() => parseSaveEventRoutine(body)))));
  }
  if (path === EVENTS_ROUTES.deleteRoutine) {
    await runEventsEffect(events.deleteRoutine(parseEventsInput(() => parseEventRoutineAction(body))));
    return json(200, {});
  }
  if (path === EVENTS_ROUTES.testRoutine) {
    await runEventsEffect(events.testRoutine(parseEventsInput(() => parseEventRoutineAction(body))));
    return json(200, {});
  }
  return "unmatched";
}
