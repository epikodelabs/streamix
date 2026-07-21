# app11

`app11` compares two approaches to building the same comprehensive form in Angular 21.

## Pages

- `/angular`: Angular reactive forms only
- `/streamix`: native inputs backed by a local `streamix-forms.ts` copy, without Angular forms on that page

## Structure

- [`src/app/pages/angular-form`](./src/app/pages/angular-form): Angular-only form page
- [`src/app/pages/streamix-form`](./src/app/pages/streamix-form): local Streamix forms page
- [`src/app/shared/form-model.ts`](./src/app/shared/form-model.ts): Angular form builders and validators
- [`src/app/shared/profile-model.ts`](./src/app/shared/profile-model.ts): shared data model and sample payload
- [`src/app/shared/form-helpers.ts`](./src/app/shared/form-helpers.ts): local event and indexed-path helpers
- [`src/app/shared/streamix-forms.ts`](./src/app/shared/streamix-forms.ts): local copy of the Streamix forms runtime
- [`src/app/shared/profile-form.ts`](./src/app/shared/profile-form.ts): Streamix form tree creation, validation, reset logic, and derived state
- [`src/app/shared/streamix-field.directive.ts`](./src/app/shared/streamix-field.directive.ts): native input bindings and field feedback

## What it shows

- Nested profile, security, address, preferences, availability, and skills sections
- Dynamic skill rows
- Inline validation and password cross-field checks
- Debounced autosave and derived preview state in the streamix page
- Side-by-side architecture comparison between Angular reactive forms and a local Streamix form tree

## Run

```bash
npx ng serve app11
```

## Build

```bash
npx ng build app11 --configuration development
```
