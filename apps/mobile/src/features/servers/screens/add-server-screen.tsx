import { type InviteLinkOptions, parseInviteUrl, selfHostedApiOrigin } from "@openbot/contracts/invite-links";
import type { AppFormat, MobileTranslate } from "@openbot/i18n/mobile";
import type { RemoteInvitePreview } from "@openbot/team-client/remote-directory";
import * as Clipboard from "expo-clipboard";
import { type Href, router } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Button, Spinner, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { CircleCheck, ClipboardPaste, ScanLine, Server } from "lucide-react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AppState, Keyboard, Pressable, View } from "react-native";

import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SERVER_ROLE_KEYS } from "@/features/servers/model/server-role";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { isIOS } from "@/shared/lib/platform";
import { currentText, useText } from "@/shared/lib/text";

const INVITE_PLACEHOLDER = "https://openbot.run/join?…";

function normalizeInviteUrl(value: string, options: InviteLinkOptions): string | null {
  const invite = value.trim();
  if (!invite) return null;
  try {
    parseInviteUrl(invite, options);
    return invite;
  } catch {
    return null;
  }
}

function describeInvite(preview: RemoteInvitePreview, t: MobileTranslate, format: AppFormat): string {
  if (preview.permanent) return t("mobile.server.invite.noExpiry", { role: t(SERVER_ROLE_KEYS[preview.role]) });
  const expires = format.date(new Date(preview.expiresAt), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return t("mobile.server.invite.expires", { role: t(SERVER_ROLE_KEYS[preview.role]), date: expires });
}

export function AddServerScreen({
  initialInvite = "",
  onJoined,
  scanHref = "/add-server/scan",
  underHeader = false,
}: {
  initialInvite?: string;
  onJoined?: () => void;
  /** The scanner page of the sheet that shows this page. */
  scanHref?: Href;
  /** An inner page under a native header: its back button replaces Cancel. */
  underHeader?: boolean;
} = {}) {
  const { t, format, errorMessage, sourceText } = useText();
  const [foreground, accentForeground, success] = useThemeColor(["foreground", "accent-foreground", "success"]);
  const { addRemoteServer, servers, teamDirectory } = useMobileWorkspace();
  const { session } = useMobileSession();
  const inviteLinks = { selfHostedApiOrigin: selfHostedApiOrigin(session?.apiUrl) };
  const [joinedId, setJoinedId] = useState<string | null>(null);
  const joinedServer = servers.find((server) => server.id === joinedId);
  const [inviteLink, setInviteLink] = useState(initialInvite);
  // A new object repeats a failed preview for the same link; an unchanged link keeps the result.
  const [request, setRequest] = useState(() => {
    const url = normalizeInviteUrl(initialInvite, inviteLinks);
    return url ? { url } : null;
  });
  const reviewedInvite = request?.url ?? null;
  const [preview, setPreview] = useState<RemoteInvitePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const joinInFlight = useRef(false);
  usePreventRemove(joining, () => {
    // A join can consume a single-use token; wait for its result before leaving.
  });

  useEffect(() => {
    let active = true;
    setPreview(null);
    setError(null);
    if (!request) {
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    void teamDirectory.previewInvite(request.url).then(
      (value) => {
        if (!active) return;
        setPreview(value);
        setPreviewing(false);
      },
      (cause) => {
        if (!active) return;
        const text = currentText();
        setError(text.errorMessage(cause, text.t("mobile.server.invite.loadFailed")));
        setPreviewing(false);
      },
    );
    return () => {
      active = false;
    };
  }, [request, teamDirectory]);

  // Verification starts as soon as the field holds a complete invitation, so a paste needs no
  // separate review step before the server identity is shown.
  function changeLink(value: string): void {
    setInviteLink(value);
    const url = normalizeInviteUrl(value, inviteLinks);
    setRequest((current) => (url === null ? null : current?.url === url ? current : { url }));
    if (url === null) setError(null);
  }

  async function joinServer(): Promise<void> {
    if (!reviewedInvite || !preview || previewing || joinInFlight.current) return;
    joinInFlight.current = true;
    Keyboard.dismiss();
    setJoining(true);
    setError(null);
    try {
      const serverId = await addRemoteServer({ inviteUrl: reviewedInvite });
      setJoinedId(serverId);
      void haptics.notification("success");
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.server.invite.joinFailed")));
      void haptics.notification("error");
      joinInFlight.current = false;
    }
    setJoining(false);
  }

  const connected = joinedServer?.state === "online";
  const joinStatus = joinedServer?.connectionMessage
    ? sourceText(joinedServer.connectionMessage)
    : t("common.connecting");
  const joinedStatus = (name: string | undefined, status: string) =>
    name ? t("mobile.server.join.joinedNamed", { name, status }) : t("mobile.server.join.joined", { status });

  return (
    <SheetScrollView
      scrollEdgeEffect={false}
      className="bg-sheet"
      contentContainerClassName={`gap-6 px-5 pb-safe-offset-5 ${underHeader ? "pt-4" : "pt-12"}`}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    >
      <View className="items-center gap-2 px-4">
        {joinedId ? (
          <View className="mb-2 size-16 items-center justify-center rounded-full bg-control">
            {connected ? (
              <CircleCheck size={34} strokeWidth={1.8} color={success} />
            ) : (
              <Spinner size="md" color={String(foreground)} />
            )}
          </View>
        ) : null}
        <Typography.Heading type="h3" align="center">
          {joinedId
            ? connected
              ? t("mobile.server.join.connected")
              : t("mobile.server.join.accepted")
            : t("mobile.server.join.title")}
        </Typography.Heading>
        <Typography.Paragraph type="body-sm" align="center" className="max-w-80 text-text-secondary">
          {joinedId
            ? connected && joinedServer
              ? t("mobile.server.join.connectedTo", { name: joinedServer.name })
              : joinedStatus(joinedServer?.name, joinStatus)
            : t("mobile.server.join.description")}
        </Typography.Paragraph>
      </View>

      {joinedId ? (
        <Button
          size="lg"
          onPress={() => {
            void haptics.impact("soft");
            if (onJoined) onJoined();
            else router.back();
          }}
        >
          <Button.Label className="font-sans font-semibold">{t("common.done")}</Button.Label>
        </Button>
      ) : (
        <View className="gap-4">
          <View className="gap-3">
            <SheetFormField
              autoCapitalize="none"
              autoCorrect={false}
              editable={!joining}
              hideLabel
              inputMode="url"
              label={t("mobile.server.join.inviteLink")}
              maxLength={500}
              placeholder={INVITE_PLACEHOLDER}
              returnKeyType="go"
              value={inviteLink}
              onChangeText={changeLink}
              onSubmitEditing={() => void joinServer()}
            />
            <View className="flex-row gap-3">
              <PasteInviteButton disabled={joining} onPaste={changeLink} />
              <QuickAction
                accessibilityLabel={t("mobile.server.join.scan")}
                disabled={joining}
                icon={<ScanLine size={18} strokeWidth={1.8} color={foreground} />}
                label={t("mobile.server.join.scanShort")}
                onPress={() => {
                  Keyboard.dismiss();
                  router.push(scanHref);
                }}
              />
            </View>
          </View>

          {reviewedInvite ? (
            <View className="flex-row items-center gap-3 rounded-grouped bg-grouped px-4 py-3.5">
              <View className="size-11 items-center justify-center rounded-xl bg-accent">
                <Server color={accentForeground} size={21} strokeWidth={1.8} />
              </View>
              <View className="min-w-0 flex-1 gap-0.5">
                <Typography.Paragraph weight="semibold" numberOfLines={1}>
                  {preview?.hostName ??
                    (previewing ? t("mobile.server.invite.checking") : t("mobile.server.invite.unavailable"))}
                </Typography.Paragraph>
                <Typography.Paragraph type="body-xs" className="text-text-secondary" numberOfLines={1}>
                  {preview
                    ? describeInvite(preview, t, format)
                    : previewing
                      ? t("mobile.server.invite.verifying")
                      : t("mobile.server.invite.verifyRequired")}
                </Typography.Paragraph>
              </View>
              {previewing ? <Spinner size="sm" color={String(foreground)} /> : null}
            </View>
          ) : null}

          {error ? (
            <Typography.Paragraph accessibilityRole="alert" align="center" className="text-danger-text">
              {error}
            </Typography.Paragraph>
          ) : null}

          {/* The join button shows once the field has text, so an empty sheet has no dimmed button. */}
          {!inviteLink.trim() ? null : preview || !reviewedInvite || previewing ? (
            <Button size="lg" isDisabled={!preview || joining || previewing} onPress={() => void joinServer()}>
              <Button.Label className="font-sans font-semibold">
                {joining ? t("mobile.server.join.joining") : t("mobile.server.join.submit")}
              </Button.Label>
            </Button>
          ) : (
            <Button size="lg" onPress={() => setRequest({ url: reviewedInvite })}>
              <Button.Label className="font-sans font-semibold">{t("common.tryAgain")}</Button.Label>
            </Button>
          )}

          {underHeader ? null : (
            <Pressable
              accessibilityRole="button"
              className="min-h-11 items-center justify-center"
              disabled={joining}
              onPress={() => {
                void haptics.impact("soft");
                router.back();
              }}
            >
              <Typography.Paragraph weight="semibold" className="text-text-secondary">
                {t("common.cancel")}
              </Typography.Paragraph>
            </Pressable>
          )}
        </View>
      )}
    </SheetScrollView>
  );
}

/** The height and shape of the two quiet actions under the field. */
const QUICK_ACTION_CLASS = `h-12 flex-1 overflow-hidden bg-control ${isIOS ? "" : "rounded-2xl"}`;
/** The corners of `SheetFormField` on iOS, so the actions match the field above them. Android uses its class. */
const QUICK_ACTION_SHAPE = isIOS ? ({ borderCurve: "continuous", borderRadius: 16 } as const) : null;

function QuickAction({
  accessibilityLabel,
  disabled,
  icon,
  label,
  onPress,
}: {
  accessibilityLabel?: string;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      className={`${QUICK_ACTION_CLASS} flex-row items-center justify-center gap-2`}
      disabled={disabled}
      style={({ pressed }) => [QUICK_ACTION_SHAPE, { opacity: disabled ? 0.5 : pressed ? 0.6 : 1 }]}
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
    >
      {icon}
      <Typography.Paragraph weight="medium">{label}</Typography.Paragraph>
    </Pressable>
  );
}

/**
 * Paste the invitation from the clipboard: the text, or a link that another app copied as a link.
 * It is the app's own action, so it always shows; it is dimmed while the clipboard has neither.
 */
function PasteInviteButton({ disabled, onPaste }: { disabled: boolean; onPaste: (value: string) => void }) {
  const { t } = useText();
  const [foreground] = useThemeColor(["foreground"]);
  const pasteable = useClipboardHasLink();
  return (
    <QuickAction
      disabled={disabled || !pasteable}
      icon={<ClipboardPaste size={18} strokeWidth={1.8} color={foreground} />}
      label={t("mobile.server.join.paste")}
      onPress={() => {
        void readClipboardLink().then(
          (value) => {
            if (value) onPaste(value);
          },
          () => undefined,
        );
      }}
    />
  );
}

async function readClipboardLink(): Promise<string> {
  const text = (await Clipboard.getStringAsync()).trim();
  if (text) return text;
  return ((await Clipboard.getUrlAsync()) ?? "").trim();
}

/**
 * Whether the clipboard has text or a link. These checks read no content, so iOS shows no paste
 * prompt. The user copies the invitation in another app, so the check runs again on each return.
 */
function useClipboardHasLink(): boolean {
  const [pasteable, setPasteable] = useState(false);
  useEffect(() => {
    let active = true;
    const check = () => {
      void Promise.all([Clipboard.hasStringAsync(), Clipboard.hasUrlAsync()]).then(
        ([text, url]) => {
          if (active) setPasteable(text || url);
        },
        () => undefined,
      );
    };
    check();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return pasteable;
}
