import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentReviewOutline, DesktopReview } from '../contracts';
import type { CommandResult, CommandRunner, RunCommandOptions } from './command';
import { AgentHarnessService } from './agents';
import type { PreparedWorkspace } from './workspaces';

const temporaryDirectories: string[] = [];
const commandResult = (stdout: string): CommandResult => ({ stdout, stderr: '', durationMs: 25, truncated: false });

const outline: AgentReviewOutline = {
  overview: { purpose: 'Trace the greeting change.', scope: 'Two files.', riskSummary: 'Check callers.', areas: ['Domain', 'Tests'] },
  sections: [{
    id: 'greeting',
    title: 'Change the greeting',
    intent: 'Update the public greeting.',
    reviewFocus: 'Check consumers and expectations.',
    risk: 'medium',
    filePaths: ['greeting.ts', 'greeting.test.ts'],
    relatedSectionIds: [],
    prompts: ['Which callers assume the old value?']
  }]
};

const review: DesktopReview = {
  ref: { sourceControl: 'gitlab', host: 'gitlab.example', projectId: 99, number: 17 },
  id: 'gitlab:1',
  number: 17,
  numberLabel: '!17',
  repository: { sourceControl: 'gitlab', remoteId: '99', name: 'app', pathWithNamespace: 'group/app', webUrl: 'https://gitlab.example/group/app' },
  title: 'Change greeting',
  description: '',
  webUrl: 'https://gitlab.example/group/app/-/merge_requests/17',
  author: { id: 1, name: 'Author', username: 'author' },
  reviewers: [],
  assignees: [],
  sourceBranch: 'feature',
  targetBranch: 'main',
  headSha: 'b'.repeat(40),
  draft: false,
  readiness: 'ready',
  readinessLabel: 'Ready for review',
  labels: [],
  createdAt: '',
  updatedAt: ''
};

const workspace: PreparedWorkspace = {
  input: {
    key: 'gitlab.example:99:17:head',
    review,
    repository: { sourceControl: 'gitlab', remoteId: '99', name: 'app', pathWithNamespace: 'group/app', webUrl: 'https://gitlab.example/group/app' },
    worktreePath: '/fixture/worktree',
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    changes: [
      { path: 'greeting.ts', kind: 'modified', diff: '-old\n+new', diffTruncated: false, additions: 1, deletions: 1 },
      { path: 'greeting.test.ts', kind: 'added', diff: '+test', diffTruncated: false, additions: 1, deletions: 0 }
    ],
    diffTruncated: false,
    preparedAt: ''
  },
  source: {
    review,
    repository: { sourceControl: 'gitlab', remoteId: '99', name: 'app', pathWithNamespace: 'group/app', webUrl: 'https://gitlab.example/group/app' },
    cloneUrls: ['git@gitlab.example:group/app.git', 'https://gitlab.example/group/app.git'],
    sourceBranch: 'feature',
    targetBranch: 'main',
    baseSha: 'a'.repeat(40),
    startSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    targetRemoteRef: 'refs/heads/main',
    headRemoteRef: 'refs/merge-requests/17/head'
  },
  promptDiff: 'diff --git a/greeting.ts b/greeting.ts\n-old\n+new',
  promptDiffTruncated: false
};

