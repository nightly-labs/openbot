import { parseInviteUrl } from "@openbot/contracts/invite-links";
import type { RemoteInvitePreview } from "@openbot/team-client/remote-directory";
import { userErrorMessage as errorMessage } from "@openbot/user-errors";
import { router } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ScanLine, Server } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, View } from "react-native";

import { AppLogo } from "@/features/auth/components/app-logo";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";

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

function describeInvite(preview: RemoteInvitePreview): string {
  if (preview.permanent) return `${preview.role} · No expiry`;
  const expires = new Date(preview.expiresAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${preview.role} · Expires ${expires}`;
}

export function AddServerScreen({
  initialInvite = "",
  onJoined,
}: {
  initialInvite?: string;
  onJoined?: () => void;
} = {}) {
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
        setError(errorMessage(cause, "OpenBot could not load this invitation."));
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
      setError(errorMessage(cause, "OpenBot could not join this server."));
      joinInFlight.current = false;
    }
    setJoining(false);
  }

  const connected = joinedServer?.state === "online";

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
          {joinedId ? (connected ? "Connected" : "Invitation accepted") : "Join a server"}
        </Typography.Heading>
        <Typography.Paragraph align="center" className="max-w-80 text-text-secondary">
          {joinedId
            ? connected && joinedServer
              ? `You are connected to ${joinedServer.name}.`
              : `You joined ${joinedServer?.name ?? "the server"}. ${joinedServer?.connectionMessage ?? "Connecting…"}`
            : "Paste or scan the invitation you received from a server owner."}
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
          <Button.Label className="font-sans font-semibold">Done</Button.Label>
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
                accessibilityLabel="Scan invitation QR code"
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
            label="Invite link"
            maxLength={500}
            placeholder="https://openbot.run/join?…"
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
                  {preview?.hostName ?? (previewing ? "Checking invitation…" : "Invitation unavailable")}
                </Typography.Paragraph>
                <Typography.Paragraph type="body-xs" className="text-text-secondary" numberOfLines={1}>
                  {preview
                    ? describeInvite(preview)
                    : previewing
                      ? "Verifying the server identity."
                      : "The server identity must be verified before you join."}
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
              <Button.Label className="font-sans font-semibold">{joining ? "Joining…" : "Join server"}</Button.Label>
            </Button>
          ) : (
            <Button size="lg" onPress={() => setRequest({ url: reviewedInvite })}>
              <Button.Label className="font-sans font-semibold">Try again</Button.Label>
            </Button>
          )}

          <Pressable
            accessibilityRole="button"
            className="min-h-11 items-center justify-center"
            disabled={joining}
            onPress={() => router.back()}
          >
            <Typography.Paragraph weight="semibold" className="text-text-secondary">
              Cancel
            </Typography.Paragraph>
          </Pressable>
        </View>
      )}
    </SheetScrollView>
  );
}
