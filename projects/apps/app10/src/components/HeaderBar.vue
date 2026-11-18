<script setup lang="ts">
import type { ViewTab } from '../types/story';

defineProps<{
  activeTab: ViewTab;
  hasSubmittedToday: boolean;
}>();

const emit = defineEmits<{
  selectTab: [tab: ViewTab];
  writeAction: [];
}>();

const NAV_ITEMS: Array<{ id: ViewTab; label: string }> = [
  { id: 'active', label: 'Active Stories' },
  { id: 'archive', label: 'Canon Archive' },
  { id: 'guide', label: 'How It Works' },
];
</script>

<template>
  <header class="sticky top-0 z-30 bg-[#FBF9F5]/95 backdrop-blur-sm border-b border-[#E5DFD3]">
    <div class="max-w-[1200px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-8">
      <!-- Zone 1: Brand Wordmark (single element, single line) -->
      <button
        type="button"
        @click="emit('selectTab', 'active')"
        class="font-display text-xl sm:text-2xl font-semibold tracking-tight text-[#1C1917] whitespace-nowrap shrink-0 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1E3A8A] cursor-pointer"
      >
        One Sentence Each
      </button>

      <!-- Zone 2: 4 concise single-line nav links -->
      <nav
        aria-label="Primary navigation"
        class="hidden md:flex items-center gap-7 text-sm font-medium text-[#57534E]"
      >
        <button
          v-for="item in NAV_ITEMS"
          :key="item.id"
          type="button"
          @click="emit('selectTab', item.id)"
          :class="
            activeTab === item.id
              ? 'text-[#1C1917] border-[#1E3A8A] font-semibold'
              : 'border-transparent hover:text-[#1C1917] hover:border-[#D6CEBE]'
          "
          class="py-1 whitespace-nowrap shrink-0 transition-colors duration-150 border-b cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1E3A8A]"
        >
          {{ item.label }}
        </button>
      </nav>

      <!-- Zone 3: 1 primary action -->
      <div class="shrink-0">
        <button
          type="button"
          @click="emit('writeAction')"
          class="px-4 py-2 min-h-[40px] text-xs sm:text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172D6B] transition-colors duration-150 rounded-md whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A8A]"
        >
          {{ hasSubmittedToday ? 'Review Drafts' : 'Write Sentence' }}
        </button>
      </div>
    </div>

    <!-- Compact mobile navigation row -->
    <nav
      aria-label="Mobile navigation"
      class="md:hidden border-t border-[#E5DFD3] px-4 flex items-center gap-5 overflow-x-auto text-xs font-medium text-[#57534E]"
    >
      <button
        v-for="item in NAV_ITEMS"
        :key="item.id"
        type="button"
        @click="emit('selectTab', item.id)"
        :class="
          activeTab === item.id
            ? 'text-[#1C1917] border-[#1E3A8A] font-semibold'
            : 'border-transparent hover:text-[#1C1917]'
        "
        class="py-2.5 whitespace-nowrap shrink-0 border-b-2 transition-colors"
      >
        {{ item.label }}
      </button>
    </nav>
  </header>
</template>
