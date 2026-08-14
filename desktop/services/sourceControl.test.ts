import { describe, expect, it } from 'vitest';
import type { SourceControlAdapter } from './sourceControl';
import { SourceControlRegistry } from './sourceControl';

const gitlabAdapter: SourceControlAdapter = {
  kind: 'gitlab',
  label: 'GitLab',
  status: async () => ({ installed: true, path: '/fake/glab', version: 'glab 1.90.0' }),
  listReviews: async () => { throw new Error('Not used in this contract test.'); },
  getReviewSource: async () => { throw new Error('Not used in this contract test.'); },
  cloneRepository: async () => undefined,
  fetchReviewRefs: async () => undefined
};

describe('source-control adapter registry', () => {
  it('publishes implemented adapters and keeps the reserved GitHub seam unavailable', async () => {
    const registry = new SourceControlRegistry([gitlabAdapter]);

    expect(registry.get('gitlab')).toBe(gitlabAdapter);
    await expect(registry.statuses()).resolves.toEqual([
      {
        kind: 'gitlab',
        label: 'GitLab',
        implemented: true,
        executable: { installed: true, path: '/fake/glab', version: 'glab 1.90.0' }
      },
      {
        kind: 'github',
        label: 'GitHub',
        implemented: false,
        executable: { installed: false, error: 'GitHub support is reserved for a future source-control adapter.' }
      }
    ]);
    expect(() => registry.get('github')).toThrow('GitHub is not available');
  });
});
