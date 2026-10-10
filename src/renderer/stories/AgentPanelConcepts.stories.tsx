import { BookMarked, CalendarClock, Folder, Gauge, Puzzle, Table2 } from "@openbot/ui";
import { SettingsLinkGroup, SettingsLinkRow } from "@openbot/ui/components/SettingsPanel";
import AgentSettingsPanel from "@openbot/ui/features/conversation/AgentSettingsPanel";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  AGENT,
  CollapsibleConcept,
  ConceptCard,
  GroupedListConcept,
  IconRailConcept,
  OverviewConcept,
  TabsConcept,
} from "./agent-panel-concepts";
import { STORY_AGENT_STATUS, STORY_MODELS } from "./fixtures";
import "./AgentPanelConcepts.css";

const meta = {
  title: "Concepts/Agent Panel",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The shipped panel with the link groups the desktop app passes in. */
function CurrentPanel() {
  return (
    <AgentSettingsPanel
      agent={AGENT}
      runtimeSettings={{ provider: AGENT.provider, model: AGENT.model, reasoningEffort: AGENT.reasoningEffort }}
      agentStatus={STORY_AGENT_STATUS}
      modelOptions={STORY_MODELS}
      working={false}
      accessEditable
      computerUseEditable
      automationEditable
      busyMessageModeEditable
      defaultBusyMessageMode="queue"
      width={296}
      maxWidth={() => 296}
      onClose={fn()}
      onStartNewChat={fn(async () => {})}
      onResize={fn()}
      onResizeEnd={fn()}
      onUpdateAgent={fn(async () => undefined)}
      onUpdateRuntimeSettings={fn(async () => true)}
      onSetAgentAvatar={fn(async () => undefined)}
      links={
        <>
          <SettingsLinkGroup inset title="Knows">
            <SettingsLinkRow icon={<BookMarked />} label="Memories" value="3 saved" onClick={fn()} />
            <SettingsLinkRow icon={<Puzzle />} label="Skills" value="5 assigned" onClick={fn()} />
            <SettingsLinkRow icon={<Folder />} label="Files" value="120 MB" onClick={fn()} />
            <SettingsLinkRow icon={<Table2 />} label="Tables" value="2 tables" onClick={fn()} />
          </SettingsLinkGroup>
          <SettingsLinkGroup inset title="Does">
            <SettingsLinkRow icon={<CalendarClock />} label="Routines" value="2 active" onClick={fn()} />
            <SettingsLinkRow icon={<Gauge />} label="Usage" onClick={fn()} />
          </SettingsLinkGroup>
        </>
      }
    />
  );
}

export const AllConcepts: Story = {
  name: "All concepts side by side",
  render: () => (
    <main class="apc-canvas">
      <div class="apc-gallery">
        <ConceptCard caption="0 · Shipped" note="The grouped list, built from the shared panel.">
          <CurrentPanel />
        </ConceptCard>
        <ConceptCard caption="1 · Grouped list" note="Names and values only. Each row opens one page.">
          <GroupedListConcept />
        </ConceptCard>
        <ConceptCard caption="2 · Tabs" note="Profile, Knowledge, Settings. No scrolling.">
          <TabsConcept />
        </ConceptCard>
        <ConceptCard caption="3 · Overview" note="A contact card. Setup items are in the ⋯ menu.">
          <OverviewConcept />
        </ConceptCard>
        <ConceptCard caption="4 · Collapsible" note="Essentials open. Each closed section shows a summary.">
          <CollapsibleConcept />
        </ConceptCard>
        <ConceptCard caption="5 · Icon rail" note="One section at a time, picked from an icon column.">
          <IconRailConcept />
        </ConceptCard>
      </div>
    </main>
  ),
};

export const Current: Story = {
  name: "0. Shipped panel",
  render: () => (
    <main class="apc-canvas">
      <ConceptCard caption="Shipped" note="Profile, instructions, then the Brain, Knows, Does and Rules groups.">
        <CurrentPanel />
      </ConceptCard>
    </main>
  ),
};

export const GroupedList: Story = {
  name: "1. Grouped list",
  render: () => (
    <main class="apc-canvas">
      <div class="apc-gallery">
        <ConceptCard caption="Root" note="Profile card, instructions preview, four short groups.">
          <GroupedListConcept />
        </ConceptCard>
        <ConceptCard caption="Model page" note="Model and reasoning together, out of the root.">
          <GroupedListConcept start="model" />
        </ConceptCard>
        <ConceptCard caption="Permissions page" note="Access, computer use and scripts in one place.">
          <GroupedListConcept start="permissions" />
        </ConceptCard>
        <ConceptCard caption="Advanced page" note="Rare items: busy messages, folder, new chat.">
          <GroupedListConcept start="advanced" />
        </ConceptCard>
      </div>
    </main>
  ),
};

export const TabsStory: Story = {
  name: "2. Tabs",
  render: () => (
    <main class="apc-canvas">
      <div class="apc-gallery">
        <ConceptCard caption="Profile tab" note="Name, title and instructions.">
          <TabsConcept tab="profile" />
        </ConceptCard>
        <ConceptCard caption="Knowledge tab" note="Memories, skills, files, tables, routines, usage.">
          <TabsConcept tab="knowledge" />
        </ConceptCard>
        <ConceptCard caption="Settings tab" note="Model, permissions, notifications, advanced.">
          <TabsConcept tab="settings" />
        </ConceptCard>
      </div>
    </main>
  ),
};

export const Overview: Story = {
  name: "3. Overview",
  render: () => (
    <main class="apc-canvas">
      <div class="apc-gallery">
        <ConceptCard caption="Root" note="Open ⋯ for profile, model, permissions and advanced.">
          <OverviewConcept />
        </ConceptCard>
      </div>
    </main>
  ),
};

export const Collapsible: Story = {
  name: "4. Collapsible sections",
  render: () => (
    <main class="apc-canvas">
      <div class="apc-gallery">
        <ConceptCard caption="Closed" note="The default: four one-line summaries.">
          <CollapsibleConcept />
        </ConceptCard>
        <ConceptCard caption="Open" note="Every section open, for comparison.">
          <CollapsibleConcept openAll />
        </ConceptCard>
      </div>
    </main>
  ),
};

export const IconRail: Story = {
  name: "5. Icon rail",
  render: () => (
    <main class="apc-canvas">
      <div class="apc-gallery">
        <ConceptCard caption="Profile" note="The first section.">
          <IconRailConcept />
        </ConceptCard>
        <ConceptCard caption="Model" note="Model and reasoning.">
          <IconRailConcept section="model" />
        </ConceptCard>
        <ConceptCard caption="Permissions" note="Access and switches.">
          <IconRailConcept section="permissions" />
        </ConceptCard>
      </div>
    </main>
  ),
};
