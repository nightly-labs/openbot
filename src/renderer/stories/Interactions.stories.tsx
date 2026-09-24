import {
  AlertDialog,
  buttonVariants,
  Combobox,
  ContextMenu,
  Copy,
  Dialog,
  DropdownMenu,
  ExternalLink,
  Heading,
  Input,
  Link2,
  Listbox,
  Pencil,
  Popover,
  RadioGroup,
  SelectPrimitive,
  SlidingTabs,
  Tabs,
  Tooltip,
  Trash2,
} from "@openbot/ui";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Foundations/Interactions",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const DialogFocus: Story = {
  render: () => (
    <main class="foundation-story foundation-interaction-stage">
      <Heading as="h1" size="lg">
        Dialog
      </Heading>
      <Dialog.Root>
        <Dialog.Trigger class={buttonVariants({ variant: "outline", size: "sm" })}>Open dialog</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay class="foundation-overlay">
            <Dialog.Content class="foundation-dialog">
              <Dialog.Title as="h2">Create agent</Dialog.Title>
              <Dialog.Description>Choose a short, recognizable name.</Dialog.Description>
              <Input aria-label="Agent name" value="Researcher" />
              <div class="foundation-dialog-actions">
                <Dialog.CloseButton class={buttonVariants({ variant: "outline", size: "sm" })}>
                  Cancel
                </Dialog.CloseButton>
                <Dialog.CloseButton class={buttonVariants({ variant: "default", size: "sm" })}>
                  Create
                </Dialog.CloseButton>
              </div>
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  ),
};

export const AlertDialogConfirmation: Story = {
  render: () => (
    <main class="foundation-story foundation-interaction-stage">
      <Heading as="h1" size="lg">
        Alert dialog
      </Heading>
      <AlertDialog.Root>
        <AlertDialog.Trigger class={buttonVariants({ variant: "destructive", size: "sm" })}>
          Delete agent
        </AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Overlay class="foundation-overlay">
            <AlertDialog.Content class="foundation-dialog">
              <AlertDialog.Title>Delete Researcher?</AlertDialog.Title>
              <AlertDialog.Description>This action cannot be undone.</AlertDialog.Description>
              <div class="foundation-dialog-actions">
                <AlertDialog.CloseButton class={buttonVariants({ variant: "outline", size: "sm" })} aria-label="Cancel">
                  Cancel
                </AlertDialog.CloseButton>
                <AlertDialog.CloseButton
                  class={buttonVariants({ variant: "destructive", size: "sm" })}
                  aria-label="Delete"
                >
                  Delete
                </AlertDialog.CloseButton>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Overlay>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </main>
  ),
};

export const MenuPopoverTooltip: Story = {
  render: () => (
    <main class="foundation-story foundation-interaction-stage">
      <Heading as="h1" size="lg">
        Anchored interactions
      </Heading>
      <div class="foundation-story-row">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger class={buttonVariants({ variant: "outline", size: "sm" })}>
            Agent actions
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="foundation-menu">
              <DropdownMenu.Item>
                <Pencil aria-hidden="true" />
                Rename
              </DropdownMenu.Item>
              <DropdownMenu.Item disabled>
                <Copy aria-hidden="true" />
                Duplicate
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item class="ui-action-menu-danger">
                <Trash2 aria-hidden="true" />
                Delete
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <Popover.Root>
          <Popover.Trigger class={buttonVariants({ variant: "outline", size: "sm" })}>Show details</Popover.Trigger>
          <Popover.Portal>
            <Popover.Content class="foundation-popover">
              <Popover.Title>Agent details</Popover.Title>
              <Popover.Description>Compact information anchored to its trigger.</Popover.Description>
              <Popover.CloseButton class={buttonVariants({ variant: "ghost", size: "sm" })} aria-label="Close">
                Close
              </Popover.CloseButton>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <Tooltip.Root openDelay={0} closeDelay={0}>
          <Tooltip.Trigger class={buttonVariants({ variant: "ghost", size: "sm" })}>Hover or focus</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content class="foundation-tooltip">Keyboard shortcut: ⌘K</Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <ContextMenu.Root>
          <ContextMenu.Trigger class="foundation-context-target">Right-click for actions</ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content class="foundation-menu">
              <ContextMenu.Item>
                <ExternalLink aria-hidden="true" />
                Open
              </ContextMenu.Item>
              <ContextMenu.Item>
                <Link2 aria-hidden="true" />
                Copy link
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      </div>
    </main>
  ),
};

