import { type AvatarHue, BROWSER_PROFILE_NAME_MAX, type BrowserProfileSummary } from "@openbot/contracts/ipc";
import { Button, Input, Plus, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Text } from "@openbot/ui";
import { createStore, Show } from "solid-js";
import { useText } from "../../text";
import { BrowserProfileDot } from "./BrowserProfileColor";

/** `shared`, `agent`, or the id of a named profile: ids are 32 hex characters, so they never match. */
export type BrowserProfileChoice = string;

/** The last option. It is never a value: choosing it opens the name field in the list. */
const NEW_PROFILE = "new";

interface BrowserProfileSelectProps {
  value: BrowserProfileChoice;
  /** Undefined while the profiles load. */
  profiles: readonly Pick<BrowserProfileSummary, "id" | "name" | "hue">[] | undefined;
  onChange: (choice: BrowserProfileChoice) => void;
  /** Makes the profile and returns its id. The select then chooses it. */
  onCreate: (name: string) => Promise<string>;
}

interface BrowserProfileSelectState {
  open: boolean;
  creating: boolean;
  name: string;
  busy: boolean;
  error: string | null;
}

const CLOSED: BrowserProfileSelectState = { open: false, creating: false, name: "", busy: false, error: null };

/**
 * The browser profile row of the agent settings. "New profile" at the end of the list changes into a
 * name field in the same list, so the user makes a profile and gives it to the agent in one step.
 */
export function BrowserProfileSelect(props: BrowserProfileSelectProps) {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<BrowserProfileSelectState>({ ...CLOSED });
  // Kobalte closes the list after each choice. The choice of "New profile" keeps it open.
  let keepOpen = false;
  let trigger: HTMLButtonElement | undefined;

  const choices = (): BrowserProfileChoice[] => {
    const ids = (props.profiles ?? []).map((profile) => profile.id);
    // A profile that is not in the list stays a choice, so the select can show it.
    const missing = props.value !== "shared" && props.value !== "agent" && !ids.includes(props.value);
    // "Only this agent" is not offered any more. An agent that uses it keeps it, with its sign-ins, until the user changes it.
    const own = props.value === "agent" ? ["agent"] : [];
    // "New profile" stays an option while the name field shows: a change of the options makes Kobalte choose again.
    return ["shared", ...own, ...ids, ...(missing ? [props.value] : []), NEW_PROFILE];
  };

  function label(choice: BrowserProfileChoice): string {
    if (choice === "shared") return t("agentSettings.browserProfile.shared");
    if (choice === "agent") return t("agentSettings.browserProfile.agent");
    if (!props.profiles) return "";
    return props.profiles.find((profile) => profile.id === choice)?.name ?? t("agentSettings.browserProfile.missing");
  }

  const hue = (choice: BrowserProfileChoice): AvatarHue | "shared" | undefined =>
    choice === "shared" ? "shared" : props.profiles?.find((profile) => profile.id === choice)?.hue;

  // Kobalte reads its state when a focused option goes away. Focus leaves the list first, in the event.
  function releaseFocus(): void {
    trigger?.focus();
  }

  function setOpen(open: boolean): void {
    if (!open && keepOpen) {
      keepOpen = false;
      return;
    }
    if (!open && state.busy) return;
    if (!open) releaseFocus();
    setState(() => (open ? { ...CLOSED, open: true } : { ...CLOSED }));
  }

  async function create(): Promise<void> {
    const name = state.name.trim();
    if (!name || state.busy) return;
    setState((draft) => {
      draft.busy = true;
      draft.error = null;
    });
    try {
      const id = await props.onCreate(name);
      setState(() => ({ ...CLOSED }));
      props.onChange(id);
    } catch (error) {
      setState((draft) => {
        draft.busy = false;
        draft.error = errorMessage(error, t("browser.profiles.failed"));
      });
    }
  }

  return (
    <Select<BrowserProfileChoice>
      class="agent-settings-runtime-select"
      open={state.open}
      onOpenChange={setOpen}
      options={choices()}
      value={props.value}
      onChange={(next) => {
        if (next === NEW_PROFILE) {
          keepOpen = true;
          releaseFocus();
          setState((draft) => {
            draft.creating = true;
          });
          return;
        }
        if (next && next !== props.value) props.onChange(next);
      }}
      itemComponent={(item) => (
        <Show
          when={item.item.rawValue === NEW_PROFILE}
          fallback={
            <SelectItem item={item.item} class="browser-profile-select-option">
              {/* Every row has the mark column, so the names line up with "New profile". */}
              <span class="browser-profile-select-mark">
                <Show when={hue(item.item.rawValue)}>{(current) => <BrowserProfileDot hue={current()} />}</Show>
              </span>
              {label(item.item.rawValue)}
            </SelectItem>
          }
        >
          <SelectItem
            item={item.item}
            class="browser-profile-select-option browser-profile-select-new"
            hidden={state.creating}
          >
            <span class="browser-profile-select-mark">
              <Plus aria-hidden="true" />
            </span>
            {t("agentSettings.browserProfile.new")}
          </SelectItem>
        </Show>
      )}
    >
      <SelectTrigger
        ref={(element) => {
          trigger = element;
        }}
        class="agent-settings-runtime-row"
        aria-label={t("agentSettings.browserProfile.label")}
      >
        <span class="agent-settings-runtime-label">{t("agentSettings.browserProfile.label")}</span>
        <SelectValue<BrowserProfileChoice>>
          {(value) => {
            const choice = () => value.selectedOption() ?? "shared";
            return (
              <span class="browser-profile-select-value">
                <Show when={hue(choice())}>{(current) => <BrowserProfileDot hue={current()} />}</Show>
                {label(choice())}
              </span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        footer={
          <Show when={state.creating}>
            <form
              class="browser-profile-select-form"
              onSubmit={(event) => {
                event.preventDefault();
                void create();
              }}
            >
              <div class="browser-profiles-row">
                <Input
                  ref={(element) => requestAnimationFrame(() => element.focus())}
                  class="browser-profiles-name"
                  size="sm"
                  value={state.name}
                  aria-label={t("browser.profiles.newName")}
                  aria-invalid={state.error ? "true" : undefined}
                  placeholder={t("browser.profiles.newName")}
                  maxlength={BROWSER_PROFILE_NAME_MAX}
                  disabled={state.busy}
                  onValueChange={(value) =>
                    setState((draft) => {
                      draft.name = value;
                      draft.error = null;
                    })
                  }
                />
                <Button type="submit" size="sm" disabled={state.busy || !state.name.trim()}>
                  {t("browser.profiles.create")}
                </Button>
              </div>
              <Show when={state.error}>
                {(message) => (
                  <Text variant="caption" tone="danger" role="alert">
                    {message()}
                  </Text>
                )}
              </Show>
            </form>
          </Show>
        }
      />
    </Select>
  );
}
