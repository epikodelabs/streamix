<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useWritable } from '@epikodelabs/streamix/vue';
import ActiveStoriesView from './components/ActiveStoriesView.vue';
import CanonArchiveView from './components/CanonArchiveView.vue';
import CommissionDesk from './components/CommissionDesk.vue';
import DeskNote from './components/DeskNote.vue';
import GuideView from './components/GuideView.vue';
import HeaderBar from './components/HeaderBar.vue';
import InterregnumView from './components/InterregnumView.vue';
import NewStoryModal from './components/NewStoryModal.vue';
import WorkspaceToolbar from './components/WorkspaceToolbar.vue';
import { DEMO_COMMISSION_PITCHES, PLATE_IMAGES } from './data/demoCommissions';
import { INITIAL_STORIES, NEXT_DAY_CANDIDATE_POOL } from './data/seedStories';
import { commissionGenreAtom } from './state/commissionGenre';
import type {
  CandidateSentence,
  CanonSentence,
  CommissionRecord,
  DailyState,
  SlushPitch,
  Story,
  StoryPitch,
  ViewTab,
} from './types/story';
import {
  formatMonthKey,
  getCurrentMonthKey,
  getCurrentMonthLabel,
  getSeasonForMonthKey,
} from './utils/month';

// Version 2 drops the community ballot data from the single-player edition.
const STORAGE_KEY = 'one-sentence-each:demo-v2';

interface PersistedPayload {
  stories: Story[];
  dailyState: DailyState;
  selectedStoryId: string;
  commissions?: CommissionRecord[];
  dismissedCommissionMonth?: string | null;
  lastVisitAt?: string | null;
}

interface NewStoryInput {
  title: string;
  subtitle: string;
  genre: string;
  maxDays: number;
  openingSentence: string;
  promptNote: string;
  coverImage: string;
  coverCaption: string;
}

interface IncomingAiCandidate {
  author: string;
  voiceStyle?: string;
  modelUsed?: string;
  text: string;
  paragraphBreakBefore?: boolean;
}

const DEFAULT_DAILY_STATE: DailyState = {
  simulatedDayOffset: 0,
  penName: 'Guest Writer',
  submittedStoryId: null,
  submittedCandidateId: null,
  waitingStoryIds: [],
  lastCanonizedEvent: null,
};

function loadInitialPayload(): PersistedPayload {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedPayload;
      if (Array.isArray(parsed.stories) && parsed.dailyState) {
        return parsed;
      }
    }
  } catch {
    // Fallback cleanly to initial seeded state
  }
  return {
    stories: INITIAL_STORIES,
    dailyState: DEFAULT_DAILY_STATE,
    selectedStoryId: INITIAL_STORIES[0].id,
    commissions: [],
    dismissedCommissionMonth: null,
    lastVisitAt: null,
  };
}

const initial = loadInitialPayload();
const stories = ref<Story[]>(initial.stories);
const dailyState = ref<DailyState>(initial.dailyState);
const selectedStoryId = ref<string>(initial.selectedStoryId);
const activeTab = ref<ViewTab>('active');
const isNewStoryOpen = ref(false);
const isGeneratingCandidates = ref(false);
const generationError = ref<string | null>(null);
const activeStoriesViewRef = ref<InstanceType<typeof ActiveStoriesView> | null>(null);

const currentMonthKey = getCurrentMonthKey();
const currentMonthLabel = getCurrentMonthLabel();
const currentSeason = getSeasonForMonthKey(currentMonthKey);

const previousVisitTimestamp = initial.lastVisitAt ? Date.parse(initial.lastVisitAt) : NaN;
const previousVisitDate = Number.isFinite(previousVisitTimestamp)
  ? new Date(previousVisitTimestamp)
  : null;
const daysAway = previousVisitDate
  ? Math.max(0, Math.floor((Date.now() - previousVisitDate.getTime()) / 86_400_000))
  : 0;
const previousMonthKey = previousVisitDate ? getCurrentMonthKey(previousVisitDate) : null;
const monthChangedDuringPause = previousMonthKey !== null && previousMonthKey !== currentMonthKey;

