import { EVENTS_CAPABILITY, EVENTS_ROUTES } from "@openbot/contracts/team-protocol/events-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { type HostEventsApi, HostEventsFailure } from "./host-events-api";
import { createTeamApiFixture, stopTeamApiFixtures } from "./team-api-server-test-harness";

// @vitest-environment node

afterEach(stopTeamApiFixtures);

function unusedEvents(): HostEventsApi {
  const unused = () => Effect.fail(new HostEventsFailure({ cause: new Error("unused in this test") }));
  return {
    getStatus: () => Effect.succeed({ supported: true, connected: true }),
    listSources: unused,
    saveSource: unused,
    deleteSource: unused,
    listDestinations: unused,
    saveDestination: unused,
    deleteDestination: unused,
    listActivity: unused,
    retryDelivery: unused,
    listRoutines: unused,
    saveRoutine: unused,
    deleteRoutine: unused,
    testRoutine: unused,
  };
}

describe("Team API events-v1", () => {
  it("requires an administrator for event management routes", async () => {
    const fixture = await createTeamApiFixture("events-admin", { configure: true });
    const { base } = await fixture.start({ events: unusedEvents() });
    const ownerToken = await fixture.signIn();
    const invite = await Effect.runPromise(fixture.store.createInvite("member"));
    const member = await Effect.runPromise(fixture.store.acceptInvite(invite.token, "member", "member password"));
    const headers = {
      "Content-Type": "application/json",
      "OpenBot-Capabilities": EVENTS_CAPABILITY,
    };

    const response = await fetch(`${base}${EVENTS_ROUTES.status}`, {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${member.sessionToken}` },
      body: "{}",
    });
    expect(response.status).toBe(403);

    const unavailable = await fetch(`${base}${EVENTS_ROUTES.saveRoutine}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({
        owner: { kind: "agent", id: "chief" },
        name: "Routine",
        instruction: "Run it",
        active: true,
        timezone: "UTC",
        trigger: { kind: "event", sourceId: "source-1", eventType: "example.received", filters: [] },
      }),
    });
    expect(unavailable.status).toBe(400);

    const ownerResponse = await fetch(`${base}${EVENTS_ROUTES.status}`, {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${ownerToken}` },
      body: "{}",
    });
    expect(ownerResponse.status).toBe(200);
    expect(await ownerResponse.json()).toEqual({ supported: true, connected: true });
  });

  it("maps event failures to safe localized 400 responses", async () => {
    const fixture = await createTeamApiFixture("events-failure", { configure: true });
    const expected = sourceText("error.backend.eventSourceMissing");
    let cause: Error = new Error(expected);
    const events: HostEventsApi = {
      ...unusedEvents(),
      saveSource: () => Effect.fail(new HostEventsFailure({ cause })),
    };
    const { base } = await fixture.start({ events });
    const ownerToken = await fixture.signIn();
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ownerToken}`,
      "OpenBot-Capabilities": EVENTS_CAPABILITY,
    };
    const localized = await fetch(`${base}${EVENTS_ROUTES.saveSource}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Webhook", active: true }),
    });
    expect(localized.status).toBe(400);
    expect(await localized.json()).toEqual({ error: expected });

    const privateValue = "secret-value-that-must-not-cross-the-api";
    cause = new Error(`database failure: ${privateValue}`);
    const privateFailure = await fetch(`${base}${EVENTS_ROUTES.saveSource}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Webhook", active: true }),
    });
    expect(privateFailure.status).toBe(400);
    const body = await privateFailure.json();
    expect(body).toEqual({ error: sourceText("error.backend.webhookSettingsInvalid") });
    expect(JSON.stringify(body)).not.toContain(privateValue);

    const failure = new HostEventsFailure({ cause: new Error(expected) });
    await expect(Effect.runPromise(Effect.fail(failure))).rejects.toBeInstanceOf(HostEventsFailure);
  });
});
