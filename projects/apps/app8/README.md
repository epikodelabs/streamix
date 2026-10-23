# App 8 — Vue Task Board

A task board written as compiled Vue single-file components on top of Streamix.
Every stateful value in the app is a Streamix node — nothing is copied into
Vue stores by hand. The Vue builder's SFC compiler bridges the `<script setup>`
declarations and the template stays plain Vue.

The demo covers the compiler-first Vue surface, one pipeline per feature:

1. **Compiled bindings** — `atom`, `derived`, `flow`, and `scope` declarations
   are bridged automatically: `v-model="search"` writes through the generated
   `useWritable` bridge, `v-model="board.draft"` lowers to
   `board.set("draft", …)`, and the scope is disposed with the component.
2. **Debounced search** — `pipe(search, debounce(200), startWith(""))` feeds
   the visible-list derived, so filtering lags the last keystroke by 200 ms
   while the input itself stays instant through the v-model bridge.
3. **Serial autosave queue**: every mutation enqueues a save request that
   `concatMap(save)` processes one at a time in request order. Repeated edits
   never overlap, and each row shows its own saved / saving / failed state,
   with per-task retry.
4. **Buffered pause**: pausing autosave retains new requests in an app-level
   array. Resuming sends them through the serial save pipeline in request
   order. Saves already enqueued before pausing continue to run.
5. **Debounced persistence** —
   `pipe(board.get("tasks"), skip(1), debounce(400), tap(…))` writes
   localStorage without an explicit subscription handler; `skip(1)` drops the
   initial replay so a fresh mount never overwrites storage before the sync
   flow restores it.
6. **Derived everything else** — combined filter/tag/sort selection, board
   stats (completion, sync health, average completion time), undo snapshots,
   and a "saved Xs ago" ticker recomputed every second by `interval(1000)`.
7. **Inspector** — run a development build and open the in-app inspector to
   watch the search pipe, autosave queue, and persistence pipeline as live
   flows.

Run it with:

```bash
npx ng serve app8
```
