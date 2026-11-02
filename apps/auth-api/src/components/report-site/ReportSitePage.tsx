import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { JSX } from "@solidjs/web";
import { Link } from "@tanstack/solid-router";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import { CONTACT_EMAIL } from "../../lib/contact";
import { LandingIcon } from "../landing/LandingIcon";
import type { ReportSiteText } from "../transactional/page-text";
import { TransactionalPage } from "../transactional/TransactionalPage";

/** The reasons that `/v1/sites/reports` accepts. */
const REPORT_REASONS = ["phishing", "malware", "abuse", "copyright", "other"] as const;

const DETAILS_LIMIT = 1_000;

/** An example value, not text: it is the same in all languages. */
const HOSTNAME_EXAMPLE = "example.openbot.site";

type ReportStatus = "idle" | "sending" | "sent" | "failed";

function fieldText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** The `error.message` of a refused report, when the server sent one that a person can read. */
async function serverMessage(response: Response): Promise<string | null> {
  if (response.status >= 500) return null;
  const body = await response.json().catch(() => null);
  if (!isDynamicRecord(body) || !isDynamicRecord(body.error)) return null;
  return isString(body.error.message) && body.error.message ? body.error.message : null;
}

/**
 * The form state and the send to `/v1/sites/reports`. The endpoint accepts only a same-origin form
 * body, so the page sends `application/x-www-form-urlencoded` with `fetch`, and the browser adds the
 * `Origin` and `Sec-Fetch-Site` headers that it checks.
 */
function createReportForm(text: ReportSiteText) {
  const [status, setStatus] = createSignal<ReportStatus>("idle");
  const [hostnameError, setHostnameError] = createSignal<string>();
  const [failure, setFailure] = createSignal("");

  const submit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = async (event) => {
    event.preventDefault();
    if (status() === "sending") return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const hostname = fieldText(data, "hostname");
    if (!hostname) {
      setHostnameError(text.hostnameMissing);
      const field = form.elements.namedItem("hostname");
      if (field instanceof HTMLElement) field.focus();
      return;
    }
    setHostnameError(undefined);
    setStatus("sending");
    const response = await fetch("/v1/sites/reports", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        hostname,
        reason: fieldText(data, "reason"),
        details: fieldText(data, "details"),
      }),
    }).catch(() => null);
    if (response?.status === 201) {
      setStatus("sent");
      return;
    }
    if (response?.status === 429) setFailure(text.tooMany);
    else setFailure((response && (await serverMessage(response))) ?? text.sendFailed);
    setStatus("failed");
  };

  return { status, hostnameError, failure, submit };
}

function SentNotice(props: { text: ReportSiteText }) {
  return (
    <div class="contact-sent" role="status">
      <span class="contact-sent-mark">
        <LandingIcon name="check" />
      </span>
      <h2>{props.text.sentTitle}</h2>
      <p>{props.text.sentBody}</p>
      <Link to="/" class="contact-text-button">
        {props.text.home}
      </Link>
    </div>
  );
}

/** The report form for a hosted site. `hostname` is the site that linked here, or empty. */
export function ReportSitePage(props: { hostname: string; lang: string; text: ReportSiteText }) {
  const form = createReportForm(props.text);
  const hostnameId = createUniqueId();
  const reasonId = createUniqueId();
  const detailsId = createUniqueId();
  const [detailsLength, setDetailsLength] = createSignal(0);

  return (
    <TransactionalPage titleId="report-site-title" layout="form" class="contact-section" lang={props.lang}>
      <header class="transactional-form-heading">
        <h1 id="report-site-title">{props.text.title}</h1>
        <p class="join-card-copy">{props.text.intro}</p>
      </header>
      <Show when={form.status() !== "sent"} fallback={<SentNotice text={props.text} />}>
        <form class="contact-form" novalidate onSubmit={form.submit}>
          <div class="contact-field">
            <div class="contact-field-head">
              <label for={hostnameId}>{props.text.hostnameLabel}</label>
              <Show when={form.hostnameError()}>
                {(error) => (
                  <span id={`${hostnameId}-error`} class="contact-error">
                    {error()}
                  </span>
                )}
              </Show>
            </div>
            <input
              id={hostnameId}
              name="hostname"
              type="text"
              value={props.hostname}
              readonly={props.hostname !== ""}
              placeholder={HOSTNAME_EXAMPLE}
              autocomplete="off"
              spellcheck={false}
              aria-invalid={form.hostnameError() ? "true" : undefined}
              aria-describedby={form.hostnameError() ? `${hostnameId}-error` : undefined}
            />
          </div>
          <div class="contact-field">
            <div class="contact-field-head">
              <label for={reasonId}>{props.text.reasonLabel}</label>
            </div>
            <div class="contact-select">
              <select id={reasonId} name="reason">
                <For each={REPORT_REASONS}>
                  {(reason) => <option value={reason}>{props.text.reasons[reason]}</option>}
                </For>
              </select>
              <LandingIcon name="chevron-down" class="contact-select-icon" />
            </div>
          </div>
          <div class="contact-field">
            <div class="contact-field-head">
              <label for={detailsId}>{props.text.detailsLabel}</label>
              <span class="contact-optional">{props.text.optional}</span>
            </div>
            <textarea
              id={detailsId}
              name="details"
              rows={5}
              maxlength={DETAILS_LIMIT}
              placeholder={props.text.detailsPlaceholder}
              aria-describedby={`${detailsId}-count`}
              onInput={(event) => setDetailsLength(event.currentTarget.value.length)}
            />
            {/* One expression: the server writes a constant as text, but the client expects a slot. */}
            <span id={`${detailsId}-count`} class="contact-count">
              {`${detailsLength()} / ${DETAILS_LIMIT}`}
            </span>
          </div>
          <div class="contact-submit">
            <button
              type="submit"
              class="landing-button landing-button-primary landing-button-md"
              data-icon="arrow-right"
              disabled={form.status() === "sending"}
            >
              {form.status() === "sending" ? props.text.sending : props.text.send}
            </button>
            <Show when={form.status() === "failed"}>
              <p class="contact-privacy contact-failed" role="alert">
                {form.failure()} {props.text.writeTo.before}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
                {props.text.writeTo.after}
              </p>
            </Show>
          </div>
        </form>
      </Show>
    </TransactionalPage>
  );
}
