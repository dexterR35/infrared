import {expect, it} from 'vitest';
import {businessGoals} from '../packages/domain/business-goals.js';
import {semanticElementTypes} from '../packages/domain/element-types.js';
import {industryFor, industryProfiles, rankGoals} from '../packages/domain/industry-profiles.js';

it('uses only registered goals and element types and keeps aliases unambiguous', () => {
  const aliases = industryProfiles.flatMap((p) => p.aliases);
  expect(new Set(aliases).size).toBe(aliases.length);
  for (const p of industryProfiles) {
    expect(p.goals.length).toBeGreaterThan(0);
    for (const g of p.goals) expect(businessGoals).toContain(g);
    for (const e of p.elements) expect(semanticElementTypes).toContain(e);
  }
});

it('resolves free-form product labels, compound labels and unknown labels', () => {
  expect(industryFor('casino').id).toBe('gaming');
  expect(industryFor('Credits').id).toBe('financial');
  expect(industryFor('fashion-store').id).toBe('fashion');
  expect(industryFor('hotels_ro').id).toBe('travel');
  expect(industryFor('zz-unknown').id).toBe('general');
  expect(industryFor(undefined).id).toBe('general');
  expect(industryFor('casino').regulated).toBe(true);
  expect(industryFor('saas').regulated).toBe(false);
});

it('ranks recommended goals first without dropping any valid goal', () => {
  const {recommended, other} = rankGoals(businessGoals, industryFor('saas'));
  expect(recommended[0]).toBe('trial_started');
  expect([...recommended, ...other].sort()).toEqual([...businessGoals].sort());
});
