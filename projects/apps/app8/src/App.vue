<script setup lang="ts">
import {
  atom, concatMap, debounce, derived, flow, interval,
  map, mergeMap, pipe, scope, skip, startWith, tap,
} from "@epikodelabs/streamix";
import { PRIORITY_RANK, PRIORITIES, SEED_TASKS, TAGS, loadPersistedTasks, persistTasks,
  type ActivityEntry, type Priority, type SaveState, type Tag, type Task } from "./model";
import TaskList from "./components/TaskList.vue";
import ActivityFeed from "./components/ActivityFeed.vue";

// ── Controls: standalone writable atoms, v-modeled through the generated
// useWritable bridges. ──
const filter = atom<"all" | "active" | "done">("all");
const tag = atom<Tag | "all">("all");
const sortBy = atom<"newest" | "oldest" | "priority">("newest");
const search = atom("");
const draftTag = atom<Tag>("work");
const draftPriority = atom<Priority>("medium");

// ── The board: a component-owned scope. The compiler ties its lifetime to
// this component and bridges the members the template touches. ──
const board = scope({
  draft: "",
  tasks: [] as Task[],
});

// ── Debounced search: a pipe over the raw search atom. The list derived
// reads the debounced atom, so filtering lags the last keystroke by 200 ms
// while the input itself stays instant through the v-model bridge. ──
const liveSearch = pipe(search, debounce(200), startWith(""));

// ── The visible list: one derived combining every control. ──
const visible = derived(($) => {
  const tasks = $(board.get("tasks")) as Task[];
  const kind = $(filter);
  const wanted = $(tag);
  const sort = $(sortBy);
  const query = $(liveSearch).trim().toLowerCase();

  const matched = tasks.filter((task) =>
    (kind === "all" || task.done === (kind === "done")) &&
    (wanted === "all" || task.tag === wanted) &&
    (query === "" || task.title.toLowerCase().includes(query)));

  const ranked = [...matched];
  if (sort === "priority") {
    ranked.sort((left, right) =>
      PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] || left.createdAt - right.createdAt);
  } else {
    ranked.sort((left, right) => sort === "newest" ? right.createdAt - left.createdAt : left.createdAt - right.createdAt);
  }
  return ranked;
});

// ── Board stats: completion, sync health, average completion time. ──
const stats = derived(($) => {
  const tasks = $(board.get("tasks")) as Task[];
  const done = tasks.filter((task) => task.done);
  const finished = done.filter((task) => task.completedAt !== undefined);
  const avgMinutes = finished.length === 0 ? 0 : Math.round(
    finished.reduce((sum, task) => sum + ((task.completedAt! - task.createdAt) / 60_000), 0) / finished.length);
  return {
    total: tasks.length,
    done: done.length,
    remaining: tasks.length - done.length,
    pct: tasks.length === 0 ? 0 : Math.round((done.length / tasks.length) * 100),
    saving: tasks.filter((task) => task.save === "saving").length,
    failed: tasks.filter((task) => task.save === "error").length,
    avgMinutes,
  };
});

// ── Undo: snapshots taken before every user mutation. ──
const undoStack = atom<Task[][]>([]);
const undoCount = derived(($) => $(undoStack).length);

function checkpoint(): void {
  undoStack.set([...undoStack.value, (board.tasks as Task[]).map((task) => ({ ...task }))].slice(-10));
}

// Autosave: concatMap runs saves one at a time in request order, so
// repeated edits to a task cannot overlap. Requests made while autosave
// is paused stay in an app-level buffer until it resumes.
interface SaveRequest { id: number }
interface SaveResult { id: number; ok: boolean }

const saveQueue = atom<SaveRequest[]>([]);
const autosaveOn = atom(true);
const pendingSaves: SaveRequest[] = [];

const saves = pipe(
  saveQueue,
  mergeMap((requests) => requests),
  concatMap((request: SaveRequest) => simulateSave(request.id)),
  tap((result: SaveResult) => applySaveResult(result)),
);

function simulateSave(id: number): Promise<SaveResult> {
  return new Promise((resolve) => {
    const duration = 500 + Math.random() * 900;
    setTimeout(() => resolve({ id, ok: Math.random() > 0.15 }), duration);
  });
}

function applySaveResult(result: SaveResult): void {
  const task = (board.tasks as Task[]).find((candidate) => candidate.id === result.id);
  if (!task) return; // deleted while the save was in flight
  board.set("tasks", (board.tasks as Task[]).map((candidate) =>
    candidate.id === result.id ? { ...candidate, save: result.ok ? "saved" : "error" } : candidate));
  logActivity(result.ok ? `Synced "${task.title}"` : `Sync failed for "${task.title}"`);
}

