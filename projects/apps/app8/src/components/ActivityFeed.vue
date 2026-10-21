<script setup lang="ts">
type Entry = { id: number; text: string; at: string };
defineProps<{ entries: Entry[] }>();
</script>

<template>
  <section class="feed">
    <h2>Activity</h2>
    <ul>
      <li v-for="entry in entries" :key="entry.id">
        <span class="at">{{ entry.at }}</span>
        <span class="text">{{ entry.text }}</span>
      </li>
    </ul>
    <p v-if="entries.length === 0" class="empty">Use the board — actions show up here.</p>
  </section>
</template>
