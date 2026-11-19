import { useCSSVariable } from "uniwind";

export function useSignInColors() {
  const surface = useCSSVariable("--openbot-bg-control-active");
  const brand = useCSSVariable("--openbot-logo-production");
  const onBrand = useCSSVariable("--openbot-logo-eye");
  const text = useCSSVariable("--openbot-text-primary");
  const muted = useCSSVariable("--openbot-text-muted");
  const danger = useCSSVariable("--openbot-danger");
  const success = useCSSVariable("--openbot-success");
  const radius = useCSSVariable("--openbot-radius-lg");
  return {
    surface: String(surface ?? "#2a2a2a"),
    brand: String(brand ?? "#d6adf2"),
    onBrand: String(onBrand ?? "#040007"),
    text: String(text ?? "#ffffff"),
    muted: String(muted ?? "#979797"),
    danger: String(danger ?? "#fd2f3b"),
    success: String(success ?? "#31cf76"),
    radius: Number.parseFloat(String(radius ?? "12")),
  };
}

export type SignInColors = ReturnType<typeof useSignInColors>;

export const SIGN_IN_CONTROL_HEIGHT = 52;