function markSave(id: number, state: SaveState): void {
  board.set("tasks", (board.tasks as Task[]).map((task) => (task.id === id ? { ...task, save: state } : task)));
}

function enqueueSave(id: number): void {
  markSave(id, "saving");
  const request = { id };
  if (autosaveOn.value) {
    saveQueue.set([request]);
  } else {
    pendingSaves.push(request);
  }
}

// ── Persistence: another pipe, this one over a scope member source. skip(1)
// drops the initial replay so a fresh mount never overwrites storage before
// the sync flow restores it; debounce batches rapid edits into one write. ──
const lastSavedAt = atom(0);

const persistence = pipe(
  board.get("tasks"),
  skip(1),
  debounce(400),
  tap((tasks: Task[]) => {
    persistTasks(tasks);
    lastSavedAt.set(Date.now());
  }),
);

// ── A live ticker: interval() clocks a derived that formats the time since
// the last local save. ──
const clock = pipe(interval(1000), map(() => Date.now()));

const savedAgo = derived(($) => {
  $(clock);
  const at = $(lastSavedAt);
  if (at === 0) return "not saved yet";
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 5) return "saved just now";
  return seconds < 60 ? `saved ${seconds}s ago` : `saved ${Math.floor(seconds / 60)}m ago`;
});

// Piped atoms are cold: these keep-alive subscriptions run the pipelines for
// the component's lifetime, and the cleanups stop them when the scope dies.
// liveSearch needs one too — as a flow, it only emits once subscribed, and a
// derived that waits for all inputs would wait forever for a cold source.
board.cleanups.add(liveSearch.subscribe(() => {}));
board.cleanups.add(saves.subscribe(() => {}));
board.cleanups.add(persistence.subscribe(() => {}));
board.cleanups.add(clock.subscribe(() => {}));
board.cleanups.add(() => { saves.dispose(); persistence.dispose(); clock.dispose(); liveSearch.dispose(); });

// ── The server round-trip, as a flow: the template reads its latest yield
// through the useIterable bridge while the flow itself writes the loaded
// tasks into the scope. ──
const sync = flow(async function* (signal) {
  yield "Restoring…";
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 700);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  if (signal.aborted) return;
  const restored = loadPersistedTasks();
  if (restored) {
    board.set("tasks", restored);
    yield restored.length === 0
      ? "Restored an empty board"
      : `Restored ${restored.length} task${restored.length === 1 ? "" : "s"} from local storage`;
  } else {
    board.set("tasks", SEED_TASKS);
    yield "Seeded demo tasks from the fake server";
  }
});

// ── User mutations. Every one checkpoints for undo and enqueues an autosave. ──
function addTask(): void {
  const title = board.draft.trim();
  if (!title) return;
  checkpoint();
  const task: Task = {
    id: Date.now(), title, done: false,
    tag: draftTag.value, priority: draftPriority.value,
    createdAt: Date.now(), save: "idle",
  };
  board.set("tasks", [...(board.tasks as Task[]), task]);
  board.set("draft", "");
  logActivity(`Added "${title}"`);
  enqueueSave(task.id);
}

function toggleTask(id: number): void {
  const task = (board.tasks as Task[]).find((candidate) => candidate.id === id);
  if (!task) return;
  checkpoint();
  board.set("tasks", (board.tasks as Task[]).map((candidate) =>
    candidate.id === id
      ? { ...candidate, done: !candidate.done, completedAt: !candidate.done ? Date.now() : undefined }
      : candidate));
  logActivity(task.done ? `Reopened "${task.title}"` : `Completed "${task.title}"`);
  enqueueSave(id);
}

function removeTask(id: number): void {
  const task = (board.tasks as Task[]).find((candidate) => candidate.id === id);
  if (!task) return;
  checkpoint();
  board.set("tasks", (board.tasks as Task[]).filter((candidate) => candidate.id !== id));
  logActivity(`Removed "${task.title}"`);
}

function clearCompleted(): void {
  const done = (board.tasks as Task[]).filter((task) => task.done);
  if (done.length === 0) return;
  checkpoint();
  board.set("tasks", (board.tasks as Task[]).filter((task) => !task.done));
  logActivity(`Cleared ${done.length} completed task${done.length === 1 ? "" : "s"}`);
}

