import type { ComputerUseMacSetupState, DesktopPlatform, MacPermissionId } from "@openbot/contracts/ipc";
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
  toast,
} from "../../components/ui";
import { errorMessage } from "../../error-message";
import { useI18n } from "../i18n/i18n-context";

export interface ComputerUseMacSetupProps {
  platform: DesktopPlatform;
  variant: "settings" | "compact";
}

export function ComputerUseMacSetup(props: ComputerUseMacSetupProps) {
  const { t } = useI18n();
  const permissions = (): ReadonlyArray<{
    id: MacPermissionId;
    title: string;
    description: string;
    icon: typeof Monitor;
  }> => [
    {
      id: "screen-recording",
      title: t("computerUse.screenRecording"),
      description: t("computerUse.screenRecordingDescription"),
      icon: Monitor,
    },
    {
      id: "accessibility",
      title: t("computerUse.accessibility"),
      description: t("computerUse.accessibilityDescription"),
      icon: MousePointer2,
    },
  ];
  const desktopApi = window.openbot;
  const [state, setState] = createSignal<ComputerUseMacSetupState | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [busyPermission, setBusyPermission] = createSignal<MacPermissionId | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  let disposed = false;

  async function loadState(): Promise<void> {
    if (props.platform !== "darwin" || loading()) return;
    setLoading(true);
    setError(null);
    try {
      const next = await desktopApi.getComputerUseMacSetupState();
      if (!disposed) setState(next);
    } catch (cause) {
      if (!disposed) setError(errorMessage(cause, t("computerUse.checkError")));
    } finally {
      if (!disposed) setLoading(false);
    }
  }

  async function openPermission(permission: MacPermissionId): Promise<void> {
    if (busyPermission() || state()?.status !== "available") return;
    setBusyPermission(permission);
    setError(null);
    try {
      const next = await desktopApi.openComputerUsePermissionSetup(permission);
      if (disposed) return;
      setState(next);
      if (next.status === "available") {
        toast.success(t("computerUse.systemSettingsOpened"), {
          description: t("computerUse.systemSettingsDescription"),
        });
      }
    } catch (cause) {
      if (!disposed) setError(errorMessage(cause, t("computerUse.openError")));
    } finally {
      if (!disposed) setBusyPermission(null);
    }
  }

  onSettled(() => void loadState());
  onCleanup(() => {
    disposed = true;
    void desktopApi.closeComputerUsePermissionSetup().catch(() => undefined);
  });

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

      <Show
        when={
          state()?.status === "unavailable" || state()?.status === "unsupported" || (!loading() && error() !== null)
        }
      >
        <Alert tone="warning" class="computer-use-alert" role="status">
          <AlertIcon>
            <TriangleAlert />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>{t("computerUse.unavailableTitle")}</AlertTitle>
            <AlertDescription>
              {errorMessage(state()?.message ?? error(), t("computerUse.unavailableDescription"))}
            </AlertDescription>
          </AlertContent>
          <AlertActions>
            <Button type="button" variant="outline" size="sm" loading={loading()} onClick={() => void loadState()}>
              <RefreshCw aria-hidden="true" />
              {t("computerUse.tryAgain")}
            </Button>
          </AlertActions>
        </Alert>
      </Show>

      <Show when={state()?.status === "available"}>
        <Show when={props.variant === "settings"}>
          <SettingsSection title={t("computerUse.helper")}>
            <ItemGroup class="settings-modal-card computer-use-card">
              <Item class="settings-modal-row computer-use-helper-row">
                <ItemMedia class="computer-use-helper-media">
                  <Show
                    when={state()?.helperIconDataUrl}
                    fallback={<Monitor class="computer-use-fallback-icon" aria-hidden="true" />}
                  >
                    {(source) => <img src={source()} alt="" />}
                  </Show>
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{state()?.helperName}</ItemTitle>
                  <ItemDescription>{t("computerUse.controlsApps")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Badge variant="success-light">
                    <CircleCheck aria-hidden="true" />
                    {t("computerUse.available")}
                  </Badge>
                </ItemActions>
              </Item>
            </ItemGroup>
          </SettingsSection>
        </Show>

        <Show
          when={props.variant === "settings"}
          fallback={
            <PermissionGroup
              permissions={permissions()}
              actionLabel={t("computerUse.setUp")}
              busy={busyPermission()}
              onOpen={openPermission}
            />
          }
        >
          <SettingsSection title={t("computerUse.systemPermissions")} description={t("computerUse.managedByMacos")}>
            <PermissionGroup
              permissions={permissions()}
              actionLabel={t("computerUse.openSettings")}
              busy={busyPermission()}
              onOpen={openPermission}
            />
          </SettingsSection>
        </Show>
      </Show>

      <Show when={error() && state()?.status === "available"}>
        <Alert tone="danger" class="computer-use-alert" role="alert">
          <AlertIcon>
            <Info />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>{t("computerUse.openError")}</AlertTitle>
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
                <h2 id="computer-use-compact-title">{t("computerUse.setupTitle")}</h2>
                <p>{t("computerUse.setupDescription")}</p>
              </div>
              <span>{t("computerUse.optional")}</span>
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
  permissions: ReadonlyArray<{ id: MacPermissionId; title: string; description: string; icon: typeof Monitor }>;
  actionLabel: string;
  busy: MacPermissionId | null;
  onOpen: (permission: MacPermissionId) => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <ItemGroup class="settings-modal-card computer-use-card computer-use-permission-list">
      <For each={props.permissions}>
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={props.busy === permission.id}
                  loadingLabel={t("computerUse.opening")}
                  disabled={props.busy !== null}
                  onClick={() => void props.onOpen(permission.id)}
                >
                  {props.actionLabel}
                </Button>
              </ItemActions>
            </Item>
          );
        }}
      </For>
    </ItemGroup>
  );
}
