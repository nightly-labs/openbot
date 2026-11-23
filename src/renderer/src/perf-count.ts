export interface RendererPerfSink {
  count(key: string, amount: number): void;
}

let sink: RendererPerfSink | null = null;

export function setRendererPerfSink(next: RendererPerfSink | null): void {
  sink = next;
}

export function rendererPerfCount(key: string, amount = 1): void {
  sink?.count(key, amount);
}
