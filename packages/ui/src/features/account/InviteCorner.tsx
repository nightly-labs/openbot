import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { referralCodeFromInput } from "@openbot/contracts/referral";
import { ArrowRight, Button, Gift, Input, Popover, X } from "@openbot/ui";
import { createSignal, onSettled, Show, untrack } from "solid-js";
import { useText } from "../../text";

interface InviteCornerProps {
  code: string | null;
  onChange: (code: string | null) => void;
  onAdded: (from: Element | undefined) => void;
}

export function InviteCorner(props: InviteCornerProps) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  let corner: HTMLDivElement | undefined;
  return (
    <div class="account-login-invite" ref={corner}>
      <Popover.Root open={open()} onOpenChange={setOpen} placement="top-start" gutter={8} modal={false}>
        <Popover.Trigger class="account-login-quiet" data-has-code={props.code ? "true" : undefined}>
          <Gift size={14} aria-hidden="true" />
          <Show when={props.code} fallback={t("account.login.inviteCorner")}>
            {(code) => (
              <>
                <span class="sr-only">{t("account.login.inviteCorner")}</span>
                <span class="account-login-invite-code">{code()}</span>
              </>
            )}
          </Show>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content class="ui-action-menu account-login-invite-popover">
            <Popover.Title class="sr-only">{t("account.login.inviteCorner")}</Popover.Title>
            <InviteEntry
              code={props.code}
              onDone={(code) => {
                setOpen(false);
                const added = code !== null && code !== props.code;
                props.onChange(code);
                if (added) props.onAdded(corner);
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Show when={props.code}>
        <Button
          variant="ghost"
          size="icon-xs"
          class="account-login-invite-remove"
          aria-label={t("account.login.inviteRemove")}
          onClick={() => props.onChange(null)}
        >
          <X size={12} aria-hidden="true" />
        </Button>
      </Show>
    </div>
  );
}

function InviteEntry(props: { code: string | null; onDone: (code: string | null) => void }) {
  const { t } = useText();
  let input: HTMLInputElement | undefined;
  onSettled(() => input?.focus());
  const [text, setText] = createSignal(untrack(() => props.code ?? ""));
  const [invalid, setInvalid] = createSignal(false);
  const save = () => {
    const value = text().trim();
    if (!value) {
      props.onDone(null);
      return;
    }
    const code = referralCodeFromInput(value);
    if (!code) {
      setInvalid(true);
      return;
    }
    props.onDone(code);
  };
  return (
    <form
      class="account-login-invite-entry"
      novalidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label class="sr-only" for="account-invite-code">
        {t("account.login.inviteCode")}
      </label>
      <div class="account-login-invite-field" data-invalid={invalid() ? "true" : undefined}>
        <Input
          ref={input}
          id="account-invite-code"
          autocomplete="off"
          autocapitalize="none"
          spellcheck={false}
          placeholder={t("account.login.inviteCode")}
          maxlength={INPUT_LIMITS.inviteUrl}
          value={text()}
          aria-invalid={invalid() ? "true" : undefined}
          aria-describedby={invalid() ? "account-invite-code-error" : undefined}
          onValueChange={(value) => {
            setText(value);
            setInvalid(false);
          }}
        />
        <Button type="submit" variant="ghost" size="icon-sm" aria-label={t("account.login.inviteUse")}>
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </div>
      <Show when={invalid()}>
        <p id="account-invite-code-error" class="account-login-invite-error" role="alert">
          {t("account.login.inviteCodeInvalid")}
        </p>
      </Show>
    </form>
  );
}