const commissions = ref<CommissionRecord[]>(initial.commissions ?? []);
const dismissedCommissionMonth = ref<string | null>(
  initial.dismissedCommissionMonth ?? null
);
const isCommissionDeskOpen = ref(false);
const isCommissioning = ref(false);
const commissionError = ref<string | null>(null);
const isInterregnumOpen = ref(false);
const pauseNoticeVisible = ref(daysAway === 7);
const commissionGenre = useWritable(commissionGenreAtom, 'commissionGenre');

watch(
  [stories, dailyState, selectedStoryId, commissions, dismissedCommissionMonth],
  () => {
    try {
      const payload: PersistedPayload = {
        stories: stories.value,
        dailyState: dailyState.value,
        selectedStoryId: selectedStoryId.value,
        commissions: commissions.value,
        dismissedCommissionMonth: dismissedCommissionMonth.value,
        lastVisitAt: new Date().toISOString(),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors in restricted environments
    }
  },
  { deep: true, immediate: true }
);

const currentCommission = computed(
  () => commissions.value.find((record) => record.monthKey === currentMonthKey) || null
);

const currentMonthIssue = computed(
  () => stories.value.find((story) => story.monthKey === currentMonthKey) || null
);

const pauseFocusStory = computed<Story | null>(() => {
  if (currentMonthIssue.value) return currentMonthIssue.value;
  const selected = stories.value.find((story) => story.id === selectedStoryId.value);
  if (selected && selected.status === 'active') return selected;
  return stories.value.find((story) => story.status === 'active') || stories.value[0] || null;
});

const slushPitches = computed<SlushPitch[]>(() => {
  const entries: SlushPitch[] = [];
  for (const record of commissions.value) {
    const revived = record.revivedPitchIds || [];
    for (const pitch of record.pitches) {
      if (pitch.id === record.chosenPitchId) continue;
      if (revived.includes(pitch.id)) continue;
      entries.push({
        pitch,
        sourceMonthKey: record.monthKey,
        sourceMonthLabel: formatMonthKey(record.monthKey),
      });
    }
  }
  return entries.sort((a, b) => b.sourceMonthKey.localeCompare(a.sourceMonthKey));
});

const previousVolumeSummary = computed(() => {
  const completed = [...stories.value.filter((story) => story.status === 'completed')].sort(
    (a, b) => (b.monthKey || '').localeCompare(a.monthKey || '')
  );
  const latest = completed[0];
  if (!latest) return '';
  const lastSentence = latest.sentences[latest.sentences.length - 1];
  return `"${latest.title}" (${latest.genre}): ${latest.subtitle}${
    lastSentence ? ` Last canon sentence: "${lastSentence.text}"` : ''
  }`;
});

const handleWriteAction = () => {
  activeTab.value = 'active';
  setTimeout(() => {
    const targetId = dailyState.value.submittedStoryId ? 'drafts-section' : 'sentence-composer';
    const el = document.getElementById(targetId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (!dailyState.value.submittedStoryId) {
      activeStoriesViewRef.value?.focusComposer();
    }
  }, 60);
};

const handleUpdatePenName = (penName: string) => {
  dailyState.value = { ...dailyState.value, penName };
};

const handleSubmitCandidate = (
  storyId: string,
  text: string,
  paragraphBreakBefore: boolean
) => {
  if (dailyState.value.submittedStoryId !== null) return;

  const newCandidateId = `cand-${Date.now()}`;
  const newCandidate: CandidateSentence = {
    id: newCandidateId,
    text,
    author: dailyState.value.penName,
    submittedAt: 'Just now',
    paragraphBreakBefore,
    isUserSubmission: true,
  };

  stories.value = stories.value.map((story) =>
    story.id === storyId
      ? { ...story, candidates: [newCandidate, ...story.candidates] }
      : story
  );

  dailyState.value = {
    ...dailyState.value,
    submittedStoryId: storyId,
    submittedCandidateId: newCandidateId,
  };
};

const fetchAiCandidatesForStory = async (target: Story): Promise<CandidateSentence[]> => {
  const response = await fetch('/api/candidates/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: target.title,
      subtitle: target.subtitle,
      genre: target.genre,
      promptNote: target.promptNote,
      recentSentences: target.sentences.slice(-8).map((s) => ({
        author: s.author,
        text: s.text,
      })),
      existingCandidates: target.candidates.map((c) => c.text),
      contributorNames: target.contributors || [],
      count: 3,
    }),
  });

  const data = (await response.json()) as {
    candidates?: IncomingAiCandidate[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }

  const incoming = Array.isArray(data.candidates) ? data.candidates : [];
  if (incoming.length === 0) {
    throw new Error('No candidate sentences were returned by the model.');
  }

  const now = Date.now();
  return incoming.map((item, idx) => ({
    id: `ai-${now}-${idx}`,
    author: item.author,
    voiceStyle: item.voiceStyle,
    modelUsed: item.modelUsed,
    text: item.text,
    submittedAt: 'Just now',
    paragraphBreakBefore: Boolean(item.paragraphBreakBefore),
    isAiGenerated: true,
  }));
};

