import { normalizeEmailAddress } from "@openbot/contracts/validation";
import type { JSX } from "@solidjs/web";
import { createSignal, createUniqueId, For, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { CONTACT_EMAIL, CONTACT_LIMITS, CONTACT_ROUTE, CONTACT_TOPICS } from "../../lib/contact";
import { EXTERNAL_LINK_REL, OPENBOT_LINKS } from "../../lib/landing-links";
import { LandingFooter } from "../landing/LandingFooter";
import { LandingIcon } from "../landing/LandingIcon";
import { SiteHeader } from "../landing/SiteHeader";
import type { ContactPageText } from "./contact-page-text";

/** The channels with a description in the page text. Email follows them, with the address as its description. */
const CONTACT_CHANNELS = [
  { id: "discord", label: "Discord", href: OPENBOT_LINKS.discord },
  { id: "github", label: "GitHub", href: `${OPENBOT_LINKS.repository}/issues/new/choose` },
  { id: "x", label: "X", href: OPENBOT_LINKS.x },
] as const;

type ContactStatus = "idle" | "sending" | "sent" | "failed" | "limited";

interface FieldErrors {
  readonly email?: string | undefined;
  readonly message?: string | undefined;
}

function fieldText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** The form state: validation, the send to `/v1/contact`, and its result. */
function createContactForm(errorText: () => ContactPageText["errors"]) {
  const [status, setStatus] = createSignal<ContactStatus>("idle");
  const [errors, setErrors] = createSignal<FieldErrors>({});
  const [sentTo, setSentTo] = createSignal("");

  const submit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = async (event) => {
    event.preventDefault();
    if (status() === "sending") return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = fieldText(data, "email");
    const message = fieldText(data, "message");
    const next: FieldErrors = {
      email: normalizeEmailAddress(email) ? undefined : errorText().email,
      message: message.length > 0 ? undefined : errorText().message,
    };
    setErrors(next);
    const firstInvalid = next.email ? "email" : next.message ? "message" : null;
    if (firstInvalid) {
      const field = form.elements.namedItem(firstInvalid);
      if (field instanceof HTMLElement) field.focus();
      return;
    }
    setStatus("sending");
    const topic = fieldText(data, "topic");
    const response = await fetch("/v1/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fieldText(data, "name"),
        email,
        company: fieldText(data, "company"),
        topic,
        message,
      }),
    }).catch(() => null);
    if (response?.ok) {
      landingAnalytics.trackContactFormSubmitted(topic, "succeeded");
      setSentTo(email);
      setStatus("sent");
      return;
    }
    const limited = response?.status === 429;
    landingAnalytics.trackContactFormSubmitted(topic, limited ? "rate_limited" : "failed");
    setStatus(limited ? "limited" : "failed");
  };

  const reset = () => {
    setErrors({});
    setStatus("idle");
  };

  return { status, errors, sentTo, submit, reset };
}

/**
 * The label row of a field. An error replaces "Optional" on the right of the label, so the field
 * does not move when the error shows.
 */
function FieldHead(props: { for: string; label: string; optional?: string | undefined; error?: string | undefined }) {
  return (
    <div class="contact-field-head">
      <label for={props.for}>{props.label}</label>
      <Show
        when={props.error}
        fallback={<Show when={props.optional}>{(optional) => <span class="contact-optional">{optional()}</span>}</Show>}
      >
        <span id={`${props.for}-error`} class="contact-error">
          {props.error}
        </span>
      </Show>
    </div>
  );
}

interface TextFieldProps {
  label: string;
  name: string;
  type: "text" | "email";
  autocomplete: string;
  maxlength?: number | undefined;
  /** The "Optional" text of an optional field. */
  optional?: string | undefined;
  error?: string | undefined;
}

function TextField(props: TextFieldProps) {
  const id = createUniqueId();
  return (
    <div class="contact-field">
      <FieldHead for={id} label={props.label} optional={props.optional} error={props.error} />
      <input
        id={id}
        name={props.name}
        type={props.type}
        autocomplete={props.autocomplete}
        maxlength={props.maxlength}
        aria-invalid={props.error ? "true" : undefined}
        aria-describedby={props.error ? `${id}-error` : undefined}
      />
    </div>
  );
}

function MessageField(props: { label: string; placeholder: string; error?: string | undefined }) {
  const id = createUniqueId();
  const [length, setLength] = createSignal(0);
  return (
    <div class="contact-field">
      <FieldHead for={id} label={props.label} error={props.error} />
      <textarea
        id={id}
        name="message"
        rows={6}
        maxlength={CONTACT_LIMITS.message}
        placeholder={props.placeholder}
        aria-invalid={props.error ? "true" : undefined}
        aria-describedby={`${id}-count${props.error ? ` ${id}-error` : ""}`}
        onInput={(event) => setLength(event.currentTarget.value.length)}
      />
      <span id={`${id}-count`} class="contact-count">
        {length()} / {CONTACT_LIMITS.message}
      </span>
    </div>
  );
}

