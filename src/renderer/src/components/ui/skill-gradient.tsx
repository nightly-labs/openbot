import { articleGradient, articleGradientCss, articleGradientUniforms } from "@openbot/brand/article-gradient";
import type { ShaderMount } from "@paper-design/shaders";
import { createEffect } from "solid-js";

/** Uses the same stable mesh profile as the public article artwork. */
export function SkillGradient(props: { name: string }) {
  let host: HTMLDivElement | undefined;
  createEffect(
    () => props.name,
    (name) => {
      const element = host;
      if (!element || !window.matchMedia || !window.IntersectionObserver) return;
      const profile = articleGradient(name);
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      let mount: ShaderMount | undefined;
      let visible = false;
      let disposed = false;
      let generation = 0;
      let failed = false;
      const stop = () => {
        generation += 1;
        mount?.dispose();
        mount = undefined;
      };
      const update = async () => {
        if (disposed || !visible || document.hidden || reducedMotion.matches) {
          stop();
          return;
        }
        if (mount || failed) return;
        const attempt = ++generation;
        try {
          const { ShaderMount, getShaderColorFromString, meshGradientFragmentShader } = await import(
            "@paper-design/shaders"
          );
          if (disposed || attempt !== generation) return;
          mount = new ShaderMount(
            element,
            meshGradientFragmentShader,
            articleGradientUniforms(profile, getShaderColorFromString),
            undefined,
            0.6,
            profile.frame,
          );
        } catch {
          failed = true;
          stop();
        }
      };
      const refresh = () => {
        void update();
      };
      const observer = new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? false;
        refresh();
      });
      observer.observe(element);
      reducedMotion.addEventListener("change", refresh);
      document.addEventListener("visibilitychange", refresh);
      const contextLost = () => {
        failed = true;
        stop();
      };
      element.addEventListener("webglcontextlost", contextLost, true);
      return () => {
        disposed = true;
        stop();
        observer.disconnect();
        reducedMotion.removeEventListener("change", refresh);
        document.removeEventListener("visibilitychange", refresh);
        element.removeEventListener("webglcontextlost", contextLost, true);
      };
    },
  );
  return (
    <div
      ref={(element) => {
        host = element;
      }}
      class="skill-preview-gradient"
      aria-hidden="true"
      style={{ background: articleGradientCss(articleGradient(props.name)) }}
    />
  );
}
