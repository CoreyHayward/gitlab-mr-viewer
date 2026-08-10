import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitLabService } from '@/services/gitlab';
import type { GitLabMergeRequest } from '@/types/gitlab';

const localStorageStub = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  };
};

const mergeRequest = (
  id: number,
  projectId = 7,
  projectPath = 'group/viewer',
  projectName = 'Viewer'
): GitLabMergeRequest => ({
  id,
  iid: id,
  title: `MR ${id}`,
  description: '',
  state: 'opened',
  created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-08-01T10:00:00Z',
  merged_at: null,
  closed_at: null,
  author: { id: 1, name: 'Author', username: 'author', avatar_url: null },
  assignees: [],
  reviewers: [],
  source_branch: `feature-${id}`,
  target_branch: 'main',
  web_url: `https://gitlab.example.com/${projectPath}/-/merge_requests/${id}`,
  project_id: projectId,
  project: {
    id: projectId,
    name: projectName,
    path_with_namespace: projectPath,
    web_url: `https://gitlab.example.com/${projectPath}`
  },
  labels: [],
  draft: false,
  work_in_progress: false,
  merge_status: 'can_be_merged',
  detailed_merge_status: 'mergeable',
  conflicts_can_be_resolved_in_ui: false,
  upvotes: 0,
  downvotes: 0,
  user_notes_count: 0,
  should_remove_source_branch: false,
  force_remove_source_branch: false,
  squash: false
});

