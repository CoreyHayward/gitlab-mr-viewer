import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitLabService } from '@/services/gitlab';
import type { GitLabMergeRequest } from '@/types/gitlab';

const discussion = {
  id: 'thread-1',
  individual_note: false,
  notes: []
};

const apiResponse = (data: unknown, options: { status?: number; headers?: Record<string, string> } = {}) => {
  const status = options.status ?? 200;
  const headers = new Map(Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    json: async () => data
  };
};

const mergeRequest = (id: number, projectId = 7): GitLabMergeRequest => ({
  id,
  iid: id,
  title: `MR ${id}`,
  description: '',
  state: 'opened',
  created_at: '2026-08-01T10:00:00Z',
  updated_at: `2026-08-0${Math.min(id, 9)}T10:00:00Z`,
  merged_at: null,
  closed_at: null,
  author: { id: 1, name: 'Author', username: 'author', avatar_url: null },
  assignees: [],
  reviewers: [],
  source_branch: 'feature',
  target_branch: 'main',
  web_url: `https://gitlab.example.com/mr/${id}`,
  project_id: projectId,
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

const project = (id = 7, name = 'Viewer') => ({
  id,
  name,
  path_with_namespace: `group/${name.toLowerCase()}`,
  web_url: `https://gitlab.example.com/group/${name.toLowerCase()}`
});

const user = { id: 99, name: 'Reviewer', username: 'reviewer', avatar_url: null };

const localStorageStub = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  };
};

describe('GitLab discussion service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads all discussion pages using the API pagination contract', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => Array.from({ length: 100 }, (_, index) => ({ ...discussion, id: `thread-${index}` })) })
      .mockResolvedValueOnce({ ok: true, json: async () => [discussion] });
    vi.stubGlobal('fetch', fetchMock);

    const service = new GitLabService('https://gitlab.example.com', 'token');
    const result = await service.getMergeRequestDiscussions(7, 12);

    expect(result).toHaveLength(101);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://gitlab.example.com/api/v4/projects/7/merge_requests/12/discussions?per_page=100&page=1', expect.objectContaining({ method: 'GET' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://gitlab.example.com/api/v4/projects/7/merge_requests/12/discussions?per_page=100&page=2', expect.objectContaining({ method: 'GET' }));
  });

  it('posts a positioned discussion as JSON and adds replies to the thread endpoint', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => discussion })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 22, type: 'DiscussionNote', body: 'reply' }) });
    vi.stubGlobal('fetch', fetchMock);
    const service = new GitLabService('https://gitlab.example.com/', 'token');
    const position = { base_sha: 'base', start_sha: 'start', head_sha: 'head', position_type: 'text' as const, old_path: 'a.ts', new_path: 'a.ts', new_line: 8 };

    await service.createMergeRequestDiscussion(7, 12, 'comment', position);
    await service.addMergeRequestDiscussionNote(7, 12, 'thread/1', 'reply');

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ body: 'comment', position });
    expect(fetchMock.mock.calls[1][0]).toBe('https://gitlab.example.com/api/v4/projects/7/merge_requests/12/discussions/thread%2F1/notes');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ body: 'reply' });
  });
});

