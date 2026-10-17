# Batch 20 — Transaction finalization reliability

Patch over Batch 19. Changes are limited to `src/lib/runtime/scheduling.ts` and a new regression spec.

When a transaction finalizer throws, the runtime now still executes the remaining finalizers and flushes queued work. The first finalizer error is rethrown after cleanup. This avoids leaving other nodes' transaction bookkeeping uncleared and dirty work unflushed.

Validation: standalone TypeScript compilation and Node.js behavior checks (see response). Full Jasmine suite not run.
