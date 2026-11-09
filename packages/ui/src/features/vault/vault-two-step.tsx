// Two-step (TOTP) codes in the Vault: the live code of a login in the list and in its dialog, and the
// setup steps that take the key from the site. Main makes the codes of saved keys; the key never comes
// to this window after it is saved. The window makes codes only from a key that the user typed in the
// setup step and has not saved yet, so the user can check the key on the site before saving it.

import type { VaultTwoStepCodes } from "@openbot/contracts/ipc";
import {
  groupedTwoStepCode,
  parseTwoStepKey,
  TWO_STEP_KEY_LIMIT,
  twoStepCode,
  twoStepRemainingMs,
} from "@openbot/contracts/two-step-code";
import {
  Button,
  Copy,
  Field,
  IconButton,
  Image,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  RadialProgress,
  ShieldCheck,
  Text,
} from "@openbot/ui";
import { createMemo, createSignal, onSettled, Show } from "solid-js";
import { useText } from "../../text";

/** A code and the time when the next one starts. */
export interface LiveTwoStepCode {
  code: string;
  /** Seconds that one code is valid. */
  period: number;
  /** Milliseconds since 1970. */
  expiresAt: number;
}

/** The time, once a second while the component is open. */
function createSecondClock(onTick?: (now: number) => void) {
  const [now, setNow] = createSignal(Date.now());
  onSettled(() => {
    const tick = () => {
      const at = Date.now();
      setNow(at);
      onTick?.(at);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  });
  return now;
}

/** The time after a failed load before the codes load again. */
const RETRY_MS = 30_000;

/**
 * The codes of the saved logins, from main. They load again when the first one runs out, and when the
 * list of logins with a key is a new one: a saved change can replace the key of a login.
 */
export function createSavedTwoStepCodes(
  load: () => (() => Promise<VaultTwoStepCodes>) | undefined,
  keyedLogins: () => readonly string[],
) {
  const [codes, setCodes] = createSignal<ReadonlyMap<string, LiveTwoStepCode>>(new Map());
  let loadedFor: readonly string[] | null = null;
  let retryAt = 0;
  let loading = false;
  let run = 0;
  const now = createSecondClock((at) => {
    const loader = load();
    const logins = keyedLogins();
    if (!loader || logins.length === 0) {
      loadedFor = null;
      run++;
      if (codes().size > 0) setCodes(new Map());
      return;
    }
    const expired = [...codes().values()].some((code) => code.expiresAt <= at);
    // The same list waits for the first code to run out, or after a failed load for the next try.
    const waiting = loadedFor === logins && (retryAt > 0 ? at < retryAt : !expired);
    if (loading || waiting) return;
    loading = true;
    const current = ++run;
    loader()
      .then((result) => {
        if (current !== run) return;
        const received = Date.now();
        loadedFor = logins;
        retryAt = 0;
        setCodes(
          new Map(
            result.codes.map((code) => [
              code.id,
              { code: code.code, period: code.period, expiresAt: received + code.remainingMs },
            ]),
          ),
        );
      })
      // After a failed load the rows show no code until the next try.
      .catch(() => {
        if (current !== run) return;
        loadedFor = logins;
        retryAt = Date.now() + RETRY_MS;
        setCodes(new Map());
      })
      .finally(() => {
        loading = false;
      });
  });
  return { code: (id: string) => codes().get(id), now };
}

/** The code of a key that the user typed and has not saved. Undefined for no key or an invalid one. */
export function createDraftTwoStepCode(keyText: () => string) {
  const key = createMemo(() => (keyText().trim() ? parseTwoStepKey(keyText()) : null));
  const [code, setCode] = createSignal<LiveTwoStepCode | undefined>(undefined);
  let run = 0;
  let shownKey: unknown = null;
  const now = createSecondClock((at) => {
    const current = key();
    const shown = code();
    if (!current) {
      run++;
      if (shown) setCode(undefined);
      return;
    }
    if (shown && shown.expiresAt > at && shownKey === current) return;
    const ticket = ++run;
    twoStepCode(current, at)
      .then((value) => {
        if (ticket !== run) return;
        shownKey = current;
        setCode({ code: value, period: current.period, expiresAt: at + twoStepRemainingMs(current.period, at) });
      })
      // Without Web Crypto (a page that is not a secure context) the check step shows no code.
      .catch(() => {
        if (ticket === run) setCode(undefined);
      });
  });
  return { code, now, valid: () => key() !== null };
}

/** Whole seconds until the next code. */
const secondsLeft = (code: LiveTwoStepCode, now: number) => Math.max(0, Math.ceil((code.expiresAt - now) / 1000));

/** The seconds until the next code, as a small ring. */
function CodeTimer(props: { code: LiveTwoStepCode; now: number }) {
  const { t } = useText();
  const seconds = () => secondsLeft(props.code, props.now);
  return (
    <RadialProgress
      class="vault-two-step-timer"
      value={(seconds() / props.code.period) * 100}
      tone={seconds() <= 5 ? "warning" : "accent"}
      aria-label={t("vault.twoStep.remaining", { count: seconds() })}
    />
  );
}

/** The live code at the end of a list row, as an authenticator app shows it. A click copies it. */
export function TwoStepRowCode(props: {
  code: LiveTwoStepCode;
  now: number;
  site: string;
  onCopy: (code: string) => void;
}) {
  const { t } = useText();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      class="vault-two-step-row-code"
      aria-label={t("vault.twoStep.copyFor", { site: props.site, code: groupedTwoStepCode(props.code.code) })}
      onClick={() => props.onCopy(props.code.code)}
    >
      <span class="vault-two-step-digits">{groupedTwoStepCode(props.code.code)}</span>
      <CodeTimer code={props.code} now={props.now} />
    </Button>
  );
}

