import { render } from "@solidjs/web";
import { App } from "./App";
import { ComputerUseHighlightSurface } from "./features/computer-use/ComputerUseHighlightSurface";
import { ComputerUsePermissionHelp, permissionFromQuery } from "./features/computer-use/ComputerUsePermissionHelp";
import { DynamicIslandSurface } from "./features/dynamic-island/DynamicIslandSurface";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Renderer root element was not found.");
}

const surface = new URLSearchParams(window.location.search).get("surface");
render(() => {
  if (surface === "dynamic-island") return <DynamicIslandSurface />;
  if (surface === "computer-use-highlight") return <ComputerUseHighlightSurface />;
  if (surface === "computer-use-permission-help")
    return <ComputerUsePermissionHelp permission={permissionFromQuery(window.location.search)} />;
  return <App />;
}, root);
