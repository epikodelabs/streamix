<script setup lang="ts">
import { atom, derived, flow, scope } from "@epikodelabs/streamix";
import TaskList from "./components/TaskList.vue";
import ActivityFeed from "./components/ActivityFeed.vue";

type Task = { id: number; title: string; done: boolean };

// The filter is a standalone writable atom; the select below v-models it
// through the generated useWritable bridge.
const filter = atom<"all" | "active" | "done">("all");

// The board is a scope: template reads of its members are bridged refs,
// writes lower to scope.set(...), and the scope itself is disposed with
// the component.
const board = scope({
  draft: "",
  tasks: [
    { id: 1, title: "Mirror SFCs into the virtual project", done: true },
    { id: 2, title: "Bridge scope members for the template", done: true },
    { id: 3, title: "Stream the activity feed from a flow", done: false },
  ],
});

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

function addTask(): void {
  const title = board.draft.trim();
  if (!title) return;
  board.set("tasks", [...(board.tasks as Task[]), { id: Date.now(), title, done: false }]);
  board.set("draft", "");
}

function toggleTask(id: number): void {
  board.set("tasks", (board.tasks as Task[]).map((task) =>
    task.id === id ? { ...task, done: !task.done } : task));
}

const ACTIVITY = ["Task added", "Task completed", "Filter changed", "Board synced"];

// A flow drives the live feed; the generated useIterable bridge keeps the
// template subscribed while the component lives and unsubscribes on unmount.
const feed = flow(async function* (signal) {
  const entries: { id: number; text: string; at: string }[] = [];
  let id = 0;
  while (!signal.aborted) {
    id += 1;
    entries.unshift({ id, text: ACTIVITY[entries.length % ACTIVITY.length], at: new Date().toLocaleTimeString() });
    yield entries.slice(0, 6);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2500);
      signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }
});
</script>

<template>
  <main class="board">
    <header class="board-header">
      <h1>📋 Vue task board</h1>
      <p>Streamix scope, derived stats, and a live flow — all through Vue template syntax.</p>
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
      <ActivityFeed :entries="feed" />
    </div>
  </main>
</template>
