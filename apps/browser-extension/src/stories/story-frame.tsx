// Story support: the side panel's frame, and a loader that renders a screen once the story workspace
// has its data. Storybook only.
import "../extension.css";
import "./stories.css";
import type { JSX } from "@solidjs/web";
import { createSignal, onSettled, Show } from "solid-js";
import type { Workspace } from "../workspace";
import { installStoryChrome, type StoryServerOptions, storyWorkspace } from "./story-server";

installStoryChrome();

/** The side panel at Chrome's default width. */
export function PanelFrame(props: { children: JSX.Element }) {
  return (
    <div class="ext-story-stage">
      <main class="ext-app ext-story-panel">{props.children}</main>
    </div>
  );
}

/** Loads a story workspace, runs `setup` (such as opening a chat), then renders the screen. */
export function WithWorkspace(props: {
  options?: StoryServerOptions;
  setup?: (workspace: Workspace) => void;
  children: (workspace: Workspace) => JSX.Element;
}) {
  return (
    <PanelFrame>
      <LoadWorkspace options={props.options} setup={props.setup}>
        {props.children}
      </LoadWorkspace>
    </PanelFrame>
  );
}

/** `WithWorkspace` with no frame, for a screen that a scene puts in its own frame. */
export function LoadWorkspace(props: {
  options?: StoryServerOptions;
  setup?: (workspace: Workspace) => void;
  children: (workspace: Workspace) => JSX.Element;
}) {
  const [workspace, setWorkspace] = createSignal<Workspace | null>(null);
  onSettled(() => {
    void storyWorkspace(props.options).then((loaded) => {
      props.setup?.(loaded);
      setWorkspace(() => loaded);
    });
  });
  return <Show when={workspace()}>{(loaded) => props.children(loaded())}</Show>;
}