/** The current code with its timer and a copy button. */
function LiveCode(props: { code: LiveTwoStepCode; now: number; onCopy: (code: string) => void }) {
  const { t } = useText();
  return (
    <div class="vault-two-step-code">
      <span class="vault-two-step-digits">{groupedTwoStepCode(props.code.code)}</span>
      <CodeTimer code={props.code} now={props.now} />
      <IconButton label={t("vault.twoStep.copy")} variant="ghost" onClick={() => props.onCopy(props.code.code)}>
        <Copy />
      </IconButton>
    </div>
  );
}

/** One row of the login dialog that tells whether the login has a two-step code. */
export function TwoStepRow(props: {
  /** Whether the login has a key: saved and not removed, or typed in the setup step. */
  on: boolean;
  code: LiveTwoStepCode | undefined;
  now: number;
  onSetUp: () => void;
  onRemove: () => void;
  onCopy: (code: string) => void;
}) {
  const { t } = useText();
  return (
    <ItemGroup class="vault-wide settings-modal-card" surface="subtle" aria-label={t("vault.twoStep.title")}>
      <Item class="settings-modal-row">
        <ItemMedia>
          <span class="vault-logo integration-logo-tile" aria-hidden="true">
            <ShieldCheck />
          </span>
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{t("vault.twoStep.title")}</ItemTitle>
          <ItemDescription>{props.on ? t("vault.twoStep.on") : t("vault.twoStep.off")}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Show
            when={props.on}
            fallback={
              <Button type="button" variant="outline" size="sm" onClick={() => props.onSetUp()}>
                {t("vault.twoStep.setUp")}
              </Button>
            }
          >
            <Show when={props.code}>{(code) => <LiveCode code={code()} now={props.now} onCopy={props.onCopy} />}</Show>
            <Button type="button" variant="ghost" size="sm" onClick={() => props.onRemove()}>
              {t("common.remove")}
            </Button>
          </Show>
        </ItemActions>
      </Item>
    </ItemGroup>
  );
}

type QrDetectorClass = new (options: {
  formats: string[];
}) => {
  detect: (image: ImageBitmap) => Promise<{ rawValue: string }[]>;
};

declare global {
  interface Window {
    /** Chromium's Shape Detection API; the TypeScript DOM library does not have it yet. */
    BarcodeDetector?: QrDetectorClass;
  }
}

/** The browser's barcode reader, where the platform has one. Chromium on Windows and Linux has none. */
function qrDetectorClass() {
  return typeof window === "undefined" ? undefined : window.BarcodeDetector;
}

/** Reads the QR code in an image. Null when there is none. */
async function readQrImage(Detector: QrDetectorClass, file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const found = await new Detector({ formats: ["qr_code"] }).detect(bitmap);
    return found[0]?.rawValue ?? null;
  } finally {
    bitmap.close();
  }
}

/** The shape of a setup key, in the groups that sites show. A key is not translated. */
const EXAMPLE_KEY = "JBSW Y3DP EHPK 3PXP";

/** Setup, step 1: the key, pasted or read from a screenshot of the QR code. */
export function TwoStepKeyStep(props: {
  site: string;
  keyText: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useText();
  let fileInput: HTMLInputElement | undefined;
  const Detector = qrDetectorClass();
  const [imageFailed, setImageFailed] = createSignal(false);
  return (
    <div class="vault-two-step-setup">
      <Text tone="muted">{t("vault.twoStep.setupIntro", { site: props.site })}</Text>
      <Field
        label={t("vault.twoStep.keyLabel")}
        error={props.invalid ? t("vault.twoStep.keyInvalid") : undefined}
        description={t("vault.twoStep.keyHint")}
      >
        <Input
          autocomplete="off"
          spellcheck={false}
          maxlength={TWO_STEP_KEY_LIMIT}
          placeholder={EXAMPLE_KEY}
          value={props.keyText}
          onValueChange={(value) => {
            setImageFailed(false);
            props.onChange(value);
          }}
        />
      </Field>
      <Show when={Detector}>
        {(detector) => (
          <>
            <div class="vault-two-step-or">
              <span>{t("vault.twoStep.or")}</span>
            </div>
            <Input
              ref={(element: HTMLInputElement) => (fileInput = element)}
              hidden
              type="file"
              accept="image/*"
              onChange={async (event: Event & { currentTarget: HTMLInputElement }) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                const text = await readQrImage(detector(), file).catch(() => null);
                setImageFailed(text === null);
                if (text) props.onChange(text);
              }}
            />
            <Button type="button" variant="outline" onClick={() => fileInput?.click()}>
              <Image aria-hidden="true" />
              {t("vault.twoStep.chooseImage")}
            </Button>
            <Show when={imageFailed()}>
              <Text tone="danger" variant="caption" role="alert">
                {t("vault.twoStep.noQrCode")}
              </Text>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

/** Setup, step 2: the user enters the code on the site, so a wrong key shows before it is saved. */
export function TwoStepCheckStep(props: { site: string; code: LiveTwoStepCode | undefined; now: number }) {
  const { t } = useText();
  return (
    <div class="vault-two-step-setup vault-two-step-check">
      <Text tone="muted">{t("vault.twoStep.checkIntro", { site: props.site })}</Text>
      <Show when={props.code}>
        {(code) => (
          <>
            <div class="vault-two-step-code" data-size="lg">
              <span class="vault-two-step-digits">{groupedTwoStepCode(code().code)}</span>
              <CodeTimer code={code()} now={props.now} />
            </div>
            <Text variant="caption" tone="muted">
              {t("vault.twoStep.checkHint", { count: code().period })}
            </Text>
          </>
        )}
      </Show>
    </div>
  );
}
