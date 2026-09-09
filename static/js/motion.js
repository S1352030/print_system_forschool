/** Serialize document transitions so an interrupted animation cannot clean up its successor. */
export function createViewTransitionRunner(doc, prefersReducedMotion) {
  let pending = Promise.resolve();
  let active = null;
  let latestRequest = 0;

  return (update, className) => {
    const request = ++latestRequest;
    active?.skipTransition();

    const task = pending.then(async () => {
      // Apply every state change in order, but animate only the latest request.
      if (request !== latestRequest || prefersReducedMotion() || !doc.startViewTransition) {
        await update();
        return;
      }

      doc.documentElement.classList.add(className);
      try {
        active = doc.startViewTransition(update);
        // Intentionally skipped transitions can reject ready before snapshot capture.
        void active.ready?.catch(() => {});
        await active.finished;
      } finally {
        active = null;
        doc.documentElement.classList.remove(className);
      }
    });

    // A failed update must not block future interactions. The caller still sees the error.
    pending = task.catch(() => {});
    return task;
  };
}

/** Wait for actual CSS transitions, including cancellation and reduced-motion/no-animation paths. */
export async function waitForElementAnimations(element) {
  const animations = element.getAnimations?.() ?? [];
  await Promise.allSettled(animations.map((animation) => animation.finished));
}
