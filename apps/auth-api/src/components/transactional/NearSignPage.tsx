import { AppLogo } from "@openbot/brand";
import { createSignal, For, Match, onSettled, Show, Switch } from "solid-js";
import { NearSignError, type NearSignFailure, runNearSignature } from "../../lib/near-sign-actions";
import {
  type NearSignRequest,
  nearReturnUrl,
  nearSignAction,
  nearTypedFields,
  parseNearSignFragment,
} from "../../lib/near-sign-request";
import { Button } from "../ui/button";
import { NEAR_ADDRESS_MARKER, type NearSignText } from "./page-text";
import { TransactionalPage } from "./TransactionalPage";

/** Where the page is in the signature. */
export type NearSignState =
  | { step: "loading" }
  | { step: "invalid" }
  | { step: "ready"; request: NearSignRequest }
  | { step: "working"; request: NearSignRequest }
  | { step: "failed"; request: NearSignRequest; failure: NearSignFailure }
  | { step: "done"; request: NearSignRequest; returnUrl: string };

const TITLE_ID = "near-sign-title";

/**
 * The page where the owner of the NEAR wallet in OpenBot signs with a passkey or an EVM wallet. The
 * desktop app opens it with the request in the fragment. The page reads the fragment once, removes it
 * from the address bar, and sends the signature back to the app as an `openbot://near-signature` link.
 * Nothing on this page talks to a server.
 */
export function NearSignPage(props: { lang: string; text: NearSignText }) {
  const [state, setState] = createSignal<NearSignState>({ step: "loading" });

  onSettled(() => {
    const page = new URL(window.location.href);
    const request = parseNearSignFragment(page.hash.slice(1));
    // The nonce in the fragment is the only proof of this request. Remove it from the address bar.
    window.history.replaceState(null, "", page.pathname);
    setState(request ? { step: "ready", request } : { step: "invalid" });
  });

  // The click that starts the passkey or wallet prompt. The browser and the wallets ask for it.
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
  if (request.kind === "register") return request.method === "passkey" ? text.createPasskey : text.connectWallet;
  return request.method === "passkey" ? text.usePasskey : text.signInWallet;
}

function failureText(text: NearSignText, request: NearSignRequest, failure: NearSignFailure): string {
  const sentence = text.failure[failure];
  return request.kind === "sign" && request.method === "evm"
    ? sentence.replace(NEAR_ADDRESS_MARKER, request.address)
    : sentence;
}

/** The request of a state that has one. */
function requestOf(state: NearSignState): NearSignRequest | null {
  return state.step === "loading" || state.step === "invalid" ? null : state.request;
}

/** The card: what the owner approves, the one button that asks the passkey or the wallet, and the result. */
export function NearSignView(props: {
  /** The language of `text`. */
  lang: string;
  text: NearSignText;
  state: NearSignState;
  onStart: (request: NearSignRequest) => void;
}) {
  const request = () => requestOf(props.state);
  const failure = () => (props.state.step === "failed" ? props.state.failure : null);
  const returnUrl = () => (props.state.step === "done" ? props.state.returnUrl : null);
  const typedFields = () => {
    const current = request();
    return current?.kind === "sign" && current.method === "evm" ? nearTypedFields(current.payload.message) : [];
  };
  const ownerAddress = () => {
    const current = request();
    return current?.kind === "sign" && current.method === "evm" ? current.address : null;
  };

  return (
    <TransactionalPage titleId={TITLE_ID} lang={props.lang}>
      <AppLogo variant="production" animation="blink" class="join-card-logo" />
      <p class="join-card-eyebrow">{props.text.eyebrow}</p>
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
              <h1 id={TITLE_ID}>{props.text.doneTitle}</h1>
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
              <Show when={ownerAddress()}>
                {(address) => (
                  <dl class="near-sign-facts">
                    <div>
                      <dt>{props.text.account}</dt>
                      <dd class="near-sign-mono">{address()}</dd>
                    </div>
                  </dl>
                )}
              </Show>
              <Show when={typedFields().length > 0}>
                <section class="near-sign-details" aria-label={props.text.details}>
                  <p class="near-sign-details-title">{props.text.details}</p>
                  <dl>
                    <For each={typedFields()}>
                      {(field) => (
                        <div>
                          <dt class="near-sign-mono">{field.path}</dt>
                          <dd class="near-sign-mono">{field.value}</dd>
                        </div>
                      )}
                    </For>
                  </dl>
                </section>
              </Show>
              <Show when={failure()}>
                {(kind) => (
                  <p class="join-card-error" role="alert">
                    {failureText(props.text, current(), kind())}
                  </p>
                )}
              </Show>
              <Show when={props.state.step === "working"}>
                <p class="join-card-copy" aria-live="polite">
                  {current().method === "passkey" ? props.text.workingPasskey : props.text.workingEvm}
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
