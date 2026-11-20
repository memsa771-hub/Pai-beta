// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FitDots, FitList, PathCardView } from './path-card';
import copy from './workspace/copy.json';

afterEach(cleanup);

it('shows the Vault evidence badge next to the reason, once per level and source', () => {
  render(<PathCardView id="p1" title="Electrical Engineering" whyLabel="Why it fits you"
    why="Builds on your repair work." actions={null}
    evidence={[
      { text: 'Repairing phones', item_id: 'item:v1', evidence_level: 'stated', source_label: 'Chat' },
      { text: 'Fixing radios', item_id: 'item:v2', evidence_level: 'stated', source_label: 'Chat' },
      { text: 'FSc Pre-Engineering', item_id: 'rec-1', evidence_level: 'shown', source_label: 'marksheet.pdf' },
      { text: 'A notebook note', item_id: 'c1', evidence_level: null, source_label: null },
    ]} />);
  const reason = screen.getByText('Why it fits you').parentElement!;
  expect(reason.textContent).toContain('Stated · Chat');
  expect(reason.textContent).toContain('From document · marksheet.pdf');
  expect(screen.getAllByText('Stated · Chat')).toHaveLength(1);
});

it('shows no badge when the reason cites no Vault entry', () => {
  render(<PathCardView id="p1" title="BBA" whyLabel="Why it fits you" why="Older path." actions={null}
    evidence={[{ text: 'Older evidence', item_id: null }]} />);
  expect(screen.getByText('Why it fits you').parentElement!.textContent).toBe('Why it fits you');
});

it('shows a cited field-note fact as a source link beside the reason', () => {
  render(<PathCardView id="p1" title="Electrical Engineering" whyLabel="Why it fits you"
    why="Builds on your repair work." actions={null}
    evidence={[
      { text: 'Repairing phones', item_id: 'item:v1', evidence_level: 'stated', source_label: 'Chat' },
      { text: 'Demand is rising.', item_id: 'note:electrical_engineering:2', evidence_level: 'source',
        source_label: null, source_url: 'https://www.pec.org.pk/demand' },
    ]} />);
  const reason = screen.getByText('Why it fits you').parentElement!;
  expect(reason.textContent).toContain('Stated · Chat');
  const link = screen.getByRole('link', { name: /pec\.org\.pk/ });
  expect(link.getAttribute('href')).toBe('https://www.pec.org.pk/demand');
  expect(reason.textContent).toContain('Source');
});

it('shows needs work as its own verdict, in words and an amber dot', () => {
  const have = { label: 'Hands-on skill', status: 'have' as const, note: '', evidence: ['Repairs phones'] };
  const work = { label: 'Maths', status: 'work' as const, note: 'Needs strong maths', evidence: ['Says maths is hard'] };
  render(<div><FitList detailed items={[have, work]} /><FitDots items={[have, work]} summary={copy.overview.fitDots} /></div>);
  expect(screen.getByText('Needs work')).toBeTruthy();
  const dots = screen.getByRole('img');
  expect(dots.getAttribute('aria-label')).toBe('1 you have, 0 partly, 0 in the way, 1 need work, 0 not known yet');
  expect(dots.querySelectorAll('span')[1].className).toContain('bg-warning');
});
