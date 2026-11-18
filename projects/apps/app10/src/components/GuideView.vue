<script setup lang="ts">
const emit = defineEmits<{
  goToActive: [];
}>();

const RULES = [
  {
    number: '01.',
    title: 'One Sentence Per Day',
    body: 'You receive a single sentence allowance per calendar day across the entire broadsheet. Scarcity forces precision: every verb, clause, and beat must earn its place.',
  },
  {
    number: '02.',
    title: 'Drafting the Day’s Choices',
    body: 'Draft a handful of candidate sentences with the model or write your own. Every draft responds to the exact same paragraph.',
  },
  {
    number: '03.',
    title: 'The Editor Chooses Canon',
    body: 'Pick the sentence that deepens tone, sustains tension, or turns the scene unexpectedly. The chosen sentence is locked permanently into the manuscript, and advancing the day canonizes your own submitted sentence first.',
  },
  {
    number: '04.',
    title: 'Slow Emergence Into Archive',
    body: 'Over two to four weeks, a cohesive work of fiction surfaces without any central outline. Once a volume completes its final day, the finished monograph enters the permanent Canon Archive.',
  },
];
</script>

<template>
  <div class="max-w-[960px] mx-auto px-4 sm:px-8 py-12">
    <div class="pb-8 border-b border-[#E5DFD3]">
      <p class="text-xs tracking-wider uppercase text-[#78716C]">
        Editorial Charter &amp; Rhythm
      </p>
      <h1 class="font-display text-3xl sm:text-4xl font-semibold text-[#1C1917] mt-2">
        How One Sentence Each Works
      </h1>
      <p class="font-prose text-lg text-[#57534E] leading-relaxed mt-3 max-w-2xl">
        An asynchronous literary workshop built around patience: no real-time chat, no infinite
        edits—just one thoughtful sentence per day, chosen from your own drafts.
      </p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-8 py-10 border-b border-[#E5DFD3]">
      <div
        v-for="rule in RULES"
        :key="rule.number"
        class="bg-white border border-[#E5DFD3] rounded-md p-6"
      >
        <div class="text-xs font-semibold text-[#1E3A8A] tabular-nums">{{ rule.number }}</div>
        <h2 class="font-display text-xl font-semibold text-[#1C1917] mt-1.5">
          {{ rule.title }}
        </h2>
        <p class="font-prose text-sm sm:text-[15px] leading-relaxed text-[#57534E] mt-2.5">
          {{ rule.body }}
        </p>
      </div>
    </div>

    <div class="pt-8 flex flex-wrap items-center justify-between gap-4">
      <div class="text-xs text-[#57534E] max-w-lg leading-relaxed">
        <strong class="text-[#1C1917]">Demo Simulation Tip:</strong> Use the
        <strong>Advance Day &amp; Canonize</strong> button in the workspace toolbar to preview
        midnight canonization immediately without waiting 24 hours.
      </div>
      <button
        type="button"
        @click="emit('goToActive')"
        class="px-5 py-2.5 min-h-[42px] text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172D6B] rounded-md transition-colors cursor-pointer"
      >
        Return to Active Stories
      </button>
    </div>
  </div>
</template>
