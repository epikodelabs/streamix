export const OUTLET_ACTIVATE_EVENT = 'vanilla-router-activate';
export const OUTLET_DEACTIVATE_EVENT = 'vanilla-router-deactivate';
export const ROUTER_LOCATION_CHANGE_EVENT = 'vanilla-router-locationchange';
export const OUTLET_ATTRIBUTE = 'data-router-outlet';

export function dispatchOutletLifecycleEvent(
  target: EventTarget,
  type: typeof OUTLET_ACTIVATE_EVENT | typeof OUTLET_DEACTIVATE_EVENT,
  component: unknown,
): void {
  target.dispatchEvent(new CustomEvent(type, { detail: component }));
}

export function dispatchRouterLocationChange(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(ROUTER_LOCATION_CHANGE_EVENT));
}

/**
 * Finds a router outlet inside a node.
 *
 * - name === undefined | null | '' → primary (unnamed) outlet
 * - name provided → looks for data-router-outlet="name"
 */
export function findOutlet(
  node: Node,
  name?: string | null,
): HTMLElement | null {
  if (!(node instanceof Element || node instanceof DocumentFragment)) {
    return null;
  }

  const targetName = name ?? '';

  // Direct match on the node itself
  if (node instanceof HTMLElement && node.hasAttribute(OUTLET_ATTRIBUTE)) {
    const outletName = node.getAttribute(OUTLET_ATTRIBUTE) ?? '';
    if (outletName === targetName) {
      return node;
    }
  }

  const outlets = Array.from(
    node.querySelectorAll<HTMLElement>(`[${OUTLET_ATTRIBUTE}]`),
  );

  // Exact name match first
  const exact = outlets.find(
    (el) => (el.getAttribute(OUTLET_ATTRIBUTE) ?? '') === targetName,
  );
  if (exact) {
    return exact;
  }

  // Primary outlet fallback: empty or missing value
  if (targetName === '') {
    return (
      outlets.find((el) => {
        const val = el.getAttribute(OUTLET_ATTRIBUTE);
        return val === '' || val === null;
      }) ?? null
    );
  }

  return null;
}