import { parseWhatsAppPhoneNumber, type WhatsAppLinkState } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { Spinner, Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import {
  groupedPairingCode,
  telegramOrchestrator,
  whatsappNumberName,
  whatsappPhoneNumber,
} from "@/features/servers/model/connectors";
import { useConnectorAction, useServerConnectors } from "@/features/servers/model/use-server-connectors";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** How often the page reads the link while it waits for the phone, as on the desktop. */
const LINK_POLL_MS = 1_000;

const LINK_ERROR = {
  timeout: "mobile.server.connectors.whatsapp.failedTimeout",
  refused: "mobile.server.connectors.whatsapp.failedRefused",
  busy: "mobile.server.connectors.whatsapp.failedBusy",
  unavailable: "mobile.server.connectors.whatsapp.failedUnavailable",
} as const satisfies Record<NonNullable<WhatsAppLinkState["error"]>, MobileTextKey>;

/**
 * Marketplace › Apps › WhatsApp › Link: links a number to the host. The user selects what
 * the number is and types its phone number. The host's session gets a pairing code from WhatsApp, and
 * the user types it in WhatsApp › Linked devices. A phone links only by pairing code: the WhatsApp app
 * on the same phone cannot scan a QR code on its own screen. The page reads the link every second
 * while it waits, and leaving the page before `linked` cancels the link on the host, so nobody can use
 * its code. After the link, the page adds the WhatsApp Orchestrator when no orchestrator exists.
 */
export function ServerWhatsAppLinkScreen() {
  const { t, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { server, agents, whatsappAvailable, whatsapp } = useServerConnectors(serverId, "whatsapp");
  const { startWhatsAppLink, loadWhatsAppLinkState, cancelWhatsAppLink, addWhatsAppOrchestrator } =
    useMobileWorkspaceActions();
  const action = useConnectorAction(whatsapp.refetch);
  const accent = String(useCSSVariable("--openbot-accent"));
  const [ownNumber, setOwnNumber] = useState(true);
  const [phone, setPhone] = useState("");
  const [invalid, setInvalid] = useState(false);
  /** The link that this page started; null while the user chooses. */
  const [link, setLink] = useState<WhatsAppLinkState | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  /** True after this page added the orchestrator, until the agent list shows it. */
  const [added, setAdded] = useState(false);

  /** Each start replaces the one before it, so a slow answer never overwrites a newer link. */
  const links = useRef(0);
  /** True from a start until the link ends in `linked` or the page cancels it. */
  const started = useRef(false);
  const mounted = useRef(true);
  const cancel = useRef<() => void>(() => undefined);
  cancel.current = () => {
    if (!started.current) return;
    started.current = false;
    void cancelWhatsAppLink(serverId).catch(() => undefined);
  };
  // A link that did not end in `linked` is cancelled when the page goes away.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      links.current += 1;
      cancel.current();
    };
  }, []);

  const follow = (state: WhatsAppLinkState, current: number) => {
    if (!mounted.current || current !== links.current) return;
    setLink(state);
    if (state.status === "linked") {
      started.current = false;
      void haptics.notification("success");
      void whatsapp.refetch();
    } else if (state.status === "failed") {
      void haptics.notification("error");
    }
  };
  const followRef = useRef(follow);
  followRef.current = follow;

  const waiting = link?.status === "waiting";
  useEffect(() => {
    if (!waiting) return;
    const current = links.current;
    const timer = setInterval(() => {
      // A failed read is tried again at the next tick; the link ends on its own when it times out.
      loadWhatsAppLinkState(serverId).then(
        (next) => followRef.current(next, current),
        () => undefined,
      );
    }, LINK_POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, serverId, loadWhatsAppLinkState]);

  if (!server || !whatsappAvailable)
    return (
      <SettingsContent>
        <SettingsNote>{t(server ? "mobile.server.connectors.unavailable" : "mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );

  const start = () => {
    if (starting) return;
    const phoneNumber = parseWhatsAppPhoneNumber(phone);
    if (!phoneNumber) {
      setInvalid(true);
      return;
    }
    const current = ++links.current;
    started.current = true;
    setStarting(true);
    setStartError(null);
    startWhatsAppLink({ method: "code", phoneNumber, ownNumber }, serverId)
      .then(
        (state) => {
          // The page went away while the start was on its way: the link stops there too.
          if (!mounted.current) {
            if (state.status !== "linked") void cancelWhatsAppLink(serverId).catch(() => undefined);
            return;
          }
          follow(state, current);
        },
        (cause: unknown) => {
          if (!mounted.current || current !== links.current) return;
          void haptics.notification("error");
          setStartError(errorMessage(cause, t("mobile.server.connectors.whatsapp.failedUnavailable")));
        },
      )
      .finally(() => {
        if (mounted.current && current === links.current) setStarting(false);
      });
  };
  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: "/server-settings/connector", params: { serverId, id: "whatsapp" } });
  };
  const tryAgain = () => {
    links.current += 1;
    setLink(null);
  };

  const connections = whatsapp.data?.connections ?? [];
  const orchestrator = telegramOrchestrator(connections, agents);
  const linkedNumber = link?.status === "linked" ? link.workspaceId : null;
  const linkedConnection = connections.find((connection) => connection.workspaceId === linkedNumber);
  const name = linkedConnection
    ? whatsappNumberName(linkedConnection)
    : linkedNumber
      ? whatsappPhoneNumber(linkedNumber)
      : "";

  if (link?.status === "linked") {
    if (!orchestrator && !added)
      return (
        <SettingsContent>
          <SettingsNote>{t("mobile.server.connectors.whatsapp.agentStepDescription", { number: name })}</SettingsNote>
          {action.error ? (
            <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
              {errorMessage(
                action.error,
                t("mobile.server.connectors.actionFailed", { name: t("mobile.server.connectors.whatsapp.title") }),
              )}
            </Typography.Paragraph>
          ) : null}
          <SettingsSection footer={t("mobile.server.connectors.whatsapp.orchestratorDescription")}>
            <SettingsRow
              disclosure={false}
              disabled={action.busy}
              // The host starts it on its default provider and model.
              onPress={() =>
                void action
                  .perform(async () => {
                    await addWhatsAppOrchestrator(serverId);
                  })
                  .then((done) => {
                    if (done) setAdded(true);
                  })
              }
            >
              <Typography.Paragraph className="text-accent">
                {t("mobile.server.connectors.whatsapp.addAgent")}
              </Typography.Paragraph>
            </SettingsRow>
            <SettingsRow disclosure={false} disabled={action.busy} onPress={close}>
              <Typography.Paragraph className="text-grouped-secondary">
                {t("mobile.server.connectors.later")}
              </Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        </SettingsContent>
      );
    return (
      <SettingsContent>
        <View className="items-center gap-2 px-4">
          <Typography.Heading type="h4" align="center">
            {t("mobile.server.connectors.whatsapp.doneTitle", { number: name })}
          </Typography.Heading>
          <Typography.Paragraph type="body-sm" align="center" className="text-grouped-secondary">
            {t("mobile.server.connectors.whatsapp.note")}
          </Typography.Paragraph>
        </View>
        <SettingsSection>
          <SettingsRow disclosure={false} onPress={close}>
            <Typography.Paragraph className="text-accent">
              {t("mobile.server.connectors.whatsapp.done")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      </SettingsContent>
    );
  }

  if (link?.status === "failed")
    return (
      <SettingsContent>
        <View className="gap-1 px-4" accessibilityRole="alert">
          <Typography.Paragraph className="text-danger-text">
            {t("mobile.server.connectors.whatsapp.failedTitle")}
          </Typography.Paragraph>
          <Typography.Paragraph type="body-sm" className="text-grouped-secondary">
            {t(LINK_ERROR[link.error ?? "unavailable"])}
          </Typography.Paragraph>
        </View>
        <SettingsSection>
          <SettingsRow disclosure={false} onPress={tryAgain}>
            <Typography.Paragraph className="text-accent">
              {t("mobile.server.connectors.whatsapp.tryAgain")}
            </Typography.Paragraph>
          </SettingsRow>
          <SettingsRow disclosure={false} onPress={close}>
            <Typography.Paragraph className="text-danger-text">{t("common.cancel")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      </SettingsContent>
    );

  if (starting || link?.status === "waiting") {
    const code = link?.code ?? null;
    return (
      <SettingsContent>
        {code ? (
          <>
            <SettingsSection>
              <LinkSteps
                steps={[
                  t("mobile.server.connectors.whatsapp.codeStepDevices"),
                  t("mobile.server.connectors.whatsapp.codeStepPhone"),
                  t("mobile.server.connectors.whatsapp.codeStepType"),
                ]}
              />
            </SettingsSection>
            <SettingsSection>
              <SettingsRow
                disclosure={false}
                // Read one character at a time: the user types it in WhatsApp.
                accessibilityLabel={t("mobile.server.connectors.whatsapp.codeLabel", {
                  code: code.split("").join(" "),
                })}
                trailing={
                  <Typography.Paragraph className="text-accent">
                    {t("mobile.server.connectors.whatsapp.copyCode")}
                  </Typography.Paragraph>
                }
                onPress={() =>
                  void Clipboard.setStringAsync(code).then(
                    () => haptics.notification("success"),
                    () => setStartError(t("mobile.server.providers.copyFailed")),
                  )
                }
              >
                <Typography.Heading type="h4" selectable>
                  {groupedPairingCode(code)}
                </Typography.Heading>
              </SettingsRow>
            </SettingsSection>
          </>
        ) : null}
        {startError ? (
          <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
            {startError}
          </Typography.Paragraph>
        ) : null}
        <SettingsSection>
          <SettingsRow disclosure={false} trailing={<Spinner size="sm" color={accent} />}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t(code ? "mobile.server.connectors.whatsapp.codeWaiting" : "mobile.server.connectors.whatsapp.starting")}
            </Typography.Paragraph>
          </SettingsRow>
          {/* Leaving the page cancels the link on the host. */}
          <SettingsRow disclosure={false} onPress={close}>
            <Typography.Paragraph className="text-danger-text">{t("common.cancel")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      </SettingsContent>
    );
  }

  const choice = (own: boolean) => (
    <SettingsRow
      checked={ownNumber === own}
      disclosure={false}
      supportingText={t(
        own
          ? "mobile.server.connectors.whatsapp.kindPersonalDescription"
          : "mobile.server.connectors.whatsapp.kindDedicatedDescription",
      )}
      trailing={ownNumber === own ? <Check size={18} color={accent} strokeWidth={2} /> : null}
      onPress={() => setOwnNumber(own)}
    >
      <Typography.Paragraph>
        {t(own ? "mobile.server.connectors.whatsapp.kindPersonal" : "mobile.server.connectors.whatsapp.kindDedicated")}
      </Typography.Paragraph>
    </SettingsRow>
  );
  return (
    <SettingsContent>
      <SettingsNote>{t("mobile.server.connectors.whatsapp.linkDescription")}</SettingsNote>
      {startError ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="-mt-4 px-4 text-danger-text">
          {startError}
        </Typography.Paragraph>
      ) : null}
      <SettingsSection title={t("mobile.server.connectors.whatsapp.kindLabel")}>
        {choice(true)}
        {choice(false)}
      </SettingsSection>
      <SheetFormField
        label={t("mobile.server.connectors.whatsapp.phoneLabel")}
        inputMode="tel"
        autoCorrect={false}
        isRequired
        value={phone}
        hint={t(
          invalid
            ? "mobile.server.connectors.whatsapp.phoneInvalid"
            : "mobile.server.connectors.whatsapp.phoneDescription",
        )}
        returnKeyType="done"
        onChangeText={(value) => {
          setPhone(value);
          setInvalid(false);
        }}
        onSubmitEditing={start}
      />
      <SettingsSection footer={t("mobile.server.connectors.whatsapp.codeOnly")}>
        <SettingsRow disclosure={false} disabled={phone.trim().length === 0} onPress={start}>
          <Typography.Paragraph className="text-accent">
            {t("mobile.server.connectors.whatsapp.getCode")}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}

/** The steps in WhatsApp, in the order that the user does them. */
function LinkSteps({ steps }: { steps: readonly string[] }) {
  return (
    <View className="gap-3 px-4 py-3">
      {steps.map((step, index) => (
        <View key={step} className="flex-row gap-3">
          <View className="size-6 items-center justify-center rounded-full bg-control">
            <Typography.Paragraph type="body-xs">{index + 1}</Typography.Paragraph>
          </View>
          <Typography.Paragraph className="min-w-0 flex-1">{step}</Typography.Paragraph>
        </View>
      ))}
    </View>
  );
}