const handleGenerateAiCandidates = async (storyId: string) => {
  const target = stories.value.find((s) => s.id === storyId);
  if (!target || isGeneratingCandidates.value) return;

  isGeneratingCandidates.value = true;
  generationError.value = null;

  try {
    const created = await fetchAiCandidatesForStory(target);
    stories.value = stories.value.map((story) =>
      story.id === storyId ? { ...story, candidates: [...created, ...story.candidates] } : story
    );
  } catch (err: unknown) {
    generationError.value =
      err instanceof Error ? err.message : 'Unable to draft candidate sentences.';
  } finally {
    isGeneratingCandidates.value = false;
  }
};

const handleSelectAndCanonize = (storyId: string, candidateId: string) => {
  const target = stories.value.find((s) => s.id === storyId);
  if (!target || target.status !== 'active') return;

  const chosen = target.candidates.find((c) => c.id === candidateId);
  if (!chosen) return;

  const newSentence: CanonSentence = {
    id: `${target.id}-day-${target.currentDay}`,
    day: target.currentDay,
    text: chosen.text,
    author: chosen.author,
    canonizedAt: `Day ${target.currentDay}`,
    paragraphBreakBefore: chosen.paragraphBreakBefore,
    modelUsed: chosen.modelUsed,
  };

  const isNowComplete = target.currentDay >= target.maxDays;
  const nextDay = isNowComplete ? target.maxDays : target.currentDay + 1;

  stories.value = stories.value.map((s) => {
    if (s.id !== storyId) return s;
    return {
      ...s,
      status: isNowComplete ? 'completed' : 'active',
      currentDay: nextDay,
      sentences: [...s.sentences, newSentence],
      candidates: [],
    };
  });

  dailyState.value = {
    ...dailyState.value,
    waitingStoryIds: isNowComplete
      ? (dailyState.value.waitingStoryIds || []).filter((id) => id !== storyId)
      : Array.from(new Set([...(dailyState.value.waitingStoryIds || []), storyId])),
    lastCanonizedEvent: {
      storyTitle: target.title,
      sentenceText: chosen.text,
      author: chosen.author,
      day: target.currentDay,
    },
  };

  if (isNowComplete) {
    activeTab.value = 'archive';
  }
};

