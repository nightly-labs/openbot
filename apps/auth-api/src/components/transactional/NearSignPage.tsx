import { AppLogo } from "@openbot/brand";
import { createSignal, Match, onSettled, Show, Switch } from "solid-js";
import { NearSignError, type NearSignFailure, runNearSignature } from "../../lib/near-sign-actions";
import {
  type NearSignRequest,
  nearReturnUrl,
  nearSignAction,
  parseNearSignFragment,
} from "../../lib/near-sign-request";
import { Button } from "../ui/button";
import type { NearSignText } from "./page-text";
import { TransactionalPage } from "./TransactionalPage";

export type NearSignState =
  | { step: "loading" }
  | { step: "invalid" }
  | { step: "ready"; request: NearSignRequest }
  | { step: "working"; request: NearSignRequest }
  | { step: "failed"; request: NearSignRequest; failure: NearSignFailure }
  | { step: "done"; request: NearSignRequest; returnUrl: string };

const TITLE_ID = "near-sign-title";

export function NearSignPage(props: { lang: string; text: NearSignText }) {
  const [state, setState] = createSignal<NearSignState>({ step: "loading" });

  onSettled(() => {
    const page = new URL(window.location.href);
    const request = parseNearSignFragment(page.hash.slice(1));
    window.history.replaceState(null, "", page.pathname);
    setState(request ? { step: "ready", request } : { step: "invalid" });
  });

  const start = (request: NearSignRequest) => {
    setState({ step: "working", request });
    runNearSignature(request, props.text.passkeyName).then(
      (data) => {
        const returnUrl = nearReturnUrl(request, data);
        setState({ step: "done", request, returnUrl });
        window.location.assign(returnUrl);
      },
      (error: unknown) => {
        const failure = error instanceof NearSignError ? error.failure : "failed";
        setState({ step: "failed", request, failure });
      },
    );
  };

  return <NearSignView lang={props.lang} text={props.text} state={state()} onStart={start} />;
}

function actionLabel(text: NearSignText, request: NearSignRequest): string {
  return request.kind === "register" ? text.createPasskey : text.usePasskey;
}

function requestOf(state: NearSignState): NearSignRequest | null {
  return state.step === "loading" || state.step === "invalid" ? null : state.request;
}

export function NearSignView(props: {
  lang: string;
  text: NearSignText;
  state: NearSignState;
  onStart: (request: NearSignRequest) => void;
}) {
  const request = () => requestOf(props.state);
  const failure = () => (props.state.step === "failed" ? props.state.failure : null);
  const returnUrl = () => (props.state.step === "done" ? props.state.returnUrl : null);
  const createsPasskey = () => request()?.kind === "register";

  return (
    <TransactionalPage titleId={TITLE_ID} lang={props.lang} bare>
      <AppLogo variant="production" animation="blink" class="join-card-logo" />
      <Show when={!createsPasskey()}>
        <p class="join-card-eyebrow">{props.text.eyebrow}</p>
      </Show>
      <Switch>
        <Match when={props.state.step === "loading"}>
          <h1 id={TITLE_ID}>{props.text.pageTitle}</h1>
          <p class="join-card-copy" aria-live="polite">
            {props.text.loading}
          </p>
        </Match>
        <Match when={props.state.step === "invalid"}>
          <h1 id={TITLE_ID}>{props.text.invalidTitle}</h1>
          <p class="join-card-error" role="alert">
            {props.text.invalidBody}
          </p>
        </Match>
        <Match when={returnUrl()}>
          {(url) => (
            <>
              <h1 id={TITLE_ID}>
                {request()?.kind === "register" ? props.text.registerDoneTitle : props.text.doneTitle}
              </h1>
              <p class="join-card-copy">{props.text.doneBody}</p>
              <div class="join-card-actions join-card-actions-single">
                <Button href={url()} variant="primary" size="lg" icon="open">
                  {props.text.openAgain}
                </Button>
              </div>
            </>
          )}
        </Match>
        <Match when={request()}>
          {(current) => (
            <>
              <h1 id={TITLE_ID}>{props.text.actions[nearSignAction(current())]}</h1>
              <Show when={current().summary}>
                <p class="join-card-copy near-sign-summary">{current().summary}</p>
              </Show>
              <Show when={failure()}>
                {(kind) => (
                  <p class="join-card-error" role="alert">
                    {props.text.failure[kind()]}
                  </p>
                )}
              </Show>
              <Show when={props.state.step === "working"}>
                <p class="join-card-copy" aria-live="polite">
                  {props.text.workingPasskey}
                </p>
              </Show>
              <div class="join-card-actions join-card-actions-single">
                <button
                  type="button"
                  class="landing-button landing-button-primary landing-button-lg"
                  data-icon="arrow-right"
                  disabled={props.state.step === "working"}
                  onClick={() => props.onStart(current())}
                >
                  {failure() ? props.text.tryAgain : actionLabel(props.text, current())}
                </button>
              </div>
            </>
          )}
        </Match>
      </Switch>
    </TransactionalPage>
  );
}
