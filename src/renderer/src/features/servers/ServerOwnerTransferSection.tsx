import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type { OwnerTransfer } from "@openbot/contracts/owner-transfer";
import { normalizeEmailAddress } from "@openbot/contracts/validation";
import {
  Button,
  ConfirmDialog,
  Crown,
  Field,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
  TriangleAlert,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, Show } from "solid-js";
import { serverRoleCanAdminister } from "./server-capabilities";
import type { ServerSettingsSectionHost } from "./server-settings-section";

export type OwnerTransferCalls = Pick<
  OpenBotDesktopApi["servers"],
  "getOwnerTransfer" | "startOwnerTransfer" | "cancelOwnerTransfer"
>;

const EMAIL_PLACEHOLDER = "person@company.com";

interface OwnerTransferPanel {
  transfer: OwnerTransfer | null;
  step: "closed" | "email" | "confirm";
  email: string;
  emailError: string | null;
  sendError: string | null;
}

export function createServerOwnerTransferSection(
  host: ServerSettingsSectionHost,
  calls: () => OwnerTransferCalls | undefined,
  visible: () => boolean,
) {
  const { t, format, errorMessage } = useText();
  const { props, configured, actionsAvailable, busy, run } = host;
  const [panel, setPanel] = createStore<OwnerTransferPanel>({
    transfer: null,
    step: "closed",
    email: "",
    emailError: null,
    sendError: null,
  });
  const serverId = () => props.server.id;
  const owner = () => props.server.role === "owner";
  const available = () =>
    Boolean(calls()) &&
    props.server.kind === "remote" &&
    props.server.hosted !== true &&
    configured() &&
    serverRoleCanAdminister(props.server);

  async function load(id: string): Promise<void> {
    const api = calls();
    if (!api) return;
    const transfer = await api.getOwnerTransfer(id).catch(() => null);
    if (serverId() !== id) return;
    setPanel((state) => {
      state.transfer = transfer;
    });
  }

  createEffect(
    () => (visible() && available() ? serverId() : null),
    (id) => {
      if (id) void load(id);
    },
  );

  function resetForServer(): void {
    setPanel((state) => {
      state.transfer = null;
      state.step = "closed";
      state.email = "";
      state.emailError = null;
      state.sendError = null;
    });
  }

  function open(): void {
    setPanel((state) => {
      state.step = "email";
      state.emailError = null;
      state.sendError = null;
    });
  }

  function close(): void {
    setPanel((state) => {
      state.step = "closed";
      state.sendError = null;
    });
  }

  function review(): void {
    if (normalizeEmailAddress(panel.email)) {
      setPanel((state) => {
        state.step = "confirm";
        state.emailError = null;
      });
      return;
    }
    setPanel((state) => {
      state.emailError = t("server.invite.invalidEmail");
    });
  }

  async function send(): Promise<void> {
    const api = calls();
    const email = normalizeEmailAddress(panel.email);
    if (!api || !email) return;
    const id = serverId();
    try {
      const transfer = await api.startOwnerTransfer(email, id);
      if (serverId() !== id) return;
      setPanel((state) => {
        state.transfer = transfer;
        state.step = "closed";
        state.email = "";
        state.sendError = null;
      });
    } catch (error) {
      setPanel((state) => {
        state.sendError = errorMessage(error, t("server.ownerTransfer.sendFailed"));
      });
    }
  }

  async function cancel(): Promise<void> {
    const api = calls();
    if (!api) return;
    const id = serverId();
    await run("owner-transfer", async () => {
      await api.cancelOwnerTransfer(id);
      if (serverId() !== id) return;
      setPanel((state) => {
        state.transfer = null;
      });
    });
  }

  function expiry(transfer: OwnerTransfer): string {
    return t("server.ownerTransfer.expires", {
      date: format.date(new Date(transfer.expiresAt), {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    });
  }

  function Panel() {
    return (
      <Show when={available() && (owner() || panel.transfer)}>
        <SettingsSection title={t("server.ownerTransfer.title")}>
          <ItemGroup class="settings-modal-card">
            <Show
              when={panel.transfer}
              fallback={
                <Item>
                  <ItemContent>
                    <ItemTitle>{t("server.ownerTransfer.ownerTitle")}</ItemTitle>
                    <ItemDescription>{t("server.ownerTransfer.ownerDescription")}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!actionsAvailable() || Boolean(busy())}
                      onClick={open}
                    >
                      {t("server.ownerTransfer.start")}
                    </Button>
                  </ItemActions>
                </Item>
              }
            >
              {(transfer) => (
                <Item>
                  <ItemContent>
                    <ItemTitle>{t("server.ownerTransfer.pending", { email: transfer().toEmail })}</ItemTitle>
                    <ItemDescription>{expiry(transfer())}</ItemDescription>
                  </ItemContent>
                  <Show when={owner()}>
                    <ItemActions>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive-ghost"
                        disabled={!actionsAvailable() || Boolean(busy())}
                        loading={busy() === "owner-transfer"}
                        onClick={() => void cancel()}
                      >
                        {t("server.ownerTransfer.cancel")}
                      </Button>
                    </ItemActions>
                  </Show>
                </Item>
              )}
            </Show>
          </ItemGroup>
        </SettingsSection>
      </Show>
    );
  }

  function Dialogs() {
    return (
      <>
        <ConfirmDialog
          open={panel.step === "email"}
          tone="default"
          icon={<Crown />}
          initialFocus="field"
          title={t("server.ownerTransfer.emailTitle", { server: props.server.name })}
          description={t("server.ownerTransfer.emailDescription")}
          confirmLabel={t("common.continue")}
          onCancel={close}
          onConfirm={review}
        >
          <Field label={t("server.ownerTransfer.email")} error={panel.emailError}>
            <Input
              size="md"
              type="email"
              autocomplete="email"
              maxlength={INPUT_LIMITS.email}
              placeholder={EMAIL_PLACEHOLDER}
              value={panel.email}
              onValueChange={(value) =>
                setPanel((state) => {
                  state.email = value;
                  state.emailError = null;
                })
              }
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                review();
              }}
            />
          </Field>
        </ConfirmDialog>
        <ConfirmDialog
          open={panel.step === "confirm"}
          tone="default"
          icon={<TriangleAlert />}
          initialFocus="cancel"
          title={t("server.ownerTransfer.confirmTitle", { email: normalizeEmailAddress(panel.email) ?? panel.email })}
          description={t("server.ownerTransfer.confirmDescription", {
            email: normalizeEmailAddress(panel.email) ?? panel.email,
          })}
          confirmLabel={t("server.ownerTransfer.send")}
          error={panel.sendError ?? undefined}
          onCancel={close}
          onConfirm={send}
        >
          <ul>
            <li>{t("server.ownerTransfer.confirmLoseAccess", { server: props.server.name })}</li>
            <li>{t("server.ownerTransfer.confirmStays")}</li>
            <li>{t("server.ownerTransfer.confirmExpiry")}</li>
          </ul>
        </ConfirmDialog>
      </>
    );
  }

  return { Panel, Dialogs, resetForServer };
}
