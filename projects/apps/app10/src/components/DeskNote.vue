<script setup lang="ts">
import { Feather, X } from '@lucide/vue';
import type { Story } from '../types/story';

defineProps<{
  daysAway: number;
  story: Story | null;
  monthLabel: string;
  hasCurrentIssue: boolean;
}>();

const emit = defineEmits<{
  dismiss: [];
  openCommissionDesk: [];
}>();
</script>

<template>
  <div class="bg-[#F3EFE6] border-b border-[#E5DFD3]">
    <div class="max-w-[1200px] mx-auto px-4 sm:px-8 py-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex items-start gap-2.5 min-w-0">
          <Feather class="w-4 h-4 text-[#1E3A8A] mt-0.5 shrink-0" aria-hidden="true" />
          <div class="min-w-0">
            <p class="text-[11px] font-medium uppercase tracking-wider text-[#1E3A8A]">
              Desk Note · {{ daysAway }} silent days
            </p>
            <p class="text-xs text-[#1C1917] mt-0.5">
              The press held your place. Nothing was lost.
            </p>
            <template v-if="story">
              <p class="text-xs text-[#57534E] mt-0.5">
                <span class="font-medium text-[#1C1917]">{{ story.title }}</span>
                is still on Day {{ story.currentDay }} of {{ story.maxDays }}.
              </p>
              <p
                v-if="story.sentences.length > 0"
                class="font-prose italic text-xs text-[#57534E] mt-1 line-clamp-2"
              >
                “{{ story.sentences[story.sentences.length - 1].text }}”
              </p>
            </template>
          </div>
        </div>

        <div class="flex items-center gap-3 shrink-0">
          <button
            v-if="!hasCurrentIssue"
            type="button"
            @click="emit('openCommissionDesk')"
            class="text-xs font-medium text-[#1E3A8A] hover:text-[#172D6B] cursor-pointer"
          >
            Commission {{ monthLabel }}
          </button>
          <button
            type="button"
            @click="emit('dismiss')"
            class="px-3 py-1.5 min-h-[32px] text-xs font-medium bg-white border border-[#D6CEBE] hover:border-[#1E3A8A] text-[#1C1917] rounded transition-colors cursor-pointer whitespace-nowrap"
          >
            Continue
          </button>
          <button
            type="button"
            @click="emit('dismiss')"
            aria-label="Dismiss desk note"
            class="p-1.5 text-[#78716C] hover:text-[#1C1917] cursor-pointer"
          >
            <X class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