const handleUnlockNextDayForStory = async (storyId: string, withAiDraft: boolean) => {
  const target = stories.value.find((s) => s.id === storyId);
  if (!target) return;

  generationError.value = null;

  let newCandidates: CandidateSentence[] = [];
  if (withAiDraft) {
    isGeneratingCandidates.value = true;
    try {
      newCandidates = await fetchAiCandidatesForStory({
        ...target,
        candidates: [],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to draft candidate sentences.';
      generationError.value = msg;
    } finally {
      isGeneratingCandidates.value = false;
    }
  }

  if (newCandidates.length > 0) {
    stories.value = stories.value.map((s) =>
      s.id === storyId ? { ...s, candidates: newCandidates } : s
    );
  }

  dailyState.value = {
    ...dailyState.value,
    simulatedDayOffset: dailyState.value.simulatedDayOffset + 1,
    submittedStoryId:
      dailyState.value.submittedStoryId === storyId ? null : dailyState.value.submittedStoryId,
    waitingStoryIds: (dailyState.value.waitingStoryIds || []).filter((id) => id !== storyId),
  };
};

/** Local demo commissions keep the monthly ritual working without a server. */
const fallbackCommissionPitches = (): StoryPitch[] => {
  const monthNumber = Number(currentMonthKey.split('-')[1]) || 0;
  const rotation = monthNumber % DEMO_COMMISSION_PITCHES.length;
  const rotated = [
    ...DEMO_COMMISSION_PITCHES.slice(rotation),
    ...DEMO_COMMISSION_PITCHES.slice(0, rotation),
  ];
  const matching = rotated.filter((pitch) => pitch.genre === commissionGenre.value);
  const others = rotated.filter((pitch) => !matching.includes(pitch));
  return [...matching, ...others]
    .slice(0, 3)
    .map((pitch, idx) => ({
      ...pitch,
      id: `${currentMonthKey}-demo-${idx}`,
    }));
};

const fetchCommissionPitches = async (): Promise<{
  pitches: StoryPitch[];
  source: 'llm' | 'demo';
}> => {
  let response: Response;
  try {
    response = await fetch('/api/volume/commission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monthKey: currentMonthKey,
        monthLabel: currentMonthLabel,
        season: currentSeason,
        genrePreference: commissionGenre.value === 'Surprise me' ? '' : commissionGenre.value,
        previousVolumeSummary: previousVolumeSummary.value,
      }),
    });
  } catch {
    // Static monorepo builds have no commission endpoint; file the demo desk
    // instead of surfacing a transport error.
    return { pitches: fallbackCommissionPitches(), source: 'demo' };
  }
  if (response.status === 404) {
    return { pitches: fallbackCommissionPitches(), source: 'demo' };
  }

  const data = (await response.json().catch(() => undefined)) as {
    pitches?: StoryPitch[];
    source?: 'llm' | 'demo';
    error?: string;
  } | undefined;
  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }
  if (!data) throw new Error('The commission desk returned an unreadable response.');

  const pitches = Array.isArray(data.pitches) ? data.pitches : [];
  if (pitches.length === 0) {
    throw new Error('The commission desk returned no pitches.');
  }

  return {
    pitches: pitches.map((pitch, idx) => ({
      ...pitch,
      id: pitch.id || `${currentMonthKey}-pitch-${idx}`,
      plate: Math.max(0, Math.min(2, Number(pitch.plate) || 0)),
      maxDays: Math.max(14, Math.min(28, Number(pitch.maxDays) || 21)),
      contributors: Array.isArray(pitch.contributors) ? pitch.contributors : [],
    })),
    source: data.source === 'demo' ? 'demo' : 'llm',
  };
};

const upsertCommission = (record: CommissionRecord) => {
  commissions.value = [
    record,
    ...commissions.value.filter((existing) => existing.monthKey !== record.monthKey),
  ];
};

