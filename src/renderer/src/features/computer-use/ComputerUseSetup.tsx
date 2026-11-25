import type { ComputerUseState, MacPermissionId } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
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
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, For, onCleanup, onSettled, Show } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { idleRestartTarget } from "../updates/updates-port";
import { computerUsePort } from "./computer-use-port";

export interface ComputerUseSetupProps {
  variant: "settings" | "compact";
}

const PERMISSION_DETAILS: Record<
  MacPermissionId,
  { title: AppTextKey; description: AppTextKey; icon: typeof Monitor }
> = {
  "screen-recording": {
    title: "computerUse.permission.screenRecording.title",
    description: "computerUse.permission.screenRecording.description",
    icon: Monitor,
  },
  accessibility: {
    title: "computerUse.permission.accessibility.title",
    description: "computerUse.permission.accessibility.description",
    icon: MousePointer2,
  },
};

export function ComputerUseSetup(props: ComputerUseSetupProps) {
  const { t, errorMessage } = useText();
  const [state, setState] = createSignal<ComputerUseState | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [busyPermission, setBusyPermission] = createSignal<MacPermissionId | null>(null);
  const [restarting, setRestarting] = createSignal(false);
  const [restartError, setRestartError] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  let disposed = false;

  const permissions = () => state()?.permissions ?? [];

  async function loadState(): Promise<void> {
    if (loading()) return;
    setLoading(true);
    setError(null);
    try {
      const next = await computerUsePort().computerUse.getState();
      if (!disposed) setState(next);
    } catch (cause) {
      if (!disposed) setError(errorMessage(cause, t("computerUse.error.check")));
    } finally {
      if (!disposed) setLoading(false);
    }
  }

  async function openPermission(permission: MacPermissionId): Promise<void> {
    if (busyPermission()) return;
    setBusyPermission(permission);
    setError(null);
    desktopAnalytics.track("computer_use_action", { action: "permission_opened", permission });
    try {
      const next = await computerUsePort().computerUse.openPermissionPane(permission);
      if (!disposed) setState(next);
    } catch (cause) {
      if (!disposed) setError(errorMessage(cause, t("computerUse.error.openSettings")));
    } finally {
      if (!disposed) setBusyPermission(null);
    }
  }

  async function restart(): Promise<void> {
    if (restarting()) return;
    setRestarting(true);
    setRestartError(null);
    try {
      const update = computerUsePort().update;
      await update.restartWhenIdle(idleRestartTarget(await update.getStatus()));
    } catch (cause) {
      if (!disposed) setRestartError(errorMessage(cause, t("update.idleRestart.requestFailed")));
    } finally {
      if (!disposed) setRestarting(false);
    }
  }

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
    return (
      (status === "permissions-required" || status === "restart-required" || status === "ready") &&
      permissions().length > 0
    );
  };

  const unavailable = () => {
    const status = state()?.status;
    return status === "unsupported" || status === "driver-missing" || status === "error";
  };

  const recheckButton = () => (
    <Show when={showPermissions()}>
      <Button type="button" variant="outline" size="sm" loading={loading()} onClick={() => void loadState()}>
        <RefreshCw aria-hidden="true" />
        {t("computerUse.checkAgain")}
      </Button>
    </Show>
  );

  const recheck = () => (
    <Show when={showPermissions()}>
      <div class="computer-use-recheck">{recheckButton()}</div>
    </Show>
  );

  const content = () => (
    <>
      <Show when={loading() && state() === null}>
        <ItemGroup class="computer-use-card computer-use-loading" aria-label={t("computerUse.checking")}>
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

      <Show when={unavailable() || (!loading() && error() !== null)}>
        <Alert tone="warning" class="computer-use-alert" role="status">
          <AlertIcon>
            <TriangleAlert />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>{t("computerUse.unavailable.title")}</AlertTitle>
            <AlertDescription>
              {errorMessage(state()?.message ?? error(), t("computerUse.error.startDriver"))}
            </AlertDescription>
          </AlertContent>
          <AlertActions>
            <Button type="button" variant="outline" size="sm" loading={loading()} onClick={() => void loadState()}>
              <RefreshCw aria-hidden="true" />
              {t("common.tryAgain")}
            </Button>
          </AlertActions>
        </Alert>
      </Show>

      <Show when={state()?.status === "restart-required"}>
        <Alert tone="warning" class="computer-use-alert" role="status">
          <AlertIcon>
            <TriangleAlert />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>{t("computerUse.restartRequired.title")}</AlertTitle>
            <AlertDescription>{restartError() ?? t("computerUse.restartRequired.description")}</AlertDescription>
          </AlertContent>
          <AlertActions>
            <Button type="button" variant="outline" size="sm" loading={restarting()} onClick={() => void restart()}>
              <RefreshCw aria-hidden="true" />
              {t("computerUse.restartRequired.action")}
            </Button>
          </AlertActions>
        </Alert>
      </Show>

      <Show when={showPermissions()}>
        <Show
          when={props.variant === "settings"}
          fallback={<PermissionGroup busy={busyPermission()} permissions={permissions()} onOpen={openPermission} />}
        >
          <SettingsSection
            data-settings-row="computerUse.permissions.title"
            title={t("computerUse.permissions.title")}
            description={t("computerUse.permissions.description")}
          >
            <PermissionGroup busy={busyPermission()} permissions={permissions()} onOpen={openPermission} />
            {recheck()}
          </SettingsSection>
        </Show>
      </Show>

      <Show when={state()?.status === "ready" && permissions().length === 0 && state()?.message}>
        {(limit) => (
          <Alert tone="warning" class="computer-use-alert" role="status">
            <AlertIcon>
              <TriangleAlert />
            </AlertIcon>
            <AlertContent>
              <AlertTitle>{t("computerUse.limited.title")}</AlertTitle>
              <AlertDescription>{errorMessage(limit(), t("status.computerUse.inputRefused"))}</AlertDescription>
            </AlertContent>
          </Alert>
        )}
      </Show>

      <Show when={state()?.status === "ready" && permissions().length === 0 && !state()?.message}>
        <Alert tone="success" class="computer-use-alert" role="status">
          <AlertIcon>
            <CircleCheck />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>{t("computerUse.ready.title")}</AlertTitle>
            <AlertDescription>{t("computerUse.ready.description")}</AlertDescription>
          </AlertContent>
        </Alert>
      </Show>

      <Show when={error() && showPermissions()}>
        <Alert tone="danger" class="computer-use-alert" role="alert">
          <AlertIcon>
            <Info />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>{t("computerUse.openSettingsFailed.title")}</AlertTitle>
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
              <h2 id="computer-use-compact-title">{t("computerUse.compact.title")}</h2>
              <p>{t("computerUse.compact.description")}</p>
            </div>
            {recheckButton()}
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
  const { t } = useText();
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
                <ItemTitle>{t(details.title)}</ItemTitle>
                <ItemDescription>{t(details.description)}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Show when={permission.granted}>
                  <Badge variant="success-light">
                    <CircleCheck aria-hidden="true" />
                    {t("computerUse.granted")}
                  </Badge>
                </Show>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  class={permission.granted ? undefined : "computer-use-grant"}
                  loading={props.busy === permission.id}
                  loadingLabel={t("computerUse.opening")}
                  disabled={props.busy !== null}
                  aria-label={t(permission.granted ? "computerUse.manageLabel" : "computerUse.grantLabel", {
                    permission: t(details.title),
                  })}
                  onClick={() => void props.onOpen(permission.id)}
                >
                  {permission.granted ? t("computerUse.manage") : t("computerUse.grant")}
                </Button>
              </ItemActions>
            </Item>
          );
        }}
      </For>
    </ItemGroup>
  );
}
