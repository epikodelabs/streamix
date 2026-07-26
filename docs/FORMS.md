# Streamix Forms

A reactive, framework-agnostic forms engine built on top of [`@epikodelabs/streamix`](https://www.npmjs.com/package/@epikodelabs/streamix) atoms, with an optional Angular directive (`sxFormBinding`) that binds a form model directly to plain HTML markup — no reactive-forms boilerplate, no template-driven `ngModel` wiring.

- **Core (`forms.ts`)** — framework-agnostic `Field` / `Form` / `List` nodes, validation, and status derivation.
- **`path.ts`** — resolve nodes/fields by dotted string path (`"address.city"`, `"contacts.0.email"`).
- **`bind-form.ts` / `native-control.ts` / `template-validators.ts`** — DOM binding layer that wires native `<input>`/`<select>`/`<textarea>` elements to fields by `name`, and lets you register custom validation attributes (`sxRequired`, `sxMatch`, etc.).
- **`form-binding.directive.ts`** — the Angular `[sxFormBinding]` structural directive that ties it all together.

## Installation

```bash
npm install @epikodelabs/streamix
```

Copy the module files into your project (or publish them as your own package) and import from the barrel:

```ts
import { field, form, list, checks } from './forms';
import { resolveField, resolveNode } from './path';
import { StreamixFormBindingDirective } from './form-binding.directive';
```

`index.ts` re-exports `./forms`, `./path`, and `./form-binding.directive`. The DOM-binding internals (`bind-form.ts`, `native-control.ts`, `template-validators.ts`) are lower-level modules — import them directly if you need to build a binding for a framework other than Angular.

## Core concepts

Everything in a form tree is a `FormNode<Value, CompleteValue = Value>`. There are three kinds:

| Kind | Created by | Represents |
|---|---|---|
| `field` | `field(initial, options)` | A single leaf value |
| `form` | `form(fields, options)` | A keyed group of child nodes (object-shaped) |
| `list` | `list(initialItems, options)` | An ordered, mutable array of child nodes |

Every node exposes the same read-only shape:

```ts
node.value            // StateProjection<Value> — the "live", possibly-partial value
node.completeValue     // StateProjection<CompleteValue> — value with disabled subtrees still included
node.issues            // StateProjection<ValidationIssues | null>
node.validationError   // StateProjection<unknown | null> — thrown-check errors, distinct from issues
node.status            // "valid" | "invalid" | "pending" | "disabled" | "error"
node.valid / node.invalid
node.pending           // true while async validation is running
node.dirty             // value differs from initialValue
node.touched           // set via node.touch() / cleared via node.untouch()
node.disabled           // WritableStateProjection<boolean>

node.set(value, options?)      // write a complete value
node.reset() / node.reset(value, { updateInitial? })
node.touch() / node.untouch()
node.enable(options?) / node.disable(options?)   // options.onlySelf to skip descendants
node.dispose()
```

Each `StateProjection<T>` is `{ value, previous, disposed, error, subscribe(cb) }`; `subscribe` only fires when the projected value actually changes (`Object.is` comparison), not on every parent update.

### Fields

```ts
import { field, checks } from './forms';

const email = field('', {
  checks: [checks.required, checks.email],
  asyncChecks: [checkEmailAvailable],   // (value, signal) => issues | null | Promise<...>
  asyncOnlyWhenSyncClean: true,          // default true: skip async checks while sync issues exist
  asyncDelay: 300,                       // debounce in ms before running async checks
  disabled: false,
  validateInitial: true,                 // run validation immediately on creation
});
```

`Field<T>` adds:

```ts
field.initialValue      // StateProjection<T>
field.syncIssues        // issues from `checks` only
field.asyncIssues       // issues from `asyncChecks` only
field.issues            // merged sync + async issues

field.useValidation(source, { checks, asyncChecks, asyncOnlyWhenSyncClean?, asyncDelay? });
field.clearValidation(source);
```

`useValidation` / `clearValidation` let *anyone* (a directive, a parent form, a template attribute) contribute additional checks to a field keyed by an arbitrary `source` object, without clobbering checks contributed by others. Multiple sources are merged; `asyncOnlyWhenSyncClean`/`asyncDelay` from the most-recently-set source win.

`bindField(writableAtom, options)` creates a field that mirrors an existing Streamix `Writable<T>` two-way: external updates to the atom flow into the field, and field writes flow back out. Disposing the field never disposes the source atom, and the atom's original value stays the field's reset baseline.

### Forms (groups)

```ts
import { form, field, checks } from './forms';

const profile = form({
  name: field('', { checks: checks.required }),
  email: field('', { checks: [checks.required, checks.email] }),
}, {
  checks: value => (value.name === value.email ? { nameEqualsEmail: true } : null),
  ownsChildren: true,   // default true — disposing the form disposes its children
  disabled: false,
});

profile.fields.name;                 // the child Field
profile.value.value;                 // Partial<{ name, email }> — omits disabled children
profile.completeValue.value;         // { name, email } — includes disabled children
profile.patch({ name: 'Ada' });      // shallow-merge a partial value
profile.useChecks(source, checks);   // add form-level (cross-field) checks, keyed by source
profile.clearChecks(source);
```

A form's own validation issues (from `useChecks`/`options.checks`) are merged with the aggregated status of its children — an invalid child makes the whole form `invalid` even if the form has no checks of its own. A node cannot belong to two containers at once; reusing a `Field`/`Form`/`List` in two `form()`/`list()` calls throws.

### Lists

```ts
import { list, field } from './forms';

const tags = list([field('first')]);

tags.items;               // readonly N[]
tags.push(field('second'));
tags.insert(0, field('inserted'));
tags.removeAt(1);
tags.detachAt(0);          // remove and return, without disposing (use when ownsChildren: false)
tags.clear();
tags.batch(() => { ... }); // coalesce multiple mutations into one notification
```

`syncList(listNode, nextValues, createFn)` reconciles a list's items to match an array of complete values — trimming/growing the list and resetting existing items in place — useful for keeping a list in sync with server data without recreating unrelated rows:

```ts
syncList(tags, ['a', 'b', 'c'], value => field(value));
```

### Checks

Built-in synchronous checks, all returning `ValidationIssues | null`:

```ts
checks.required
checks.requiredTrue          // for checkbox-style "must be true" fields
checks.minLength(n) / checks.maxLength(n)
checks.number
checks.min(n) / checks.max(n)
checks.pattern(stringOrRegExp)
checks.email
checks.compose(...checks)         // merge several sync checks into one
checks.composeAsync(...asyncChecks)
```

Issue shape is a plain keyed object, e.g. `{ required: true }`, `{ minLength: { required: 3, actual: 1 } }`, `{ pattern: { required: '^\\d+$', actual: 'abc' } }`. Issue dictionaries have a `null` prototype — use `Object.hasOwn(issues, 'required')`, not `issues.hasOwnProperty(...)`.

### Feedback helpers

```ts
import { formatFieldError, fieldError, fieldHint, defaultFieldMessages, type FieldView } from './forms';

formatFieldError(field, messages?, pendingHint?);
// -> null while untouched/clean/pending, "Validation failed." on thrown errors,
//    a message for the first issue key otherwise (falls back to a generic
//    "Minimum/Maximum length/value is N." for range issues, "Value is invalid." otherwise)
```

`FieldView<T>` bundles a field with display metadata (`label`, `type`, `min`/`max`, `hint`, `pendingHint`) for building generic field-renderer components; `fieldError(view, messages?)` / `fieldHint(view)` operate on a `FieldView` directly.

### Utilities

```ts
watchNode(node, callback);        // subscribe to a node's raw state atom; returns an unsubscribe fn
formSnapshot(node);               // node.completeValue.value, typed via NodeCompleteValue<N>
abortableDelay(ms, signal);       // Promise that resolves early if the signal aborts (used to build asyncDelay-like checks)
```

## Path resolution (`path.ts`)

Resolve a node anywhere in a tree from a dotted string path. Form segments index into `fields`; list segments must be integer indices into `items`.

```ts
import { resolveNode, resolveField } from './path';

resolveNode(rootForm, 'address.city');     // FormNode | undefined
resolveField(rootForm, 'contacts.0.email'); // Field<unknown> | undefined — undefined if the node isn't a field
```

## DOM binding without Angular

`bindForm(root, form, options?)` is the framework-agnostic binding engine the Angular directive wraps. Use it directly in any environment that gives you a root `HTMLElement`:

```ts
import { bindForm } from './bind-form';

const binding = bindForm(document.querySelector('#my-form')!, myForm, {
  noValidate: true, // sets `.noValidate = true` on an enclosing <form> (default true)
});

binding.refresh();  // force a re-scan (normally automatic via MutationObserver)
binding.dispose();  // detach everything: listeners, observer, template validators
```

What it does:

1. **Native control binding** — every `input[name]`, `textarea[name]`, `select[name]` under `root` is matched to a field via `resolveField(form, element.name)` and bound with `bindControl` (see below). Elements are re-scanned on DOM mutation (`MutationObserver` on `childList`/`subtree`/`attributes`, debounced with `queueMicrotask`); controls whose name/type/attributes change are rebound, and removed elements are disposed automatically.
2. **Template validators** — every element in the subtree is checked against the registered `templateValidators` map (see below) and bound/rebound/disposed as matching attributes appear, change, or disappear.

### Native control binding (`native-control.ts`)

For a matched element, `bindControl` derives an `ElementKind` (`checkbox` / `radio` / `number` / `select` / `text`) and:

- **Reads native HTML validation attributes into checks automatically**: `required`, `minlength`, `maxlength`, `pattern`, `type="email"`, and for number/range inputs, `min`/`max`. These are attached via `field.useValidation(...)`, so they compose with checks you already put on the field — they don't replace them.
- **Writes** the field's value/disabled/invalid/pending state back onto the element on every change (`element.disabled`, value via `writeControlValue`, `.is-invalid` / `.is-pending` classes, `aria-invalid`).
- **Reads** user input into the field: `input` events for text-like controls, `change` for checkboxes/selects/radios (ignoring unchecked radio `change` events), and `blur` calls `field.touch()`.
- `nativeControlSignature(element)` fingerprints `name|type|required|minlength|maxlength|pattern|min|max` so `bindForm` knows when to tear down and rebuild a control vs. leave it alone.

### Custom template validators (`template-validators.ts`)

Register your own HTML attributes as validation sources, resolved against the DOM at bind time. Two kinds:

```ts
import { defineFieldValidator, defineFormValidator } from './template-validators';
import { checks } from './forms';

// Field-level: applies to the field matching the element's own `name`
defineFieldValidator('sxMinLength', ({ attributeValue }) => ({
  checks: checks.minLength(Number(attributeValue)),
}));

// Form-level: applies to a `Form` node resolved from the element's context
defineFormValidator(
  'sxMatch',
  ({ attributeValue, targetPath }) => value =>
    value[targetPath] === value[attributeValue] ? null : { mismatch: true },
  // optional resolvePath override; otherwise falls back to the attribute value
  // as a path, then to the nearest common ancestor path of nested named controls
);
```

```html
<div sxMatch="password">
  <input name="password" />
  <input name="confirmPassword" />
</div>
```

Notes:

- Attribute names are matched case-insensitively (`normalizeAttribute`); registering the same attribute twice throws.
- `templateValidatorSignature(...)` fingerprints `(kind, attribute, targetPath, attributeValue)` so a binding is only torn down and recreated when something relevant actually changed.
- For form-level validators, `inferContainerPath` finds the longest common ancestor path shared by all named controls inside the element when no explicit path is given — this is what lets `sxMatch="password"` on a wrapping `<div>` resolve to the right nested form group.
- Field-level validator disposal calls `field.clearValidation(source)`; form-level calls `target.clearChecks(source)`, and both skip the call if the node is already disposed.

## Angular integration (`[sxFormBinding]`)

```ts
import { Component } from '@angular/core';
import { StreamixFormBindingDirective } from './form-binding.directive';
import { form, field, checks } from './forms';

@Component({
  standalone: true,
  imports: [StreamixFormBindingDirective],
  template: `
    <form [sxFormBinding]="loginForm">
      <input name="email" type="email" required />
      <input name="password" type="password" required minlength="8" />
      <button type="submit">Sign in</button>
    </form>
  `,
})
export class LoginComponent {
  loginForm = form({
    email: field('', { checks: [checks.required, checks.email] }),
    password: field('', { checks: checks.required }),
  });
}
```

- Bind the directive to a `Form<any>` instance via `[sxFormBinding]="yourForm"`.
- Binds on `ngAfterViewInit`; if the bound `Form` instance changes later (`ngOnChanges`, compared with `Object.is`), the old binding is disposed and a new one created against the new form.
- Automatically disposes the binding in `ngOnDestroy`.
- If the host element is or is inside a `<form>`, `noValidate` is set to disable the browser's native validation UI (native `required`/`pattern`/etc. attributes are still read and turned into checks — you just don't get the browser's default bubble UI, since `bindForm`'s CSS classes/`aria-invalid` drive your own styling instead).
- No template syntax beyond plain `name="..."` attributes and (optionally) custom validator attributes is required — this is deliberately closer to template-driven forms than reactive forms, but backed by the same `Field`/`Form`/`List` model you'd use headlessly.

## Full example

```ts
import { form, field, list, checks } from './forms';

const signupForm = form({
  username: field('', {
    checks: [checks.required, checks.minLength(3)],
    asyncChecks: [checkUsernameAvailable],
    asyncDelay: 300,
  }),
  password: field('', { checks: [checks.required, checks.minLength(8)] }),
  contacts: list([field('')]),
}, {
  checks: value =>
    value.username.toLowerCase() === value.password.toLowerCase()
      ? { passwordMatchesUsername: true }
      : null,
});

signupForm.status.subscribe(status => console.log('form status:', status));
signupForm.fields.contacts.push(field(''));
signupForm.reset();
```

```html
<form [sxFormBinding]="signupForm">
  <input name="username" required minlength="3" />
  <input name="password" type="password" required minlength="8" />
  <input name="contacts.0" />
</form>
```