describe('GitLab merge request detail enrichment', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads approvals and diff statistics for one project in one request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        project: {
          name: 'Viewer Display Name',
          fullPath: 'group/viewer',
          webUrl: 'https://gitlab.example.com/group/viewer',
          mergeRequests: {
            nodes: [
              {
                iid: '1',
                approvalsRequired: 2,
                approvalsLeft: 1,
                approvedBy: {
                  nodes: [{ id: 'gid://gitlab/User/31', name: 'Reviewer', username: 'reviewer', avatarUrl: null }]
                },
                diffStatsSummary: { additions: 12, deletions: 3, fileCount: 2 }
              },
              {
                iid: '2',
                approvalsRequired: 1,
                approvalsLeft: 0,
                approvedBy: {
                  nodes: [{ id: 'gid://gitlab/User/32', name: 'Approver', username: 'approver', avatarUrl: null }]
                },
                diffStatsSummary: { additions: 5, deletions: 8, fileCount: 4 }
              }
            ]
          }
        }
      }
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new GitLabService('https://gitlab.example.com', 'token');
    const enriched = await service.enrichMergeRequestsWithDetails([
      mergeRequest(1),
      mergeRequest(2)
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://gitlab.example.com/api/graphql');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(expect.objectContaining({
      variables: {
        fullPath: 'group/viewer',
        iids: ['1', '2'],
        first: 2
      }
    }));
    expect(enriched.map(({ approval_status, diff_stats }) => ({ approval_status, diff_stats }))).toEqual([
      {
        approval_status: {
          approvals_required: 2,
          approvals_left: 1,
          approved_by: [{
            approved_at: null,
            user: { id: 31, name: 'Reviewer', username: 'reviewer', avatar_url: null }
          }]
        },
        diff_stats: { additions: 12, deletions: 3, file_count: 2 }
      },
      {
        approval_status: {
          approvals_required: 1,
          approvals_left: 0,
          approved_by: [{
            approved_at: null,
            user: { id: 32, name: 'Approver', username: 'approver', avatar_url: null }
          }]
        },
        diff_stats: { additions: 5, deletions: 8, file_count: 4 }
      }
    ]);
    expect(enriched.every(({ project }) => project?.name === 'Viewer Display Name')).toBe(true);
  });

  it('uses combined details before applying an approval filter', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v4/projects/7/merge_requests') {
        return new Response(JSON.stringify([mergeRequest(1)]), { status: 200 });
      }
      if (url.pathname === '/api/v4/user') {
        return new Response(JSON.stringify({ id: 99, name: 'Current User', username: 'current.user', avatar_url: null }), { status: 200 });
      }
      if (url.pathname === '/api/v4/projects/7') {
        return new Response(JSON.stringify(mergeRequest(1).project), { status: 200 });
      }
      if (url.pathname === '/api/graphql') {
        return new Response(JSON.stringify({
          data: {
            project: {
              name: 'Viewer',
              fullPath: 'group/viewer',
              webUrl: 'https://gitlab.example.com/group/viewer',
              mergeRequests: {
                nodes: [{
                  iid: '1',
                  approvalsRequired: 1,
                  approvalsLeft: 0,
                  approvedBy: { nodes: [] },
                  diffStatsSummary: { additions: 4, deletions: 2, fileCount: 1 }
                }]
              }
            }
          }
        }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GitLabService('https://gitlab.example.com', 'token').getMergeRequests(7, {
      state: 'opened',
      approvalState: 'approved'
    });
    const requestedPaths = fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname);

    expect(result.mergeRequests).toHaveLength(1);
    expect(result.mergeRequests[0].approval_status).toEqual(expect.objectContaining({ approvals_left: 0 }));
    expect(result.mergeRequests[0].diff_stats).toEqual({ additions: 4, deletions: 2, file_count: 1 });
    expect(requestedPaths.filter((path) => path.endsWith('/approvals'))).toHaveLength(0);
    expect(requestedPaths.filter((path) => path === '/api/graphql')).toHaveLength(1);
  });

  it('uses MR references instead of fetching project metadata separately', async () => {
    const listedMergeRequest = {
      ...mergeRequest(1),
      project: undefined,
      references: { full: 'group/viewer!1' }
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v4/merge_requests') {
        return new Response(JSON.stringify([listedMergeRequest]), { status: 200 });
      }
      if (url.pathname === '/api/v4/user') {
        return new Response(JSON.stringify({ id: 99, name: 'Current User', username: 'current.user', avatar_url: null }), { status: 200 });
      }
      if (url.pathname === '/api/graphql') {
        return new Response(JSON.stringify({
          data: {
            project: {
              name: 'Exact Project Name',
              fullPath: 'group/viewer',
              webUrl: 'https://gitlab.example.com/group/viewer',
              mergeRequests: {
                nodes: [{
                  iid: '1',
                  approvalsRequired: 1,
                  approvalsLeft: 1,
                  approvedBy: { nodes: [] },
                  diffStatsSummary: { additions: 4, deletions: 2, fileCount: 1 }
                }]
              }
            }
          }
        }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new GitLabService('https://gitlab.example.com', 'token');
    const loaded = await service.getAllMergeRequests({ state: 'opened', authors: ['author'] });
    const enriched = await service.enrichMergeRequestsWithDetails(loaded.mergeRequests);
    const requestedPaths = fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname);

    expect(loaded.warnings).toEqual([]);
    expect(enriched[0].project).toEqual({
      id: 7,
      name: 'Exact Project Name',
      path_with_namespace: 'group/viewer',
      web_url: 'https://gitlab.example.com/group/viewer'
    });
    expect(requestedPaths).not.toContain('/api/v4/projects/7');
  });

  it('chunks detail queries for a busy project without dropping MRs', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { variables: { iids: string[] } };
      return new Response(JSON.stringify({
        data: {
          project: {
            name: 'Viewer',
            fullPath: 'group/viewer',
            webUrl: 'https://gitlab.example.com/group/viewer',
            mergeRequests: {
              nodes: request.variables.iids.map((iid) => ({
                iid,
                approvalsRequired: 1,
                approvalsLeft: 1,
                approvedBy: { nodes: [] },
                diffStatsSummary: { additions: Number(iid), deletions: 0, fileCount: 1 }
              }))
            }
          }
        }
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const mergeRequests = Array.from({ length: 21 }, (_, index) => mergeRequest(index + 1));
    const enriched = await new GitLabService('https://gitlab.example.com', 'token').enrichMergeRequestsWithDetails(mergeRequests);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => (
      JSON.parse(String(init?.body)).variables.iids.length <= 20
    ))).toBe(true);
    expect(enriched.every(({ approval_status, diff_stats }) => Boolean(approval_status && diff_stats))).toBe(true);
  });

  it('preserves exact project metadata when detail caches satisfy a refresh', async () => {
    vi.stubGlobal('localStorage', localStorageStub());
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v4/user') {
        return new Response(JSON.stringify({ id: 99, name: 'Current User', username: 'current.user', avatar_url: null }), { status: 200 });
      }
      if (url.pathname === '/api/graphql') {
        return new Response(JSON.stringify({
          data: {
            project: {
              name: 'Exact Project Name',
              fullPath: 'group/viewer',
              webUrl: 'https://gitlab.example.com/group/viewer',
              mergeRequests: {
                nodes: [{
                  iid: '1',
                  approvalsRequired: 1,
                  approvalsLeft: 1,
                  approvedBy: { nodes: [] },
                  diffStatsSummary: { additions: 4, deletions: 2, fileCount: 1 }
                }]
              }
            }
          }
        }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = new GitLabService('https://gitlab.example.com', 'token');
    await service.testConnection();

    const firstLoad = await service.enrichMergeRequestsWithDetails([mergeRequest(1)]);
    const refreshLoad = await service.enrichMergeRequestsWithDetails([mergeRequest(1)]);

    expect(firstLoad[0].project?.name).toBe('Exact Project Name');
    expect(refreshLoad[0].project?.name).toBe('Exact Project Name');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

});
