import { normalizeEmailAddress } from "@openbot/contracts/validation";
import type { JSX } from "@solidjs/web";
import { createSignal, createUniqueId, For, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { CONTACT_EMAIL, CONTACT_LIMITS, CONTACT_ROUTE, CONTACT_TOPICS } from "../../lib/contact";
import { EXTERNAL_LINK_REL, OPENBOT_LINKS } from "../../lib/landing-links";
import { LandingFooter } from "../landing/LandingFooter";
import { LandingIcon } from "../landing/LandingIcon";
import { SiteHeader } from "../landing/SiteHeader";

const CONTACT_CHANNELS = [
  { label: "Discord", detail: "Community and help", href: OPENBOT_LINKS.discord },
  { label: "GitHub", detail: "Bugs and source code", href: `${OPENBOT_LINKS.repository}/issues/new/choose` },
  { label: "X", detail: "News", href: OPENBOT_LINKS.x },
  { label: "Email", detail: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}` },
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
function createContactForm() {
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
      email: normalizeEmailAddress(email) ? undefined : "Enter a valid email",
      message: message.length > 0 ? undefined : "Write a message",
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
function FieldHead(props: { for: string; label: string; optional?: boolean | undefined; error?: string | undefined }) {
  return (
    <div class="contact-field-head">
      <label for={props.for}>{props.label}</label>
      <Show
        when={props.error}
        fallback={
          <Show when={props.optional}>
            <span class="contact-optional">Optional</span>
          </Show>
        }
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
  optional?: boolean | undefined;
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

function MessageField(props: { error?: string | undefined }) {
  const id = createUniqueId();
  const [length, setLength] = createSignal(0);
  return (
    <div class="contact-field">
      <FieldHead for={id} label="Message" error={props.error} />
      <textarea
        id={id}
        name="message"
        rows={6}
        maxlength={CONTACT_LIMITS.message}
        placeholder="How can we help?"
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
function SubmitRow(props: { status: ContactStatus }) {
  return (
    <div class="contact-submit">
      <button
        type="submit"
        class="landing-button landing-button-primary landing-button-md"
        data-icon="arrow-right"
        disabled={props.status === "sending"}
      >
        {props.status === "sending" ? "Sending…" : "Send message"}
      </button>
      <Show
        when={props.status === "failed" || props.status === "limited"}
        fallback={
          <p class="contact-privacy">
            We use your email only to answer you.{" "}
            <a href={OPENBOT_LINKS.privacy} target="_blank" rel={EXTERNAL_LINK_REL}>
              Privacy
            </a>
          </p>
        }
      >
        <p class="contact-privacy contact-failed" role="alert">
          {props.status === "limited" ? "Too many messages. Try again later" : "Could not send. Try again"}, or write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </Show>
    </div>
  );
}

function SentNotice(props: { email: string; onReset: () => void }) {
  return (
    <div class="contact-sent" role="status">
      <span class="contact-sent-mark">
        <LandingIcon name="check" />
      </span>
      <h2>Message sent</h2>
      <p>
        We will answer at <strong>{props.email}</strong>.
      </p>
      <button type="button" class="contact-text-button" onClick={() => props.onReset()}>
        Send another message
      </button>
    </div>
  );
}

export function ContactPage() {
  const form = createContactForm();
  const topicId = createUniqueId();

  onSettled(() => landingAnalytics.start(document, window.location.hostname, CONTACT_ROUTE));

  return (
    <div class="landing-page">
      <SiteHeader page="content" />
      <main>
        <section class="landing-section contact-section" data-revealed="true" aria-labelledby="contact-title">
          <div class="landing-section-inner">
            <div class="landing-faq-layout">
              <header class="landing-section-heading landing-faq-heading">
                <h1 id="contact-title">Talk to the team</h1>
                <p>Tell us what you need. A person on the OpenBot team reads each message.</p>
                <ul class="contact-channels">
                  <For each={CONTACT_CHANNELS}>
                    {(channel) => (
                      <li>
                        <a href={channel.href} target="_blank" rel={EXTERNAL_LINK_REL}>
                          <span class="contact-channel-label">{channel.label}</span>
                          <span class="contact-channel-detail">{channel.detail}</span>
                          <LandingIcon name="arrow-up-right" class="contact-channel-icon" />
                        </a>
                      </li>
                    )}
                  </For>
                </ul>
              </header>
              <div class="contact-card">
                <Show
                  when={form.status() !== "sent"}
                  fallback={<SentNotice email={form.sentTo()} onReset={form.reset} />}
                >
                  <form class="contact-form" novalidate onSubmit={form.submit}>
                    <div class="contact-row">
                      <TextField
                        label="Name"
                        name="name"
                        type="text"
                        autocomplete="name"
                        maxlength={CONTACT_LIMITS.name}
                        optional
                      />
                      <TextField
                        label="Email"
                        name="email"
                        type="email"
                        autocomplete="email"
                        error={form.errors().email}
                      />
                    </div>
                    <TextField
                      label="Company"
                      name="company"
                      type="text"
                      autocomplete="organization"
                      maxlength={CONTACT_LIMITS.company}
                      optional
                    />
                    <div class="contact-field">
                      <FieldHead for={topicId} label="Topic" />
                      <div class="contact-select">
                        <select id={topicId} name="topic">
                          <For each={CONTACT_TOPICS}>{(topic) => <option value={topic.id}>{topic.label}</option>}</For>
                        </select>
                        <LandingIcon name="chevron-down" class="contact-select-icon" />
                      </div>
                    </div>
                    <MessageField error={form.errors().message} />
                    <SubmitRow status={form.status()} />
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
