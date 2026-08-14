import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DesktopReview } from '../contracts';
import { ProcessCommandRunner } from './command';
import type { ManagedReviewRefs, ReviewSource } from './sourceControl';
import { WorkspaceManager, workspaceTestExports } from './workspaces';

const temporaryDirectories: string[] = [];
const runner = new ProcessCommandRunner();

const git = async (cwd: string, args: string[]) => (
  runner.run('git', ['-C', cwd, ...args], { maxOutputBytes: 1_000_000 })
);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const review = (headSha: string): DesktopReview => ({
  ref: { sourceControl: 'gitlab', host: 'gitlab.example', projectId: 99, number: 17 },
  id: 'gitlab:701',
  number: 17,
  numberLabel: '!17',
  repository: { sourceControl: 'gitlab', remoteId: '99', name: 'app', pathWithNamespace: 'group/app', webUrl: 'https://gitlab.example/group/app' },
  title: 'Change greeting',
  description: 'Updates the greeting.',
  webUrl: 'https://gitlab.example/group/app/-/merge_requests/17',
  author: { id: 1, name: 'Author', username: 'author' },
  reviewers: [],
  assignees: [],
  sourceBranch: 'feature',
  targetBranch: 'main',
  headSha,
  draft: false,
  readiness: 'ready',
  readinessLabel: 'Ready for review',
  labels: [],
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-11T00:00:00Z'
});

describe('managed review worktrees', () => {
  it('checks out the exact GitLab MR ref and builds local diffs without touching the source checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reviewflow-worktree-'));
    temporaryDirectories.push(root);
    const sourcePath = join(root, 'source');
    const remotePath = join(root, 'remote.git');
    const dataPath = join(root, 'data');
    await runner.run('git', ['init', '--initial-branch=main', sourcePath]);
    await git(sourcePath, ['config', 'user.email', 'reviewflow@example.test']);
    await git(sourcePath, ['config', 'user.name', 'ReviewFlow Test']);
    await writeFile(join(sourcePath, 'greeting.ts'), 'export const greeting = "hello";\n');
    await git(sourcePath, ['add', 'greeting.ts']);
    await git(sourcePath, ['commit', '-m', 'base']);
    const baseSha = (await git(sourcePath, ['rev-parse', 'HEAD'])).stdout.trim();
    await git(sourcePath, ['switch', '-c', 'feature']);
    await writeFile(join(sourcePath, 'greeting.ts'), 'export const greeting = "hello review";\n');
    await writeFile(join(sourcePath, 'greeting.test.ts'), 'export const expected = "hello review";\n');
    await git(sourcePath, ['add', 'greeting.ts', 'greeting.test.ts']);
    await git(sourcePath, ['commit', '-m', 'feature']);
    const headSha = (await git(sourcePath, ['rev-parse', 'HEAD'])).stdout.trim();
    await runner.run('git', ['init', '--bare', remotePath]);
    await git(sourcePath, ['remote', 'add', 'fixture', remotePath]);
    await git(sourcePath, ['push', 'fixture', 'main:main']);
    await git(sourcePath, ['push', 'fixture', `feature:refs/merge-requests/17/head`]);

    const reviewSource: ReviewSource = {
      review: review(headSha),
      repository: { sourceControl: 'gitlab', remoteId: '99', name: 'app', pathWithNamespace: 'group/app', webUrl: 'https://gitlab.example/group/app' },
      cloneUrls: [remotePath],
      sourceBranch: 'feature',
      targetBranch: 'main',
      baseSha,
      startSha: baseSha,
      headSha,
      targetRemoteRef: 'refs/heads/main',
      headRemoteRef: 'refs/merge-requests/17/head'
    };
    const adapter = {
      getReviewSource: async () => reviewSource,
      cloneRepository: async (source: ReviewSource, destination: string) => {
        await runner.run('git', ['clone', '--filter=blob:none', '--no-checkout', '--origin', 'origin', '--', source.cloneUrls[0], destination]);
      },
      fetchReviewRefs: async (repositoryPath: string, source: ReviewSource, refs: ManagedReviewRefs) => {
        await runner.run('git', [
          '-C', repositoryPath, 'fetch', '--no-tags', '--prune', 'origin',
          `+${source.targetRemoteRef}:${refs.targetRef}`,
          `+${source.headRemoteRef}:${refs.headRef}`
        ]);
      }
    };
    const manager = new WorkspaceManager(dataPath, runner, { get: () => adapter });
    const ref = { sourceControl: 'gitlab' as const, host: 'gitlab.example', projectId: 99, number: 17 };
    const prepared = await manager.prepare(ref);

    expect(prepared.input.headSha).toBe(headSha);
    expect(prepared.input.changes.map((change) => [change.path, change.kind])).toEqual([
      ['greeting.test.ts', 'added'],
      ['greeting.ts', 'modified']
    ]);
    expect(prepared.input.changes[1].diff).toContain('+export const greeting = "hello review";');
    expect(await readFile(join(prepared.input.worktreePath, 'greeting.ts'), 'utf8')).toContain('hello review');
    expect(await readFile(join(sourcePath, 'greeting.ts'), 'utf8')).toContain('hello review');

    const reused = await manager.prepare(ref);
    expect(reused.input.worktreePath).toBe(prepared.input.worktreePath);
  });

  it('parses NUL-delimited rename records and diff counts', () => {
    expect(workspaceTestExports.parseNameStatus('R100\0old.ts\0new.ts\0M\0same.ts\0')).toEqual([
      { path: 'new.ts', oldPath: 'old.ts', kind: 'renamed' },
      { path: 'same.ts', kind: 'modified' }
    ]);
    expect(workspaceTestExports.diffCounts('--- a/file\n+++ b/file\n-old\n+new\n context')).toEqual({ additions: 1, deletions: 1 });
    expect(workspaceTestExports.remoteBelongsToSource(
      'git@gitlab.example:group/app.git',
      { cloneUrls: ['git@gitlab.example:group/app'] }
    )).toBe(true);
    expect(workspaceTestExports.canonicalRemote('https://token:secret@gitlab.example/group/app.git')).toBe('');
  });
});
