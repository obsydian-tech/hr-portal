import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_CODES, normaliseStage, openStages } from './recruitment-stages.mjs';

describe('normaliseStage', () => {
  it('leaves the six codes as they are', () => {
    for (const code of STAGE_CODES) assert.equal(normaliseStage(code), code);
  });
  it('reads every old stage name as the stage it became', () => {
    const became = {
      APPLICATION_REVIEW: 'APPLIED', PHONE_SCREENING: 'SCREENING', TECHNICAL_INTERVIEW: 'INTERVIEW', PANEL_INTERVIEW: 'INTERVIEW',
      INTERVIEWING: 'INTERVIEW', EVALUATION: 'INTERVIEW', BACKGROUND_CHECK: 'OFFER', OFFER_PREPARATION: 'OFFER',
      OFFER_APPROVAL: 'OFFER', OFFER_DELIVERY: 'OFFER', CONTRACT_SIGNING: 'HIRED', PRE_BOARDING: 'HIRED', ONBOARDING: 'HIRED',
    };
    for (const [old, now] of Object.entries(became)) assert.equal(normaliseStage(old), now, old);
  });
  it('reads a candidate row: an old outcome is Not hired whatever the stage says', () => {
    assert.equal(normaliseStage({ currentStage: 'EVALUATION', status: 'REJECTED' }), 'NOT_HIRED');
    assert.equal(normaliseStage({ currentStage: 'APPLICATION_REVIEW', status: 'EVALUATION_FAILED' }), 'NOT_HIRED');
    assert.equal(normaliseStage({ currentStage: 'OFFER_DELIVERY', status: 'ACTIVE' }), 'OFFER');
    assert.equal(normaliseStage({ currentStage: 'OFFER' }), 'OFFER');
  });
  it('gives nothing for what is not a stage', () => {
    for (const v of [undefined, null, '', 'applied', 'HM_REVIEW', {}, { currentStage: 'NOPE' }]) assert.equal(normaliseStage(v), undefined);
  });
});

describe('openStages', () => {
  it('has Screening unless the company turned it off', () => {
    assert.deepEqual(openStages(true), ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER']);
    assert.deepEqual(openStages(undefined), ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER']);
    assert.deepEqual(openStages(false), ['APPLIED', 'INTERVIEW', 'OFFER']);
  });
});
