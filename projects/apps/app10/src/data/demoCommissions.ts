import type { StoryPitch } from '../types/story';

export const PLATE_IMAGES = [
  '/src/assets/images/story_salt_clock_1794937954288.jpg',
  '/src/assets/images/story_unclaimed_letters_1794937953591.jpg',
  '/src/assets/images/story_glasshouse_train_1794937954280.jpg',
];

// Hand-written commissions used when the Gemini API is unavailable, so the
// monthly ritual still works in a keyless local demo.
export const DEMO_COMMISSION_PITCHES: Array<Omit<StoryPitch, 'id'>> = [
  {
    title: 'The Lantern Exchange',
    subtitle:
      'A lighthouse keeper begins receiving letters addressed to a ship that sank before he was born.',
    genre: 'Maritime Mystery',
    constraint: 'Every sentence must mention a source of light; no scene may move indoors.',
    openingSentence:
      'On the first fogless night in forty years, every lamp along the seawall was found burning at noon.',
    promptNote:
      'Keep the prose salt-worn and patient. Favor physical objects over explanation; let the mystery arrive by post.',
    maxDays: 21,
    contributors: ['M. Lindqvist', 'Nadia Okafor', 'Clara Byrne', 'Julian Mercer'],
    coverCaption: 'Plate I — The seawall at noon, every lamp lit.',
    plate: 0,
  },
  {
    title: 'The Bureau of Borrowed Weather',
    subtitle:
      'A municipal office leases tomorrow’s weather to citizens who can prove they deserve it.',
    genre: 'Speculative Fiction',
    constraint: 'No dialogue; the story may speak only through forms, ledgers, and weather.',
    openingSentence:
      'The clerk who recorded the weather had been dead since spring, yet the forms kept arriving in his hand.',
    promptNote:
      'Balance bureaucratic exactness with quiet surrealism; every absurd rule should be applied with a straight face.',
    maxDays: 21,
    contributors: ['S. Takahashi', 'Elena Rostova', 'Nadia Okafor', 'M. Lindqvist'],
    coverCaption: 'Plate III — The weather ledgers, stamped and overdue.',
    plate: 2,
  },
  {
    title: 'The Last Unclaimed Piano',
    subtitle:
      'A dead-letter room receives a piano nobody will claim, and its keys begin returning lost messages.',
    genre: 'Urban Realism',
    constraint:
      'From Day 10 onward, every sentence must return to an object introduced earlier in the story.',
    openingSentence:
      'The piano arrived at the dead-letter office without a stamp, a crate, or an explanation, and Miriam signed for it anyway.',
    promptNote:
      'Work in small bureaucratic gestures and handwriting quirks; let the piano remain stubbornly ordinary.',
    maxDays: 21,
    contributors: ['Clara Byrne', 'Julian Mercer', 'S. Takahashi', 'Elena Rostova'],
    coverCaption: 'Plate II — Sorting wall B-14, now with one piano.',
    plate: 1,
  },
  {
    title: 'The Winter Orchard',
    subtitle:
      'A fruit-grower keeps a ledger of trees that flower out of season, and one entry is written in her late husband’s hand.',
    genre: 'Literary Fiction',
    constraint: 'Every sentence must name a plant or a month; no scene may take place at night.',
    openingSentence:
      'In the third week of January, the quince trees behind the packing shed bloomed, and Ilse wrote the date beside her husband’s name.',
    promptNote:
      'Favor quiet domestic detail, seasonal texture, and unspoken grief over plot mechanics.',
    maxDays: 21,
    contributors: ['Clara Byrne', 'M. Lindqvist', 'Elena Rostova', 'Julian Mercer'],
    coverCaption: 'Plate I — The orchard ledger, open at the third week of January.',
    plate: 0,
  },
  {
    title: 'Letters from the Night Shift',
    subtitle:
      'The overnight staff of a vanished hotel leave letters for guests who will never check in.',
    genre: 'Epistolary',
    constraint:
      'The story may only be told through letters, notices, and marginalia; no omniscient narration.',
    openingSentence:
      'The first letter was addressed to Room 214 and left in the key cubby by a clerk who had clocked out in 1978.',
    promptNote:
      'Let bureaucratic formality slowly give way to intimacy; handle shifts in handwriting as shifts in voice.',
    maxDays: 21,
    contributors: ['Elena Rostova', 'S. Takahashi', 'Clara Byrne', 'Nadia Okafor'],
    coverCaption: 'Plate II — The key cubby, one letter deep.',
    plate: 1,
  },
];
