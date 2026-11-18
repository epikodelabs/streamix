export type ViewTab = 'active' | 'archive' | 'guide';

export interface CanonSentence {
  id: string;
  day: number;
  text: string;
  author: string;
  canonizedAt: string;
  paragraphBreakBefore?: boolean;
  modelUsed?: string;
}

export interface CandidateSentence {
  id: string;
  text: string;
  author: string;
  submittedAt: string;
  paragraphBreakBefore?: boolean;
  isUserSubmission?: boolean;
  isAiGenerated?: boolean;
  voiceStyle?: string;
  modelUsed?: string;
}

export interface Story {
  id: string;
  issueNumber: string;
  title: string;
  subtitle: string;
  genre: string;
  status: 'active' | 'completed';
  currentDay: number;
  maxDays: number;
  coverImage: string;
  coverCaption: string;
  promptNote: string;
  sentences: CanonSentence[];
  candidates: CandidateSentence[];
  monthKey?: string;
  constraint?: string;
  contributors?: string[];
}

export interface StoryPitch {
  id: string;
  title: string;
  subtitle: string;
  genre: string;
  constraint: string;
  openingSentence: string;
  promptNote: string;
  maxDays: number;
  contributors: string[];
  coverCaption: string;
  plate: number;
}

export interface CommissionRecord {
  monthKey: string;
  pitches: StoryPitch[];
  chosenPitchId: string | null;
  revivedPitchIds?: string[];
  requestedGenre?: string;
  source: 'llm' | 'demo';
  generatedAt: string;
}

export interface SlushPitch {
  pitch: StoryPitch;
  sourceMonthKey: string;
  sourceMonthLabel: string;
}

export interface DailyState {
  simulatedDayOffset: number;
  penName: string;
  submittedStoryId: string | null;
  submittedCandidateId: string | null;
  waitingStoryIds: string[];
  lastCanonizedEvent: {
    storyTitle: string;
    sentenceText: string;
    author: string;
    day: number;
  } | null;
}
