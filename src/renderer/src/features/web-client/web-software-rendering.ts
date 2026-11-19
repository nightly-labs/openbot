import { isString } from "@openbot/contracts/runtime-values";
import { setDrawsOnCpu } from "../../motion-preference";

/**
 * WebGL renderer names of the CPU: Chromium's SwiftShader, Mesa's llvmpipe, softpipe and lavapipe,
 * and the Windows driver of a computer with no GPU, such as a VPS seen through a remote desktop.
 */
const CPU_RENDERERS = /swiftshader|llvmpipe|softpipe|lavapipe|basic render driver/i;

/**
 * Whether this browser draws on the CPU. The web client has no main process to ask, so it asks WebGL:
 * with `failIfMajorPerformanceCaveat`, a browser that would draw WebGL on the CPU gives no context.
 * A browser with WebGL turned off also gives none; that page then only loses its blur and its
 * moving avatars.
 */
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

/**
 * Tells the motion setting, as the desktop does (`platform.tsx`), when this browser draws on the CPU,
 * as in a remote desktop on a server with no GPU. Each backdrop blur, the moving avatars and the
 * loading crew then stop, unless the user turned them on in Settings. Call it before the loading
 * screen shows.
 */
export function markSoftwareRendering(): void {
  if (browserDrawsOnCpu()) setDrawsOnCpu(true);
}
