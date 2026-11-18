<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { X } from '@lucide/vue';
import { validateSingleSentence } from '../utils/sentenceValidation';

interface NewStoryInput {
  title: string;
  subtitle: string;
  genre: string;
  maxDays: number;
  openingSentence: string;
  promptNote: string;
  themeWords?: string[];
  coverImage: string;
  coverCaption: string;
}

const props = defineProps<{
  isOpen: boolean;
  penName: string;
  hasSubmittedToday: boolean;
}>();

const emit = defineEmits<{
  close: [];
  createStory: [input: NewStoryInput];
}>();

const PLATE_OPTIONS = [
  {
    label: 'Watchhouse & Tidal Clock',
    image: '/src/assets/images/story_salt_clock_1794937954288.jpg',
    caption: 'Plate I — Brass instruments beside the coastal ledger.',
  },
  {
    label: 'Archival Sorting Room',
    image: '/src/assets/images/story_unclaimed_letters_1794937953591.jpg',
    caption: 'Plate II — Pigeonhole racks and twine-bound correspondence.',
  },
  {
    label: 'Highland Glasshouse Train',
    image: '/src/assets/images/story_glasshouse_train_1794937954280.jpg',
    caption: 'Plate III — Lantern-lit conservatory carriage at dusk.',
  },
];

const GENRE_OPTIONS = [
  'Literary Fiction',
  'Maritime Mystery',
  'Urban Realism',
  'Speculative Fiction',
  'Epistolary',
];

const title = ref('');
const subtitle = ref('');
const genre = ref('Literary Fiction');
const maxDays = ref(16);
const openingSentence = ref('');
const promptNote = ref('');
const themeWordsInput = ref('');
const plateIdx = ref(0);

const sentenceValidation = computed(() => validateSingleSentence(openingSentence.value));

const canSubmit = computed(
  () =>
    !props.hasSubmittedToday &&
    title.value.trim().length >= 3 &&
    subtitle.value.trim().length >= 6 &&
    sentenceValidation.value.valid
);

const onKeyDown = (event: KeyboardEvent) => {
  if (props.isOpen && event.key === 'Escape') emit('close');
};

onMounted(() => window.addEventListener('keydown', onKeyDown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown));

const handleMaxDaysInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  maxDays.value = Math.max(7, Math.min(30, Number(target.value) || 14));
};

