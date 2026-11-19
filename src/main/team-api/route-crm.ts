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
/** The longest person name that a CRM activity keeps. */
const ACTOR_NAME_LIMIT = 200;

/** The wire codec has already checked the body, so only a malformed payload fails here, in English. */
function parse<A>(decode: (value: unknown) => A, body: unknown): A {
  try {
    return decode(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid CRM request.");
  }
}

/** A missing record answers 404 and a refused change 400, with the person's sentence. Anything else is a host fault. */
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

/** The list, cut at the end while `bytes` would not fit one WebRTC frame. One item always stays. */
function cutToFrame<T>(items: readonly T[], bytes: number): T[] {
  const kept = [...items];
  while (kept.length > 1 && bytes > WEBRTC_FRAME_BODY_BUDGET) bytes -= bytesOf(kept.pop()) + 1;
  return kept;
}

/**
 * The page, cut at the end while it would not fit one WebRTC frame. The customers' notes can make a
 * full page too large; the cut page names its last customer as the next cursor, so the client reads
 * the rest on the next page.
 */
function fittedCustomers(page: CrmCustomerPage): CrmCustomerPage {
  const bytes = bytesOf(page);
  if (bytes <= WEBRTC_FRAME_BODY_BUDGET) return page;
  const customers = cutToFrame(page.customers, bytes);
  const last = customers.at(-1);
  return fitted({ customers, next: last ? last.number : page.next });
}

/**
 * The overview, with the pending proposals cut at the end while it would not fit one WebRTC frame.
 * Agents can make up to 500 proposals with long notes. The cut proposals come back in a later
 * overview, after the owner decides the ones shown.
 */
function fittedOverview(overview: CrmOverview): CrmOverview {
  const bytes = bytesOf(overview);
  if (bytes <= WEBRTC_FRAME_BODY_BUDGET) return overview;
  return fitted({ ...overview, proposals: cutToFrame(overview.proposals, bytes) });
}

function fitted<A>(value: A): A {
  if (bytesOf(value) > WEBRTC_FRAME_BODY_BUDGET) throw new HttpError(413, sourceText("error.crm.tooLargeToSend"));
  return value;
}

/**
 * The CRM of a server for its owners and admins. A member gets 403 on every route; frozen by
 * `crm-v1`. A change names the member who made it, so the activity of a customer says who changed it.
 * Only the dispatcher answers 404 for a path that no route knows.
 */
export async function routeCrm(context: TeamApiRequestContext, crm: TeamApiCrm | undefined): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const path = url.pathname;
  if (method !== "POST" || !CRM_PATHS.has(path)) return "unmatched";
  if (!crm || !capabilities.has(CRM_CAPABILITY)) throw new HttpError(400, sourceText("error.crm.serverTooOld"));
  requireAdmin(member);
  // `readJson` has already run the body through the `crm-v1` wire codec.
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
    // The answers hold no key: only the result of the change.
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
