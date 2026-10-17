# Streamix Runtime — Batch 18: Source Detachment and Demand Safety

Apply after Batch 17.

## Fix

When removing a source, the coordinator now updates and notifies pending consumers **before** awaiting the source iterator's `return()`. Previously, if the removed source was the last active source and its cleanup promise never resolved, outstanding `next()` consumers remained stuck indefinitely despite there being no sources left.

This preserves the semantics of other active sources: removal of one source does not prematurely complete consumers while another source is still producing events.

## Tests

Added `runtime-coordinator-detach.spec.ts` covering:
- Pending consumer settles before a removed source finishes cleanup.
- Removing one source does not complete the coordinator while another remains active.

## Verification

Targeted library TypeScript check passed:

`tsc --noEmit --skipLibCheck --target es2022 --module esnext --moduleResolution bundler src/lib/utils/coordinator.ts`

Jasmine tests and full production build have not been run (test runner dependencies are not installed in this reconstructed workspace).

## Next

Run the complete Jasmine suite and adapter builds against the actual monorepo. Resolve any graph propagation and execution lifecycle regressions before declaring the runtime migration complete.
