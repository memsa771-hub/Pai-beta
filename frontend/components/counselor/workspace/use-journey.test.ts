// @vitest-environment jsdom
import { it, expect, vi, beforeEach } from 'vitest';
import { workspaceApi } from '@/lib/api';
import { journeyProgress, signalMet, useJourney, type JourneySignals } from './use-journey';
import { picture } from '@/tests/fixtures/counselor';
import copy from './copy.json';

const at = (stage: string | null, moments: Record<string, string>, extra: Partial<JourneySignals> = {}) => journeyProgress({
  picture: { ...picture, stage, moments, picture: notReady },
  possibilities: [], ...extra,
} as JourneySignals);

// The live audit: after six messages the Counselor had *planned* a first
// picture and a follow-up, and the view jumped from B to E with no first
// picture shown and no Mirror ready.
const planned = { explore_area: 'e1', first_picture: 'e2', follow_thread: 'e3' };
const notReady = { ...picture.picture!, ready: false };
const ready = (stage: string | null) => ({ picture: { ...picture, stage, moments: planned } }) as Partial<JourneySignals>;

it('never shows a stage the server has not reached', () => {
  expect(at('FOUNDATION', planned).stage.id).toBe('B');
  expect(at('DIRECTION', planned).stage.id).toBe('D');
  expect(at('MIRROR', planned).stage.id).toBe('E');
});

it('lets early paths exist without skipping the conversation stages', () => {
  const early = { possibilities: [{ id: 'p', title: 'Electronics', why: '', status: 'suggested' }] } as unknown as Partial<JourneySignals>;
  expect(at('DIRECTION', planned, early).stage.id).toBe('D');
});

it('does not cap later stages, and an unknown stage keeps the signal view', () => {
  expect(at('PROPOSED', planned, ready('PROPOSED')).stage.id).toBe('F');
  expect(at(null, planned).stage.id).toBe('E');
});

it('stage E is Your Mirror, reached when the Mirror is ready; at MIRROR the view may show F', () => {
  const stageE = copy.stages.find((s) => s.id === 'E')!;
  expect([stageE.title, stageE.view, stageE.signal]).toEqual(['Your Mirror', 'mirror', 'mirror_ready']);
  const data = (ready: boolean) => ({ picture: { ...picture, picture: { ...picture.picture!, ready } }, possibilities: [] }) as JourneySignals;
  expect(signalMet('mirror_ready', data(true))).toBe(true);
  expect(signalMet('mirror_ready', data(false))).toBe(false);
  expect(signalMet('mirror_ready', { ...data(true), picture: { ...picture, picture: null } })).toBe(false);
  expect(signalMet('mirror_confirmed', data(true))).toBe(false); // the old signal is gone
  expect(at('MIRROR', planned).stage.id).toBe('E');
  expect(at('MIRROR', planned, ready('MIRROR')).stage.id).toBe('F');
});

it('I is reached when the student chooses a path on Paths; no step ticks or places search remain', () => {
  const path = (status: string) => ({ id: 'p', title: 'Electronics', why: '', status, evidence: [], unknowns: [] });
  const data = (status: string) => ({ picture, possibilities: [path(status)] }) as unknown as JourneySignals;
  expect(signalMet('route_chosen', data('saved'))).toBe(false);
  expect(signalMet('route_chosen', data('chosen'))).toBe(true);
  expect(signalMet('route_step_done', data('chosen'))).toBe(false); // the old step ticks are gone
  expect(signalMet('places_searched', data('chosen'))).toBe(false); // the old places search is gone
  const stageI = copy.stages.find((s) => s.id === 'I')!;
  expect([stageI.view, stageI.signal]).toEqual(['paths', 'route_chosen']);
  expect(copy.stages.some((s) => s.view === 'roadmap')).toBe(false);
  // Choosing reaches I, so the current stage moves on to J.
  expect(at(null, planned, { ...ready('CHOSEN'), possibilities: [path('chosen')] } as unknown as Partial<JourneySignals>).stage.id).toBe('J');
});

it('stays on G when paths are found and none is chosen', () => {
  const found = { possibilities: [{ id: 'p', title: 'Electronics', why: '', status: 'suggested' }] } as unknown as Partial<JourneySignals>;
  expect(at(null, planned, found).stage.id).toBe('G');
});

vi.mock('@/lib/api', () => ({ workspaceApi: {
  getCounselorWorkspace: vi.fn(), getPossibilities: vi.fn(),
} }));

beforeEach(() => { vi.clearAllMocks(); });

it('reads only the workspace and the paths', async () => {
  const { renderHook, waitFor } = await import('@testing-library/react');
  vi.mocked(workspaceApi.getCounselorWorkspace).mockResolvedValue(picture);
  vi.mocked(workspaceApi.getPossibilities).mockResolvedValue([
    { id: 'mine', title: 'A', why: '', status: 'chosen', evidence: [], unknowns: [] },
  ]);
  const { result } = renderHook(() => useJourney());
  await waitFor(() => expect(result.current.data?.possibilities).toHaveLength(1));
  expect(Object.keys(result.current.data!)).toEqual(['picture', 'possibilities']);
});
