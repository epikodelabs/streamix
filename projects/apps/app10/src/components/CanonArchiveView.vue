<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { BookOpen, Download } from '@lucide/vue';
import type { CanonSentence, Story } from '../types/story';
import { formatMonthKey } from '../utils/month';

const props = defineProps<{
  stories: Story[];
}>();

const emit = defineEmits<{
  openActiveStory: [storyId: string];
}>();

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

const completedStories = computed(() => props.stories.filter((s) => s.status === 'completed'));

const selectedArchiveId = ref<string | null>(null);

const archiveStory = computed<Story>(() => {
  return (
    completedStories.value.find((s) => s.id === selectedArchiveId.value) ||
    completedStories.value[0] ||
    props.stories[0]
  );
});

const monthGroups = computed(() => {
  const groups = new Map<string, Story[]>();
  for (const story of props.stories) {
    const key = story.monthKey || 'back-catalog';
    const group = groups.get(key) || [];
    group.push(story);
    groups.set(key, group);
  }
  return Array.from(groups.entries())
    .map(([key, stories]) => ({
      key,
      label: key === 'back-catalog' ? 'Back Catalog' : formatMonthKey(key),
      stories,
    }))
    .sort((a, b) => {
      if (a.key === 'back-catalog') return 1;
      if (b.key === 'back-catalog') return -1;
      return b.key.localeCompare(a.key);
    });
});

const paragraphs = computed(() => groupIntoParagraphs(archiveStory.value.sentences));

