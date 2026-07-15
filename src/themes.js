/**
 * One theme per chapter: the backdrop gradient, the frame accent, and the chapter's own
 * location strip, which is the text in the header bar.
 *
 * Backdrops are gradients only. The game also drifts a pattern of shapes over each
 * chapter's screen; that isn't reproduced, since it can't be done faithfully, and an
 * approximation of it reads worse than a clean gradient.
 *
 * Only the page chrome changes between chapters. The ending screen itself is always black
 * with white/red text, so the canvas is deliberately untouched.
 *
 * Order is chapter order; Blackout is chapter 07 and the default, so clicking
 * the chapter name wraps from it round to 00.
 */

export const THEMES = [
  {
    id: 'prototype',
    chapter: '00',
    name: 'prototype',
    crumbs: ['25th Ward', 'Area A2', 'High-rise Apartment'],
    backdrop: 'radial-gradient(ellipse at 50% 40%, #9a9a9a 0%, #6f6f6f 70%, #4c4c4c 100%)',
    vars: {
      '--accent': '#ec74b2',
      '--accent-2': '#d0d0d0',
      '--accent-soft': '#6d4155',
      '--ink': '#f2f2f2',
      '--dim': '#a8a8a8',
    },
  },
  {
    id: 'new-world-order',
    chapter: '01',
    name: 'new world order',
    crumbs: ['25th Ward', 'Area A1', 'Seaside Park'],
    backdrop: 'linear-gradient(to bottom, #16265f 0%, #3a2a5c 45%, #6b2438 100%)',
    vars: {
      '--accent': '#e2472a',
      '--accent-2': '#3f56a8',
      '--accent-soft': '#5c2a3e',
      '--ink': '#eceaf2',
      '--dim': '#8d8fae',
    },
  },
  {
    id: 'good-looking-guy',
    chapter: '02',
    name: 'good looking guy',
    crumbs: ['25th Ward', 'Area B3', 'Multi-tenant Building', 'Manga Cafe'],
    backdrop: 'linear-gradient(to bottom, #cdbd8f 0%, #9dae9a 45%, #4c9c8b 100%)',
    vars: {
      '--accent': '#f4f4ee',
      '--accent-2': '#3f8d7f',
      '--accent-soft': '#7d8a86',
      '--ink': '#f6f6f1',
      '--dim': '#c8c6b4',
    },
  },
  {
    id: 'boys-dont-cry',
    chapter: '03',
    name: "boys don't cry",
    crumbs: ['25th Ward', 'Area B1', 'ATM'],
    backdrop: 'linear-gradient(to bottom, #7b4de0 0%, #8f77c8 50%, #8ec98a 100%)',
    vars: {
      '--accent': '#f2e34a',
      '--accent-2': '#7b4de0',
      '--accent-soft': '#6a6340',
      '--ink': '#f7f7f2',
      '--dim': '#c3b9e4',
    },
  },
  {
    id: 'digital-man',
    chapter: '04',
    name: 'digital man',
    crumbs: ['24th Ward', 'Area E2', "Kurumizawa's Room"],
    backdrop:
      'radial-gradient(ellipse at 75% 35%, rgba(70,120,90,0.5) 0%, transparent 55%),' +
      'radial-gradient(ellipse at 20% 70%, rgba(60,80,130,0.45) 0%, transparent 60%),' +
      'linear-gradient(to bottom, #0b1020 0%, #101a24 100%)',
    vars: {
      '--accent': '#9fdcc0',
      '--accent-2': '#3f5f8c',
      '--accent-soft': '#33544a',
      '--ink': '#e9eef1',
      '--dim': '#7c8b96',
    },
  },
  {
    id: 'electride',
    chapter: '05',
    name: 'electride',
    crumbs: ['24th Ward', 'Area A1', 'City Hall', "Mayor's Office"],
    backdrop: '#000',
    vars: {
      '--accent': '#e02b2b',
      '--accent-2': '#4c8f7a',
      '--accent-soft': '#4a1616',
      '--ink': '#e6e6e6',
      '--dim': '#7e6c6c',
    },
  },
  {
    id: 'white-out',
    chapter: '06',
    name: 'white out',
    crumbs: ['24th Ward', 'Area D3', 'Hachisuka Dome'],
    backdrop: 'linear-gradient(to bottom, #7ed0d8 0%, #66b3dc 55%, #4f9ad6 100%)',
    vars: {
      '--accent': '#ffffff',
      '--accent-2': '#2f7fc0',
      '--accent-soft': '#8fc4e4',
      '--ink': '#ffffff',
      '--dim': '#d8ecf8',
    },
  },
  {
    id: 'blackout',
    chapter: '07',
    name: 'black out',
    crumbs: ['25th Ward', 'Area A4', 'Construction Site'],
    backdrop: '#000',
    // black out is monochrome: black and grey, no colour anywhere in the chrome
    vars: {
      '--accent': '#b8b8b8',
      '--accent-2': '#5e5e5e',
      '--accent-soft': '#2c2c2c',
      '--ink': '#dcdcdc',
      '--dim': '#6f6f6f',
    },
  },
];

export const DEFAULT_THEME = THEMES.findIndex((theme) => theme.id === 'blackout');
