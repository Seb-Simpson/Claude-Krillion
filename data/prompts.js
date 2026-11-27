// Outlier prompt database — assembled from one file per category.
// Each answer is [canonicalName, pop, ...aliases]; pop = estimated % of
// ordinary English-speaking adults who would name it (1–100).
import foodDrink from './categories/food-drink.js';
import animals from './categories/animals.js';
import geography from './categories/geography.js';
import scienceNature from './categories/science-nature.js';
import sport from './categories/sport.js';
import filmTv from './categories/film-tv.js';
import music from './categories/music.js';
import wordsLanguage from './categories/words-language.js';
import historyPeople from './categories/history-people.js';
import everydayThings from './categories/everyday-things.js';
import bodyHealth from './categories/body-health.js';
import artsCulture from './categories/arts-culture.js';
import gamesToys from './categories/games-toys.js';
import tech from './categories/tech.js';

export const CATEGORIES = [
  'Food & Drink',
  'Animals',
  'Geography',
  'Science & Nature',
  'Sport',
  'Film & TV',
  'Music',
  'Words & Language',
  'History & People',
  'Everyday Things',
  'Body & Health',
  'Arts & Culture',
  'Games & Toys',
  'Tech',
];

export const PROMPTS = [
  ...foodDrink,
  ...animals,
  ...geography,
  ...scienceNature,
  ...sport,
  ...filmTv,
  ...music,
  ...wordsLanguage,
  ...historyPeople,
  ...everydayThings,
  ...bodyHealth,
  ...artsCulture,
  ...gamesToys,
  ...tech,
];
