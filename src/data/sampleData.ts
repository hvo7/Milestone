import type { Questline } from '../types';

export const sampleData: Questline[] = [
  {
    id: 'ql-1',
    title: 'Learning & Growth',
    description: 'Pick a skill and take it from beginner to confident through steady, deliberate practice.',
    icon: '📚',
    color: 'violet',
    quests: [
      {
        id: 'q-1-1',
        title: 'Get started',
        description: 'Lay the foundations: pick a focus, gather resources, and build the habit.',
        order: 1,
        actions: [
          { id: 'a-1', title: 'Choose a skill to focus on', completed: true },
          { id: 'a-2', title: 'Collect learning resources (courses, books, videos)', completed: true },
          { id: 'a-3', title: 'Set up a daily one-hour study block', completed: false },
        ],
      },
      {
        id: 'q-1-2',
        title: 'Practice deliberately',
        description: 'Knowledge sticks when you apply it. Turn study into real output.',
        order: 2,
        actions: [
          { id: 'a-4', title: 'Finish the foundational course or book', completed: false },
          { id: 'a-5', title: 'Build a small project using what you learned', completed: false },
          { id: 'a-6', title: 'Get feedback from a mentor or peer', completed: false },
        ],
      },
      {
        id: 'q-1-3',
        title: 'Level up',
        description: 'Prove your skills with advanced work — and teach others along the way.',
        order: 3,
        actions: [
          { id: 'a-7', title: 'Complete an advanced project or certification', completed: false },
          { id: 'a-8', title: 'Write about or teach what you learned', completed: false },
          { id: 'a-9', title: 'Contribute to a community or open project', completed: false },
        ],
      },
    ],
  },
  {
    id: 'ql-2',
    title: 'Health & Fitness',
    description: 'Build a sustainable training habit and steadily raise the bar.',
    icon: '💪',
    color: 'crimson',
    quests: [
      {
        id: 'q-2-1',
        title: 'Build the habit',
        description: 'Start small and stay consistent — the routine matters more than the intensity.',
        order: 1,
        actions: [
          { id: 'a-10', title: 'Set a consistent weekly training schedule', completed: false },
          { id: 'a-11', title: 'Learn proper form for the core movements', completed: false },
          { id: 'a-12', title: 'Start tracking nutrition and sleep', completed: false },
        ],
      },
      {
        id: 'q-2-2',
        title: 'Stay consistent',
        description: 'Consistency compounds. Hit your first streak and first milestone.',
        order: 2,
        actions: [
          { id: 'a-13', title: 'Hit your first milestone goal', completed: false },
          { id: 'a-14', title: 'Keep a 30-day training streak', completed: false },
          { id: 'a-15', title: 'Get advice from a coach or experienced friend', completed: false },
        ],
      },
      {
        id: 'q-2-3',
        title: 'Push further',
        description: 'Set an ambitious target and go get it.',
        order: 3,
        actions: [
          { id: 'a-16', title: 'Complete a big challenge or event (race, comp, PR)', completed: false },
          { id: 'a-17', title: 'Help someone else get started', completed: false },
        ],
      },
    ],
  },
  {
    id: 'ql-3',
    title: 'Personal Finance',
    description: 'Understand your money, build a safety net, and put savings to work.',
    icon: '💰',
    color: 'amber',
    quests: [
      {
        id: 'q-3-1',
        title: 'Know your numbers',
        description: 'You can\'t improve what you don\'t measure. Get a clear picture first.',
        order: 1,
        actions: [
          { id: 'a-18', title: 'Track every source of income and spending', completed: false },
          { id: 'a-19', title: 'Create a monthly budget', completed: false },
          { id: 'a-20', title: 'Pay off high-interest debt first', completed: false },
        ],
      },
      {
        id: 'q-3-2',
        title: 'Build the safety net',
        description: 'Savings buy you options. Start the emergency fund, then start investing.',
        order: 2,
        actions: [
          { id: 'a-21', title: 'Save a 3-month emergency fund', completed: false },
          { id: 'a-22', title: 'Open your first investment account', completed: false },
          { id: 'a-23', title: 'Learn the basics of long-term investing', completed: false },
        ],
      },
      {
        id: 'q-3-3',
        title: 'Grow long-term',
        description: 'Real wealth is freedom — measured in options, not just numbers.',
        order: 3,
        actions: [
          { id: 'a-24', title: 'Start a second income stream', completed: false },
          { id: 'a-25', title: 'Map out a path to financial independence', completed: false },
          { id: 'a-26', title: 'Review insurance and protect what you\'ve built', completed: false },
        ],
      },
    ],
  },
];
