<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { BookOpen, Hourglass, Library, X } from '@lucide/vue';
import type { Story } from '../types/story';

const props = defineProps<{
  isOpen: boolean;
  daysAway: number;
  monthLabel: string;
  monthChanged: boolean;
  story: Story | null;
  hasCurrentIssue: boolean;
}>();

const emit = defineEmits<{
  close: [];
  openCommissionDesk: [];
  openArchive: [];
}>();

const recentSentences = computed(() =>
  props.story ? props.story.sentences.slice(-3) : []
);

const onKeyDown = (event: KeyboardEvent) => {
  if (props.isOpen && event.key === 'Escape') emit('close');
};

onMounted(() => window.addEventListener('keydown', onKeyDown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown));
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1C1917]/45 backdrop-blur-[2px]"
    role="dialog"
    aria-modal="true"
    aria-labelledby="interregnum-heading"
  >
    <div class="w-full max-w-2xl bg-[#FBF9F5] border border-[#D6CEBE] rounded-lg shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
      <div class="px-6 py-4 border-b border-[#E5DFD3] bg-[#F7F4EE] flex items-start justify-between gap-4">
        <div class="flex items-start gap-3">
          <div class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1E3A8A]/10">
            <Hourglass class="w-4 h-4 text-[#1E3A8A]" aria-hidden="true" />
          </div>
          <div>
            <p class="text-[11px] tracking-wider uppercase text-[#78716C]">
              The Interregnum · {{ daysAway }} days
            </p>
            <h2 id="interregnum-heading" class="font-display text-2xl font-semibold text-[#1C1917]">
              Nothing was lost.
            </h2>
          </div>
        </div>
        <button
          type="button"
          @click="emit('close')"
          aria-label="Close interregnum"
          class="p-2 text-[#57534E] hover:text-[#1C1917] cursor-pointer shrink-0"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <div class="p-6 overflow-y-auto space-y-5">
        <p class="font-prose text-[15px] text-[#57534E] leading-relaxed">
          The press stood silent for {{ daysAway }} days. No sentences were pressed, no pages were
          cut, and no allowance was spent — your manuscript waited exactly where you left it.
        </p>

        <div v-if="story" class="bg-white border border-[#E5DFD3] rounded-md p-5">
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-[#78716C]">
            <span class="inline-flex items-center gap-1.5">
              <BookOpen class="w-3.5 h-3.5" aria-hidden="true" />
              What waited for you
            </span>
            <span class="tabular-nums">
              Day {{ story.currentDay }}/{{ story.maxDays }} · {{ story.sentences.length }}
              canonized · {{ story.candidates.length }} drafted
            </span>
          </div>

          <h3 class="font-display text-xl font-semibold text-[#1C1917] mt-2">
            {{ story.title }}
          </h3>
          <p class="font-prose italic text-sm text-[#57534E] mt-1">
            {{ story.subtitle }}
          </p>
          <p v-if="story.constraint" class="text-xs text-[#57534E] mt-2 leading-relaxed">
            <span class="font-semibold text-[#1C1917]">Monthly Constraint:</span>
            {{ story.constraint }}
          </p>

          <div v-if="recentSentences.length > 0" class="mt-4 pt-4 border-t border-[#E5DFD3]">
            <p class="text-[11px] uppercase tracking-wider text-[#78716C]">
              Last {{ recentSentences.length === 1 ? 'sentence' : `${recentSentences.length} sentences` }}
            </p>
            <div class="mt-2 space-y-2">
              <p
                v-for="sentence in recentSentences"
                :key="sentence.id"
                class="font-prose text-sm text-[#1C1917] leading-relaxed"
              >
                “{{ sentence.text }}”
              </p>
            </div>
          </div>
        </div>

        <div
          v-else
          class="bg-white border border-[#E5DFD3] rounded-md p-5 text-center font-prose text-sm text-[#57534E]"
        >
          The shelf is waiting. No manuscript is currently open.
        </div>

        <div
          v-if="monthChanged"
          class="px-5 py-4 bg-[#F3EFE6] border border-[#D6CEBE] rounded-md"
        >
          <p class="text-xs font-medium text-[#1E3A8A]">A new month turned while you were away.</p>
          <p class="text-xs text-[#57534E] mt-1 leading-relaxed">
            <template v-if="hasCurrentIssue">
              This month’s issue is already running; the desk will be ready when you are.
            </template>
            <template v-else>
              The {{ monthLabel }} Commission Desk can draft three fresh premises whenever you want
              to begin again. The previous volume stays in the archive untouched.
            </template>
          </p>
        </div>

        <p class="text-xs text-[#78716C] italic">
          This was a pause, not a penalty. Nothing expires here.
        </p>
      </div>

      <div class="px-6 py-4 border-t border-[#E5DFD3] bg-[#F7F4EE] flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          @click="emit('openArchive')"
          class="inline-flex items-center gap-2 px-4 py-2 min-h-[38px] text-xs font-medium bg-white border border-[#D6CEBE] hover:border-[#1E3A8A] text-[#1C1917] rounded-md transition-colors cursor-pointer"
        >
          <Library class="w-3.5 h-3.5 text-[#1E3A8A]" aria-hidden="true" />
          Visit the Archive
        </button>

        <div class="flex flex-wrap items-center gap-3">
          <button
            v-if="monthChanged && !hasCurrentIssue"
            type="button"
            @click="emit('openCommissionDesk')"
            class="px-4 py-2 min-h-[38px] text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172D6B] rounded-md transition-colors cursor-pointer"
          >
            Open the {{ monthLabel }} Commission Desk
          </button>
          <button
            type="button"
            @click="emit('close')"
            :class="
              monthChanged && !hasCurrentIssue
                ? 'bg-white border border-[#D6CEBE] hover:border-[#1E3A8A] text-[#1C1917]'
                : 'bg-[#1E3A8A] hover:bg-[#172D6B] text-white'
            "
            class="px-4 py-2 min-h-[38px] text-xs font-medium rounded-md transition-colors cursor-pointer"
          >
            Return to the Manuscript
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
