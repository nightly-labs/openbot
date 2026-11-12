import type { LinkAccountStatus } from "@openbot/contracts/ipc";
import {
  Button,
  buttonVariants,
  ConfirmDialog,
  DropdownMenu,
  Ellipsis,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Link2Off,
  Text,
} from "@openbot/ui";
import { createStore, Show } from "solid-js";
import { useText } from "../../text";

export interface VaultLinkAccountProps {
  status: LinkAccountStatus;
  /** Opens Link's sign-in page in the browser. The status changes when the user approves there. */
  onConnect: () => Promise<void>;
  onCancel: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  /** Where the menu opens, so it stays inside the settings page. */
  menuMount?: HTMLElement | undefined;
}

interface LinkUi {
  busy: boolean;
  failure: string | null;
  disconnecting: boolean;
}

/** The word in the Link mark. It is artwork, so it is not translated. */
const LINK_MARK = "link";

/**
 * The Payment accounts group of the Cards tab: the Link account of this computer. An agent asks the
 * user to approve each payment in Link and gets a one-time card.
 */
export function VaultLinkAccount(props: VaultLinkAccountProps) {
  const { t, errorMessage, sourceText } = useText();
  const [ui, setUi] = createStore<LinkUi>({ busy: false, failure: null, disconnecting: false });

  async function run(action: () => Promise<void>): Promise<boolean> {
    setUi((draft) => {
      draft.busy = true;
      draft.failure = null;
    });
    try {
      await action();
      return true;
    } catch (error) {
      setUi((draft) => {
        draft.failure = errorMessage(error, t("vault.link.failed"));
      });
      return false;
    } finally {
      setUi((draft) => {
        draft.busy = false;
      });
    }
  }

  const detail = () => {
    if (props.status.state === "pending") return t("vault.link.waiting");
    if (props.status.state === "connected") return props.status.email ?? "";
    // Main sends its error as source text, so it shows in the user's language.
    if (props.status.error) return sourceText(props.status.error);
    return props.status.state === "expired" ? t("error.connector.linkExpired") : "";
  };
  const failed = () => props.status.state !== "pending" && props.status.state !== "connected" && detail() !== "";
  // A failed or expired sign-in shows its reason in the danger colour.
  const detailClass = () => (failed() ? "vault-truncate vault-link-error" : "vault-truncate");

  return (
    <div class="vault-link-accounts">
      <Text as="div" variant="caption" tone="muted" class="vault-group-label">
        {t("vault.link.group")}
      </Text>
      <ItemGroup class="settings-modal-card" surface="subtle" aria-label={t("vault.link.group")}>
        <Item class="settings-modal-row">
          <ItemMedia>
            <LinkLogo />
          </ItemMedia>
          <ItemContent>
            <ItemTitle class="vault-truncate">{t("vault.link.name")}</ItemTitle>
            <Show when={detail()}>
              {(text) => (
                <ItemDescription class={detailClass()} aria-live="polite">
                  {text()}
                </ItemDescription>
              )}
            </Show>
          </ItemContent>
          <ItemActions>
            <Show when={props.status.state !== "connected" && props.status.state !== "pending"}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={ui.busy}
                onClick={() => void run(props.onConnect)}
              >
                {t("vault.link.connect")}
              </Button>
            </Show>
            <Show when={props.status.state === "pending"}>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={ui.busy}
                onClick={() => void run(props.onCancel)}
              >
                {t("vault.link.cancel")}
              </Button>
            </Show>
            {/* An expired sign-in keeps its file, so Disconnect stays available. */}
            <Show when={props.status.state === "connected" || props.status.state === "expired"}>
              <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false}>
                <DropdownMenu.Trigger
                  class={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} ui-icon-button`}
                  aria-label={t("vault.link.actions")}
                >
                  <Ellipsis aria-hidden="true" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal mount={props.menuMount ?? document.body}>
                  <DropdownMenu.Content>
                    <DropdownMenu.Item
                      onSelect={() =>
                        setUi((draft) => {
                          draft.failure = null;
                          draft.disconnecting = true;
                        })
                      }
                    >
                      <Link2Off aria-hidden="true" />
                      {t("vault.link.disconnect")}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </Show>
          </ItemActions>
        </Item>
      </ItemGroup>
      <Show when={!ui.disconnecting && ui.failure}>
        {(failure) => (
          <Text tone="danger" variant="caption" role="alert">
            {failure()}
          </Text>
        )}
      </Show>
      <ConfirmDialog
        open={ui.disconnecting}
        title={t("vault.link.disconnectTitle")}
        description={t("vault.link.disconnectDescription")}
        confirmLabel={t("vault.link.disconnect")}
        error={ui.disconnecting && ui.failure ? ui.failure : undefined}
        onCancel={() =>
          setUi((draft) => {
            draft.disconnecting = false;
            draft.failure = null;
          })
        }
        onConfirm={async () => {
          if (await run(props.onDisconnect))
            setUi((draft) => {
              draft.disconnecting = false;
            });
        }}
      />
    </div>
  );
}

/** The Link mark on the light tile of the card brands, in Link's fixed colours. */
function LinkLogo() {
  return (
    <span class="vault-logo vault-card-logo vault-link-logo" aria-hidden="true">
      <svg aria-hidden="true" viewBox="0 0 34 16">
        <circle cx="6" cy="8" r="5.5" fill="#00d66f" />
        <path
          d="M4.4 5.2v5.4h3.4"
          fill="none"
          stroke="#011e0f"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <text
          x="13"
          y="12"
          fill="#011e0f"
          font-family="Arial, Helvetica, sans-serif"
          font-size="11.5"
          font-weight="700"
          letter-spacing="-0.02em"
        >
          {LINK_MARK}
        </text>
      </svg>
    </span>
  );
}
