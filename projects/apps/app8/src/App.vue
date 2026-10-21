<script setup lang="ts">
import { atom, derived, flow, scope } from "@epikodelabs/streamix";
import TaskList from "./components/TaskList.vue";
import ActivityFeed from "./components/ActivityFeed.vue";

type Task = { id: number; title: string; done: boolean };
type ActivityEntry = { id: number; text: string; at: string };

// The filter is a standalone writable atom; the select below v-models it
// through the generated useWritable bridge.
const filter = atom<"all" | "active" | "done">("all");

// The board is a scope: template reads of its members are bridged refs,
// writes lower to scope.set(...), and the scope itself is disposed with
// the component. Tasks start empty — the sync flow loads them below.
const board = scope({
  draft: "",
  tasks: [] as Task[],
});

const SEED_TASKS: Task[] = [
  { id: 1, title: "Mirror SFCs into the virtual project", done: true },
  { id: 2, title: "Bridge scope members for the template", done: true },
  { id: 3, title: "Log real actions in the activity feed", done: true },
];

// Deriveds track raw sources through the $ shorthand. scope.get() returns a
// trackable member source, so the visible list and the stats stay reactive
// without copying state into Vue.
const visible = derived(($) => {
  const tasks = $(board.get("tasks")) as Task[];
  const kind = $(filter);
  return kind === "all" ? tasks : tasks.filter((task) => task.done === (kind === "done"));
});

const stats = derived(($) => {
  const tasks = $(board.get("tasks")) as Task[];
  const done = tasks.filter((task) => task.done).length;
  return { done, remaining: tasks.length - done };
});

// The server round-trip, as a flow: the template reads the status through the
// useIterable bridge while the flow itself writes the loaded tasks into the
// scope. It ends after the final yield and the bridge unsubscribes.
const sync = flow(async function* (signal) {
  yield "Loading tasks…";
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1200);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  if (signal.aborted) return;
  board.set("tasks", SEED_TASKS);
  yield "Tasks synced";
});

function addTask(): void {
  const title = board.draft.trim();
  if (!title) return;
  board.set("tasks", [...(board.tasks as Task[]), { id: Date.now(), title, done: false }]);
  board.set("draft", "");
  logActivity(`Added "${title}"`);
}

function toggleTask(id: number): void {
  const task = (board.tasks as Task[]).find((candidate) => candidate.id === id);
  if (!task) return;
  board.set("tasks", (board.tasks as Task[]).map((candidate) =>
    candidate.id === id ? { ...candidate, done: !candidate.done } : candidate));
  logActivity(task.done ? `Reopened "${task.title}"` : `Completed "${task.title}"`);
}

// ── Activity: every entry is something that actually happened ──
const actions = atom<ActivityEntry[]>([]);
let activityId = 0;

function logActivity(text: string): void {
  activityId += 1;
  actions.set([
    { id: activityId, text, at: new Date().toLocaleTimeString() },
    ...actions.value,
  ].slice(0, 8));
}

// Filter changes are logged through a subscription so the v-model bridge
// stays untouched; the guard keeps the initial emission out of the log.
let lastFilter: "all" | "active" | "done" = filter.value;
board.cleanups.add(filter.subscribe(() => {
  const kind = filter.value;
  if (kind !== lastFilter) {
    lastFilter = kind;
    logActivity(`Filter: ${kind}`);
  }
}));
</script>

<template>
  <main class="board">
    <header class="board-header">
      <h1>📋 Vue task board</h1>
      <p>Streamix scope, derived stats, and a server-sync flow — the activity log records real actions.</p>
      <p class="sync">{{ sync }}</p>
      <label class="filter">
        Filter
        <select v-model="filter">
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="done">Done</option>
        </select>
      </label>
    </header>

    <section class="stats">
      <span class="stat"><strong>{{ stats.done }}</strong> done</span>
      <span class="stat"><strong>{{ stats.remaining }}</strong> remaining</span>
      <span class="stat"><strong>{{ visible.length }}</strong> shown</span>
    </section>

    <form class="add" @submit.prevent="addTask">
      <input v-model="board.draft" placeholder="What needs doing?" />
      <button type="submit">Add task</button>
    </form>

    <div class="columns">
      <TaskList :tasks="visible" @toggle="toggleTask" />
      <ActivityFeed :entries="actions" />
    </div>
  </main>
</template>
