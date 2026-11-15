<script setup lang="ts">
import type { Priority, Task } from "../model";

defineProps<{ tasks: Task[] }>();
defineEmits<{ toggle: [id: number]; remove: [id: number]; retry: [id: number] }>();

function priorityMark(priority: Priority): string {
  return priority === "high" ? "▲" : priority === "medium" ? "◆" : "●";
}
</script>

<template>
  <section class="tasks">
    <h2>Tasks</h2>
    <ul>
      <li v-for="task in tasks" :key="task.id" :class="{ done: task.done }">
        <button class="check" :aria-label="`Toggle ${task.title}`" @click="$emit('toggle', task.id)">
          {{ task.done ? "✓" : "" }}
        </button>
        <span class="title">{{ task.title }}</span>
        <span class="tag" :class="task.tag">{{ task.tag }}</span>
        <span class="prio" :class="task.priority" :title="`${task.priority} priority`">
          {{ priorityMark(task.priority) }}
        </span>
        <span v-if="task.save === 'saving'" class="save saving">saving…</span>
        <span v-else-if="task.save === 'saved'" class="save saved" title="Synced">✓</span>
        <span v-else-if="task.save === 'error'" class="save error" title="Sync failed">✗</span>
        <button v-if="task.save === 'error'" class="retry" @click="$emit('retry', task.id)">Retry</button>
        <button class="remove" :aria-label="`Delete ${task.title}`" @click="$emit('remove', task.id)">✕</button>
      </li>
    </ul>
    <p v-if="tasks.length === 0" class="empty">Nothing matches this filter.</p>
  </section>
</template>