class FakeAgentRunner implements CommandRunner {
  calls: Array<{ executable: string; args: string[]; options?: RunCommandOptions }> = [];
  constructor(private readonly responses: Record<string, string>) {}
  async run(executable: string, args: string[], options?: RunCommandOptions): Promise<CommandResult> {
    this.calls.push({ executable, args, options });
    return commandResult(this.responses[executable] ?? '{}');
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const dataDirectory = async () => {
  const path = await mkdtemp(join(tmpdir(), 'reviewflow-agent-'));
  temporaryDirectories.push(path);
  return path;
};

describe('local agent harness adapters', () => {
  it('invokes Codex in a read-only sandbox with a structured outline schema', async () => {
    const runner = new FakeAgentRunner({ '/fake/codex': JSON.stringify(outline) });
    const service = new AgentHarnessService(await dataDirectory(), runner, {
      find: async (name) => name === 'codex' ? '/fake/codex' : null
    });
    const result = await service.generateOutline({ kind: 'codex' }, workspace);

    expect(result.value.sections[0].filePaths).toEqual(['greeting.ts', 'greeting.test.ts']);
    const call = runner.calls[0];
    expect(call.args).toEqual(expect.arrayContaining(['--sandbox', 'read-only', '--ask-for-approval', 'never', '--ephemeral']));
    expect(call.args).not.toEqual(expect.arrayContaining(['workspace-write', 'danger-full-access']));
    expect(call.options?.cwd).toBe('/fixture/worktree');
    expect(call.options?.input).toContain('BEGIN UNTRUSTED PATCH');
  });

  it('invokes Claude Code with read-only tools and parses its JSON wrapper', async () => {
    const runner = new FakeAgentRunner({
      '/fake/claude': JSON.stringify({ result: JSON.stringify(outline), session_id: 'session-1', is_error: false })
    });
    const service = new AgentHarnessService(await dataDirectory(), runner, {
      find: async (name) => name === 'claude' ? '/fake/claude' : null
    });
    const result = await service.generateOutline({ kind: 'claude', model: 'sonnet' }, workspace);

    expect(result.sessionId).toBe('session-1');
    const call = runner.calls[0];
    expect(call.args).toEqual(expect.arrayContaining(['--permission-mode', 'plan', '--tools', 'Read,Grep,Glob', '--no-session-persistence']));
    expect(call.args.join(' ')).not.toMatch(/\b(Edit|Write|Bash)\b/);
  });

  it('returns evidence-backed candidate findings and ignores findings outside the changed diff', async () => {
    const payload = {
      summary: 'One candidate issue.',
      findings: [
        {
          id: 'greeting-null',
          title: 'Caller can receive an empty greeting',
          severity: 'high',
          confidence: 'high',
          description: 'The new branch can return an empty string.',
          filePath: 'greeting.ts',
          startLine: 14,
          endLine: 15,
          evidence: 'The fallback no longer applies.',
          suggestedComment: 'Could we preserve the fallback here?'
        },
        {
          id: 'unrelated',
          title: 'Unchanged file',
          severity: 'low',
          confidence: 'low',
          description: 'Not commentable.',
          filePath: 'unrelated.ts',
          startLine: null,
          endLine: null,
          evidence: 'None.',
          suggestedComment: 'No.'
        }
      ]
    };
    const runner = new FakeAgentRunner({ '/fake/codex': JSON.stringify(payload) });
    const service = new AgentHarnessService(await dataDirectory(), runner, { find: async () => '/fake/codex' });
    const result = await service.runAutomatedReview({ kind: 'codex' }, workspace);

    expect(result.value.findings).toHaveLength(1);
    expect(result.value.findings[0]).toMatchObject({ filePath: 'greeting.ts', startLine: 14, severity: 'high' });
  });

  it('parses repository evidence for follow-up questions', async () => {
    const answer = {
      answer: 'The public consumer reads the new greeting directly.',
      evidence: [{ path: 'consumer.ts', line: 8, reason: 'Direct import and use.' }],
      caveats: ['Runtime configuration was not exercised.']
    };
    const runner = new FakeAgentRunner({ '/fake/codex': JSON.stringify(answer) });
    const service = new AgentHarnessService(await dataDirectory(), runner, { find: async () => '/fake/codex' });
    const result = await service.ask({ kind: 'codex' }, workspace, 'What consumes this?', outline.sections[0]);

    expect(result.value.evidence[0]).toEqual({ path: 'consumer.ts', line: 8, reason: 'Direct import and use.' });
    expect(runner.calls[0].options?.input).toContain('What consumes this?');
  });
});