function syncAll(): void {
  const ids = (board.tasks as Task[]).map((task) => task.id);
  if (ids.length === 0) { logActivity("Nothing to sync"); return; }
  for (const id of ids) enqueueSave(id);
  logActivity(`Syncing ${ids.length} task${ids.length === 1 ? "" : "s"}…`);
}

function retrySave(id: number): void {
  logActivity("Retrying a failed save");
  enqueueSave(id);
}

function undo(): void {
  const stack = undoStack.value;
  if (stack.length === 0) return;
  board.set("tasks", stack[stack.length - 1]);
  undoStack.set(stack.slice(0, -1));
  logActivity("Undid the last change");
}

function toggleAutosave(): void {
  autosaveOn.set(!autosaveOn.value);
  if (autosaveOn.value && pendingSaves.length > 0) {
    saveQueue.set(pendingSaves.splice(0));
  }
  logActivity(autosaveOn.value ? "Autosave resumed" : "Autosave paused — saves will buffer");
}

// ── Activity: every entry is something that actually happened. ──
const actions = atom<ActivityEntry[]>([]);
let activityId = 0;

function logActivity(text: string): void {
  activityId += 1;
  actions.set([
    { id: activityId, text, at: new Date().toLocaleTimeString() },
    ...actions.value,
  ].slice(0, 8));
}

function clearActivity(): void {
  actions.set([]);
}

// Control changes are logged through subscriptions so the v-model bridges
// stay untouched; the guards keep the initial replay out of the log.
function logControl<T>(source: { value: T; subscribe(callback: (value: T) => void): unknown }, label: string): void {
  let last = source.value;
  board.cleanups.add(source.subscribe(() => {
    const next = source.value;
    if (Object.is(next, last)) return;
    last = next;
    logActivity(`${label}: ${String(next)}`);
  }));
}
logControl(filter, "Filter");
logControl(tag, "Tag");
logControl(sortBy, "Sort");
</script>

<template>
  <main class="board">
    <header class="board-header">
      <h1>📋 Vue task board</h1>
      <p>Compiled Vue SFCs driving a Streamix scope, derived stats, a debounced search pipe, and a serial autosave queue — open the in-app inspector to watch the flows live.</p>
      <p class="sync">{{ sync }}</p>
    </header>

    <div class="controls">
      <input class="search" type="search" v-model="search" placeholder="Search tasks…" />
      <label class="field">Filter
        <select v-model="filter">
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="done">Done</option>
        </select>
      </label>
      <label class="field">Tag
        <select v-model="tag">
          <option value="all">All tags</option>
          <option v-for="item in TAGS" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <label class="field">Sort
        <select v-model="sortBy">
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="priority">Priority</option>
        </select>
      </label>
    </div>

    <section class="stats">
      <span class="stat"><strong>{{ stats.done }}</strong> done</span>
      <span class="stat"><strong>{{ stats.remaining }}</strong> remaining</span>
      <span class="stat"><strong>{{ stats.avgMinutes }}</strong> min avg</span>
      <span class="stat" :class="{ warn: stats.saving > 0 }"><strong>{{ stats.saving }}</strong> syncing</span>
      <span class="stat" :class="{ bad: stats.failed > 0 }"><strong>{{ stats.failed }}</strong> failed</span>
    </section>
    <div class="progress">
      <div class="bar" :style="{ width: stats.pct + '%' }"></div>
    </div>

    <form class="add" @submit.prevent="addTask">
      <input v-model="board.draft" placeholder="What needs doing?" />
      <select v-model="draftTag" aria-label="Tag">
        <option v-for="item in TAGS" :key="item" :value="item">{{ item }}</option>
      </select>
      <select v-model="draftPriority" aria-label="Priority">
        <option v-for="item in PRIORITIES" :key="item" :value="item">{{ item }}</option>
      </select>
      <button type="submit">Add task</button>
    </form>

    <div class="toolbar">
      <button class="ghost" :disabled="undoCount === 0" @click="undo">↩ Undo ({{ undoCount }})</button>
      <button class="ghost" @click="syncAll">⇅ Sync all</button>
      <button class="ghost" @click="toggleAutosave">{{ autosaveOn ? "⏸ Pause autosave" : "▶ Resume autosave" }}</button>
      <button class="ghost" @click="clearCompleted">✕ Clear completed</button>
      <span class="saved">{{ savedAgo }}</span>
    </div>

    <div class="columns">
      <TaskList :tasks="visible" @toggle="toggleTask" @remove="removeTask" @retry="retrySave" />
      <ActivityFeed :entries="actions" @clear="clearActivity" />
    </div>
  </main>
</template>
