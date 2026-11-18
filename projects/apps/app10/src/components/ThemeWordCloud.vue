<script setup lang="ts">
import { ref } from 'vue';
import { Loader2, PenLine, Plus, X } from '@lucide/vue';
import type { ThemeWord } from '../types/story';

const props = defineProps<{
  words: ThemeWord[];
  activeWords: string[];
  isGenerating?: boolean;
  isWaitingForNextDay?: boolean;
}>();

const emit = defineEmits<{
  toggleWord: [word: string];
  addWord: [word: string];
  removeWord: [word: string];
  clearActive: [];
  draftWithTheme: [];
}>();

const WEIGHT_CLASSES: Record<1 | 2 | 3, string> = {
  3: 'font-display text-xl sm:text-2xl font-semibold tracking-tight',
  2: 'font-prose italic text-base sm:text-lg font-medium',
  1: 'font-sans text-sm',
};

const newWord = ref('');

const handleAdd = () => {
  const cleaned = newWord.value.trim().toLowerCase().slice(0, 28);
  if (!cleaned) return;
  emit('addWord', cleaned);
  newWord.value = '';
};
</script>

<template>
  <div class="bg-white border border-[#D6CEBE] rounded-md p-5">
    <div class="flex flex-wrap items-baseline justify-between gap-3 pb-3 border-b border-[#E5DFD3]">
      <div>
        <h3 class="font-display text-lg font-semibold text-[#1C1917]">Thematic Word Cloud</h3>
        <p class="text-xs text-[#57534E] mt-0.5">
          Click words to activate or deactivate motifs for today’s story theme.
        </p>
      </div>

      <div class="flex items-center gap-3 text-xs">
        <span class="text-[#57534E]">
          <template v-if="props.activeWords.length > 0">
            <strong class="text-[#1E3A8A]">Active theme:</strong>
            {{ props.activeWords.join(' · ') }}
          </template>
          <template v-else>Open theme (no motifs locked)</template>
        </span>
        <button
          v-if="props.activeWords.length > 0"
          type="button"
          @click="emit('clearActive')"
          class="text-xs text-[#78716C] hover:text-[#1C1917] underline underline-offset-2 cursor-pointer whitespace-nowrap shrink-0"
        >
          Clear
        </button>
      </div>
    </div>

    <!-- Typographic Word Cloud -->
    <div
      role="group"
      aria-label="Theme words"
      class="py-4 px-3 flex flex-wrap items-baseline justify-center gap-x-5 gap-y-2 bg-[#FBF9F5] border-b border-[#E5DFD3] rounded-xs mt-3"
    >
      <span
        v-for="item in props.words"
        :key="item.word"
        class="inline-flex items-baseline gap-1"
      >
        <button
          type="button"
          :aria-pressed="props.activeWords.includes(item.word)"
          @click="emit('toggleWord', item.word)"
          :class="[
            WEIGHT_CLASSES[item.weight],
            props.activeWords.includes(item.word)
              ? 'text-[#1E3A8A] underline decoration-[#1E3A8A] decoration-2 underline-offset-4'
              : 'text-[#57534E] hover:text-[#1C1917]',
          ]"
          class="px-1 py-0.5 transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#1E3A8A]"
        >
          {{ item.word }}
        </button>
        <button
          v-if="item.isCustom"
          type="button"
          @click="emit('removeWord', item.word)"
          :aria-label="`Remove ${item.word} from word cloud`"
          class="p-0.5 text-[#A8A29E] hover:text-[#9A3412] transition-colors cursor-pointer"
        >
          <X class="w-3 h-3" aria-hidden="true" />
        </button>
      </span>
    </div>

    <!-- Add Custom Theme Word + Direct Theme Drafting Action -->
    <form
      @submit.prevent="handleAdd"
      class="mt-3.5 flex flex-wrap items-center justify-between gap-3"
    >
      <div class="flex items-center gap-2 flex-1 min-w-[220px] max-w-md">
        <label for="theme-word-input" class="sr-only">Add theme word</label>
        <input
          id="theme-word-input"
          v-model="newWord"
          type="text"
          maxlength="28"
          placeholder="Add your own theme word (e.g., storm, betrayal)..."
          class="flex-1 px-3 py-1.5 text-xs bg-[#FBF9F5] border border-[#D6CEBE] rounded text-[#1C1917] placeholder:text-[#A8A29E] focus:outline-none focus:bg-white focus:border-[#1E3A8A]"
        />
        <button
          type="submit"
          :disabled="!newWord.trim()"
          class="inline-flex items-center gap-1 px-3 py-1.5 min-h-[34px] text-xs font-medium bg-[#F7F4EE] hover:bg-[#EBE6DF] disabled:opacity-40 border border-[#D6CEBE] text-[#1C1917] rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus class="w-3.5 h-3.5 text-[#1E3A8A]" aria-hidden="true" />
          Add Word
        </button>
      </div>

      <button
        type="button"
        :disabled="props.isGenerating"
        @click="emit('draftWithTheme')"
        class="inline-flex items-center gap-1.5 px-3.5 py-1.5 min-h-[36px] text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172D6B] disabled:opacity-60 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
      >
        <Loader2 v-if="props.isGenerating" class="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
        <PenLine v-else class="w-3.5 h-3.5" aria-hidden="true" />
        {{
          props.isGenerating
            ? 'Drafting Themed Voices…'
            : props.isWaitingForNextDay
              ? 'Open Tomorrow & Draft Theme'
              : 'Apply Theme & Draft 3 AI Voices'
        }}
      </button>
    </form>
  </div>
</template>
