<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { CalendarClock, Check, Newspaper, Pencil, Plus, RotateCcw } from '@lucide/vue';

defineProps<{
  penName: string;
  hasSubmittedToday: boolean;
  submittedStoryTitle?: string;
  simulatedDayOffset: number;
}>();

const emit = defineEmits<{
  updatePenName: [name: string];
  advanceDay: [];
  resetDemo: [];
  openNewStory: [];
  openCommissionDesk: [];
}>();

const editingName = ref(false);
const draftName = ref('');
const nameInputEl = ref<HTMLInputElement | null>(null);

watch(editingName, async (isEditing) => {
  if (isEditing) {
    await nextTick();
    nameInputEl.value?.focus();
  }
});

const startEditing = (penName: string) => {
  draftName.value = penName;
  editingName.value = true;
};

const handleSaveName = (penName: string) => {
  const cleaned = draftName.value.trim();
  if (cleaned.length >= 2) {
    emit('updatePenName', cleaned.slice(0, 32));
  } else {
    draftName.value = penName;
  }
  editingName.value = false;
};
</script>

<template>
  <div class="bg-[#F3EFE6] border-b border-[#E5DFD3]">
    <div class="max-w-[1200px] mx-auto px-4 sm:px-8 py-2.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-[#57534E]">
      <!-- Contributor Pen Name & Daily Allowance -->
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <form
          v-if="editingName"
          @submit.prevent="handleSaveName(penName)"
          class="flex items-center gap-2"
        >
          <label for="pen-name-input" class="text-[#57534E]">Pen name:</label>
          <input
            id="pen-name-input"
            ref="nameInputEl"
            v-model="draftName"
            type="text"
            maxlength="32"
            class="px-2 py-1 text-xs bg-white border border-[#D6CEBE] rounded text-[#1C1917] focus:outline-none focus:border-[#1E3A8A]"
          />
          <button
            type="submit"
            class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-[#1E3A8A] hover:text-[#172D6B] cursor-pointer"
          >
            <Check class="w-3.5 h-3.5" aria-hidden="true" />
            Save
          </button>
        </form>
        <div v-else class="flex items-center gap-1.5">
          <span>Writing as</span>
          <span class="font-semibold text-[#1C1917]">{{ penName }}</span>
          <button
            type="button"
            @click="startEditing(penName)"
            aria-label="Edit pen name"
            class="p-1 text-[#78716C] hover:text-[#1C1917] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#1E3A8A]"
          >
            <Pencil class="w-3 h-3" aria-hidden="true" />
          </button>
        </div>

        <span aria-hidden="true" class="text-[#C7BFB0]">·</span>

        <div class="flex items-center gap-1.5 tabular-nums">
          <span
            :class="hasSubmittedToday ? 'text-[#9A3412] font-medium' : 'text-[#14532D] font-medium'"
          >
            {{
              hasSubmittedToday
                ? `Daily allowance: 0 of 1 remaining${
                    submittedStoryTitle ? ` (submitted to ${submittedStoryTitle})` : ''
                  }`
                : 'Daily allowance: 1 of 1 sentence remaining'
            }}
          </span>
        </div>
      </div>

      <!-- Interactive Demo Controls -->
      <div class="flex flex-wrap items-center gap-3">
        <span class="tabular-nums text-[#78716C] hidden sm:inline">
          Edition Day {{ simulatedDayOffset + 1 }}
        </span>

        <button
          type="button"
          @click="emit('advanceDay')"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[34px] text-xs font-medium bg-white border border-[#D6CEBE] hover:border-[#1E3A8A] text-[#1C1917] rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#1E3A8A]"
        >
          <CalendarClock class="w-3.5 h-3.5 text-[#1E3A8A]" aria-hidden="true" />
          Advance Day &amp; Canonize
        </button>

        <button
          type="button"
          @click="emit('openCommissionDesk')"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[34px] text-xs font-medium bg-white border border-[#D6CEBE] hover:border-[#1E3A8A] text-[#1C1917] rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#1E3A8A]"
        >
          <Newspaper class="w-3.5 h-3.5 text-[#1E3A8A]" aria-hidden="true" />
          Commission Desk
        </button>

        <button
          type="button"
          @click="emit('openNewStory')"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[34px] text-xs font-medium bg-white border border-[#D6CEBE] hover:border-[#1C1917] text-[#1C1917] rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#1E3A8A]"
        >
          <Plus class="w-3.5 h-3.5" aria-hidden="true" />
          Start Story
        </button>

        <button
          type="button"
          @click="emit('resetDemo')"
          class="inline-flex items-center gap-1 px-2 py-1.5 min-h-[34px] text-xs text-[#78716C] hover:text-[#1C1917] transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#1E3A8A]"
        >
          <RotateCcw class="w-3 h-3" aria-hidden="true" />
          Reset Demo
        </button>
      </div>
    </div>
  </div>
</template>
