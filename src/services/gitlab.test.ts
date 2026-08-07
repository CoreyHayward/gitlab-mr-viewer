import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitLabService } from '@/services/gitlab';

const discussion = {
  id: 'thread-1',
  individual_note: false,
  notes: []
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
