import { describe, expect, it } from 'vitest';
import { applyMergeRequestFilters, buildMergeRequestTargets } from '@/services/gitlab/mergeRequests';
import type { GitLabMergeRequest } from '@/types/gitlab';

const mergeRequest = (username: string): GitLabMergeRequest => ({
  id: username === 'alice' ? 1 : 2,
  iid: username === 'alice' ? 1 : 2,
  project_id: 7,
  title: 'Review',
  description: null,
  state: 'opened',
  draft: false,
  work_in_progress: false,
  web_url: 'https://gitlab.example.com/group/viewer/-/merge_requests/1',
  source_branch: 'feature',
  target_branch: 'main',
  author: { id: 1, username, name: username, avatar_url: null },
  assignees: [],
  reviewers: [],
  labels: [],
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-02T00:00:00Z',
  merged_at: null,
  closed_at: null,
  merge_status: 'can_be_merged',
  detailed_merge_status: 'mergeable',
  conflicts_can_be_resolved_in_ui: false,
  user_notes_count: 0,
  upvotes: 0,
  downvotes: 0,
  should_remove_source_branch: false,
  force_remove_source_branch: false,
  squash: false
});

describe('merge request query planning', () => {
  const bases = Array.from({ length: 3 }, (_, index) => ({
    endpoint: `/projects/${index + 1}/merge_requests`,
    label: `Project ${index + 1}`
  }));

  it('uses server-side author queries for small combinations', () => {
    const targets = buildMergeRequestTargets(bases.slice(0, 2), { authors: ['alice', 'bob'] });

    expect(targets).toHaveLength(4);
    expect(targets.every((target) => target.endpoint.includes('author_username='))).toBe(true);
  });

  it('avoids project-by-author request multiplication for large combinations', () => {
    const targets = buildMergeRequestTargets(bases, {
      authors: Array.from({ length: 20 }, (_, index) => `author-${index}`)
    });

    expect(targets).toHaveLength(3);
    expect(targets.every((target) => !target.endpoint.includes('author_username='))).toBe(true);
  });

  it('applies exact author filtering when query planning falls back to client filtering', () => {
    expect(applyMergeRequestFilters([mergeRequest('alice'), mergeRequest('bob')], { authors: ['Alice'] }))
      .toEqual([mergeRequest('alice')]);
  });

  it('matches the current username case-insensitively for the not-approved filter', () => {
    const approved = {
      ...mergeRequest('alice'),
      approval_status: {
        approvals_required: 1,
        approvals_left: 0,
        approved_by: [{
          approved_at: '2026-08-02T00:00:00Z',
          user: { id: 9, username: 'Reviewer', name: 'Reviewer', avatar_url: null }
        }]
      }
    };

    expect(applyMergeRequestFilters([approved], { notReviewedByMe: true }, 'reviewer')).toEqual([]);
  });
});
