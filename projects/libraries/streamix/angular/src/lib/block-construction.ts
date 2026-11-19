/**
 * Construction frames for compiled block factories.
 *
 * A generated factory body constructs DOM, nested blocks, and a binding table
 * before returning the compiled instance. A throw anywhere in that sequence
 * orphans everything built so far: nested blocks keep subscribing to their
 * sources and rendering into detached anchors, and the partial binding table
 * keeps its subscriptions. While a factory runs, created resources register
 * with the active construction frame; when the factory throws, the frame
 * destroys them. Every structural resource destroy is idempotent, so a
 * resource the factory already destroyed is unaffected. When the factory
 * succeeds, the frame is popped without disposing: ownership moved to the
 * returned instance's destroy callback.
 * @internal
 */
export interface SxConstructionResource {
  destroy(): void;
}

interface SxConstructionFrame {
  readonly resources: SxConstructionResource[];
  /** Destroys the registered resources, last created first. */
  dispose(): void;
}

const constructionStack: SxConstructionFrame[] = [];

/** Opens a construction frame; pairs with {@link endSxConstruction}. @internal */
export function beginSxConstruction(): SxConstructionFrame {
  const frame: SxConstructionFrame = {
    resources: [],
    dispose(): void {
      for (const resource of frame.resources.reverse()) {
        try {
          resource.destroy();
        } catch (error) {
          console.error('[streamix] A block construction resource failed to destroy.', error);
        }
      }
      frame.resources.length = 0;
    },
  };
  constructionStack.push(frame);
  return frame;
}

/** Closes a construction frame without disposing its resources. @internal */
export function endSxConstruction(frame: SxConstructionFrame): void {
  const index = constructionStack.lastIndexOf(frame);
  if (index >= 0) {
    constructionStack.splice(index, 1);
  }
}

/** Registers a resource with the active construction frame, if any. @internal */
export function registerSxConstruction(resource: SxConstructionResource): void {
  constructionStack[constructionStack.length - 1]?.resources.push(resource);
}

/**
 * Runs one block factory under a construction frame: a throwing factory has
 * every resource it built destroyed before the error propagates.
 * @internal
 */
export function constructSxBlock<T extends SxConstructionResource>(
  create: () => T,
): T {
  const frame = beginSxConstruction();
  try {
    return create();
  } catch (error) {
    frame.dispose();
    throw error;
  } finally {
    endSxConstruction(frame);
  }
}
