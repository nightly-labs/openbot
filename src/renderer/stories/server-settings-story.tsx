import type { HostReleaseStatus, HostUpdateStatus } from "@openbot/contracts/ipc";
import { onSettled, snapshot } from "solid-js";
import { fn } from "storybook/test";
import { ServerSettingsModal, type ServerSettingsModalProps } from "../src/features/servers/ServerSettingsModal";
import { STORY_HOST_STATUS, STORY_INVITES, STORY_PRESENCE, STORY_SERVERS } from "../src/preview/fixtures";
import { createMockOpenBot } from "./mock-openbot";
import { SettingsPageStory } from "./settings-page-story";

function storyServer(kind: (typeof STORY_SERVERS)[number]["kind"]) {
  const server = STORY_SERVERS.find((item) => item.kind === kind);
  if (!server) throw new Error(`Story server fixtures need a ${kind} server.`);
  return server;
}

export const STORY_LOCAL_SERVER = storyServer("local");
export const STORY_REMOTE_SERVER = storyServer("remote");

/** The props of the real Server settings for this computer, without its optional sections. */
export const serverSettingsArgs = () =>
  ({
    open: true,
    platform: "darwin",
    server: STORY_LOCAL_SERVER,
    hostStatus: STORY_HOST_STATUS,
    members: STORY_PRESENCE.members,
    invites: STORY_INVITES,
    loading: false,
    loadError: null,
    onRetry: fn(async () => undefined),
    onSaveIdentity: fn(async () => undefined),
    onSetPublished: fn(async () => undefined),
    onCreateInvite: fn(async (input) => ({
      id: "invite-story",
      inviteUrl: "https://team.example.com/invite/story",
      expiresAt: "2026-08-29T10:00:00.000Z",
      role: input.role,
      usedAt: null,
      email: input.email ?? null,
      permanent: input.permanent ?? false,
      useCount: 0,
    })),
    onUpdateMember: fn(async () => undefined),
    onRemoveMember: fn(async () => undefined),
    onRevokeInvite: fn(async () => undefined),
    onOpenScreenRecordingSettings: fn(async () => undefined),
    onRecheckScreenRecording: fn(async () => undefined),
  }) satisfies Omit<ServerSettingsModalProps, "page">;

/** The real Server settings page, with a preview `window.openbot` for the panels that read it. */
export function ServerSettingsStory(props: {
  settings: Omit<ServerSettingsModalProps, "page">;
  hostUpdate?: HostUpdateStatus;
  hostRelease?: HostReleaseStatus;
}) {
  const previous = window.openbot;
  // Storybook passes the args as a store, and the mock copies its options with `structuredClone`.
  const hostStatus = props.settings.hostStatus;
  const mock = createMockOpenBot({
    ...(hostStatus ? { hostStatus: snapshot(hostStatus) } : {}),
    ...(props.hostUpdate ? { hostUpdate: props.hostUpdate } : {}),
    ...(props.hostRelease ? { hostRelease: props.hostRelease } : {}),
  });
  window.openbot = mock.api;
  onSettled(() => () => {
    mock.dispose();
    window.openbot = previous;
  });
  return (
    <SettingsPageStory title="Server settings">
      {(page) => <ServerSettingsModal {...props.settings} page={page()} />}
    </SettingsPageStory>
  );
}
