export const BACKGROUND_REFRESH_MINUTES = 15;

export type BackgroundRefreshRun = (ended: AbortSignal) => Promise<boolean>;

export interface BackgroundRefreshNative {
  install(): void;
  enable(run: BackgroundRefreshRun): () => void;
}
