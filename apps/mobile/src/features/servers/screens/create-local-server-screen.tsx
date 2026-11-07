import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { HostLocalServer } from "@openbot/team-client/team-admin-requests";
import type { UserErrorDetails } from "@openbot/user-errors";
import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Button, Spinner, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import CircleCheck from "lucide-react-native/icons/circle-check";
import { useRef, useState } from "react";
import { Keyboard, View } from "react-native";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { showsOnline } from "@/features/workspace/model/server-status";
import { ErrorReference } from "@/shared/components/error-reference";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/**
 * Makes a server on the computer of `serverId`, beside that computer's own server (`local-servers-v1`).
 * The computer registers it for the account, so it then shows in the server list as any other server.
 */
export function CreateLocalServerScreen() {
  const { t, errorDetails } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const queryScope = useQueryScope();
  const [foreground, success] = useThemeColor(["foreground", "success"]);
  const { servers, canCreateLocalServers } = useMobileWorkspace();
  const { listLocalServers, createLocalServer, selectServer } = useMobileWorkspaceActions();
  const computer = servers.find((server) => server.id === serverId);
  const available = Boolean(computer && showsOnline(computer) && canCreateLocalServers(serverId));
  const list = useQuery({
    queryKey: queryKeys.localServers(queryScope, serverId),
    enabled: available,
    retry: false,
    queryFn: () => listLocalServers(serverId),
  });
  const limitReached = list.data ? list.data.servers.length >= list.data.limit : false;
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<HostLocalServer | null>(null);
  const [error, setError] = useState<UserErrorDetails | null>(null);
  const pending = useRef(false);
  const trimmed = name.trim();
  const nameTooShort = trimmed.length < INPUT_LIMITS.serverNameMin;
  // A create cannot be stopped on the computer; the sheet stays until the answer arrives.
  usePreventRemove(creating, () => {});
  const createdServer = created ? servers.find((server) => server.id === created.serverId) : undefined;

  async function create() {
    if (!available || nameTooShort || limitReached || pending.current) return;
    pending.current = true;
    Keyboard.dismiss();
    setCreating(true);
    setError(null);
    try {
      setCreated(await createLocalServer(serverId, trimmed));
      void haptics.notification("success");
    } catch (cause) {
      void haptics.notification("error");
      setError(errorDetails(cause, t("mobile.server.local.createFailed")));
      pending.current = false;
    }
    setCreating(false);
  }

  if (created) {
    const computerName = computer?.name ?? "";
    return (
      <SheetScrollView className="bg-sheet" contentContainerClassName="gap-6 px-5 pb-safe-offset-5 pt-5">
        <Stack.Screen options={{ title: t("mobile.server.local.title") }} />
        <View className="items-center gap-2 px-4">
          <View className="mb-2 size-16 items-center justify-center rounded-full bg-control">
            {createdServer || !created.published ? (
              <CircleCheck size={34} strokeWidth={1.8} color={success} />
            ) : (
              <Spinner size="md" color={String(foreground)} />
            )}
          </View>
          <Typography.Heading type="h3" align="center">
            {t("mobile.server.local.created")}
          </Typography.Heading>
          <Typography.Paragraph type="body-sm" align="center" className="max-w-80 text-text-secondary">
            {!created.published
              ? t("mobile.server.local.notPublished", { name: created.name, computer: computerName })
              : createdServer
                ? t("mobile.server.local.createdOn", { name: created.name, computer: computerName })
                : t("mobile.server.local.waiting", { name: created.name })}
          </Typography.Paragraph>
        </View>
        {createdServer ? (
          <Button
            size="lg"
            onPress={() => {
              void haptics.impact("soft");
              selectServer(createdServer.id);
              router.dismissTo("/connected");
            }}
          >
            <Button.Label className="font-sans font-semibold">{t("mobile.server.local.open")}</Button.Label>
          </Button>
        ) : (
          <Button
            size="lg"
            variant="secondary"
            onPress={() => {
              void haptics.impact("soft");
              router.dismissTo("/connected");
            }}
          >
            <Button.Label className="font-sans font-semibold">{t("common.done")}</Button.Label>
          </Button>
        )}
      </SheetScrollView>
    );
  }

  return (
    <SheetScrollView
      className="bg-sheet"
      contentContainerClassName="gap-5 px-5 pb-safe-offset-5 pt-5"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: t("mobile.server.local.title") }} />
      <SheetSaveAction
        dirty={trimmed.length > 0}
        canSave={available && !nameTooShort && !limitReached}
        pending={creating}
        label={t("mobile.server.local.create")}
        pendingLabel={t("mobile.server.local.creating")}
        onSave={() => void create()}
      />
      <Typography.Paragraph type="body-sm" className="text-text-secondary">
        {t("mobile.server.local.description", { name: computer?.name ?? "" })}
      </Typography.Paragraph>
      <SheetFormField
        label={t("mobile.server.local.nameLabel")}
        value={name}
        onChangeText={(value) => {
          setName(value);
          if (error) setError(null);
        }}
        editable={!creating && !limitReached}
        maxLength={INPUT_LIMITS.serverName}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => void create()}
      />
      {trimmed && nameTooShort ? (
        <Typography.Paragraph type="body-sm" className="text-text-secondary">
          {t("mobile.server.local.nameTooShort", { limit: INPUT_LIMITS.serverNameMin })}
        </Typography.Paragraph>
      ) : null}
      {limitReached && list.data ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {t("mobile.server.local.limitReached", { name: computer?.name ?? "", limit: list.data.limit })}
        </Typography.Paragraph>
      ) : null}
      {!available ? (
        <Typography.Paragraph className="text-muted">{t("mobile.server.local.unsupported")}</Typography.Paragraph>
      ) : null}
      {error ? (
        <View className="gap-1">
          <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
            {error.message}
          </Typography.Paragraph>
          <ErrorReference reference={error.reference} />
        </View>
      ) : null}
    </SheetScrollView>
  );
}
