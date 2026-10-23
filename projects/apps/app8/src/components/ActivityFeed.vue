<script setup lang="ts">
import type { ActivityEntry } from "../model";

defineProps<{ entries: ActivityEntry[] }>();
defineEmits<{ clear: [] }>();
</script>

<template>
  <section class="feed">
    <h2>Activity <button class="clear" @click="$emit('clear')">Clear</button></h2>
    <ul>
      <li v-for="entry in entries" :key="entry.id">
        <span class="at">{{ entry.at }}</span>
        <span class="text">{{ entry.text }}</span>
      </li>
    </ul>
    <p v-if="entries.length === 0" class="empty">Use the board — actions show up here.</p>
  </section>
</template>
