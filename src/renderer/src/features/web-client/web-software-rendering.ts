import { isString } from "@openbot/contracts/runtime-values";
import { setDrawsOnCpu } from "../../motion-preference";

const CPU_RENDERERS = /swiftshader|llvmpipe|softpipe|lavapipe|basic render driver/i;

function browserDrawsOnCpu(): boolean {
  let gl: WebGLRenderingContext | null;
  try {
    gl = document.createElement("canvas").getContext("webgl", { failIfMajorPerformanceCaveat: true });
  } catch {
    return true;
  }
  if (!gl) return true;
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return isString(renderer) && CPU_RENDERERS.test(renderer);
}

export function markSoftwareRendering(): void {
  if (browserDrawsOnCpu()) setDrawsOnCpu(true);
}
