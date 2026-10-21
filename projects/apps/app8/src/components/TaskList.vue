<script setup lang="ts">
type Task = { id: number; title: string; done: boolean };
defineProps<{ tasks: Task[] }>();
defineEmits<{ toggle: [id: number] }>();
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
      </li>
    </ul>
    <p v-if="tasks.length === 0" class="empty">Nothing matches this filter.</p>
  </section>
</template>
