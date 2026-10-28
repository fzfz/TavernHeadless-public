/** Internal input, accepted only after the shared visibilityAnimation validator. */
interface VisibilityAnimation {
  visible: boolean;
  durationMs: number;
  easing: "swing";
  queue: "append";
}
export function createVisibilityAnimations(
  runtimeError: (code: string, cause?: unknown) => Error,
): {
  enqueue(element: HTMLElement, options: VisibilityAnimation): Promise<void>;
  dispose(): void;
};
