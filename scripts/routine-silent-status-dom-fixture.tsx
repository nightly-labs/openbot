// The production editor, rendered without Electron or a browser process.

import type { ConversationMessage } from "@openbot/contracts/ipc";
import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { toAgentMessages } from "../src/renderer/src/app-message-projection";
import { AgentRoutinesSettings } from "../src/renderer/src/features/conversation/AgentRoutinesSettings";
import { type AgentRoutinesApi, agentRoutinesPort } from "../src/renderer/src/features/conversation/routines-port";

declare global {
  interface Window {
    silentRoutineFixture: {
      api: AgentRoutinesApi;
      saved: () => Promise<{ id: string; silent?: boolean }[]>;
      messages: ConversationMessage[];
      silentRunId: string;
    };
    runSilentRoutineEditor: () => Promise<{ checks: string[]; html: string[] }>;
  }
}

window.runSilentRoutineEditor = async () => {
  const checks: string[] = [];
  const html: string[] = [];
  const bridge = window.silentRoutineFixture;
  const port = agentRoutinesPort("dom-fixture", false, false, bridge.api, false, true);
  let view = render(() => <AgentRoutinesSettings port={port} onCountChange={() => {}} />);
  fireEvent.click(await view.findByRole("button", { name: "Create Routine" }));
  fireEvent.input(await view.findByLabelText("Name"), { target: { value: "DOM silent fixture" } });
  fireEvent.input(await view.findByLabelText("Instruction"), { target: { value: "Write a useful report." } });
  const toggle = await view.findByRole("switch", { name: "Silent routine" });
  fireEvent.click(toggle);
  html.push(document.documentElement.outerHTML);
  fireEvent.click(await view.findByRole("button", { name: "Save" }));
  await waitFor(async () => {
    const rows = await bridge.saved();
    if (rows.length !== 1 || rows[0]?.silent !== true) throw new Error("Create did not save silent=true.");
  });
  await view.findByRole("button", { name: "Test run" });
  checks.push("The production create form saves silent=true through the production port and IPC decoder.");
  html.push(document.documentElement.outerHTML);
  fireEvent.click(await view.findByRole("switch", { name: "Silent routine" }));
  fireEvent.click(await view.findByRole("button", { name: "Save" }));
  await waitFor(async () => {
    const rows = await bridge.saved();
    if (rows.length !== 1 || rows[0]?.silent !== false)
      throw new Error("The open create form did not clear the saved preference.");
  });
  await view.findByRole("button", { name: "Test run" });
  fireEvent.click(await view.findByRole("switch", { name: "Silent routine" }));
  fireEvent.click(await view.findByRole("button", { name: "Save" }));
  await waitFor(async () => {
    const rows = await bridge.saved();
    if (rows.length !== 1 || rows[0]?.silent !== true)
      throw new Error("The open create form did not save the preference again.");
  });
  await view.findByRole("button", { name: "Test run" });
  checks.push("The same open form can clear and restore the preference after creation without a duplicate.");
  view.unmount();
  const saved = (await bridge.saved())[0];
  if (!saved) throw new Error("The created routine is missing.");
  view = render(() => (
    <AgentRoutinesSettings
      port={port}
      onCountChange={() => {}}
      selectionRequest={{ routineId: saved.id, routineName: "DOM silent fixture", nonce: 1 }}
    />
  ));
  const editToggle = await view.findByRole("switch", { name: "Silent routine" });
  fireEvent.click(editToggle);
  fireEvent.click(await view.findByRole("button", { name: "Save" }));
  await waitFor(async () => {
    const rows = await bridge.saved();
    if (rows.length !== 1 || rows[0]?.id !== saved.id || rows[0]?.silent !== false)
      throw new Error("Edit did not save silent=false on the same routine.");
  });
  await view.findByRole("button", { name: "Test run" });
  checks.push("The production edit form reloads the value and saves explicit false on the same routine.");
  html.push(document.documentElement.outerHTML);
  view.unmount();
  view = render(() => (
    <AgentRoutinesSettings
      port={{ ...port, silent: false }}
      onCountChange={() => {}}
      selectionRequest={{ routineId: saved.id, routineName: "DOM silent fixture", nonce: 2 }}
    />
  ));
  await view.findByLabelText("Instruction");
  if (view.queryByRole("switch", { name: "Silent routine" }))
    throw new Error("An unsupported host exposes the control.");
  checks.push("An unsupported host hides the control.");
  const projected = toAgentMessages(bridge.messages);
  if (
    projected.some(
      (message) => message.actionMarker?.kind === "routine-run" && message.actionMarker.runId === bridge.silentRunId,
    )
  )
    throw new Error("The production desktop/web message projection received a silent lifecycle row.");
  if (!projected.some((message) => message.body === "A useful report."))
    throw new Error("The desktop/web projection lost the report.");
  checks.push("The production desktop/web message projection keeps the report without a silent lifecycle row.");
  view.unmount();
  return { checks, html };
};