const handleRequestCommissions = async () => {
  if (isCommissioning.value || currentCommission.value || currentMonthIssue.value) return;

  isCommissioning.value = true;
  commissionError.value = null;

  try {
    const { pitches, source } = await fetchCommissionPitches();
    upsertCommission({
      monthKey: currentMonthKey,
      pitches,
      chosenPitchId: null,
      requestedGenre: commissionGenre.value,
      source,
      generatedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    commissionError.value =
      err instanceof Error ? err.message : 'Unable to commission a new issue.';
  } finally {
    isCommissioning.value = false;
  }
};

const handleUseFallbackCommissions = () => {
  const pitches = fallbackCommissionPitches();
  upsertCommission({
    monthKey: currentMonthKey,
    pitches,
    chosenPitchId: null,
    requestedGenre: commissionGenre.value,
    source: 'demo',
    generatedAt: new Date().toISOString(),
  });
  commissionError.value = null;
};

const handleStartCommission = (pitch: StoryPitch, sourceMonthKey: string) => {
  if (currentMonthIssue.value) return;

  const id = `story-${Date.now()}`;
  const coverImage = PLATE_IMAGES[pitch.plate] || PLATE_IMAGES[0];
  const newStory: Story = {
    id,
    issueNumber: `${currentMonthLabel} · Monthly Issue`,
    title: pitch.title,
    subtitle: pitch.subtitle,
    genre: pitch.genre,
    status: 'active',
    currentDay: 2,
    maxDays: pitch.maxDays,
    coverImage,
    coverCaption: pitch.coverCaption,
    promptNote: pitch.promptNote,
    sentences: [
      {
        id: `${id}-s1`,
        day: 1,
        text: pitch.openingSentence,
        author: 'The Commission',
            canonizedAt: 'Day 1 (Opening)',
      },
    ],
    candidates: [],
    monthKey: currentMonthKey,
    constraint: pitch.constraint,
    contributors: pitch.contributors,
  };

  stories.value = [newStory, ...stories.value];
  selectedStoryId.value = id;
  activeTab.value = 'active';

  commissions.value = commissions.value.map((record) => {
    if (record.monthKey !== sourceMonthKey) return record;
    if (sourceMonthKey === currentMonthKey) {
      return { ...record, chosenPitchId: pitch.id };
    }
    return {
      ...record,
      revivedPitchIds: [...(record.revivedPitchIds || []), pitch.id],
    };
  });

  isCommissionDeskOpen.value = false;
  dismissedCommissionMonth.value = currentMonthKey;
};

const handleRevivePitch = (pitch: StoryPitch, sourceMonthKey: string) => {
  handleStartCommission(pitch, sourceMonthKey);
};

const openCommissionDesk = () => {
  isCommissionDeskOpen.value = true;
  commissionError.value = null;
};

const handleCloseCommissionDesk = () => {
  isCommissionDeskOpen.value = false;
  dismissedCommissionMonth.value = currentMonthKey;
};

const dismissPauseNotice = () => {
  pauseNoticeVisible.value = false;
};

const handleInterregnumClose = () => {
  isInterregnumOpen.value = false;
};

const handlePauseOpenDesk = () => {
  pauseNoticeVisible.value = false;
  isInterregnumOpen.value = false;
  openCommissionDesk();
};

const handleInterregnumOpenArchive = () => {
  isInterregnumOpen.value = false;
  pauseNoticeVisible.value = false;
  activeTab.value = 'archive';
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

const handleOpenCurrentIssue = () => {
  if (!currentMonthIssue.value) return;
  if (currentMonthIssue.value.status === 'completed') {
    activeTab.value = 'archive';
  } else {
    selectedStoryId.value = currentMonthIssue.value.id;
    activeTab.value = 'active';
  }
  isCommissionDeskOpen.value = false;
  dismissedCommissionMonth.value = currentMonthKey;
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

const handleOpenActiveStory = (storyId: string) => {
  selectedStoryId.value = storyId;
  activeTab.value = 'active';
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

onMounted(() => {
  // Under a week: no pause ritual. Exactly one week: a light desk note. Over a
  // week: the Interregnum. The Commission Desk never auto-opens on top of it.
  if (daysAway >= 7 && stories.value.length > 0) {
    if (daysAway > 7) {
      pauseNoticeVisible.value = false;
      isInterregnumOpen.value = true;
    }
    return;
  }

  if (!currentMonthIssue.value && dismissedCommissionMonth.value !== currentMonthKey) {
    isCommissionDeskOpen.value = true;
  }
});

const handleAdvanceDay = () => {
  let featuredEvent: DailyState['lastCanonizedEvent'] = null;
  const nextDayOffset = dailyState.value.simulatedDayOffset + 1;

  const updatedStories: Story[] = stories.value.map((story) => {
    if (story.status !== 'active') return story;

    // The editor's own sentence wins the day when present; otherwise the
    // first drafted continuation is canonized.
    const winner = story.candidates.find((candidate) => candidate.isUserSubmission) ?? story.candidates[0];

    let nextSentences = story.sentences;
    if (winner) {
      nextSentences = [
        ...story.sentences,
        {
          id: `${story.id}-day-${story.currentDay}`,
          day: story.currentDay,
          text: winner.text,
          author: winner.author,
          canonizedAt: `Day ${story.currentDay}`,
          paragraphBreakBefore: winner.paragraphBreakBefore,
        },
      ];

      if (story.id === selectedStoryId.value || !featuredEvent) {
        featuredEvent = {
          storyTitle: story.title,
          sentenceText: winner.text,
          author: winner.author,
          day: story.currentDay,
        };
      }
    }

    const isNowComplete = story.currentDay >= story.maxDays;
    const nextDay = isNowComplete ? story.maxDays : story.currentDay + 1;

    // Seed fresh next-day drafts for active stories
    let nextCandidates: CandidateSentence[] = [];
    if (!isNowComplete) {
      const pool = NEXT_DAY_CANDIDATE_POOL[story.id];
      if (pool && pool.length > 0) {
        const rotated = pool.map((entry, idx) => ({
          id: `${story.id}-d${nextDay}-c${idx}-${Date.now()}`,
          text: entry.text,
          author: entry.author,
          submittedAt: `${idx + 2}h ago`,
          paragraphBreakBefore: entry.paragraphBreakBefore,
        }));
        nextCandidates = rotated;
      }
    }

    return {
      ...story,
      status: isNowComplete ? 'completed' : 'active',
      currentDay: nextDay,
      sentences: nextSentences,
      candidates: nextCandidates,
    };
  });

  stories.value = updatedStories;

  // Ensure selected story remains active if possible
  const stillActive = updatedStories.find(
    (s) => s.id === selectedStoryId.value && s.status === 'active'
  );
  if (!stillActive) {
    const firstActive = updatedStories.find((s) => s.status === 'active');
    if (firstActive) selectedStoryId.value = firstActive.id;
  }

  dailyState.value = {
    ...dailyState.value,
    simulatedDayOffset: nextDayOffset,
    submittedStoryId: null,
    submittedCandidateId: null,
    waitingStoryIds: [],
    lastCanonizedEvent: featuredEvent,
  };
};

const handleCreateStory = (input: NewStoryInput) => {
  const id = `story-${Date.now()}`;
  const newStory: Story = {
    id,
    issueNumber: `Vol. IV · No. ${stories.value.length + 15}`,
    title: input.title,
    subtitle: input.subtitle,
    genre: input.genre,
    status: 'active',
    currentDay: 2,
    maxDays: input.maxDays,
    coverImage: input.coverImage,
    coverCaption: input.coverCaption,
    promptNote: input.promptNote,
    sentences: [
      {
        id: `${id}-s1`,
        day: 1,
        text: input.openingSentence,
        author: dailyState.value.penName,
            canonizedAt: 'Day 1 (Opening)',
      },
    ],
    candidates: [],
    monthKey: currentMonthKey,
  };

  stories.value = [newStory, ...stories.value];
  selectedStoryId.value = id;
  activeTab.value = 'active';
  dailyState.value = {
    ...dailyState.value,
    submittedStoryId: id,
    submittedCandidateId: null,
  };
};

const handleResetDemo = () => {
  // Finished editions are permanent reading artifacts: a demo reset restores
  // the seed workspace but never discards completed stories.
  const preservedCompleted = stories.value.filter(
    (story) =>
      story.status === 'completed' && !INITIAL_STORIES.some((seed) => seed.id === story.id)
  );

  window.localStorage.removeItem(STORAGE_KEY);
  stories.value = [...INITIAL_STORIES, ...preservedCompleted];
  dailyState.value = DEFAULT_DAILY_STATE;
  selectedStoryId.value = INITIAL_STORIES[0].id;
  activeTab.value = 'active';
  commissions.value = [];
  dismissedCommissionMonth.value = null;
  isCommissionDeskOpen.value = false;
  isCommissioning.value = false;
  commissionError.value = null;
  isInterregnumOpen.value = false;
  pauseNoticeVisible.value = false;
};

const handleDismissLastCanonized = () => {
  dailyState.value = { ...dailyState.value, lastCanonizedEvent: null };
};

const submittedStoryTitle = computed(
  () => stories.value.find((s) => s.id === dailyState.value.submittedStoryId)?.title
);
</script>

<template>
  <div class="min-h-screen flex flex-col bg-[#FBF9F5] text-[#1C1917]">
    <HeaderBar
      :active-tab="activeTab"
      :has-submitted-today="dailyState.submittedStoryId !== null"
      @select-tab="activeTab = $event"
      @write-action="handleWriteAction"
    />

    <WorkspaceToolbar
      :pen-name="dailyState.penName"
      :has-submitted-today="dailyState.submittedStoryId !== null"
      :submitted-story-title="submittedStoryTitle"
      :simulated-day-offset="dailyState.simulatedDayOffset"
      @update-pen-name="handleUpdatePenName"
      @advance-day="handleAdvanceDay"
      @reset-demo="handleResetDemo"
      @open-new-story="isNewStoryOpen = true"
      @open-commission-desk="openCommissionDesk"
    />

    <DeskNote
      v-if="pauseNoticeVisible && stories.length > 0 && !isCommissionDeskOpen && !isInterregnumOpen"
      :days-away="daysAway"
      :story="pauseFocusStory"
      :month-label="currentMonthLabel"
      :has-current-issue="Boolean(currentMonthIssue)"
      @dismiss="dismissPauseNotice"
      @open-commission-desk="handlePauseOpenDesk"
    />

    <main class="flex-1">
      <ActiveStoriesView
        v-if="activeTab === 'active'"
        ref="activeStoriesViewRef"
        :stories="stories"
        :selected-story-id="selectedStoryId"
        :daily-state="dailyState"
        @select-story="selectedStoryId = $event"
        @select-and-canonize="handleSelectAndCanonize"
        @submit-candidate="handleSubmitCandidate"
        @generate-ai-candidates="handleGenerateAiCandidates"
        @unlock-next-day-for-story="handleUnlockNextDayForStory"
        :is-generating-candidates="isGeneratingCandidates"
        :generation-error="generationError"
        @dismiss-generation-error="generationError = null"
        @advance-day="handleAdvanceDay"
        @dismiss-last-canonized="handleDismissLastCanonized"
      />

      <CanonArchiveView
        v-if="activeTab === 'archive'"
        :stories="stories"
        @open-active-story="handleOpenActiveStory"
      />

      <GuideView v-if="activeTab === 'guide'" @go-to-active="activeTab = 'active'" />
    </main>

    <footer class="border-t border-[#E5DFD3] bg-[#F7F4EE]">
      <div class="max-w-[1200px] mx-auto px-4 sm:px-8 py-6 flex flex-wrap items-center justify-between gap-4 text-xs text-[#78716C]">
        <span class="font-display text-sm text-[#1C1917]">One Sentence Each</span>
        <div class="flex flex-wrap items-center gap-4">
          <button
            type="button"
            @click="activeTab = 'active'"
            class="hover:text-[#1C1917] cursor-pointer"
          >
            Active Stories
          </button>
          <button
            type="button"
            @click="activeTab = 'archive'"
            class="hover:text-[#1C1917] cursor-pointer"
          >
            Canon Archive
          </button>
          <button
            type="button"
            @click="activeTab = 'guide'"
            class="hover:text-[#1C1917] cursor-pointer"
          >
            Editorial Charter
          </button>
        </div>
      </div>
    </footer>

    <NewStoryModal
      :is-open="isNewStoryOpen"
      :pen-name="dailyState.penName"
      :has-submitted-today="dailyState.submittedStoryId !== null"
      @close="isNewStoryOpen = false"
      @create-story="handleCreateStory"
    />

    <InterregnumView
      :is-open="isInterregnumOpen"
      :days-away="daysAway"
      :month-label="currentMonthLabel"
      :month-changed="monthChangedDuringPause"
      :story="pauseFocusStory"
      :has-current-issue="Boolean(currentMonthIssue)"
      @close="handleInterregnumClose"
      @open-commission-desk="handlePauseOpenDesk"
      @open-archive="handleInterregnumOpenArchive"
    />

    <CommissionDesk
      :is-open="isCommissionDeskOpen"
      :month-label="currentMonthLabel"
      :record="currentCommission"
      :current-issue="currentMonthIssue"
      :slush="slushPitches"
      :is-generating="isCommissioning"
      :error="commissionError"
      :genre="commissionGenre"
      @update-genre="commissionGenre = $event"
      @close="handleCloseCommissionDesk"
      @request="handleRequestCommissions"
      @use-fallback="handleUseFallbackCommissions"
      @start-pitch="handleStartCommission"
      @revive-pitch="handleRevivePitch"
      @open-issue="handleOpenCurrentIssue"
    />
  </div>
</template>
