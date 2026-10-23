// Shared demo model for the app8 task board. Plain data and storage helpers —
// every Streamix node lives in App.vue.

export type Tag = "work" | "home" | "idea";
export type Priority = "high" | "medium" | "low";
export type SaveState = "idle" | "saving" | "saved" | "error";

export interface Task {
  id: number;
  title: string;
  done: boolean;
  tag: Tag;
  priority: Priority;
  createdAt: number;
  completedAt?: number;
  /** Per-task save state, written by the serial autosave pipeline. */
  save: SaveState;
}

export interface ActivityEntry {
  id: number;
  text: string;
  at: string;
}

export const TAGS: Tag[] = ["work", "home", "idea"];
export const PRIORITIES: Priority[] = ["high", "medium", "low"];

/** Lower ranks sort first. */
export const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

const STORAGE_KEY = "streamix.app8.tasks.v1";
const MINUTE = 60_000;
const now = Date.now();

export const SEED_TASKS: Task[] = [
  { id: 1, title: "Mirror SFCs into the virtual project", done: true, tag: "work", priority: "high", createdAt: now - 5 * MINUTE, completedAt: now - 4 * MINUTE, save: "saved" },
  { id: 2, title: "Bridge scope members for the template", done: true, tag: "work", priority: "high", createdAt: now - 4 * MINUTE, completedAt: now - 2 * MINUTE, save: "saved" },
  { id: 3, title: "Water the monstera", done: false, tag: "home", priority: "medium", createdAt: now - 3 * MINUTE, save: "saved" },
  { id: 4, title: "Sketch the serial autosave queue", done: false, tag: "idea", priority: "medium", createdAt: now - 2 * MINUTE, save: "saved" },
  { id: 5, title: "Watch a live pipeline in the inspector", done: false, tag: "idea", priority: "low", createdAt: now - MINUTE, save: "saved" },
];

export function loadPersistedTasks(): Task[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Task[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function persistTasks(tasks: Task[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch {
    // Storage may be unavailable (private mode); the demo keeps going.
  }
}
