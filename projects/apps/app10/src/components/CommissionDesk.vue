<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { BookOpen, CalendarDays, Loader2, Newspaper, Sparkles, X } from '@lucide/vue';
import { COMMISSION_GENRES } from '../data/genres';
import type { CommissionRecord, SlushPitch, Story, StoryPitch } from '../types/story';

const props = defineProps<{
  isOpen: boolean;
  monthLabel: string;
  record: CommissionRecord | null;
  currentIssue: Story | null;
  slush: SlushPitch[];
  isGenerating: boolean;
  error: string | null;
  genre: string;
}>();

const emit = defineEmits<{
  close: [];
  request: [];
  useFallback: [];
  updateGenre: [genre: string];
  startPitch: [pitch: StoryPitch, sourceMonthKey: string];
  revivePitch: [pitch: StoryPitch, sourceMonthKey: string];
  openIssue: [];
}>();

const availablePitches = computed(() => {
  if (!props.record) return [];
  return props.record.pitches.filter((pitch) => pitch.id !== props.record?.chosenPitchId);
});

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
    aria-labelledby="commission-desk-heading"
  >
    <div class="w-full max-w-5xl bg-[#FBF9F5] border border-[#D6CEBE] rounded-lg shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
      <div class="px-6 py-4 border-b border-[#E5DFD3] flex items-start justify-between gap-4 bg-[#F7F4EE]">
        <div class="flex items-start gap-3">
          <div class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1E3A8A]/10">
            <Newspaper class="w-4 h-4 text-[#1E3A8A]" aria-hidden="true" />
          </div>
          <div>
            <p class="text-[11px] tracking-wider uppercase text-[#78716C]">Monthly Commission</p>
            <h2 id="commission-desk-heading" class="font-display text-xl font-semibold text-[#1C1917]">
              The Commission Desk · {{ monthLabel }}
            </h2>
            <p class="text-xs text-[#57534E] mt-0.5">
              Three commissions await the editor. Choose a genre, request the month’s pitches, and
              begin one serial.
            </p>
          </div>
        </div>
        <button
          type="button"
          @click="emit('close')"
          aria-label="Close commission desk"
          class="p-2 text-[#57534E] hover:text-[#1C1917] cursor-pointer shrink-0"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <div class="p-6 overflow-y-auto space-y-6">
        <!-- Genre choice before the desk drafts anything -->
        <div
          v-if="!record && !currentIssue"
          class="bg-[#F7F4EE] border border-[#E5DFD3] rounded-md p-4"
        >
          <p class="text-[11px] font-medium uppercase tracking-wider text-[#78716C]">
            Genre for this month
          </p>
          <div class="mt-2 flex flex-wrap gap-2">
            <button
              v-for="option in COMMISSION_GENRES"
              :key="option"
              type="button"
              :disabled="isGenerating"
              @click="emit('updateGenre', option)"
              :class="
                genre === option
                  ? 'bg-[#1E3A8A] border-[#1E3A8A] text-white'
                  : 'bg-white border-[#D6CEBE] text-[#1C1917] hover:border-[#1E3A8A]'
              "
              class="px-3 py-1.5 min-h-[32px] text-xs font-medium rounded-md border transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {{ option }}
            </button>
          </div>
          <p class="text-xs text-[#78716C] mt-2">
            <template v-if="genre === 'Surprise me'">
              The desk will draft three distinct genres and let you choose the month’s direction.
            </template>
            <template v-else>
              All three pitches will be written as {{ genre }} stories, differing in premise and
              formal constraint.
            </template>
          </p>
        </div>

        <!-- Current issue already running -->
        <div
          v-if="currentIssue"
          class="bg-white border border-[#1E3A8A]/35 rounded-md p-6 flex flex-wrap items-start justify-between gap-4"
        >
          <div class="space-y-1.5">
            <p class="text-xs font-medium text-[#1E3A8A]">
              {{
                currentIssue.status === 'active'
                  ? 'This month’s issue is already running'
                  : 'This month’s issue is complete and archived'
              }}
            </p>
            <h3 class="font-display text-2xl font-semibold text-[#1C1917]">
              {{ currentIssue.title }}
            </h3>
            <p class="font-prose italic text-sm text-[#57534E]">{{ currentIssue.subtitle }}</p>
            <p class="text-xs text-[#57534E] tabular-nums">
              {{ currentIssue.genre }} · Day {{ currentIssue.currentDay }}/{{ currentIssue.maxDays }}
              <span v-if="currentIssue.constraint">
                · Constraint: {{ currentIssue.constraint }}
              </span>
            </p>
          </div>
          <button
            type="button"
            @click="emit('openIssue')"
            class="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172D6B] rounded-md transition-colors cursor-pointer"
          >
            <BookOpen class="w-3.5 h-3.5" aria-hidden="true" />
            {{ currentIssue.status === 'active' ? 'Return to the Manuscript' : 'Open the Archive' }}
          </button>
        </div>

        <!-- Pitches for this month -->
        <template v-else-if="record && availablePitches.length > 0">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 class="font-display text-lg font-semibold text-[#1C1917]">
                Commissions for {{ monthLabel }}
              </h3>
              <p class="text-xs text-[#57534E] mt-0.5">
                Pick one premise. The others are filed in the slush pile for a future month.
              </p>
            </div>
            <span class="text-xs text-[#78716C]">
              {{ record.source === 'demo' ? 'Demo commissions' : 'Drafted by Gemini' }}
              <template v-if="record.requestedGenre && record.requestedGenre !== 'Surprise me'">
                · {{ record.requestedGenre }}
              </template>
            </span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
            <article
              v-for="pitch in availablePitches"
              :key="pitch.id"
              class="bg-white border border-[#E5DFD3] rounded-md p-5 flex flex-col"
            >
              <div class="flex items-center justify-between gap-2 text-xs text-[#78716C] tabular-nums">
                <span>{{ pitch.genre }}</span>
                <span class="inline-flex items-center gap-1">
                  <CalendarDays class="w-3 h-3" aria-hidden="true" />
                  {{ pitch.maxDays }} days
                </span>
              </div>

              <h4 class="font-display text-xl font-semibold text-[#1C1917] mt-2">
                {{ pitch.title }}
              </h4>
              <p class="font-prose italic text-sm text-[#57534E] mt-1.5">
                {{ pitch.subtitle }}
              </p>

              <div class="mt-4 pt-3 border-t border-[#E5DFD3]">
                <p class="text-[11px] uppercase tracking-wider text-[#78716C]">Constraint</p>
                <p class="text-xs text-[#1C1917] mt-1 leading-relaxed">{{ pitch.constraint }}</p>
              </div>

              <div class="mt-4">
                <p class="text-[11px] uppercase tracking-wider text-[#78716C]">Opening Sentence</p>
                <p class="font-prose text-sm text-[#1C1917] leading-relaxed mt-1">
                  “{{ pitch.openingSentence }}”
                </p>
              </div>

              <div class="mt-4">
                <p class="text-[11px] uppercase tracking-wider text-[#78716C]">Commissioned Voices</p>
                <p class="text-xs text-[#57534E] mt-1">{{ pitch.contributors.join(' · ') }}</p>
              </div>

              <div class="mt-auto pt-5">
                <button
                  type="button"
                  @click="emit('startPitch', pitch, record.monthKey)"
                  class="w-full min-h-[40px] px-4 py-2 text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172D6B] rounded-md transition-colors cursor-pointer"
                >
                  Begin This Issue
                </button>
              </div>
            </article>
          </div>
        </template>

        <!-- No pitches yet -->
        <div v-else class="bg-white border border-[#E5DFD3] rounded-md p-8 text-center">
          <template v-if="isGenerating">
            <Loader2 class="w-7 h-7 text-[#1E3A8A] mx-auto animate-spin" aria-hidden="true" />
            <h3 class="font-display text-xl font-semibold text-[#1C1917] mt-3">
              Reading the slush pile…
            </h3>
            <p class="font-prose text-sm text-[#57534E] mt-1.5 max-w-md mx-auto">
              Three commissions are being drafted for {{ monthLabel }}. This usually takes a few
              seconds.
            </p>
          </template>

          <template v-else-if="error">
            <h3 class="font-display text-xl font-semibold text-[#1C1917]">
              The commission desk is jammed
            </h3>
            <p class="text-sm text-[#9A3412] mt-2 max-w-xl mx-auto leading-relaxed">{{ error }}</p>
            <div class="mt-5 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                @click="emit('request')"
                class="px-4 py-2 min-h-[40px] text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172D6B] rounded-md transition-colors cursor-pointer"
              >
                Try Again
              </button>
              <button
                type="button"
                @click="emit('useFallback')"
                class="px-4 py-2 min-h-[40px] text-xs font-medium bg-[#F7F4EE] hover:bg-[#EBE6DF] border border-[#D6CEBE] text-[#1C1917] rounded-md transition-colors cursor-pointer"
              >
                Use Demo Commissions
              </button>
            </div>
          </template>

          <template v-else>
            <Sparkles class="w-7 h-7 text-[#1E3A8A] mx-auto" aria-hidden="true" />
            <h3 class="font-display text-xl font-semibold text-[#1C1917] mt-3">
              A new month, a new serial
            </h3>
            <p class="font-prose text-sm text-[#57534E] mt-1.5 max-w-lg mx-auto leading-relaxed">
              The desk will commission three distinct premises for {{ monthLabel }}, complete with a
              formal constraint, an opening sentence, and a cast of contributor voices.
            </p>
            <button
              type="button"
              @click="emit('request')"
              class="mt-5 inline-flex items-center gap-2 px-5 py-2.5 min-h-[42px] text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172D6B] rounded-md transition-colors cursor-pointer"
            >
              <Sparkles class="w-3.5 h-3.5" aria-hidden="true" />
              Request This Month’s Commissions
            </button>
          </template>
        </div>

        <!-- Slush pile -->
        <div v-if="slush.length > 0" class="pt-2">
          <div class="flex flex-wrap items-end justify-between gap-2 pb-3 border-b border-[#E5DFD3]">
            <div>
              <h3 class="font-display text-lg font-semibold text-[#1C1917]">The Slush Pile</h3>
              <p class="text-xs text-[#57534E] mt-0.5">
                Unpressed commissions from previous months. Revive one when no issue is running.
              </p>
            </div>
            <span class="text-xs text-[#78716C] tabular-nums">{{ slush.length }} filed</span>
          </div>

          <ul class="mt-3 divide-y divide-[#F1EDE4] bg-white border border-[#E5DFD3] rounded-md">
            <li
              v-for="entry in slush"
              :key="`${entry.sourceMonthKey}-${entry.pitch.id}`"
              class="px-5 py-4 flex flex-wrap items-center justify-between gap-4"
            >
              <div class="min-w-0">
                <div class="text-[11px] uppercase tracking-wider text-[#78716C]">
                  {{ entry.sourceMonthLabel }} · {{ entry.pitch.genre }}
                </div>
                <div class="font-display text-base font-semibold text-[#1C1917] mt-0.5">
                  {{ entry.pitch.title }}
                </div>
                <p class="text-xs text-[#57534E] mt-1 max-w-xl leading-relaxed">
                  {{ entry.pitch.constraint }}
                </p>
              </div>
              <button
                v-if="!currentIssue"
                type="button"
                @click="emit('revivePitch', entry.pitch, entry.sourceMonthKey)"
                class="px-3 py-1.5 min-h-[34px] text-xs font-medium bg-[#F7F4EE] hover:bg-[#1E3A8A] text-[#1C1917] hover:text-white border border-[#D6CEBE] hover:border-[#1E3A8A] rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Revive for {{ monthLabel }}
              </button>
            </li>
          </ul>
        </div>
      </div>

      <div class="px-6 py-3 border-t border-[#E5DFD3] bg-[#F7F4EE] flex items-center justify-between gap-3 text-[11px] text-[#78716C]">
        <span>One issue per month. Unpressed pitches are kept in the slush pile.</span>
        <button
          type="button"
          @click="emit('close')"
          class="text-xs font-medium text-[#57534E] hover:text-[#1C1917] cursor-pointer shrink-0"
        >
          Not now
        </button>
      </div>
    </div>
  </div>
</template>
