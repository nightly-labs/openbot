import type { MacPermissionId } from "@openbot/contracts/ipc";
import { createSignal, onSettled, Show } from "solid-js";
import {
  Button,
  CircleCheck,
  FolderOpen,
  GripVertical,
  Monitor,
  MousePointer2,
  TriangleAlert,
} from "../../components/ui";
import { errorMessage } from "../../error-message";
import { useI18n } from "../i18n/i18n-context";

export function ComputerUseSetupSurface() {
  const { t } = useI18n();
  const permissionCopy = (): Record<MacPermissionId, { title: string; icon: typeof Monitor }> => ({
    "screen-recording": { title: t("computerUse.screenRecording"), icon: Monitor },
    accessibility: { title: t("computerUse.accessibility"), icon: MousePointer2 },
  });
  const desktopApi = window.openbot;
  const query = new URLSearchParams(window.location.search);
  const permission: MacPermissionId =
    query.get("permission") === "accessibility" ? "accessibility" : "screen-recording";
  const copy = permissionCopy()[permission];
  const PermissionIcon = copy.icon;
  const [state, setState] = createSignal<Awaited<ReturnType<typeof window.openbot.getComputerUseMacSetupState>> | null>(
    null,
  );
  const [dragging, setDragging] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let disposed = false;
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };

  onSettled(() => {
    window.addEventListener("keydown", closeOnEscape);
    void desktopApi
      .getComputerUseMacSetupState()
      .then((next) => {
        if (!disposed) setState(next);
      })
      .catch((cause) => {
        if (!disposed) setError(errorMessage(cause, t("computerUse.setupError")));
      });
    return () => {
      disposed = true;
      window.removeEventListener("keydown", closeOnEscape);
    };
  });

  async function reveal(): Promise<void> {
    setError(null);
    try {
      await desktopApi.revealComputerUseHelper();
    } catch (cause) {
      setError(errorMessage(cause, t("computerUse.finderError")));
    }
  }

  function close(): void {
    void desktopApi.closeComputerUsePermissionSetup();
  }

  return (
    <main class="computer-use-setup-surface">
      <header class="computer-use-setup-header">
        <span class="computer-use-setup-permission-icon" aria-hidden="true">
          <PermissionIcon />
        </span>
        <div>
          <h1>{t("computerUse.addTo", { permission: copy.title })}</h1>
          <p>{t("computerUse.dragInstruction")}</p>
        </div>
      </header>

      <Show
        when={state()?.status === "available"}
        fallback={
          <div class="computer-use-setup-unavailable" role={error() ? "alert" : "status"}>
            <TriangleAlert aria-hidden="true" />
            <span>
              {error()
                ? errorMessage(error(), t("computerUse.loadError"))
                : state()?.message
                  ? errorMessage(state()?.message, t("computerUse.loadError"))
                  : t("computerUse.loading")}
            </span>
          </div>
        }
      >
        <Button
          type="button"
          variant="ghost"
          class={`computer-use-drag-card${dragging() ? " is-dragging" : ""}`}
          draggable="true"
          aria-label={t("computerUse.dragLabel", { helper: state()?.helperName ?? t("computerUse.helperFallback") })}
          onClick={() => void reveal()}
          onDragStart={(event) => {
            event.preventDefault();
            setDragging(true);
            setError(null);
            void desktopApi
              .startComputerUseHelperDrag()
              .catch((cause) => setError(errorMessage(cause, t("computerUse.dragError"))))
              .finally(() => setDragging(false));
          }}
          onDragEnd={() => {
            setDragging(false);
          }}
        >
          <span class="computer-use-drag-handle" aria-hidden="true">
            <GripVertical />
          </span>
          <span class="computer-use-drag-icon" aria-hidden="true">
            <Show when={state()?.helperIconDataUrl} fallback={<Monitor />}>
              {(source) => <img src={source()} alt="" />}
            </Show>
          </span>
          <strong>{state()?.helperName}.app</strong>
          <span>{t("computerUse.dragToAdd")}</span>
        </Button>
      </Show>

      <Show when={error()}>
        <p class="computer-use-setup-error" role="alert">
          {error()}
        </p>
      </Show>

      <footer class="computer-use-setup-footer">
        <p>{t("computerUse.cantDrag")}</p>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={state()?.status !== "available"}
            onClick={() => void reveal()}
          >
            <FolderOpen aria-hidden="true" />
            {t("computerUse.showInFinder")}
          </Button>
          <Button type="button" size="sm" onClick={close}>
            <CircleCheck aria-hidden="true" />
            {t("computerUse.done")}
          </Button>
        </div>
      </footer>
    </main>
  );
}
