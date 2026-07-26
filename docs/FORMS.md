# Streamix Forms

> *Because nobody has ever said: "I wish my forms were more complicated."*

Forms start simple:

```ts
const name = field("");
```

A week later they involve 17 validators, async checks, nested groups, dynamic lists, and a bug that only shows up on Fridays.

If that sounds familiar — this is for you.

## The idea

Most form libraries are glued to a UI framework.  
Streamix Forms is not.

> **A form is just state.**

Field, group, list, validation — all state.  
Rendering is someone else’s problem.

Write the logic once. Use it in Angular, React, or whatever comes next.

## Why it might stick

- No RxJS, no Angular Reactive Forms
- Framework-independent model
- Fine-grained reactivity (Streamix atoms)
- Sync + async validation
- Cross-field checks
- Native HTML validation support
- Strong TypeScript inference
- Dynamic lists & nested forms
- Disposable form trees

## Architecture

```text
Application → Form Model → Validation → DOM Binding → Angular (or anything)
```

Core has zero Angular, zero RxJS, zero DOM assumptions. Just forms.

---

## Install

```bash
npm install @epikodelabs/streamix
```

```ts
import { field, form, list, checks } from './forms';
import { resolveField, resolveNode } from './path';
import { StreamixFormBindingDirective } from './form-binding.directive';
```

## Core

Three node types:

| Kind    | Factory                     | What it is              |
|---------|-----------------------------|-------------------------|
| `field` | `field(initial, options)`   | Single value            |
| `form`  | `form(fields, options)`     | Object of child nodes   |
| `list`  | `list(initialItems, options)` | Ordered array of nodes |

Common API on every node:

```ts
node.value / node.completeValue / node.issues / node.status
node.valid / node.invalid / node.pending / node.dirty / node.touched / node.disabled
node.set() / node.reset() / node.touch() / node.enable() / node.disable() / node.dispose()
```

### Field

```ts
const email = field('', {
  checks: [checks.required, checks.email],
  asyncChecks: [checkEmailAvailable],
  asyncDelay: 300,
});
```

Extra: `useValidation(source, …)` / `clearValidation(source)` so multiple sources can add checks without clobbering each other.

### Form

```ts
const profile = form({
  name: field('', { checks: checks.required }),
  email: field('', { checks: [checks.required, checks.email] }),
}, {
  checks: v => v.name === v.email ? { nameEqualsEmail: true } : null,
});
```

### List

```ts
const tags = list([field('first')]);
tags.push(field('second'));
tags.removeAt(1);
tags.batch(() => { /* multiple mutations, one notification */ });
```

`syncList(list, values, createFn)` keeps a list in sync with external data without recreating everything.

### Checks

```ts
checks.required / requiredTrue / minLength / maxLength
checks.number / min / max / pattern / email
checks.compose(...) / composeAsync(...)
```

Issues are plain objects (`{ required: true }`, `{ minLength: { required: 3, actual: 1 } }`).

### Helpers

```ts
formatFieldError(field)          // human-readable error or null
watchNode(node, cb)              // subscribe to raw state
formSnapshot(node)               // complete value
resolveNode / resolveField       // path lookup: 'contacts.0.email'
```

## DOM binding (framework-agnostic)

```ts
import { bindForm } from './bind-form';

const binding = bindForm(rootElement, myForm);
binding.refresh();
binding.dispose();
```

- Matches `input[name]` / `textarea` / `select` to fields
- Reads native `required`, `minlength`, `pattern`, etc. into checks
- Writes value / disabled / invalid / pending back to the DOM
- Supports custom attribute validators via `defineFieldValidator` / `defineFormValidator`

## Angular

```ts
@Component({
  standalone: true,
  imports: [StreamixFormBindingDirective],
  template: `
    <form [sxFormBinding]="loginForm">
      <input name="email" type="email" required />
      <input name="password" type="password" required minlength="8" />
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

Plain `name` attributes. No reactive-forms ceremony. Binding auto-cleans on destroy.

## Quick example

```ts
const signup = form({
  username: field('', {
    checks: [checks.required, checks.minLength(3)],
    asyncChecks: [checkUsernameAvailable],
    asyncDelay: 300,
  }),
  password: field('', { checks: [checks.required, checks.minLength(8)] }),
  contacts: list([field('')]),
}, {
  checks: v => v.username.toLowerCase() === v.password.toLowerCase()
    ? { passwordMatchesUsername: true } : null,
});
```

```html
<form [sxFormBinding]="signup">
  <input name="username" required minlength="3" />
  <input name="password" type="password" required minlength="8" />
  <input name="contacts.0" />
</form>
```

Forms stay forms. State stays state. Fewer Friday bugs.