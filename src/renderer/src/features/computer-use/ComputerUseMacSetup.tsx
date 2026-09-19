import type { ComputerUseState, DesktopPlatform, MacPermissionId } from "@openbot/contracts/ipc";
import { createSignal, For, onCleanup, onSettled, Show } from "solid-js";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Button,
  CircleCheck,
  Info,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Monitor,
  MousePointer2,
  RefreshCw,
  SettingsSection,
  Skeleton,
  TriangleAlert,
} from "../../components/ui";
import { errorMessage } from "../../error-message";

export interface ComputerUseMacSetupProps {
  platform: DesktopPlatform;
  variant: "settings" | "compact";
}

/** What the user must install, when this computer has no driver. Shown, never run for them. */
const DRIVER_INSTALL_COMMAND = '/bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"';

const PERMISSIONS: ReadonlyArray<{
  id: MacPermissionId;
  title: string;
  description: string;
  icon: typeof Monitor;
}> = [
  {
    id: "screen-recording",
    title: "Screen Recording",
    description: "Lets OpenBot see app windows.",
    icon: Monitor,
  },
  {
    id: "accessibility",
    title: "Accessibility",
    description: "Lets OpenBot click and type.",
    icon: MousePointer2,
  },
];

export function ComputerUseMacSetup(props: ComputerUseMacSetupProps) {
  const desktopApi = window.openbot;
  const [state, setState] = createSignal<ComputerUseState | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [busyPermission, setBusyPermission] = createSignal<MacPermissionId | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  let disposed = false;

  const granted = (permission: MacPermissionId): boolean =>
    state()?.permissions.some((entry) => entry.id === permission && entry.granted) ?? false;

  async function loadState(): Promise<void> {
    if (props.platform !== "darwin" || loading()) return;
    setLoading(true);
    setError(null);
    try {
      const next = await desktopApi.getComputerUseState();
      if (!disposed) setState(next);
    } catch (cause) {
      if (!disposed) setError(errorMessage(cause, "OpenBot could not check Computer Use."));
    } finally {
      if (!disposed) setLoading(false);
    }
  }

  async function openPermission(permission: MacPermissionId): Promise<void> {
    if (busyPermission()) return;
    setBusyPermission(permission);
    setError(null);
    try {
      const next = await desktopApi.openComputerUsePermissionPane(permission);
      if (!disposed) setState(next);
    } catch (cause) {
      if (!disposed) setError(errorMessage(cause, "OpenBot could not open System Settings."));
    } finally {
      if (!disposed) setBusyPermission(null);
    }
  }

  onSettled(() => void loadState());
  onCleanup(() => {
    disposed = true;
  });

  const showPermissions = () => {
    const status = state()?.status;
    return status === "permissions-required" || status === "ready";
  };

  const content = () => (
    <>
      <Show when={loading() && state() === null}>
        <ItemGroup class="computer-use-card computer-use-loading" aria-label="Checking Computer Use">
          <For each={[0, 1]}>
            {() => (
              <Item class="computer-use-row">
                <ItemMedia>
                  <Skeleton class="computer-use-skeleton-icon" />
                </ItemMedia>
                <ItemContent>
                  <Skeleton class="computer-use-skeleton-title" />
                  <Skeleton class="computer-use-skeleton-description" />
                </ItemContent>
              </Item>
            )}
          </For>
        </ItemGroup>
      </Show>

      <Show when={state()?.status === "driver-missing"}>
        <Alert tone="warning" class="computer-use-alert" role="status">
          <AlertIcon>
            <TriangleAlert />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>Install the Computer Use driver</AlertTitle>
            <AlertDescription>
              Run this in Terminal, then check again.
              <code class="computer-use-install-command">{DRIVER_INSTALL_COMMAND}</code>
            </AlertDescription>
          </AlertContent>
          <AlertActions>
            <Button type="button" variant="outline" size="sm" loading={loading()} onClick={() => void loadState()}>
              <RefreshCw aria-hidden="true" />
              Check again
            </Button>
          </AlertActions>
        </Alert>
      </Show>

      <Show when={state()?.status === "unsupported" || state()?.status === "error" || (!loading() && error() !== null)}>
        <Alert tone="warning" class="computer-use-alert" role="status">
          <AlertIcon>
            <TriangleAlert />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>Computer Use isn’t available yet</AlertTitle>
            <AlertDescription>
              {errorMessage(state()?.message ?? error(), "OpenBot could not start the Computer Use driver.")}
            </AlertDescription>
          </AlertContent>
          <AlertActions>
            <Button type="button" variant="outline" size="sm" loading={loading()} onClick={() => void loadState()}>
              <RefreshCw aria-hidden="true" />
              Try again
            </Button>
          </AlertActions>
        </Alert>
      </Show>

      <Show when={showPermissions()}>
        <Show
          when={props.variant === "settings"}
          fallback={<PermissionGroup busy={busyPermission()} granted={granted} onOpen={openPermission} />}
        >
          <SettingsSection title="System permissions" description="Permissions are managed by macOS.">
            <PermissionGroup busy={busyPermission()} granted={granted} onOpen={openPermission} />
          </SettingsSection>
        </Show>
      </Show>

      <Show when={error() && showPermissions()}>
        <Alert tone="danger" class="computer-use-alert" role="alert">
          <AlertIcon>
            <Info />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>Couldn’t open System Settings</AlertTitle>
            <AlertDescription>{error()}</AlertDescription>
          </AlertContent>
        </Alert>
      </Show>
    </>
  );

  return (
    <Show when={props.platform === "darwin"}>
      <Show
        when={props.variant === "settings"}
        fallback={
          <section class="computer-use-compact" aria-labelledby="computer-use-compact-title">
            <header class="computer-use-compact-header">
              <div>
                <h2 id="computer-use-compact-title">Enable Computer Use</h2>
                <p>Let OpenBot see and interact with apps on this Mac.</p>
              </div>
              <span>Optional</span>
            </header>
            {content()}
          </section>
        }
      >
        <div class="computer-use-settings">{content()}</div>
      </Show>
    </Show>
  );
}

function PermissionGroup(props: {
  busy: MacPermissionId | null;
  granted: (permission: MacPermissionId) => boolean;
  onOpen: (permission: MacPermissionId) => Promise<void>;
}) {
  return (
    <ItemGroup class="settings-modal-card computer-use-card computer-use-permission-list">
      <For each={PERMISSIONS}>
        {(permission) => {
          const PermissionIcon = permission.icon;
          return (
            <Item class="settings-modal-row computer-use-row">
              <ItemMedia class="computer-use-permission-icon">
                <PermissionIcon aria-hidden="true" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{permission.title}</ItemTitle>
                <ItemDescription>{permission.description}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Show
                  when={props.granted(permission.id)}
                  fallback={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={props.busy === permission.id}
                      loadingLabel="Opening…"
                      disabled={props.busy !== null}
                      onClick={() => void props.onOpen(permission.id)}
                    >
                      Open settings
                    </Button>
                  }
                >
                  <Badge variant="success-light">
                    <CircleCheck aria-hidden="true" />
                    Granted
                  </Badge>
                </Show>
              </ItemActions>
            </Item>
          );
        }}
      </For>
    </ItemGroup>
  );
}
