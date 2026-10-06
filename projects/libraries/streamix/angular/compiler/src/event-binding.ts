/**
 * Native event recognition shared by the template parser and the compiled
 * block compiler. Both need the same allow-list and modifier vocabulary; only
 * the argument rules differ (a compiled binding can rewrite value arguments,
 * a top-level binding must handle literals and `$event` only).
 */

/** Native events the compiler installs itself. */
export const NATIVE_EVENT_TYPES = new Set([
  'click', 'dblclick', 'input', 'change', 'submit', 'reset', 'focus', 'blur',
  'focusin', 'focusout', 'keydown', 'keyup', 'keypress', 'pointerdown',
  'pointerup', 'pointermove', 'pointercancel', 'pointerenter', 'pointerleave',
  'mousedown', 'mouseup', 'mousemove', 'mouseenter', 'mouseleave', 'mouseover',
  'mouseout', 'wheel', 'scroll', 'contextmenu', 'dragstart', 'drag', 'dragend',
  'dragenter', 'dragover', 'dragleave', 'drop', 'touchstart', 'touchend',
  'touchmove', 'touchcancel', 'animationend', 'animationstart',
  'transitionend', 'load', 'error',
]);

/** Angular event modifiers the generated listener can reproduce. */
export const EVENT_MODIFIERS = new Set([
  'stop', 'prevent', 'self', 'once', 'capture',
]);

/** Keyboard modifiers, mapped to the `KeyboardEvent.key` value they filter. */
export const KEY_MODIFIER_KEYS: Readonly<Record<string, string>> = {
  enter: 'Enter',
  escape: 'Escape',
  space: ' ',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  alt: 'Alt',
  shift: 'Shift',
  control: 'Control',
  meta: 'Meta',
};

/** A recognized `(event.modifier)="method(...)"` binding. */
export interface SxParsedNativeEvent {
  readonly type: string;
  readonly modifiers: readonly string[];
  readonly method: string;
  readonly argumentText: string;
}

const LITERAL_ARGUMENT =
  /^'[^']*'$|^"[^"]*"$|^-?\d+(\.\d+)?$|^(?:true|false|null|undefined)$/;

const METHOD_CALL =
  /^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(([^()]*)\)\s*$/;

/**
 * Recognizes a native event binding. Returns `undefined` for animations,
 * `window:`/`document:` targets, component/custom-element outputs, unknown
 * event names or modifiers, and handler shapes the generated listener cannot
 * reproduce.
 */
export function parseNativeEventBinding(
  elementName: string,
  eventName: string,
  phase: string | null,
  target: string | null,
  handler: string,
  options: { allowValueArguments?: boolean } = {},
): SxParsedNativeEvent | undefined {
  if (phase != null || target != null || elementName.includes('-')) {
    return undefined;
  }

  const [type, ...modifiers] = eventName.split('.');

  if (!NATIVE_EVENT_TYPES.has(type)) {
    return undefined;
  }

  for (const modifier of modifiers) {
    if (!EVENT_MODIFIERS.has(modifier) && !(modifier in KEY_MODIFIER_KEYS)) {
      return undefined;
    }
  }

  const call = METHOD_CALL.exec(handler);

  if (!call) {
    return undefined;
  }

  const argumentText = call[2];

  if (!options.allowValueArguments) {
    for (const argument of argumentText.split(',').map(part => part.trim())) {
      if (!argument || argument === '$event') {
        continue;
      }

      if (!LITERAL_ARGUMENT.test(argument)) {
        return undefined;
      }
    }
  }

  return {
    type,
    modifiers,
    method: call[1],
    argumentText,
  };
}

/** True when an event argument is a literal the compiler can emit verbatim. */
export function isLiteralArgument(argument: string): boolean {
  return argument === '$event' || LITERAL_ARGUMENT.test(argument);
}
