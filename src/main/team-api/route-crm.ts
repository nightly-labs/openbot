import type { CrmActor, CrmCustomerPage, CrmOverview } from "@openbot/contracts/ipc";
import { CRM_CAPABILITY, CRM_ROUTES } from "@openbot/contracts/team-protocol/crm-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { CrmError } from "../../backend/crm/crm-handle";
import {
  parseCrmActivityPage,
  parseCrmChange,
  parseCrmCustomerPage,
  parseCrmPaymentPage,
  parseCrmSettings,
  parseCrmSource,
  parseCrmSourceConnect,
} from "../ipc/crm-inputs";
import type { TeamApiCrm } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, WEBRTC_FRAME_BODY_BUDGET } from "./request-helpers";

const CRM_PATHS: ReadonlySet<string> = new Set(Object.values(CRM_ROUTES));
const ACTOR_NAME_LIMIT = 200;

function parse<A>(decode: (value: unknown) => A, body: unknown): A {
  try {
    return decode(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid CRM request.");
  }
}

async function run<A>(operation: Effect.Effect<A, CrmError>): Promise<A> {
  try {
    return await Effect.runPromise(operation);
  } catch (error) {
    if (error instanceof CrmError) throw new HttpError(error.code === "missing" ? 404 : 400, error.message);
    throw error;
  }
}

function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function cutToFrame<T>(items: readonly T[], bytes: number): T[] {
  const kept = [...items];
  while (kept.length > 1 && bytes > WEBRTC_FRAME_BODY_BUDGET) bytes -= bytesOf(kept.pop()) + 1;
  return kept;
}

function fittedCustomers(page: CrmCustomerPage): CrmCustomerPage {
  const bytes = bytesOf(page);
  if (bytes <= WEBRTC_FRAME_BODY_BUDGET) return page;
  const customers = cutToFrame(page.customers, bytes);
  const last = customers.at(-1);
  return fitted({ customers, next: last ? last.number : page.next });
}

function fittedOverview(overview: CrmOverview): CrmOverview {
  const bytes = bytesOf(overview);
  if (bytes <= WEBRTC_FRAME_BODY_BUDGET) return overview;
  return fitted({ ...overview, proposals: cutToFrame(overview.proposals, bytes) });
}

function fitted<A>(value: A): A {
  if (bytesOf(value) > WEBRTC_FRAME_BODY_BUDGET) throw new HttpError(413, sourceText("error.crm.tooLargeToSend"));
  return value;
}

export async function routeCrm(context: TeamApiRequestContext, crm: TeamApiCrm | undefined): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const path = url.pathname;
  if (method !== "POST" || !CRM_PATHS.has(path)) return "unmatched";
  if (!crm || !capabilities.has(CRM_CAPABILITY)) throw new HttpError(400, sourceText("error.crm.serverTooOld"));
  requireAdmin(member);
  const body = await readJson(request);
  const actor: CrmActor = {
    kind: "person",
    id: member.id,
    name: (member.name?.trim() || member.email || member.username).slice(0, ACTOR_NAME_LIMIT),
  };
  switch (path) {
    case CRM_ROUTES.overview:
      return json(200, fittedOverview(await run(crm.overview())));
    case CRM_ROUTES.customers:
      return json(200, fittedCustomers(await run(crm.customers(parse(parseCrmCustomerPage, body)))));
    case CRM_ROUTES.payments:
      return json(200, fitted(await run(crm.payments(parse(parseCrmPaymentPage, body)))));
    case CRM_ROUTES.activity:
      return json(200, fitted(await run(crm.activity(parse(parseCrmActivityPage, body)))));
    case CRM_ROUTES.apply:
      return json(200, await run(crm.apply(parse(parseCrmChange, body), actor)));
    case CRM_ROUTES.sourceConnect:
      return json(200, await run(crm.sourceConnect(parse(parseCrmSourceConnect, body))));
    case CRM_ROUTES.sourceDisconnect:
      return json(200, await run(crm.sourceDisconnect(parse(parseCrmSource, body))));
    case CRM_ROUTES.sourceSync:
      return json(200, await run(crm.sourceSync(parse(parseCrmSource, body))));
    case CRM_ROUTES.settings:
      return json(200, await run(crm.settings()));
    case CRM_ROUTES.setSettings:
      return json(200, await run(crm.setSettings(parse(parseCrmSettings, body))));
  }
  return "unmatched";
}
