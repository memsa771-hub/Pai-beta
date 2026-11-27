// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PathsFound, PossibilityCard } from './possibilities';
import { workspaceApi } from '@/lib/api';
import { I18nProvider } from '@/lib/i18n';
import type { Possibility } from '@/lib/possibilities';
vi.mock('@/lib/api', () => ({ workspaceApi: { changePossibility: vi.fn(), getPossibilities: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const value: Possibility = { id: 'candidate', title: 'Practical work', why: 'Your own project', status: 'suggested', evidence: [], unknowns: [] };
it('offers translated student controls; choosing happens on Paths, never from the chat card', async () => {
  const changed = vi.fn();
  vi.mocked(workspaceApi.changePossibility).mockResolvedValue({ ...value, status: 'saved' });
  const pushState = vi.spyOn(window.history, 'pushState');
  render(<I18nProvider><PossibilityCard value={value} onChange={changed} /></I18nProvider>);
  expect(screen.queryByText('Explore it')).toBeNull();
  fireEvent.click(screen.getByText('Save for later'));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(workspaceApi.changePossibility).toHaveBeenCalledWith('candidate', 'save');
  fireEvent.click(screen.getByText('Compare and choose'));
  expect(String(pushState.mock.calls.at(-1)?.[2])).toContain('view=paths');
  expect(workspaceApi.changePossibility).toHaveBeenCalledTimes(1);
  pushState.mockRestore();
});
it('chosen has no actions', () => {
  render(<I18nProvider><PossibilityCard value={{ ...value, status: 'chosen' }} onChange={vi.fn()} /></I18nProvider>);
  expect(screen.queryByRole('button')).toBeNull();
});

it('shows the paths PAI found in chat and opens them in the workspace', async () => {
  const fit = [{ label: 'Hands-on work', status: 'have' as const, note: '', evidence: ['I fix phones'] }];
  vi.mocked(workspaceApi.getPossibilities).mockResolvedValue([
    { ...value, id: 'a', title: 'Mobile repair', fit, study_field: { key: 'x', needs_check: true, needs_group: [] } },
    { ...value, id: 'b', title: 'Dismissed one', status: 'dismissed' },
    { ...value, id: 'c', title: 'Not in this message' },
  ]);
  window.history.replaceState({}, '', '/my-space?view=threads');
  const moved = vi.fn();
  window.addEventListener('popstate', moved);
  render(<PathsFound ids={['a', 'b']} />);
  expect(await screen.findByText('Mobile repair')).toBeTruthy();
  expect(screen.getByText('Needs checking for your group')).toBeTruthy();
  expect(screen.queryByText('Dismissed one')).toBeNull();
  expect(screen.queryByText('Not in this message')).toBeNull();
  expect(screen.getByText('One path, checked against what you shared.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open your paths' }));
  expect(window.location.pathname + window.location.search).toBe('/my-space?view=paths');
  expect(moved).toHaveBeenCalledOnce();
  window.removeEventListener('popstate', moved);
});
it('a dismissed path card in chat offers no Compare and choose', () => {
  render(<I18nProvider><PossibilityCard value={{ ...value, status: 'dismissed' }} onChange={vi.fn()} /></I18nProvider>);
  expect(screen.queryByText('Compare and choose')).toBeNull();
  expect(screen.getByText('Save for later')).toBeTruthy();
});
