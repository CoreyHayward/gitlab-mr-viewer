import { describe, expect, it } from 'vitest';
import type { CommandResult, CommandRunner, RunCommandOptions } from './command';
import { CommandError } from './command';
import { GlabClient } from './gitlab';
import type { ReviewSource } from './sourceControl';

const result = (stdout: string): CommandResult => ({ stdout, stderr: '', durationMs: 4, truncated: false });

class FakeRunner implements CommandRunner {
  calls: Array<{ executable: string; args: string[]; options?: RunCommandOptions }> = [];

  async run(executable: string, args: string[], options?: RunCommandOptions): Promise<CommandResult> {
    this.calls.push({ executable, args, options });
    if (args[0] === 'repo' || executable === 'git') return result('');
    const endpoint = args[1];
    if (endpoint === '/user') return result(JSON.stringify({ id: 42, name: 'Corey', username: 'corey' }));
    if (endpoint?.startsWith('/merge_requests?')) {
      return result([
        JSON.stringify({
          id: 10,
          iid: 7,
          project_id: 99,
          title: 'Ready change',
          web_url: 'https://gitlab.example/group/app/-/merge_requests/7',
          references: { full: 'group/app!7' },
          author: { id: 1, name: 'Author', username: 'author' },
          reviewers: [{ id: 42, name: 'Corey', username: 'corey' }],
          source_branch: 'feature',
          target_branch: 'main',
          sha: 'a'.repeat(40),
          draft: false,
          detailed_merge_status: 'not_approved',
          blocking_discussions_resolved: true,
          labels: ['backend'],
          created_at: '2026-08-01T10:00:00Z',
          updated_at: '2026-08-11T10:00:00Z'
        }),
        JSON.stringify({
          id: 11,
          iid: 8,
          project_id: 100,
          title: 'Draft change',
          web_url: 'https://gitlab.example/group/web/-/merge_requests/8',
          references: { full: 'group/web!8' },
          author: { id: 2, name: 'Other', username: 'other' },
          source_branch: 'draft',
          target_branch: 'main',
          sha: 'b'.repeat(40),
          draft: true,
          created_at: '2026-08-02T10:00:00Z',
          updated_at: '2026-08-10T10:00:00Z'
        })
      ].join('\n'));
    }
    throw new Error(`Unexpected fake endpoint: ${endpoint}`);
  }
}

describe('glab-backed dashboard', () => {
  it('loads review requests for the current user without exposing a token', async () => {
    const runner = new FakeRunner();
    const client = new GlabClient(runner, { find: async () => '/fake/glab' });
    const dashboard = await client.listReviews('gitlab.example', 'review-requested');

    expect(dashboard.currentUser.username).toBe('corey');
    expect(dashboard.reviews.map((review) => [review.repository.pathWithNamespace, review.readiness])).toEqual([
      ['group/app', 'ready'],
      ['group/web', 'draft']
    ]);
    const listCall = runner.calls.find((call) => call.args[1]?.startsWith('/merge_requests?'));
    expect(listCall?.args[1]).toContain('reviewer_id=42');
    expect(JSON.stringify(runner.calls)).not.toMatch(/PRIVATE-TOKEN|secret-value/);

    const review = dashboard.reviews[0];
    const source: ReviewSource = {
      review,
      repository: review.repository,
      cloneUrls: ['git@gitlab.example:group/app.git', 'https://gitlab.example/group/app.git'],
      sourceBranch: 'feature',
      targetBranch: 'main',
      baseSha: 'b'.repeat(40),
      startSha: 'b'.repeat(40),
      headSha: 'a'.repeat(40),
      targetRemoteRef: 'refs/heads/main',
      headRemoteRef: 'refs/merge-requests/7/head'
    };
    await client.cloneRepository(source, '/managed/app');
    await client.fetchReviewRefs('/managed/app', source, {
      targetRef: 'refs/reviewflow/gitlab-7-target',
      headRef: 'refs/reviewflow/gitlab-7-head'
    });

    const cloneCall = runner.calls.find((call) => call.args[0] === 'repo');
    expect(cloneCall?.args).toEqual(expect.arrayContaining(['clone', review.repository.webUrl, '/managed/app', '--no-checkout']));
    const fetchCall = runner.calls.find((call) => call.executable === 'git');
    expect(fetchCall?.args.join(' ')).toContain('glab\' auth git-credential');
    expect(fetchCall?.args.join(' ')).toContain('refs/merge-requests/7/head');
    expect(fetchCall?.options?.env?.GIT_TERMINAL_PROMPT).toBe('0');
  });

  it('hands authenticated glab credentials to a non-interactive clone', async () => {
    const runner = new FakeRunner();
    const client = new GlabClient(runner, { find: async () => '/fake/glab' });
    const source = {
      review: {
        ref: { sourceControl: 'gitlab', host: 'gitlab.example', projectId: 99, number: 7 }
      },
      repository: {
        sourceControl: 'gitlab',
        pathWithNamespace: 'group/app',
        webUrl: 'https://gitlab.example/group/app'
      },
      cloneUrls: ['https://gitlab.example/group/app.git']
    } as ReviewSource;

    await client.cloneRepository(source, '/managed/app');

    const cloneCall = runner.calls.find((call) => call.args.includes('/managed/app'));
    const credentialHandoff = JSON.stringify({ args: cloneCall?.args, env: cloneCall?.options?.env });
    expect(cloneCall?.options?.env?.GIT_TERMINAL_PROMPT).toBe('0');
    expect(cloneCall?.options?.env).toMatchObject({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'credential.https://gitlab.example.helper',
      GIT_CONFIG_VALUE_0: "!'/fake/glab' auth git-credential",
      GIT_CONFIG_KEY_1: 'credential.http://gitlab.example.helper',
      GIT_CONFIG_VALUE_1: "!'/fake/glab' auth git-credential"
    });
    expect(credentialHandoff).not.toMatch(/PRIVATE-TOKEN|oauth2:[^@]+@/);
  });

  it('turns authentication failures into an actionable glab instruction', async () => {
    const runner: CommandRunner = {
      run: async () => { throw new CommandError('HTTP 401 token=hidden', 'glab', 1, 'HTTP 401 token=hidden'); }
    };
    const client = new GlabClient(runner, { find: async () => '/fake/glab' });
    await expect(client.listReviews('gitlab.example', 'review-requested')).rejects.toThrow(
      'glab auth login --hostname gitlab.example'
    );
  });
});