describe('GitLab merge request loading', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the all-project view without using the instance-wide merge request endpoint', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v4/merge_requests') {
        return apiResponse({ message: { error: 'Request timed out' } }, { status: 408 });
      }
      if (url.pathname === '/api/v4/projects') {
        return apiResponse([project()], { headers: { 'x-next-page': '2' } });
      }
      if (url.pathname === '/api/v4/projects/7/merge_requests') return apiResponse([mergeRequest(1)]);
      if (url.pathname.endsWith('/user')) return apiResponse(user);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GitLabService('https://gitlab.example.com', 'token').getAllMergeRequests({ state: 'opened' });
    const requestedUrls = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
    const projectIndexRequest = requestedUrls.find((url) => url.pathname === '/api/v4/projects');
    const projectMergeRequest = requestedUrls.find((url) => url.pathname === '/api/v4/projects/7/merge_requests');

    expect(requestedUrls.some((url) => url.pathname === '/api/v4/merge_requests')).toBe(false);
    expect(projectIndexRequest?.searchParams.get('membership')).toBe('true');
    expect(projectIndexRequest?.searchParams.get('with_merge_requests_enabled')).toBe('true');
    expect(projectIndexRequest?.searchParams.get('order_by')).toBe('last_activity_at');
    expect(projectIndexRequest?.searchParams.get('per_page')).toBe('4');
    expect(projectMergeRequest?.searchParams.get('per_page')).toBe('5');
    expect(projectMergeRequest?.searchParams.get('state')).toBe('opened');
    expect(result.mergeRequests.map((item) => item.id)).toEqual([1]);
    expect(result.nextCursor?.projectDiscovery).toEqual(expect.objectContaining({ page: 2 }));
    expect(result.warnings).toEqual([]);
  });

  it('continues project discovery across all-project result pages', async () => {
    const projectPages: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v4/projects') {
        const page = url.searchParams.get('page') ?? '';
        projectPages.push(page);
        return page === '1'
          ? apiResponse([project()], { headers: { 'x-next-page': '2' } })
          : apiResponse([project(8, 'Other')]);
      }
      if (url.pathname === '/api/v4/projects/7/merge_requests') return apiResponse([mergeRequest(1)]);
      if (url.pathname === '/api/v4/projects/8/merge_requests') return apiResponse([mergeRequest(2, 8)]);
      if (url.pathname.endsWith('/user')) return apiResponse(user);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new GitLabService('https://gitlab.example.com', 'token');
    const firstPage = await service.getAllMergeRequests({ state: 'opened' });
    const secondPage = await service.getAllMergeRequests({ state: 'opened' }, undefined, firstPage.nextCursor);

    expect(projectPages).toEqual(['1', '2']);
    expect(firstPage.mergeRequests.map((item) => item.id)).toEqual([1]);
    expect(firstPage.nextCursor?.projectDiscovery).toEqual(expect.objectContaining({ page: 2 }));
    expect(secondPage.mergeRequests.map((item) => item.id)).toEqual([2]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('recovers a project query when GitLab times out on a large first page', async () => {
    const attemptedPageSizes: number[] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v4/projects/7/merge_requests') {
        const pageSize = Number(url.searchParams.get('per_page'));
        attemptedPageSizes.push(pageSize);
        if (pageSize > 5) {
          return apiResponse({ message: { error: 'Request timed out' } }, { status: 408 });
        }
        return apiResponse([mergeRequest(1)], { headers: { 'x-next-page': '2' } });
      }
      if (url.pathname.endsWith('/user')) return apiResponse(user);
      if (url.pathname.endsWith('/projects/7')) return apiResponse(project());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GitLabService('https://gitlab.example.com', 'token').getMergeRequests(7, { state: 'opened' });

    expect(attemptedPageSizes).toEqual([50, 5]);
    expect(result.mergeRequests.map((item) => item.id)).toEqual([1]);
    expect(result.nextCursor?.targets).toEqual([
      expect.objectContaining({ page: 2, perPage: 5 })
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('keeps successful author results and reports failed subqueries', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v4/projects') return apiResponse([project()]);
      if (url.pathname.endsWith('/merge_requests') && url.searchParams.get('author_username') === 'broken') {
        return apiResponse({ message: 'forbidden' }, { status: 403 });
      }
      if (url.pathname.endsWith('/merge_requests')) return apiResponse([mergeRequest(2)]);
      if (url.pathname.endsWith('/user')) return apiResponse(user);
      if (url.pathname.endsWith('/projects/7')) return apiResponse(project());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GitLabService('https://gitlab.example.com', 'token').getAllMergeRequests({
      authors: ['author', 'broken']
    });

    expect(result.mergeRequests.map((item) => item.id)).toEqual([2]);
    expect(result.warnings).toEqual([expect.stringContaining('@broken')]);
    expect(result.nextCursor?.targets).toEqual([expect.objectContaining({ label: expect.stringContaining('@broken'), page: 1 })]);
  });

  it('checks every requested author before presenting an empty all-project result', async () => {
    const authors = Array.from({ length: 8 }, (_, index) => `author-${index + 1}`);
    const requestedAuthors: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v4/merge_requests') {
        const author = url.searchParams.get('author_username') ?? '';
        requestedAuthors.push(author);
        return apiResponse(author === 'author-8' ? [{
          ...mergeRequest(8),
          author: { ...mergeRequest(8).author, username: author }
        }] : []);
      }
      if (url.pathname === '/api/v4/projects/7') return apiResponse(project());
      if (url.pathname.endsWith('/user')) return apiResponse(user);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GitLabService('https://gitlab.example.com', 'token').getAllMergeRequests({
      state: 'opened',
      authors
    });

    expect(requestedAuthors).toEqual(authors);
    expect(fetchMock.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname === '/api/v4/merge_requests')
      .every((url) => url.searchParams.get('scope') === 'all')).toBe(true);
    expect(result.mergeRequests.map((item) => item.id)).toEqual([8]);
    expect(result.warnings).toEqual([]);
  });

  it('starts up to eight independent author queries concurrently', async () => {
    const authors = Array.from({ length: 8 }, (_, index) => `author-${index + 1}`);
    let activeAuthorQueries = 0;
    let maximumActiveAuthorQueries = 0;
    const authorGate = new Promise<void>((resolve) => setTimeout(resolve, 20));
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v4/merge_requests') {
        activeAuthorQueries += 1;
        maximumActiveAuthorQueries = Math.max(maximumActiveAuthorQueries, activeAuthorQueries);
        await authorGate;
        activeAuthorQueries -= 1;
        return apiResponse([]);
      }
      if (url.pathname.endsWith('/user')) return apiResponse(user);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await new GitLabService('https://gitlab.example.com', 'token').getAllMergeRequests({
      state: 'opened',
      authors
    });

    expect(maximumActiveAuthorQueries).toBe(8);
  });

  it('applies exact project name and path filters after enrichment', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v4/projects') return apiResponse([project(7, 'Viewer'), project(8, 'Other')]);
      if (url.pathname === '/api/v4/projects/7/merge_requests') return apiResponse([mergeRequest(1, 7)]);
      if (url.pathname === '/api/v4/projects/8/merge_requests') return apiResponse([mergeRequest(2, 8)]);
      if (url.pathname.endsWith('/user')) return apiResponse(user);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GitLabService('https://gitlab.example.com', 'token').getAllMergeRequests({
      projects: ['group/viewer']
    });

    expect(result.mergeRequests.map((item) => item.project?.path_with_namespace)).toEqual(['group/viewer']);
  });

  it('ignores malformed project cache entries and refreshes them from GitLab', async () => {
    const localStorage = localStorageStub();
    const cacheKey = `gitlab-project-cache:${encodeURIComponent('https://gitlab.example.com')}:99`;
    localStorage.setItem(cacheKey, JSON.stringify({
      7: { project: { id: 7 }, timestamp: Date.now() }
    }));
    vi.stubGlobal('localStorage', localStorage);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(apiResponse([mergeRequest(1)]))
      .mockResolvedValueOnce(apiResponse(user))
      .mockResolvedValueOnce(apiResponse(project()));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GitLabService('https://gitlab.example.com', 'token').getMergeRequests(7);

    expect(result.mergeRequests[0].project).toEqual(project());
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('GitLab paginated resources', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads every project page', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(apiResponse([project(7)], { headers: { 'x-next-page': '2' } }))
      .mockResolvedValueOnce(apiResponse([project(8)]));
    vi.stubGlobal('fetch', fetchMock);

    const projects = await new GitLabService('https://gitlab.example.com', 'token').getProjects();

    expect(projects.map((item) => item.id)).toEqual([7, 8]);
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('page')).toBe('2');
  });

  it('honours an explicitly empty next-page header without probing another page', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(apiResponse([project(7)], {
      headers: { 'x-next-page': '' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    const projects = await new GitLabService('https://gitlab.example.com', 'token').getProjects();

    expect(projects).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses paginated diffs and reports collapsed or oversized files as incomplete', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(apiResponse({
        iid: 12,
        changes_count: '1000+',
        diff_refs: { base_sha: 'base1234', start_sha: 'start1234', head_sha: 'head1234' }
      }))
      .mockResolvedValueOnce(apiResponse([
        { old_path: 'a.ts', new_path: 'a.ts', diff: '@@ -1 +1 @@\n-a\n+b', collapsed: true }
      ], { headers: { 'x-next-page': '2' } }))
      .mockResolvedValueOnce(apiResponse([
        { old_path: 'b.ts', new_path: 'b.ts', diff: '', too_large: true }
      ]));
    vi.stubGlobal('fetch', fetchMock);

    const details = await new GitLabService('https://gitlab.example.com', 'token').getMergeRequestReviewDetails(7, 12);

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).not.toEqual(expect.arrayContaining([expect.stringContaining('/changes')]));
    expect(String(fetchMock.mock.calls[1][0])).toContain('/diffs?');
    expect(details.changes).toHaveLength(2);
    expect(details.diff_completeness).toMatchObject({
      complete: false,
      truncated: true,
      loaded_files: 2,
      collapsed_files: 1,
      too_large_files: 1
    });
    expect(details.diff_completeness?.reason).toContain('GitLab capped the reported change count at 1,000');
  });

  it('accepts a temporarily unavailable changes count without failing diff loading', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(apiResponse({ changes_count: null }))
      .mockResolvedValueOnce(apiResponse([
        { old_path: 'a.ts', new_path: 'a.ts', diff: '@@ -1 +1 @@\n-a\n+b' }
      ], { headers: { 'x-next-page': '' } }));
    vi.stubGlobal('fetch', fetchMock);

    const details = await new GitLabService('https://gitlab.example.com', 'token').getMergeRequestReviewDetails(7, 12);

    expect(details.changes).toHaveLength(1);
    expect(details.diff_completeness).toMatchObject({ complete: true, truncated: false });
  });
});
