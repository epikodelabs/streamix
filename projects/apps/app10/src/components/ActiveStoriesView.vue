<script setup lang="ts">
import { computed, ref } from 'vue';
import { useIterable } from '@epikodelabs/streamix/vue';
import {
  BookOpen,
  CalendarClock,
  Check,
  Clock,
  Feather,
  Loader2,
  PenLine,
  X,
} from '@lucide/vue';
import type { CanonSentence, DailyState, Story } from '../types/story';
import { validateSingleSentence } from '../utils/sentenceValidation';

const props = defineProps<{
  stories: Story[];
  selectedStoryId: string;
  dailyState: DailyState;
  isGeneratingCandidates: boolean;
  generationError: string | null;
}>();

const emit = defineEmits<{
  selectStory: [id: string];
  selectAndCanonize: [storyId: string, candidateId: string];
  submitCandidate: [storyId: string, text: string, paragraphBreakBefore: boolean];
  generateAiCandidates: [storyId: string];
  unlockNextDayForStory: [storyId: string, withAiDraft: boolean];
  dismissGenerationError: [];
  advanceDay: [];
  dismissLastCanonized: [];
}>();

function getCountdownToMidnight(): string {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const diffSec = Math.max(0, Math.floor((midnight.getTime() - now.getTime()) / 1000));
  const h = String(Math.floor(diffSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((diffSec % 3600) / 60)).padStart(2, '0');
  const s = String(diffSec % 60).padStart(2, '0');
  return `${h}h ${m}m ${s}s`;
}

function groupIntoParagraphs(sentences: CanonSentence[]): CanonSentence[][] {
  const paragraphs: CanonSentence[][] = [];
  let current: CanonSentence[] = [];
  for (const s of sentences) {
    if (s.paragraphBreakBefore && current.length > 0) {
      paragraphs.push(current);
      current = [s];
    } else {
      current.push(s);
    }
  }
  if (current.length > 0) {
    paragraphs.push(current);
  }
  return paragraphs;
}

async function* countdownTicks(): AsyncIterable<string> {
  while (true) {
    yield getCountdownToMidnight();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// Streamix owns the ticking async flow; Vue only reads the latest emission.
const countdown = useIterable(countdownTicks(), getCountdownToMidnight());

const readingMode = ref<'annotated' | 'book'>('annotated');
const selectedSentenceId = ref<string | null>(null);
const draftSentence = ref('');
const paragraphBreak = ref(false);
const imgErrorMap = ref<Record<string, boolean>>({});
const composerEl = ref<HTMLTextAreaElement | null>(null);

const activeStories = computed(() => props.stories.filter((s) => s.status === 'active'));

const story = computed<Story>(() => {
  return (
    activeStories.value.find((s) => s.id === props.selectedStoryId) ||
    activeStories.value[0] ||
    props.stories[0]
  );
});

const inspectedSentence = computed<CanonSentence | null>(() => {
  if (!story.value || story.value.sentences.length === 0) return null;
  if (selectedSentenceId.value) {
    const found = story.value.sentences.find((s) => s.id === selectedSentenceId.value);
    if (found) return found;
  }
  return story.value.sentences[story.value.sentences.length - 1];
});

const paragraphs = computed(() => groupIntoParagraphs(story.value.sentences));

const orderedCandidates = computed(() => {
  const copy = [...story.value.candidates];
  copy.sort((a, b) => {
    if (a.isUserSubmission && !b.isUserSubmission) return -1;
    if (!a.isUserSubmission && b.isUserSubmission) return 1;
    return 0;
  });
  return copy;
});

const totalWords = computed(() =>
  story.value.sentences.reduce(
    (sum, s) => sum + s.text.trim().split(/\s+/).filter(Boolean).length,
    0
  )
);

const validation = computed(() => validateSingleSentence(draftSentence.value));

const composerPlaceholder = computed(
  () => `Continue "${story.value.title}" with one evocative sentence...`
);

const hasSubmittedToday = computed(() => props.dailyState.submittedStoryId !== null);

const isWaitingForNextDay = computed(() =>
  Boolean(
    story.value && (props.dailyState.waitingStoryIds || []).includes(story.value.id)
  )
);

const handleCandidateSubmit = () => {
  if (hasSubmittedToday.value || !validation.value.valid) return;
  emit('submitCandidate', story.value.id, draftSentence.value.trim(), paragraphBreak.value);
  draftSentence.value = '';
  paragraphBreak.value = false;
};

const handleSelectStory = (id: string) => {
  emit('selectStory', id);
  selectedSentenceId.value = null;
};

const handleCoverError = (storyId: string) => {
  imgErrorMap.value = { ...imgErrorMap.value, [storyId]: true };
};

defineExpose({
  focusComposer: () => composerEl.value?.focus(),
});
</script>

<template>
  <section
    v-if="activeStories.length === 0"
    class="max-w-[1200px] mx-auto px-4 sm:px-8 py-16 text-center"
  >
    <h1 class="font-display text-3xl font-semibold text-[#1C1917]">
      All Current Chronicles Are Complete
    </h1>
    <p class="font-prose text-[#57534E] mt-3 max-w-lg mx-auto">
      Every serialized story in this volume has reached its final day and moved to the Canon
      Archive. Start a new collaborative chronicle from the toolbar above.
    </p>
  </section>

  <div v-else class="max-w-[1200px] mx-auto px-4 sm:px-8 py-8 sm:py-10">
    <!-- Canonization Announcement Banner when user advances a day -->
    <div
      v-if="dailyState.lastCanonizedEvent"
      role="status"
      class="mb-8 px-5 py-4 bg-white border border-[#1E3A8A]/35 rounded-md flex items-start justify-between gap-4"
    >
      <div class="space-y-1">
        <p class="text-xs font-medium text-[#1E3A8A]">
          Midnight Canonization Complete · {{ dailyState.lastCanonizedEvent.storyTitle }} · Day
          {{ dailyState.lastCanonizedEvent.day }}
        </p>
        <p class="font-prose text-sm sm:text-base text-[#1C1917] italic">
          “{{ dailyState.lastCanonizedEvent.sentenceText }}”
        </p>
        <p class="text-xs text-[#57534E] tabular-nums">
          Entered permanent canon by {{ dailyState.lastCanonizedEvent.author }}. Tomorrow’s
          1-sentence allowance is now open.
        </p>
      </div>
      <button
        type="button"
        @click="emit('dismissLastCanonized')"
        aria-label="Dismiss canonization notice"
        class="p-1.5 text-[#78716C] hover:text-[#1C1917] cursor-pointer shrink-0"
      >
        <X class="w-4 h-4" />
      </button>
    </div>

    <!-- Editorial Story Switcher Strip -->
    <div class="mb-8 pb-4 border-b border-[#E5DFD3]">
      <div class="flex items-center justify-between gap-4 mb-3">
        <h2 class="text-xs font-medium tracking-wider uppercase text-[#78716C]">
          Active Serialized Editions
        </h2>
        <span class="text-xs text-[#78716C] tabular-nums">
          {{ activeStories.length }} open
          {{ activeStories.length === 1 ? 'story' : 'stories' }} accepting sentences
        </span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          v-for="(item, idx) in activeStories"
          :key="item.id"
          type="button"
          @click="handleSelectStory(item.id)"
          :class="
            item.id === story.id
              ? 'bg-white border-[#1E3A8A] shadow-xs'
              : 'bg-[#F7F4EE] border-[#E5DFD3] hover:bg-white hover:border-[#C7BFB0]'
          "
          class="text-left px-4 py-3.5 rounded-md border transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#1E3A8A]"
        >
          <div class="flex items-center justify-between gap-2 text-xs text-[#78716C] tabular-nums">
            <span>0{{ idx + 1 }}. {{ item.genre }}</span>
            <span>Day {{ item.currentDay }}/{{ item.maxDays }}</span>
          </div>
          <div class="font-display text-base font-semibold text-[#1C1917] mt-1 truncate">
            {{ item.title }}
          </div>
          <div class="text-xs text-[#57534E] mt-1 tabular-nums">
            {{ item.sentences.length }} canonized · {{ item.candidates.length }} candidates today
          </div>
        </button>
      </div>
    </div>

    <!-- Lead Story Asymmetric Split Hero -->
    <section aria-labelledby="story-title-heading" class="mb-12">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        <div class="lg:col-span-7 flex flex-col justify-between py-1">
          <div>
            <p class="text-xs tracking-wider uppercase text-[#57534E]">
              {{ story.issueNumber }} · {{ story.genre }}
            </p>
            <h1
              id="story-title-heading"
              class="font-display text-3xl sm:text-4xl lg:text-[2.75rem] font-semibold leading-[1.15] tracking-tight text-[#1C1917] mt-3"
            >
              {{ story.title }}
            </h1>
            <p class="font-prose italic text-lg sm:text-xl text-[#44403C] leading-relaxed mt-3 max-w-2xl">
              {{ story.subtitle }}
            </p>

            <div class="mt-6 pt-5 border-t border-[#E5DFD3] space-y-3">
              <p class="text-xs text-[#57534E] leading-relaxed max-w-xl">
                <span class="font-semibold text-[#1C1917]">Editorial Note:</span>
                {{ story.promptNote }}
              </p>
              <p v-if="story.constraint" class="text-xs text-[#57534E] leading-relaxed max-w-xl">
                <span class="font-semibold text-[#1C1917]">Monthly Constraint:</span>
                {{ story.constraint }}
              </p>
              <p
                v-if="story.contributors && story.contributors.length > 0"
                class="text-xs text-[#57534E] leading-relaxed max-w-xl"
              >
                <span class="font-semibold text-[#1C1917]">Commissioned Voices:</span>
                {{ story.contributors.join(' · ') }}
              </p>
            </div>
          </div>

          <div class="mt-6 pt-5 border-t border-[#E5DFD3]">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#57534E] tabular-nums">
              <span class="font-semibold text-[#1C1917]">
                Day {{ story.currentDay }} of {{ story.maxDays }}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {{ story.sentences.length }}
                {{ story.sentences.length === 1 ? 'sentence' : 'sentences' }} canonized
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {{ story.candidates.length }}
                {{ story.candidates.length === 1 ? 'draft' : 'drafts' }} to choose from
              </span>
            </div>

            <!-- Clean hair-thin progress track -->
            <div class="mt-3 w-full h-1.5 bg-[#E5DFD3] rounded-full overflow-hidden">
              <div
                class="h-full bg-[#1E3A8A] transition-all duration-300"
                :style="{
                  width: `${Math.min(100, Math.round((story.currentDay / story.maxDays) * 100))}%`,
                }"
              ></div>
            </div>
          </div>
        </div>

        <div class="lg:col-span-5 flex flex-col">
          <figure class="flex-1 flex flex-col bg-white border border-[#E5DFD3] rounded-md p-3">
            <div class="relative w-full aspect-[4/3] lg:aspect-auto lg:flex-1 overflow-hidden rounded-sm bg-[#EBE6DF]">
              <img
                v-if="!imgErrorMap[story.id]"
                :src="story.coverImage"
                :alt="`${story.title} editorial bookplate`"
                referrerpolicy="no-referrer"
                @error="handleCoverError(story.id)"
                class="w-full h-full object-cover"
              />
              <div
                v-else
                class="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-[#EBE6DF] to-[#DFD7C8]"
              >
                <BookOpen class="w-8 h-8 text-[#57534E] mb-2" aria-hidden="true" />
                <span class="font-display text-lg text-[#1C1917]">{{ story.title }}</span>
              </div>
            </div>
            <figcaption class="mt-2.5 text-xs font-prose italic text-[#57534E]">
              {{ story.coverCaption }}
            </figcaption>
          </figure>
        </div>
      </div>
    </section>

    <!-- Main Manuscript + Margin Colophon Rail -->
    <section class="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start pb-14 border-b border-[#E5DFD3]">
      <!-- Left/Center: Canonized Prose -->
      <div class="lg:col-span-8">
        <div class="flex flex-wrap items-center justify-between gap-4 pb-4 mb-6 border-b border-[#E5DFD3]">
          <div>
            <h2 class="font-display text-xl sm:text-2xl font-semibold text-[#1C1917]">
              The Canonized Manuscript
            </h2>
            <p class="text-xs text-[#78716C] mt-0.5">
              {{
                readingMode === 'annotated'
                  ? 'Select any sentence to inspect its day of canonization and voice.'
                  : 'Uninterrupted monograph typography.'
              }}
            </p>
          </div>

          <div
            role="group"
            aria-label="Reading mode"
            class="flex items-center gap-1 p-1 bg-[#F3EFE6] border border-[#E5DFD3] rounded-md"
          >
            <button
              type="button"
              @click="readingMode = 'annotated'"
              :class="
                readingMode === 'annotated'
                  ? 'bg-white text-[#1C1917] shadow-xs'
                  : 'text-[#57534E] hover:text-[#1C1917]'
              "
              class="px-3 py-1 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Annotated
            </button>
            <button
              type="button"
              @click="readingMode = 'book'"
              :class="
                readingMode === 'book'
                  ? 'bg-white text-[#1C1917] shadow-xs'
                  : 'text-[#57534E] hover:text-[#1C1917]'
              "
              class="px-3 py-1 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Book View
            </button>
          </div>
        </div>

        <article class="max-w-2xl font-prose text-[17px] sm:text-[18px] leading-[1.85] text-[#1C1917] space-y-6">
          <p
            v-for="(para, pIdx) in paragraphs"
            :key="para[0]?.id || pIdx"
            :class="
              pIdx === 0
                ? 'first-letter:font-display first-letter:text-5xl first-letter:font-semibold first-letter:float-left first-letter:mr-3 first-letter:mt-1 first-letter:leading-[0.85] first-letter:text-[#1C1917]'
                : ''
            "
          >
            <template v-for="(sentence, sIdx) in para" :key="sentence.id">
              <button
                v-if="readingMode === 'annotated'"
                type="button"
                @click="selectedSentenceId = sentence.id"
                :class="
                  inspectedSentence?.id === sentence.id
                    ? 'bg-[#1E3A8A]/10 text-[#1C1917] underline decoration-[#1E3A8A]/50 decoration-1 underline-offset-4'
                    : 'hover:bg-[#EBE6DF]/70'
                "
                class="inline text-left font-prose leading-[1.85] rounded-xs transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#1E3A8A]"
              >
                {{ sentence.text }}
              </button>
              <span v-else>{{ sentence.text }}</span>
              {{ sIdx < para.length - 1 ? ' ' : '' }}
            </template>
          </p>

          <!-- Pending Daily Slot Indicator at the end of the manuscript -->
          <p class="text-sm font-sans text-[#78716C] italic pt-2">
            {{
              isWaitingForNextDay
                ? `[ Day ${Math.max(1, story.currentDay - 1)} complete — Sentence ${
                    story.sentences.length + 1
                  } opens tomorrow. ]`
                : `[ Sentence ${story.sentences.length + 1} is currently open for selection below. ]`
            }}
          </p>
        </article>
      </div>

      <!-- Right: Margin Colophon Rail -->
      <aside class="lg:col-span-4 lg:sticky lg:top-24 space-y-6">
        <div v-if="inspectedSentence" class="bg-white border border-[#E5DFD3] rounded-md p-5">
          <div class="text-xs font-medium tracking-wider uppercase text-[#78716C]">
            Sentence Provenance · Day {{ inspectedSentence.day }}
          </div>
          <p class="font-prose italic text-sm text-[#1C1917] leading-relaxed mt-3 pb-4 border-b border-[#E5DFD3]">
            “{{ inspectedSentence.text }}”
          </p>
          <dl class="mt-4 space-y-2.5 text-xs">
            <div class="flex items-center justify-between gap-4">
              <dt class="text-[#78716C]">Voice</dt>
              <dd class="font-semibold text-[#1C1917]">{{ inspectedSentence.author }}</dd>
            </div>
            <div v-if="inspectedSentence.modelUsed" class="flex items-center justify-between gap-4">
              <dt class="text-[#78716C]">Model</dt>
              <dd class="text-[#57534E]">{{ inspectedSentence.modelUsed }}</dd>
            </div>
            <div class="flex items-center justify-between gap-4">
              <dt class="text-[#78716C]">Canonized</dt>
              <dd class="text-[#1C1917] tabular-nums">{{ inspectedSentence.canonizedAt }}</dd>
            </div>
          </dl>
        </div>

        <div class="bg-[#F7F4EE] border border-[#E5DFD3] rounded-md p-5">
          <h3 class="font-display text-base font-semibold text-[#1C1917]">Edition Ledger</h3>
          <dl class="mt-3 space-y-2.5 text-xs">
            <div class="flex items-center justify-between gap-4">
              <dt class="text-[#57534E]">Total Word Count</dt>
              <dd class="font-medium text-[#1C1917] tabular-nums">{{ totalWords }} words</dd>
            </div>
            <div class="flex items-center justify-between gap-4">
              <dt class="text-[#57534E]">Remaining Turns</dt>
              <dd class="font-medium text-[#1C1917] tabular-nums">
                {{ Math.max(0, story.maxDays - story.currentDay + 1) }}
                {{ Math.max(0, story.maxDays - story.currentDay + 1) === 1 ? 'day' : 'days' }}
              </dd>
            </div>
          </dl>
        </div>
      </aside>
    </section>

    <!-- Sentence Drafts & One-Sentence Composer (or Waiting for Next Day) -->
    <section id="drafts-section" class="pt-12">
      <div v-if="isWaitingForNextDay" class="bg-white border border-[#D6CEBE] rounded-md p-8 max-w-3xl">
        <div class="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[#1E3A8A]">
          <Clock class="w-4 h-4" aria-hidden="true" />
          <span>Day {{ Math.max(1, story.currentDay - 1) }} Canonized · Waiting for Tomorrow</span>
        </div>
        <h2 class="font-display text-2xl sm:text-3xl font-semibold text-[#1C1917] mt-2">
          The story has been updated.
        </h2>
        <p class="font-prose text-base text-[#57534E] leading-relaxed mt-2">
          Today’s winning sentence is now locked into the manuscript above. In the daily cadence of
          <em>One Sentence Each</em>, the next round of competing continuations opens tomorrow.
        </p>

        <div class="mt-6 pt-5 border-t border-[#E5DFD3] flex flex-wrap items-center justify-between gap-4">
          <div class="text-xs text-[#57534E] tabular-nums">
            Next round opens in
            <strong class="text-[#1C1917] font-semibold">{{ countdown }}</strong>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <button
              type="button"
              :disabled="isGeneratingCandidates"
              @click="emit('unlockNextDayForStory', story.id, false)"
              class="px-4 py-2 min-h-[40px] text-xs font-medium bg-[#F7F4EE] hover:bg-[#EBE6DF] border border-[#D6CEBE] text-[#1C1917] rounded-md transition-colors cursor-pointer"
            >
              Open Tomorrow (Blank)
            </button>
            <button
              type="button"
              :disabled="isGeneratingCandidates"
              @click="emit('unlockNextDayForStory', story.id, true)"
              class="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172D6B] disabled:opacity-60 rounded-md transition-colors cursor-pointer"
            >
              <Loader2
                v-if="isGeneratingCandidates"
                class="w-3.5 h-3.5 animate-spin"
                aria-hidden="true"
              />
              <PenLine v-else class="w-3.5 h-3.5" aria-hidden="true" />
              {{
                isGeneratingCandidates
                  ? 'Drafting Tomorrow’s AI Voices…'
                  : 'Open Tomorrow & Draft AI Voices'
              }}
            </button>
          </div>
        </div>
      </div>

      <div v-else class="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        <!-- Left: Sentence Drafts -->
        <div class="lg:col-span-7 space-y-5">
          <div class="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 class="font-display text-2xl font-semibold text-[#1C1917]">
                Day {{ story.currentDay }} Sentence Drafts
              </h2>
              <p class="text-xs text-[#57534E] mt-1">
                Draft a few voices from the model, then canonize the sentence that fits.
              </p>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                :disabled="isGeneratingCandidates"
                @click="emit('generateAiCandidates', story.id)"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[34px] text-xs font-medium bg-white border border-[#D6CEBE] hover:border-[#1E3A8A] disabled:opacity-60 text-[#1C1917] rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#1E3A8A]"
              >
                <Loader2
                  v-if="isGeneratingCandidates"
                  class="w-3.5 h-3.5 animate-spin text-[#1E3A8A]"
                  aria-hidden="true"
                />
                <PenLine v-else class="w-3.5 h-3.5 text-[#1E3A8A]" aria-hidden="true" />
                {{ isGeneratingCandidates ? 'Drafting 3 Voices…' : 'Draft 3 AI Voices' }}
              </button>
            </div>
          </div>

          <div
            v-if="generationError"
            role="alert"
            class="px-4 py-3 bg-[#9A3412]/8 border border-[#9A3412]/30 rounded-md flex items-start justify-between gap-3 text-xs text-[#9A3412]"
          >
            <span>{{ generationError }}</span>
            <button
              type="button"
              @click="emit('dismissGenerationError')"
              aria-label="Dismiss error"
              class="p-0.5 hover:text-[#1C1917] cursor-pointer shrink-0"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>

          <div
            v-if="orderedCandidates.length === 0"
            class="bg-white border border-[#E5DFD3] rounded-md p-8 text-center space-y-4"
          >
            <p class="font-prose text-[#57534E]">
              No sentence drafts exist for Day {{ story.currentDay }} yet. Write Sentence
              {{ story.sentences.length + 1 }} yourself or draft three distinct AI voices.
            </p>
            <button
              type="button"
              :disabled="isGeneratingCandidates"
              @click="emit('generateAiCandidates', story.id)"
              class="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172D6B] disabled:opacity-60 rounded-md transition-colors cursor-pointer"
            >
              <Loader2
                v-if="isGeneratingCandidates"
                class="w-3.5 h-3.5 animate-spin"
                aria-hidden="true"
              />
              <PenLine v-else class="w-3.5 h-3.5" aria-hidden="true" />
              {{ isGeneratingCandidates ? 'Drafting 3 Voices…' : 'Draft 3 AI Voices' }}
            </button>
          </div>

          <div v-else class="space-y-3">
            <div
              v-for="candidate in orderedCandidates"
              :key="candidate.id"
              class="bg-white border border-[#E5DFD3] rounded-md p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4 transition-colors duration-150"
            >
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#78716C]">
                  <span class="font-medium text-[#1C1917]">{{ candidate.author }}</span>
                  <template v-if="candidate.voiceStyle">
                    <span aria-hidden="true">·</span>
                    <span>{{ candidate.voiceStyle }}</span>
                  </template>
                  <template v-if="candidate.modelUsed">
                    <span aria-hidden="true">·</span>
                    <span>{{ candidate.modelUsed }}</span>
                  </template>
                  <span aria-hidden="true">·</span>
                  <span>{{ candidate.submittedAt }}</span>
                  <template v-if="candidate.isUserSubmission">
                    <span aria-hidden="true">·</span>
                    <span class="font-semibold text-[#14532D]">Your Submission</span>
                  </template>
                  <template v-if="candidate.paragraphBreakBefore">
                    <span aria-hidden="true">·</span>
                    <span class="italic text-[#57534E]">Starts new paragraph</span>
                  </template>
                </div>

                <p class="font-prose text-[16px] sm:text-[17px] leading-relaxed text-[#1C1917] mt-2.5">
                  {{ candidate.text }}
                </p>
              </div>

              <div class="flex sm:flex-col items-center sm:items-end gap-2 shrink-0">
                <button
                  type="button"
                  @click="emit('selectAndCanonize', story.id, candidate.id)"
                  class="inline-flex items-center gap-1 px-3 py-1.5 min-h-[34px] text-xs font-medium bg-[#F7F4EE] hover:bg-[#1E3A8A] text-[#1C1917] hover:text-white border border-[#D6CEBE] hover:border-[#1E3A8A] rounded-md transition-colors duration-150 cursor-pointer whitespace-nowrap"
                >
                  <Check class="w-3 h-3" aria-hidden="true" />
                  Canonize
                </button>
              </div>
            </div>
          </div>
      </div>

      <!-- Right: One-Sentence Daily Composer -->
      <div id="sentence-composer" class="lg:col-span-5">
        <div class="bg-white border border-[#D6CEBE] rounded-md p-6">
          <div class="flex items-center justify-between gap-3 pb-4 border-b border-[#E5DFD3]">
            <div class="flex items-center gap-2">
              <Feather class="w-4 h-4 text-[#1E3A8A]" aria-hidden="true" />
              <h3 class="font-display text-lg font-semibold text-[#1C1917]">
                Add Sentence {{ story.sentences.length + 1 }}
              </h3>
            </div>
            <span
              :class="hasSubmittedToday ? 'text-[#9A3412]' : 'text-[#14532D]'"
              class="text-xs font-medium tabular-nums"
            >
              {{ hasSubmittedToday ? '0 of 1 left today' : '1 of 1 left today' }}
            </span>
          </div>

          <div v-if="hasSubmittedToday" class="pt-5 space-y-4">
            <div class="flex items-start gap-2.5 text-sm text-[#1C1917]">
              <Check class="w-4 h-4 text-[#14532D] mt-0.5 shrink-0" aria-hidden="true" />
              <p class="leading-relaxed">
                Your daily sentence is saved for today’s canonization. You can write exactly
                <strong>one sentence per day</strong> across all active stories.
              </p>
            </div>

            <p class="text-xs text-[#57534E] leading-relaxed">
              Choose any draft with <strong>Canonize</strong> to lock it in, or advance the day
              to canonize your own submitted sentence.
            </p>

            <button
              type="button"
              @click="emit('advanceDay')"
              class="w-full min-h-[42px] px-4 py-2.5 text-xs font-medium bg-[#F7F4EE] hover:bg-[#EBE6DF] border border-[#D6CEBE] text-[#1C1917] rounded-md inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <CalendarClock class="w-4 h-4 text-[#1E3A8A]" aria-hidden="true" />
              Advance Day &amp; Canonize Winner
            </button>
          </div>

          <form v-else @submit.prevent="handleCandidateSubmit" class="pt-4 space-y-4">
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <label for="candidate-sentence-textarea" class="text-xs font-medium text-[#57534E]">
                  Propose as <strong class="text-[#1C1917]">{{ dailyState.penName }}</strong>
                </label>
                <span class="text-xs text-[#78716C] tabular-nums">
                  {{ validation.wordCount }} words · {{ validation.charCount }}/240
                </span>
              </div>

              <textarea
                id="candidate-sentence-textarea"
                ref="composerEl"
                v-model="draftSentence"
                rows="4"
                :placeholder="composerPlaceholder"
                class="w-full px-3.5 py-3 font-prose text-base leading-relaxed bg-[#FBF9F5] border border-[#D6CEBE] rounded-md text-[#1C1917] placeholder:text-[#A8A29E] focus:outline-none focus:bg-white focus:border-[#1E3A8A]"
              ></textarea>

              <p v-if="draftSentence.trim().length > 0 && validation.error" class="text-xs text-[#9A3412] mt-1.5">
                {{ validation.error }}
              </p>
            </div>

            <label class="flex items-center gap-2.5 text-xs text-[#57534E] cursor-pointer select-none">
              <input
                v-model="paragraphBreak"
                type="checkbox"
                class="w-4 h-4 accent-[#1E3A8A] rounded cursor-pointer"
              />
              Begin a new paragraph before this sentence
            </label>

            <div class="pt-2 flex items-center justify-between gap-4">
              <span class="text-xs text-[#78716C]">Advance Day canonizes this sentence first</span>
              <button
                type="submit"
                :disabled="!validation.valid"
                class="px-4 py-2.5 min-h-[42px] text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172D6B] disabled:opacity-40 disabled:cursor-not-allowed rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Save Draft Sentence
              </button>
            </div>
          </form>
        </div>
      </div>
      </div>
    </section>
  </div>
</template>
