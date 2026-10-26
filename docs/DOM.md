# DOM and browser streams

Import `on` from the DOM subpackage. Each returned atom shares one browser
listener or watch among its consumers. Observation starts on the first
subscription or async iterator and stops after the last consumer leaves.
Calling `dispose()` also releases the source.

```ts
import { on } from '@epikodelabs/streamix/dom';

const pointer = on('pointer');
const scroll = on('scroll');

const stopPointer = pointer.subscribe(({ x, y }) => movePreview(x, y));
const stopScroll = scroll.subscribe(({ x, y }) => updateScrollIndicator(x, y));

// When the owner is destroyed:
stopPointer();
stopScroll();
```

## Pointer position

`on('pointer', target?)` observes `pointermove`, `pointerdown`,
`pointerup`, and `pointercancel` on an `EventTarget`, defaulting to `window`.
Listeners are passive. There is no initial position until an event arrives.

Each `PointerPosition` snapshot contains:

| Field | Meaning |
| --- | --- |
| `x`, `y` | Viewport coordinates in CSS pixels (`clientX`, `clientY`) |
| `pageX`, `pageY` | Document coordinates in CSS pixels |
| `pointerId`, `pointerType`, `isPrimary` | Identity and kind of pointer |
| `buttons`, `pressure` | Current button bitmask and pointer pressure |

An element target only observes events delivered to that element; it does not
enable pointer capture or change the element's touch behavior. Coordinates
remain relative to the viewport, including when the target is an element.

## Scroll position

`on('scroll', target?)` accepts a `Window`, `Document`, or `Element`,
defaulting to `window`. It emits `{ x, y }` initially and on scroll events,
using a passive listener. Offsets retain fractional and negative values.
An element stream observes that element's scrolling, not descendant scrolls.

```ts
const panelScroll = on('scroll', panelElement);

for await (const { y } of panelScroll) {
  updatePanelHeader(y);
  if (panelClosed()) break; // Releases this iterator's observation.
}
```

Pointer and scroll streams use analog delivery to coalesce pending source
updates to the latest snapshot. They are position streams;
do not use them to count every input event. They do not add animation-frame
throttling.

## Geolocation

`on('geolocation', options?)` shares a native `watchPosition()` call. Options
are standard `PositionOptions`, passed unchanged to the browser.

```ts
const location = on('geolocation', {
  enableHighAccuracy: false,
  maximumAge: 30_000,
  timeout: 10_000,
});

const stop = location.subscribe(state => {
  if (state.error) {
    showLocationError(state.error.message);
    return;
  }
  const { latitude, longitude, accuracy } = state.position.coords;
  updateMap(latitude, longitude, accuracy);
});

// Stops the browser watch when this is the final consumer.
stop();
```

`GeolocationState` is either `{ position: GeolocationPosition, error: null }`
or `{ position: null, error: GeolocationPositionError }`. No placeholder
location is emitted. Native asynchronous failures, including permission
denial, are state updates; a later successful fix can replace an error.
Synchronous API exceptions use the atom's `onError` channel.

Location access requires a secure context, browser permission, and an allowing
Permissions Policy. The permission request happens only when the atom is
consumed. See the browser's [geolocation API documentation](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API).

All three sources are safe to construct and consume during SSR. Default
pointer/scroll sources without a window, and geolocation without the browser
API, remain silent until disposed or unsubscribed.
