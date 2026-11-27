import { it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Guard: every roadmap UI stays removed. The chat-linked roadmaps went first
// (ROADMAP_ENGINE_SPEC.md §4); the Roadmap page followed: paths are compared
// and chosen on the one Paths page (components/counselor/workspace/paths.tsx).
const ROOT = resolve(__dirname, '..');
const SKIP = new Set(['node_modules', '.next', 'out', 'dist', 'coverage', 'test-results']);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|cjs|js)$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

const files = ['app', 'components', 'hooks', 'lib', 'tests']
  .map((dir) => join(ROOT, dir)).filter(existsSync).flatMap(sources)
  .filter((path) => !path.endsWith('roadmap-removed.test.ts'));

it('no module imports the old roadmap components, types or chat comparison', () => {
  const banned = /from\s+['"][^'"]*(components\/roadmaps\/|lib\/roadmaps?['"]|roadmap-comparison|workspace\/decisions['"]|counselor-research-status|\.\/roadmap(-parts|-steps|-text)?['"])/;
  const offenders = files.filter((path) => banned.test(readFileSync(path, 'utf8'))).map((path) => relative(ROOT, path));
  expect(offenders).toEqual([]);
});

it('the old roadmap files and API calls are gone', () => {
  for (const path of ['components/roadmaps', 'lib/roadmaps.ts', 'lib/roadmap.ts', 'components/counselor/workspace/decisions.tsx',
    'components/chat/roadmap-comparison.tsx', 'components/chat/counselor-research-status.tsx',
    'components/counselor/workspace/roadmap.tsx', 'components/counselor/workspace/roadmap-parts.tsx',
    'components/counselor/workspace/roadmap-steps.tsx', 'components/counselor/workspace/roadmap-text.ts']) {
    expect(existsSync(join(ROOT, path)), path).toBe(false);
  }
  const api = readFileSync(join(ROOT, 'lib/api.ts'), 'utf8');
  expect(api).not.toMatch(/\/v1\/roadmap|\/paths\/\$\{[^}]+\}\/roadmap|preparePathRoadmap|getRoadmaps?|chooseRoadmap|getRoadmapPage|chooseRoute|setRouteStep|withdrawRoute/);
});

it('no menu, tab, view or stage leads to a Roadmap page', async () => {
  const copy = JSON.parse(readFileSync(join(ROOT, 'components/counselor/workspace/copy.json'), 'utf8'));
  expect(Object.keys(copy.sections)).not.toContain('roadmaps');
  expect(Object.keys(copy.nav)).not.toContain('roadmap');
  expect(Object.keys(copy.subTabs)).not.toContain('roadmap');
  expect(copy.roadmap).toBeUndefined();
  expect(copy.stages.map((stage: { view: string }) => stage.view)).not.toContain('roadmap');
  const layout = readFileSync(join(ROOT, 'components/layout/layout-context.tsx'), 'utf8');
  expect(layout).not.toMatch(/'roadmap'/);
});
