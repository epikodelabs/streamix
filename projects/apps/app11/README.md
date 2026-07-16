# app11

`app11` compares two approaches to building the same comprehensive form in Angular 21.

## Pages

- `/angular`: Angular reactive forms only
- `/streamix`: native inputs backed by streamix scope state, without Angular forms on that page

## Structure

- [`src/app/pages/angular-form`](./src/app/pages/angular-form): Angular-only form page
- [`src/app/pages/streamix-form`](./src/app/pages/streamix-form): streamix-based form page
- [`src/app/shared/form-model.ts`](./src/app/shared/form-model.ts): Angular form builders and validators
- [`src/app/shared/profile-model.ts`](./src/app/shared/profile-model.ts): shared data model and sample payload
- [`src/app/shared/form-helpers.ts`](./src/app/shared/form-helpers.ts): local reusable path and event helpers
- [`src/app/shared/streamix-form.config.ts`](./src/app/shared/streamix-form.config.ts): streamix page field metadata
- [`src/app/shared/streamix-form.validation.ts`](./src/app/shared/streamix-form.validation.ts): streamix page validation and hint logic
- [`src/app/shared/streamix-form.helpers.ts`](./src/app/shared/streamix-form.helpers.ts): streamix UI-state orchestration

## What it shows

- Nested profile, security, address, preferences, availability, and skills sections
- Dynamic skill rows
- Inline validation and password cross-field checks
- Debounced autosave and derived preview state in the streamix page
- Side-by-side architecture comparison between Angular reactive forms and streamix scope state

## Run

```bash
npx ng serve app11
```

## Build

```bash
npx ng build app11 --configuration development
```