const contributors = computed(() => {
  const counts = new Map<string, number>();
  for (const s of archiveStory.value.sentences) {
    counts.set(s.author, (counts.get(s.author) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
});

const handleShelfSelect = async (story: Story) => {
  if (story.status === 'completed') {
    selectedArchiveId.value = story.id;
    await nextTick();
    document
      .getElementById('archive-monograph')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    emit('openActiveStory', story.id);
  }
};

const handleDownloadEdition = () => {
  if (!archiveStory.value) return;
  const prose = paragraphs.value.map((para) => para.map((s) => s.text).join(' ')).join('\n\n');
  const colophon = contributors.value
    .map(([name, count]) => `- ${name} (${count} sentence${count > 1 ? 's' : ''})`)
    .join('\n');
  const content = `${archiveStory.value.title}\n${archiveStory.value.subtitle}\n${archiveStory.value.issueNumber} · ${archiveStory.value.genre}\n\n---\n\n${prose}\n\n---\n\nContributors:\n${colophon}\n`;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${archiveStory.value.id}-canon-edition.txt`;
  link.click();
  URL.revokeObjectURL(url);
};
</script>

<template>
  <section
    v-if="stories.length === 0"
    class="max-w-[1200px] mx-auto px-4 sm:px-8 py-16 text-center"
  >
    <BookOpen class="w-8 h-8 text-[#78716C] mx-auto mb-3" aria-hidden="true" />
    <h1 class="font-display text-3xl font-semibold text-[#1C1917]">The Archive Is Empty</h1>
    <p class="font-prose text-[#57534E] mt-3 max-w-md mx-auto">
      Commission a monthly issue from the desk to begin the collection.
    </p>
  </section>

  <div v-else class="max-w-[1200px] mx-auto px-4 sm:px-8 py-10">
    <div class="pb-6 mb-8 border-b border-[#E5DFD3] flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="text-xs tracking-wider uppercase text-[#78716C]">
          Permanent Broadsheet Collection
        </p>
        <h1 class="font-display text-3xl sm:text-4xl font-semibold text-[#1C1917] mt-1">
          Canon Archive
        </h1>
      </div>
      <button
        v-if="completedStories.length > 0"
        type="button"
        @click="handleDownloadEdition"
        class="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] text-xs font-medium bg-white border border-[#D6CEBE] hover:border-[#1E3A8A] text-[#1C1917] rounded-md transition-colors cursor-pointer"
      >
        <Download class="w-3.5 h-3.5 text-[#1E3A8A]" aria-hidden="true" />
        Download Edition (.txt)
      </button>
    </div>

    <!-- The Monthly Shelf -->
    <section class="mb-12">
      <div class="flex flex-wrap items-end justify-between gap-3 pb-3 border-b border-[#E5DFD3]">
        <div>
          <h2 class="font-display text-2xl font-semibold text-[#1C1917]">The Monthly Shelf</h2>
          <p class="text-xs text-[#57534E] mt-0.5">
            Every commissioned issue, filed by month. Finished issues stay here permanently and
            open below; running issues open in the reading view.
          </p>
        </div>
        <span class="text-xs text-[#78716C] tabular-nums">{{ stories.length }} volumes</span>
      </div>

      <div class="mt-5 space-y-7">
        <section v-for="group in monthGroups" :key="group.key">
          <div class="flex items-baseline justify-between gap-3">
            <h3 class="text-xs font-medium tracking-wider uppercase text-[#57534E]">
              {{ group.label }}
            </h3>
            <span class="text-[11px] text-[#78716C] tabular-nums">
              {{ group.stories.length }} {{ group.stories.length === 1 ? 'issue' : 'issues' }}
            </span>
          </div>

          <div class="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <button
              v-for="story in group.stories"
              :key="story.id"
              type="button"
              @click="handleShelfSelect(story)"
              :class="
                story.status === 'completed' && story.id === archiveStory.id
                  ? 'bg-white border-[#1E3A8A] shadow-xs'
                  : 'bg-white border-[#E5DFD3] hover:border-[#1E3A8A]/60'
              "
              class="text-left border rounded-md p-4 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#1E3A8A]"
            >
              <div class="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wider text-[#78716C]">
                <span :class="story.status === 'active' ? 'text-[#14532D]' : ''">
                  {{ story.status === 'active' ? 'Running' : 'Completed' }}
                </span>
                <span>{{ story.genre }}</span>
              </div>
              <div class="font-display text-base font-semibold text-[#1C1917] mt-1 truncate">
                {{ story.title }}
              </div>
              <div class="text-xs text-[#57534E] mt-1 tabular-nums">
                Day {{ story.currentDay }}/{{ story.maxDays }} · {{ story.sentences.length }}
                sentences
              </div>
              <p
                v-if="story.constraint"
                class="text-[11px] text-[#78716C] mt-1.5 leading-relaxed line-clamp-2"
              >
                {{ story.constraint }}
              </p>
              <p
                :class="story.status === 'completed' ? 'text-[#1E3A8A]' : 'text-[#57534E]'"
                class="text-[11px] font-medium mt-2"
              >
                {{
                  story.status === 'completed'
                    ? 'Read the finished edition →'
                    : 'Open the manuscript →'
                }}
              </p>
            </button>
          </div>
        </section>
      </div>
    </section>

    <div
      v-if="completedStories.length === 0"
      class="bg-white border border-[#E5DFD3] rounded-md p-10 text-center"
    >
      <BookOpen class="w-8 h-8 text-[#78716C] mx-auto mb-3" aria-hidden="true" />
      <h2 class="font-display text-2xl font-semibold text-[#1C1917]">
        No Completed Editions Yet
      </h2>
      <p class="font-prose text-[#57534E] mt-2 max-w-md mx-auto">
        Running issues enter the permanent archive once they reach their final day.
      </p>
    </div>

    <div v-else class="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
      <!-- Monograph Prose -->
      <article
        id="archive-monograph"
        class="lg:col-span-8 bg-white border border-[#E5DFD3] rounded-md p-6 sm:p-10"
      >
        <p class="text-xs tracking-wider uppercase text-[#78716C]">
          {{ archiveStory.issueNumber }} · {{ archiveStory.genre }}
        </p>
        <h2 class="font-display text-3xl sm:text-4xl font-semibold text-[#1C1917] mt-2">
          {{ archiveStory.title }}
        </h2>
        <p class="font-prose italic text-base sm:text-lg text-[#57534E] mt-2 pb-6 border-b border-[#E5DFD3]">
          {{ archiveStory.subtitle }}
        </p>
        <p
          v-if="archiveStory.constraint"
          class="text-xs text-[#57534E] mt-3 leading-relaxed"
        >
          <span class="font-semibold text-[#1C1917]">Monthly Constraint:</span>
          {{ archiveStory.constraint }}
        </p>

        <div class="max-w-2xl font-prose text-[17px] sm:text-[18px] leading-[1.85] text-[#1C1917] space-y-6 pt-8">
          <p
            v-for="(para, pIdx) in paragraphs"
            :key="para[0]?.id || pIdx"
            :class="
              pIdx === 0
                ? 'first-letter:font-display first-letter:text-5xl first-letter:font-semibold first-letter:float-left first-letter:mr-3 first-letter:mt-1 first-letter:leading-[0.85] first-letter:text-[#1C1917]'
                : ''
            "
          >
            {{ para.map((s) => s.text).join(' ') }}
          </p>
        </div>

        <div class="mt-10 pt-6 border-t border-[#E5DFD3] text-xs text-[#78716C] font-prose italic">
          Finis · Completed across {{ archiveStory.sentences.length }} daily
          {{ archiveStory.sentences.length === 1 ? 'round' : 'rounds' }} of collective editing.
        </div>
      </article>

      <!-- Archival Colophon -->
      <aside class="lg:col-span-4 space-y-6">
        <div class="bg-[#F7F4EE] border border-[#E5DFD3] rounded-md p-6">
          <h3 class="font-display text-lg font-semibold text-[#1C1917]">
            Archival Colophon
          </h3>
          <dl class="mt-4 space-y-2.5 text-xs">
            <div v-if="archiveStory.monthKey" class="flex items-center justify-between">
              <dt class="text-[#57534E]">Issue Month</dt>
              <dd class="font-medium text-[#1C1917]">{{ formatMonthKey(archiveStory.monthKey) }}</dd>
            </div>
            <div class="flex items-center justify-between">
              <dt class="text-[#57534E]">Total Length</dt>
              <dd class="font-medium text-[#1C1917] tabular-nums">
                {{ archiveStory.sentences.length }}
                {{ archiveStory.sentences.length === 1 ? 'sentence' : 'sentences' }}
              </dd>
            </div>
          </dl>
        </div>

        <div class="bg-white border border-[#E5DFD3] rounded-md p-6">
          <h3 class="font-display text-base font-semibold text-[#1C1917] pb-3 border-b border-[#E5DFD3]">
            Contributor Roll
          </h3>
          <ul class="mt-3 divide-y divide-[#F1EDE4] text-xs">
            <li
              v-for="[author, count] in contributors"
              :key="author"
              class="py-2 flex items-center justify-between gap-2"
            >
              <span class="text-[#1C1917] font-medium">{{ author }}</span>
              <span class="text-[#78716C] tabular-nums">
                {{ count }} {{ count === 1 ? 'sentence' : 'sentences' }}
              </span>
            </li>
          </ul>
        </div>
      </aside>
    </div>
  </div>
</template>
