import office from './office.js';
import b1 from './b1.js';
import b2 from './b2.js';
import b3 from './b3.js';
import b4 from './b4.js';
import b5 from './b5.js';

export const LEVELS = [office, b1, b2, b3, b4, b5];
export const LEVEL_BY_ID = Object.fromEntries(LEVELS.map((l) => [l.id, l]));
