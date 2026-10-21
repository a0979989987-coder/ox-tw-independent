import test from 'node:test';
import assert from 'node:assert/strict';
import { isSwipe } from '../src/app/swipe-views.js';

test('a quick flick or a long drag switches; slow short moves and diagonal scrolls do not', () => {
  assert.equal(isSwipe(-70, 5, 150), true, 'quick 70px flick');
  assert.equal(isSwipe(-130, 20, 600), true, 'long slow drag');
  assert.equal(isSwipe(-70, 5, 500), false, 'slow 70px move while reading');
  assert.equal(isSwipe(-50, 0, 80), false, 'too short');
  assert.equal(isSwipe(-130, 100, 300), false, 'mostly a vertical scroll');
  assert.equal(isSwipe(-200, 10, 1200), false, 'held too long');
});
