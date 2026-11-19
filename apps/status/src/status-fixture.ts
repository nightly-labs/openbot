import { HISTORY_DAYS, type Incident, SERVICE_IDS, type ServiceId, type StatusFile, statusDates } from "./model";

export const FIXTURE_NOW = "2026-10-16T10:05:00Z";

const ISSUES = "https://github.com/nightly-labs/openbot/issues";

const INCIDENTS: readonly Incident[] = [
  {
    id: 2412,
    url: `${ISSUES}/2412`,
    title: "Marketplace pages load slowly",
    kind: "incident",
    impact: "degraded",
    components: ["marketplace"],
    startedAt: "2026-10-16T09:12:00Z",
    resolvedAt: null,
    updates: [
      {
        at: "2026-10-16T09:41:00Z",
        stage: "identified",
        body: "A slow query on the search index causes the delay. We are deploying a fix.",
      },
      {
        at: "2026-10-16T09:12:00Z",
        stage: "investigating",
        body: "Marketplace pages and skill search take up to 20 seconds to load. Installed agents and skills work.",
      },
    ],
  },
  {
    id: 2409,
    url: `${ISSUES}/2409`,
    title: "Connections server upgrade",
    kind: "maintenance",
    impact: "maintenance",
    components: ["connections"],
    startedAt: "2026-10-20T06:00:00Z",
    resolvedAt: "2026-10-20T06:30:00Z",
    updates: [
      {
        at: "2026-10-15T14:00:00Z",
        stage: "scheduled",
        body: "Phones and teammates can disconnect for up to one minute. They connect again without action.",
      },
    ],
  },
  {
    id: 2371,
    url: `${ISSUES}/2371`,
    title: "Phones and teammates could not connect",
    kind: "incident",
    impact: "partial",
    components: ["connections"],
    startedAt: "2026-10-11T07:10:00Z",
    resolvedAt: "2026-10-11T08:05:00Z",
    updates: [
      { at: "2026-10-11T08:05:00Z", stage: "resolved", body: "All connections work again." },
      { at: "2026-10-11T07:52:00Z", stage: "monitoring", body: "We raised the limit. Connections are coming back." },
      {
        at: "2026-10-11T07:38:00Z",
        stage: "identified",
        body: "The connection server reached its limit of open connections.",
      },
      {
        at: "2026-10-11T07:10:00Z",
        stage: "investigating",
        body: "Some connections to servers fail or close after a few seconds. Work on your own computer is not affected.",
      },
    ],
  },
  {
    id: 2360,
    url: `${ISSUES}/2360`,
    title: "Some hosted servers stayed at “Starting”",
    kind: "incident",
    impact: "partial",
    components: ["hosted", "connections"],
    startedAt: "2026-10-10T13:20:00Z",
    resolvedAt: "2026-10-10T16:45:00Z",
    updates: [
      { at: "2026-10-10T16:45:00Z", stage: "resolved", body: "All affected servers are connected again." },
      {
        at: "2026-10-10T14:30:00Z",
        stage: "identified",
        body: "After a restart of the connection server, some hosted servers did not connect again. To fix it now, restart the server in Settings → Hosted servers.",
      },
      {
        at: "2026-10-10T13:20:00Z",
        stage: "investigating",
        body: "Some hosted servers show “Starting” and do not open.",
      },
    ],
  },
  {
    id: 2288,
    url: `${ISSUES}/2288`,
    title: "Account database maintenance",
    kind: "maintenance",
    impact: "maintenance",
    components: ["accounts"],
    startedAt: "2026-09-22T02:00:00Z",
    resolvedAt: "2026-09-22T02:30:00Z",
    updates: [
      { at: "2026-09-22T02:30:00Z", stage: "completed", body: "The maintenance is complete." },
      {
        at: "2026-09-18T10:00:00Z",
        stage: "scheduled",
        body: "Sign-in can be slow for up to 30 minutes. Servers that are open stay connected.",
      },
    ],
  },
  {
    id: 2241,
    url: `${ISSUES}/2241`,
    title: "Sign-in failed for new accounts",
    kind: "incident",
    impact: "major",
    components: ["accounts"],
    startedAt: "2026-09-03T18:40:00Z",
    resolvedAt: "2026-09-03T19:05:00Z",
    updates: [
      { at: "2026-09-03T19:05:00Z", stage: "resolved", body: "We rolled back the release. New accounts can sign in." },
      {
        at: "2026-09-03T18:40:00Z",
        stage: "investigating",
        body: "New accounts get an error after the email code. Accounts that are signed in are not affected.",
      },
    ],
  },
  {
    id: 2187,
    url: `${ISSUES}/2187`,
    title: "Desktop updates downloaded slowly",
    kind: "incident",
    impact: "degraded",
    components: ["updates"],
    startedAt: "2026-08-14T11:00:00Z",
    resolvedAt: "2026-08-14T12:30:00Z",
    updates: [
      { at: "2026-08-14T12:30:00Z", stage: "resolved", body: "Downloads are at full speed again." },
      {
        at: "2026-08-14T11:00:00Z",
        stage: "investigating",
        body: "Update downloads for Windows and Linux are slow. The update still installs.",
      },
    ],
  },
];

const FAILED: Partial<Record<ServiceId, Record<string, number>>> = {
  connections: { "2026-10-11": 55, "2026-10-10": 20 },
  hosted: { "2026-10-10": 205 },
  accounts: { "2026-09-03": 25 },
};
const DEGRADED: Partial<Record<ServiceId, Record<string, number>>> = {
  marketplace: { "2026-10-16": 50 },
  updates: { "2026-08-14": 90 },
};

const CHECKED_DAYS = 75;

function fixture(): StatusFile {
  const dates = statusDates(HISTORY_DAYS, FIXTURE_NOW).slice(-CHECKED_DAYS);
  const today = FIXTURE_NOW.slice(0, 10);
  const todayMinutes = (Date.parse(FIXTURE_NOW) - Date.parse(`${today}T00:00:00Z`)) / 60_000;
  return {
    version: 1,
    checkedAt: "2026-10-16T10:02:00Z",
    services: SERVICE_IDS.map((id) => ({
      id,
      result: id === "marketplace" ? "degraded" : "ok",
      days: dates.map((date) => {
        const minutes = date === today ? todayMinutes : 1440;
        return {
          date,
          checks: Math.round(minutes / 5),
          minutes,
          failedMinutes: FAILED[id]?.[date] ?? 0,
          degradedMinutes: DEGRADED[id]?.[date] ?? 0,
        };
      }),
    })),
    incidents: INCIDENTS,
  };
}

export const STATUS_FIXTURE = fixture();

export const ALL_CLEAR_FIXTURE: StatusFile = {
  ...STATUS_FIXTURE,
  services: STATUS_FIXTURE.services.map((service) => ({ ...service, result: "ok" })),
  incidents: INCIDENTS.filter((incident) => incident.resolvedAt !== null && incident.resolvedAt < FIXTURE_NOW),
};