const handleSubmit = () => {
  if (!canSubmit.value) return;
  const plate = PLATE_OPTIONS[plateIdx.value] || PLATE_OPTIONS[0];
  const parsedThemeWords = themeWordsInput.value
    .split(',')
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);

  emit('createStory', {
    title: title.value.trim(),
    subtitle: subtitle.value.trim(),
    genre: genre.value,
    maxDays: maxDays.value,
    openingSentence: openingSentence.value.trim(),
    promptNote:
      promptNote.value.trim() ||
      'Maintain a consistent voice and advance the scene by one clear beat per day.',
    themeWords: parsedThemeWords,
    coverImage: plate.image,
    coverCaption: plate.caption,
  });
  title.value = '';
  subtitle.value = '';
  openingSentence.value = '';
  promptNote.value = '';
  themeWordsInput.value = '';
  emit('close');
};
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1C1917]/45 backdrop-blur-[2px]"
    role="dialog"
    aria-modal="true"
    aria-labelledby="new-story-heading"
  >
    <div class="w-full max-w-xl bg-[#FBF9F5] border border-[#D6CEBE] rounded-lg shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
      <div class="px-6 py-4 border-b border-[#E5DFD3] flex items-center justify-between bg-[#F7F4EE]">
        <div>
          <h2 id="new-story-heading" class="font-display text-xl font-semibold text-[#1C1917]">
            Begin a New Collaborative Story
          </h2>
          <p class="text-xs text-[#57534E] mt-0.5">
            Opening Sentence 1 is canonized immediately under {{ penName }}.
          </p>
        </div>
        <button
          type="button"
          @click="emit('close')"
          aria-label="Close modal"
          class="p-2 text-[#57534E] hover:text-[#1C1917] cursor-pointer"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <form @submit.prevent="handleSubmit" class="p-6 space-y-4 overflow-y-auto">
        <div
          v-if="hasSubmittedToday"
          class="p-3 bg-[#9A3412]/8 border border-[#9A3412]/30 rounded text-xs text-[#9A3412]"
        >
          You have already used your daily sentence allowance today. Click
          <strong>Advance Day &amp; Canonize</strong> in the toolbar to start tomorrow’s turn.
        </div>

        <div>
          <label for="story-title" class="block text-xs font-medium text-[#1C1917] mb-1">
            Story Title
          </label>
          <input
            id="story-title"
            v-model="title"
            type="text"
            placeholder="e.g., The Watchmaker of Greyfriars Alley"
            maxlength="80"
            class="w-full px-3 py-2 text-sm bg-white border border-[#D6CEBE] rounded text-[#1C1917] focus:outline-none focus:border-[#1E3A8A]"
            required
          />
        </div>

        <div>
          <label for="story-subtitle" class="block text-xs font-medium text-[#1C1917] mb-1">
            Editorial Deck (One-line premise)
          </label>
          <input
            id="story-subtitle"
            v-model="subtitle"
            type="text"
            placeholder="A repair ledger reveals every pocket watch stopped at the exact same minute."
            maxlength="140"
            class="w-full px-3 py-2 text-sm bg-white border border-[#D6CEBE] rounded text-[#1C1917] focus:outline-none focus:border-[#1E3A8A]"
            required
          />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label for="story-genre" class="block text-xs font-medium text-[#1C1917] mb-1">
              Genre
            </label>
            <select
              id="story-genre"
              v-model="genre"
              class="w-full px-3 py-2 text-sm bg-white border border-[#D6CEBE] rounded text-[#1C1917] focus:outline-none focus:border-[#1E3A8A]"
            >
              <option v-for="g in GENRE_OPTIONS" :key="g" :value="g">{{ g }}</option>
            </select>
          </div>

          <div>
            <label for="story-days" class="block text-xs font-medium text-[#1C1917] mb-1">
              Target Length (Days / Sentences)
            </label>
            <input
              id="story-days"
              type="number"
              min="7"
              max="30"
              :value="maxDays"
              @input="handleMaxDaysInput"
              class="w-full px-3 py-2 text-sm tabular-nums bg-white border border-[#D6CEBE] rounded text-[#1C1917] focus:outline-none focus:border-[#1E3A8A]"
            />
          </div>
        </div>

        <div>
          <label for="story-plate" class="block text-xs font-medium text-[#1C1917] mb-1">
            Frontispiece Engraving
          </label>
          <select
            id="story-plate"
            v-model.number="plateIdx"
            class="w-full px-3 py-2 text-sm bg-white border border-[#D6CEBE] rounded text-[#1C1917] focus:outline-none focus:border-[#1E3A8A]"
          >
            <option v-for="(plate, idx) in PLATE_OPTIONS" :key="plate.label" :value="idx">
              {{ plate.label }}
            </option>
          </select>
        </div>

        <div>
          <label for="opening-sentence" class="block text-xs font-medium text-[#1C1917] mb-1">
            Opening Sentence (Sentence 1)
          </label>
          <textarea
            id="opening-sentence"
            v-model="openingSentence"
            rows="3"
            placeholder="Write the single opening sentence that sets the tone and world..."
            class="w-full px-3 py-2 font-prose text-sm leading-relaxed bg-white border border-[#D6CEBE] rounded text-[#1C1917] focus:outline-none focus:border-[#1E3A8A]"
            required
          ></textarea>
          <p
            v-if="openingSentence.trim().length > 0 && sentenceValidation.error"
            class="text-xs text-[#9A3412] mt-1"
          >
            {{ sentenceValidation.error }}
          </p>
        </div>

        <div>
          <label for="prompt-note" class="block text-xs font-medium text-[#1C1917] mb-1">
            Editorial Note for Contributors (Optional)
          </label>
          <input
            id="prompt-note"
            v-model="promptNote"
            type="text"
            placeholder="e.g., Favor concrete sensory details over exposition."
            maxlength="160"
            class="w-full px-3 py-2 text-sm bg-white border border-[#D6CEBE] rounded text-[#1C1917] focus:outline-none focus:border-[#1E3A8A]"
          />
        </div>

        <div>
          <label for="theme-words-seed" class="block text-xs font-medium text-[#1C1917] mb-1">
            Initial Word Cloud Motifs (Optional, comma-separated)
          </label>
          <input
            id="theme-words-seed"
            v-model="themeWordsInput"
            type="text"
            placeholder="e.g., fog, pocket watch, cobblestone, silence"
            maxlength="140"
            class="w-full px-3 py-2 text-sm bg-white border border-[#D6CEBE] rounded text-[#1C1917] focus:outline-none focus:border-[#1E3A8A]"
          />
        </div>

        <div class="pt-3 border-t border-[#E5DFD3] flex items-center justify-end gap-3">
          <button
            type="button"
            @click="emit('close')"
            class="px-4 py-2 text-xs font-medium text-[#57534E] hover:text-[#1C1917] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            :disabled="!canSubmit"
            class="px-4 py-2 text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172D6B] disabled:opacity-40 disabled:cursor-not-allowed rounded cursor-pointer transition-colors"
          >
            Publish Opening Sentence
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
