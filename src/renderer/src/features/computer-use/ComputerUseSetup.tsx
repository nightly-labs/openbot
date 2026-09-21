import type { ComputerUseState, MacPermissionId } from "@openbot/contracts/ipc";
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

export interface ComputerUseSetupProps {
  /**
   * Which of the two shapes to draw: the settings panel, or the compact card of the setup flow.
   *
   * There is no platform here. What one desktop asks for and another does not is the driver's own
   * answer - the list of permissions, and the status - never a table this component keeps.
   */
  variant: "settings" | "compact";
}

/**
 * How each grant is described. Which of them apply is the driver's answer, never this table: only
 * macOS puts a permission between OpenBot and the desktop, and a row shown elsewhere would name a
 * setting the user cannot find.
 */
const PERMISSION_DETAILS: Record<MacPermissionId, { title: string; description: string; icon: typeof Monitor }> = {
  "screen-recording": {
    title: "Screen Recording",
    description: "Lets OpenBot see app windows.",
    icon: Monitor,
  },
  accessibility: {
    title: "Accessibility",
    description: "Lets OpenBot click and type.",
    icon: MousePointer2,
  },
};

export function ComputerUseSetup(props: ComputerUseSetupProps) {
  const desktopApi = window.openbot;
  const [state, setState] = createSignal<ComputerUseState | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [busyPermission, setBusyPermission] = createSignal<MacPermissionId | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  let disposed = false;

  const permissions = () => state()?.permissions ?? [];

  async function loadState(): Promise<void> {
    if (loading()) return;
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

  // A grant is given in System Settings, outside this window, and the driver reports only what it
  // sees when it is asked. Coming back to OpenBot is the moment the answer may have changed, so the
  // panel asks again rather than keeping a row that is granted already.
  const recheckOnReturn = () => {
    if (showPermissions()) void loadState();
  };
  window.addEventListener("focus", recheckOnReturn);

  onSettled(() => void loadState());
  onCleanup(() => {
    disposed = true;
    window.removeEventListener("focus", recheckOnReturn);
  });

  const showPermissions = () => {
    const status = state()?.status;
    return (status === "permissions-required" || status === "ready") && permissions().length > 0;
  };

  /** Every status that leaves Computer Use not working, which the one alert below reports. */
  const unavailable = () => {
    const status = state()?.status;
    return status === "unsupported" || status === "driver-missing" || status === "error";
  };

  /**
   * The manual way back, for a user whose desktop gave this window no focus event.
   *
   * Offered while the rows are up, granted or not: a grant is taken away in System Settings as
   * easily as it is given, and a panel that reads "Granted" with no way to ask again would keep
   * saying so long after macOS stopped agreeing.
   */
  const recheck = () => (
    <Show when={showPermissions()}>
      <div class="computer-use-recheck">
        <Button type="button" variant="outline" size="sm" loading={loading()} onClick={() => void loadState()}>
          <RefreshCw aria-hidden="true" />
          Check again
        </Button>
      </div>
    </Show>
  );

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

      {/*
       * One alert for every fault, the missing driver included. OpenBot carries the driver, so a
       * build without one is a fault of that build and not a thing the user installs by hand; the
       * panel therefore names no command and offers the same way back as the rest.
       */}
      <Show when={unavailable() || (!loading() && error() !== null)}>
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
          fallback={
            <>
              <PermissionGroup busy={busyPermission()} permissions={permissions()} onOpen={openPermission} />
              {recheck()}
            </>
          }
        >
          <SettingsSection title="System permissions" description="Permissions are managed by macOS.">
            <PermissionGroup busy={busyPermission()} permissions={permissions()} onOpen={openPermission} />
            {recheck()}
          </SettingsSection>
        </Show>
      </Show>

      <Show when={state()?.status === "ready" && permissions().length === 0}>
        <Alert tone="success" class="computer-use-alert" role="status">
          <AlertIcon>
            <CircleCheck />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>Computer Use is ready</AlertTitle>
            <AlertDescription>
              OpenBot can see and interact with apps on this computer. This system asks for no extra permission.
            </AlertDescription>
          </AlertContent>
        </Alert>
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
    <Show
      when={props.variant === "settings"}
      fallback={
        <section class="computer-use-compact" aria-labelledby="computer-use-compact-title">
          <header class="computer-use-compact-header">
            <div>
              <h2 id="computer-use-compact-title">Enable Computer Use</h2>
              <p>Let OpenBot see and interact with apps on this computer.</p>
            </div>
            <span>Optional</span>
          </header>
          {content()}
        </section>
      }
    >
      <div class="computer-use-settings">{content()}</div>
    </Show>
  );
}

function PermissionGroup(props: {
  busy: MacPermissionId | null;
  permissions: ComputerUseState["permissions"];
  onOpen: (permission: MacPermissionId) => Promise<void>;
}) {
  return (
    <ItemGroup class="settings-modal-card computer-use-card computer-use-permission-list">
      <For each={props.permissions}>
        {(permission) => {
          const details = PERMISSION_DETAILS[permission.id];
          const PermissionIcon = details.icon;
          return (
            <Item class="settings-modal-row computer-use-row">
              <ItemMedia class="computer-use-permission-icon">
                <PermissionIcon aria-hidden="true" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{details.title}</ItemTitle>
                <ItemDescription>{details.description}</ItemDescription>
              </ItemContent>
              <ItemActions>
                {/*
                 * The badge says where the grant stands; the button stays beside it. A grant is
                 * taken away in the same pane it is given in, and a row that offered no way back
                 * once it read "Granted" would leave the user to find that pane by themselves.
                 */}
                <Show when={permission.granted}>
                  <Badge variant="success-light">
                    <CircleCheck aria-hidden="true" />
                    Granted
                  </Badge>
                </Show>
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
              </ItemActions>
            </Item>
          );
        }}
      </For>
    </ItemGroup>
  );
}