export const TabsAndRadioGroup: Story = {
  render: () => {
    const [channel, setChannel] = createSignal("general");
    return (
      <main class="foundation-story foundation-interaction-stage">
        <Heading as="h1" size="lg">
          Selection groups
        </Heading>
        <Tabs.Root defaultValue="models" class="foundation-tabs">
          <Tabs.List class="foundation-tabs-list" aria-label="Agent settings">
            <Tabs.Trigger class="foundation-tab" value="models">
              Models
            </Tabs.Trigger>
            <Tabs.Trigger class="foundation-tab" value="tools">
              Tools
            </Tabs.Trigger>
            <Tabs.Trigger class="foundation-tab" value="permissions">
              Permissions
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content class="foundation-tab-panel" value="models">
            Model settings
          </Tabs.Content>
          <Tabs.Content class="foundation-tab-panel" value="tools">
            Tool settings
          </Tabs.Content>
          <Tabs.Content class="foundation-tab-panel" value="permissions">
            Permission settings
          </Tabs.Content>
        </Tabs.Root>
        <RadioGroup.Root
          class="foundation-radio-group"
          value={channel()}
          onChange={setChannel}
          aria-label="Default channel"
        >
          {(
            [
              ["general", "General"],
              ["research", "Research"],
              ["support", "Support"],
            ] satisfies [string, string][]
          ).map(([value, label]) => (
            <RadioGroup.Item class="foundation-radio-item" value={value}>
              <RadioGroup.ItemInput />
              <RadioGroup.ItemControl class="foundation-radio-control" />
              <RadioGroup.ItemLabel>{label}</RadioGroup.ItemLabel>
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      </main>
    );
  },
};

export const SlidingSelectionTabs: Story = {
  render: () => (
    <main class="foundation-story foundation-interaction-stage">
      <Heading as="h1" size="lg">
        Sliding tabs
      </Heading>
      <SlidingTabs.Root defaultValue="plan">
        <SlidingTabs.List aria-label="Response mode">
          <SlidingTabs.Trigger value="plan">Plan</SlidingTabs.Trigger>
          <SlidingTabs.Trigger value="debug">Debug</SlidingTabs.Trigger>
          <SlidingTabs.Trigger value="ask">Ask</SlidingTabs.Trigger>
        </SlidingTabs.List>
        <SlidingTabs.ContentSlot>
          <SlidingTabs.Content value="plan">Plan mode</SlidingTabs.Content>
          <SlidingTabs.Content value="debug">Debug mode</SlidingTabs.Content>
          <SlidingTabs.Content value="ask">Ask mode</SlidingTabs.Content>
        </SlidingTabs.ContentSlot>
      </SlidingTabs.Root>
    </main>
  ),
};

const pickerOptions = ["GPT-5", "Claude Sonnet", "Gemini Pro"];

export const Pickers: Story = {
  render: () => (
    <main class="foundation-story foundation-interaction-stage">
      <Heading as="h1" size="lg">
        Pickers
      </Heading>
      <div class="foundation-story-stack">
        <SelectPrimitive.Root<string>
          options={pickerOptions}
          placeholder="Choose a model"
          itemComponent={(props) => (
            <SelectPrimitive.Item class="foundation-listbox-item" item={props.item}>
              <SelectPrimitive.ItemLabel>{props.item.rawValue}</SelectPrimitive.ItemLabel>
            </SelectPrimitive.Item>
          )}
        >
          <SelectPrimitive.Trigger class="ui-input foundation-picker-trigger" aria-label="Model">
            <SelectPrimitive.Value<string>>{(state) => state.selectedOption()}</SelectPrimitive.Value>
          </SelectPrimitive.Trigger>
          <SelectPrimitive.Portal>
            <SelectPrimitive.Content class="foundation-picker-content">
              <SelectPrimitive.Listbox class="foundation-listbox" />
            </SelectPrimitive.Content>
          </SelectPrimitive.Portal>
        </SelectPrimitive.Root>

        <Combobox.Root<string>
          options={pickerOptions}
          placeholder="Search models"
          itemComponent={(props) => (
            <Combobox.Item class="foundation-listbox-item" item={props.item}>
              <Combobox.ItemLabel>{props.item.rawValue}</Combobox.ItemLabel>
            </Combobox.Item>
          )}
        >
          <Combobox.Control class="foundation-combobox-control">
            <Combobox.Label>Search model</Combobox.Label>
            <Combobox.Input class="ui-input foundation-combobox-input" />
          </Combobox.Control>
          <Combobox.Portal>
            <Combobox.Content class="foundation-picker-content">
              <Combobox.Listbox class="foundation-listbox" />
            </Combobox.Content>
          </Combobox.Portal>
        </Combobox.Root>

        <Listbox.Root<string>
          options={pickerOptions}
          aria-label="Available models"
          class="foundation-listbox foundation-picker-content"
          renderItem={(item) => (
            <Listbox.Item class="foundation-listbox-item" item={item}>
              <Listbox.ItemLabel>{item.rawValue}</Listbox.ItemLabel>
            </Listbox.Item>
          )}
          onChange={fn()}
        />
      </div>
    </main>
  ),
};
