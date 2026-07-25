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