/** A failed send replaces the privacy line beside the button, so the form does not grow. */
function SubmitRow(props: { status: ContactStatus; text: ContactPageText }) {
  const failure = () => (props.status === "limited" ? props.text.limited : props.text.failed);
  return (
    <div class="contact-submit">
      <button
        type="submit"
        class="landing-button landing-button-primary landing-button-md"
        data-icon="arrow-right"
        disabled={props.status === "sending"}
      >
        {props.status === "sending" ? props.text.sending : props.text.send}
      </button>
      <Show
        when={props.status === "failed" || props.status === "limited"}
        fallback={
          <p class="contact-privacy">
            {props.text.privacy}{" "}
            <a href={OPENBOT_LINKS.privacy} target="_blank" rel={EXTERNAL_LINK_REL}>
              {props.text.privacyLink}
            </a>
          </p>
        }
      >
        <p class="contact-privacy contact-failed" role="alert">
          {failure().before}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          {failure().after}
        </p>
      </Show>
    </div>
  );
}

function SentNotice(props: { email: string; text: ContactPageText; onReset: () => void }) {
  return (
    <div class="contact-sent" role="status">
      <span class="contact-sent-mark">
        <LandingIcon name="check" />
      </span>
      <h2>{props.text.sentTitle}</h2>
      <p>
        {props.text.sentBody.before}
        <strong>{props.email}</strong>
        {props.text.sentBody.after}
      </p>
      <button type="button" class="contact-text-button" onClick={() => props.onReset()}>
        {props.text.sendAnother}
      </button>
    </div>
  );
}

function ContactChannel(props: { label: string; detail: string; href: string }) {
  return (
    <li>
      <a href={props.href} target="_blank" rel={EXTERNAL_LINK_REL}>
        <span class="contact-channel-label">{props.label}</span>
        <span class="contact-channel-detail">{props.detail}</span>
        <LandingIcon name="arrow-up-right" class="contact-channel-icon" />
      </a>
    </li>
  );
}

export function ContactPage(props: { lang: string; text: ContactPageText }) {
  const form = createContactForm(() => props.text.errors);
  const topicId = createUniqueId();

  onSettled(() => landingAnalytics.start(document, window.location.hostname, CONTACT_ROUTE));

  return (
    <div class="landing-page" lang={props.lang}>
      <SiteHeader page="content" />
      <main>
        <section class="landing-section contact-section" data-revealed="true" aria-labelledby="contact-title">
          <div class="landing-section-inner">
            <div class="landing-faq-layout">
              <header class="landing-section-heading landing-faq-heading">
                <h1 id="contact-title">{props.text.heading}</h1>
                <p>{props.text.intro}</p>
                <ul class="contact-channels">
                  <For each={CONTACT_CHANNELS}>
                    {(channel) => (
                      <ContactChannel
                        label={channel.label}
                        detail={props.text.channels[channel.id]}
                        href={channel.href}
                      />
                    )}
                  </For>
                  <ContactChannel
                    label={props.text.fields.email}
                    detail={CONTACT_EMAIL}
                    href={`mailto:${CONTACT_EMAIL}`}
                  />
                </ul>
              </header>
              <div class="contact-card">
                <Show
                  when={form.status() !== "sent"}
                  fallback={<SentNotice email={form.sentTo()} text={props.text} onReset={form.reset} />}
                >
                  <form class="contact-form" novalidate onSubmit={form.submit}>
                    <div class="contact-row">
                      <TextField
                        label={props.text.fields.name}
                        name="name"
                        type="text"
                        autocomplete="name"
                        maxlength={CONTACT_LIMITS.name}
                        optional={props.text.optional}
                      />
                      <TextField
                        label={props.text.fields.email}
                        name="email"
                        type="email"
                        autocomplete="email"
                        error={form.errors().email}
                      />
                    </div>
                    <TextField
                      label={props.text.fields.company}
                      name="company"
                      type="text"
                      autocomplete="organization"
                      maxlength={CONTACT_LIMITS.company}
                      optional={props.text.optional}
                    />
                    <div class="contact-field">
                      <FieldHead for={topicId} label={props.text.fields.topic} />
                      <div class="contact-select">
                        <select id={topicId} name="topic">
                          <For each={CONTACT_TOPICS}>
                            {(topic) => <option value={topic.id}>{props.text.topics[topic.id]}</option>}
                          </For>
                        </select>
                        <LandingIcon name="chevron-down" class="contact-select-icon" />
                      </div>
                    </div>
                    <MessageField
                      label={props.text.fields.message}
                      placeholder={props.text.placeholder}
                      error={form.errors().message}
                    />
                    <SubmitRow status={form.status()} text={props.text} />
                  </form>
                </Show>
              </div>
            </div>
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
