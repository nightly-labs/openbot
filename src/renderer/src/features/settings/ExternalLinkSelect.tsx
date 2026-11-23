import {
  type ExternalLinkBrowser,
  type ExternalLinkBrowsers,
  type ExternalLinkTarget,
  externalLinkAppName,
  isExternalLinkAppPath,
} from "@openbot/contracts/ipc";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openbot/ui";
import { createMemo, createSignal, createStore, onSettled, Show } from "solid-js";
import { useI18n } from "../../i18n-context";
import { settingsPort } from "./settings-port";

const OTHER = "other";
const APP_PREFIX = "app:";

function optionKey(target: ExternalLinkTarget): string {
  return target.kind === "app" ? `${APP_PREFIX}${target.path}` : target.kind;
}

function optionTarget(key: string): ExternalLinkTarget {
  if (key === "default" || key === "openbot") return { kind: key };
  return { kind: "app", path: key.slice(APP_PREFIX.length) };
}

function sameKeys(before: string[], after: string[]): boolean {
  return before.length === after.length && before.every((key, index) => key === after[index]);
}

function groupClass(key: string) {
  if (key === "openbot") return "settings-modal-select-group-end";
  return undefined;
}

interface ExternalLinkSelectProps {
  target: ExternalLinkTarget;
  platform: "darwin" | "win32" | "linux" | undefined;
  mount: HTMLElement | undefined;
  onChange: (target: ExternalLinkTarget) => void;
}

export function ExternalLinkSelect(props: ExternalLinkSelectProps) {
  const i18n = useI18n();
  const [found, setFound] = createSignal<ExternalLinkBrowsers>({ defaultBrowser: null, browsers: [] });
  const [form, setForm] = createStore({ open: false, editing: false, path: "" });
  const mac = () => props.platform === "darwin";
  let keepOpen = false;
  let trigger: HTMLButtonElement | undefined;

  onSettled(() => {
    let active = true;
    void settingsPort()
      .listExternalLinkBrowsers()
      .then((browsers) => {
        if (active) setFound(browsers);
      });
    return () => {
      active = false;
    };
  });

  const options = createMemo(
    (): string[] => {
      const listed = found().browsers.map((browser) => `${APP_PREFIX}${browser.path}`);
      const saved = optionKey(props.target);
      const extra = props.target.kind === "app" && !listed.includes(saved) ? [saved] : [];
      return ["default", "openbot", ...listed, ...extra, OTHER];
    },
    { equals: sameKeys },
  );

  const appLabel = (path: string): string => {
    const browser = found().browsers.find((item: ExternalLinkBrowser) => item.path === path);
    if (browser) return browser.name;
    return mac() ? externalLinkAppName(path) : path;
  };

  const label = (key: string): string => {
    if (key === OTHER) return i18n.t(mac() ? "settings.externalLinks.otherApp" : "settings.externalLinks.command");
    if (key === "openbot") return i18n.t("settings.externalLinks.openbot");
    if (key === "default") {
      const current = found().defaultBrowser;
      if (!current) return i18n.t("settings.externalLinks.defaultBrowser");
      return i18n.t("settings.externalLinks.defaultBrowserNamed", { name: current.name });
    }
    return appLabel(key.slice(APP_PREFIX.length));
  };

  function choose(target: ExternalLinkTarget): void {
    if (optionKey(target) !== optionKey(props.target)) props.onChange(target);
  }

  function chooseApp(): void {
    void settingsPort()
      .chooseExternalLinkApp()
      .then((app) => {
        if (app) choose({ kind: "app", path: app.path });
      });
  }

  function saveCommand(): void {
    const path = form.path.trim();
    if (!isExternalLinkAppPath(path)) return;
    choose({ kind: "app", path });
    trigger?.focus();
    setForm(() => ({ open: false, editing: false, path: "" }));
  }

  return (
    <Select<string>
      class="settings-modal-select settings-modal-link-select"
      open={form.open}
      onOpenChange={(open) => {
        if (!open && keepOpen) {
          keepOpen = false;
          return;
        }
        if (!open) trigger?.focus();
        setForm(() => ({ open, editing: false, path: "" }));
      }}
      options={options()}
      value={optionKey(props.target)}
      onChange={(key) => {
        if (!key) return;
        if (key !== OTHER) return choose(optionTarget(key));
        if (mac()) return chooseApp();
        keepOpen = true;
        trigger?.focus();
        setForm((draft) => {
          draft.editing = true;
        });
      }}
      placement="bottom-end"
      sameWidth={false}
      itemComponent={(item) => (
        <SelectItem
          item={item.item}
          class={groupClass(item.item.rawValue)}
          hidden={item.item.rawValue === OTHER && form.editing}
        >
          {label(item.item.rawValue)}
        </SelectItem>
      )}
    >
      <SelectTrigger
        ref={(element) => {
          trigger = element;
        }}
        size="sm"
        aria-label={i18n.t("settings.externalLinks.title")}
      >
        <SelectValue<string>>{(value) => label(value.selectedOption() ?? "default")}</SelectValue>
      </SelectTrigger>
      <SelectContent
        mount={props.mount}
        footer={
          <Show when={form.editing}>
            <form
              class="settings-modal-link-command"
              onSubmit={(event) => {
                event.preventDefault();
                saveCommand();
              }}
            >
              <Input
                ref={(element) => requestAnimationFrame(() => element.focus())}
                size="sm"
                value={form.path}
                aria-label={i18n.t("settings.externalLinks.commandLabel")}
                placeholder={i18n.t("settings.externalLinks.commandPlaceholder")}
                onValueChange={(path) =>
                  setForm((draft) => {
                    draft.path = path;
                  })
                }
              />
              <Button type="submit" size="sm" disabled={!isExternalLinkAppPath(form.path.trim())}>
                {i18n.t("settings.externalLinks.useCommand")}
              </Button>
            </form>
          </Show>
        }
      />
    </Select>
  );
}
