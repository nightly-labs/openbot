import { parseInviteUrl } from "@openbot/contracts/invite-links";
import type { AppFormat, MobileTranslate } from "@openbot/i18n/mobile";
import type { RemoteInvitePreview } from "@openbot/team-client/remote-directory";
import { router } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ScanLine, Server } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, View } from "react-native";

import { AppLogo } from "@/features/auth/components/app-logo";
import { SERVER_ROLE_KEYS } from "@/features/servers/model/server-role";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { currentText, useText } from "@/shared/lib/text";

const INVITE_PLACEHOLDER = "https://openbot.run/join?…";

function normalizeInviteUrl(value: string): string | null {
  const invite = value.trim();
  if (!invite) return null;
  try {
    parseInviteUrl(invite);
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
}: {
  initialInvite?: string;
  onJoined?: () => void;
} = {}) {
  const { t, format, errorMessage, sourceText } = useText();
  const [foreground, accentForeground] = useThemeColor(["foreground", "accent-foreground"]);
  const { addRemoteServer, servers, teamDirectory } = useMobileWorkspace();
  const [joinedId, setJoinedId] = useState<string | null>(null);
  const joinedServer = servers.find((server) => server.id === joinedId);
  const [inviteLink, setInviteLink] = useState(initialInvite);
  // A new object repeats a failed preview for the same link; an unchanged link keeps the result.
  const [request, setRequest] = useState(() => {
    const url = normalizeInviteUrl(initialInvite);
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
    const url = normalizeInviteUrl(value);
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
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.server.invite.joinFailed")));
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
      contentContainerClassName="gap-7 px-5 pb-safe-offset-5 pt-20"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    >
      <View className="items-center gap-3 px-4">
        <AppLogo animation="blink" followDeviceOrientation interactive size={72} />
        <Typography.Heading type="h3" align="center" className="pt-1">
          {joinedId
            ? connected
              ? t("mobile.server.join.connected")
              : t("mobile.server.join.accepted")
            : t("mobile.server.join.title")}
        </Typography.Heading>
        <Typography.Paragraph align="center" className="max-w-80 text-text-secondary">
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
            if (onJoined) onJoined();
            else router.back();
          }}
        >
          <Button.Label className="font-sans font-semibold">{t("common.done")}</Button.Label>
        </Button>
      ) : (
        <View className="gap-5">
          <SheetFormField
            autoCapitalize="none"
            autoCorrect={false}
            editable={!joining}
            trailing={
              <Button
                isIconOnly
                variant="ghost"
                accessibilityLabel={t("mobile.server.join.scan")}
                isDisabled={joining}
                onPress={() => {
                  Keyboard.dismiss();
                  router.push("/add-server/scan");
                }}
              >
                <ScanLine size={22} color={foreground} />
              </Button>
            }
            inputMode="url"
            label={t("mobile.server.join.inviteLink")}
            maxLength={500}
            placeholder={INVITE_PLACEHOLDER}
            returnKeyType="go"
            value={inviteLink}
            onChangeText={changeLink}
            onSubmitEditing={() => void joinServer()}
          />

          {reviewedInvite ? (
            <View className="flex-row items-center gap-3 rounded-3xl bg-control px-4 py-4">
              <View className="size-12 items-center justify-center rounded-2xl bg-accent">
                <Server color={accentForeground} size={23} strokeWidth={1.8} />
              </View>
              <View className="min-w-0 flex-1 gap-0.5">
                <Typography.Paragraph weight="semibold">
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
            </View>
          ) : null}

          {error ? (
            <Typography.Paragraph accessibilityRole="alert" align="center" className="text-danger-text">
              {error}
            </Typography.Paragraph>
          ) : null}

          {preview || !reviewedInvite || previewing ? (
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

          <Pressable
            accessibilityRole="button"
            className="min-h-11 items-center justify-center"
            disabled={joining}
            onPress={() => router.back()}
          >
            <Typography.Paragraph weight="semibold" className="text-text-secondary">
              {t("common.cancel")}
            </Typography.Paragraph>
          </Pressable>
        </View>
      )}
    </SheetScrollView>
  );
}
