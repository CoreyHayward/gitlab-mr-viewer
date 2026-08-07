import type {
  GitLabDiscussionLine,
  GitLabDiscussionPosition,
  GitLabMergeRequestDiscussion
} from '@/types/gitlab';
import type { ReviewFileChange } from '@/review/types';

export type DiffLineKind = 'add' | 'remove' | 'meta' | 'context';

export type ParsedDiffLine = {
  id: string;
  kind: DiffLineKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

export type ParsedDiff = {
  lines: ParsedDiffLine[];
  allLines: ParsedDiffLine[];
  additions: number;
  deletions: number;
  clipped: boolean;
};

export type ReviewThreadAnchor = {
  type: 'old' | 'new';
  line: number;
};

export type InlineReviewThread = {
  id: string;
  discussion: GitLabMergeRequestDiscussion;
  position: GitLabDiscussionPosition | null;
  filePath?: string;
  start: ReviewThreadAnchor | null;
  end: ReviewThreadAnchor | null;
  inline: boolean;
  stale: boolean;
  staleReason?: 'commit' | 'file' | 'line';
  resolved: boolean;
};

export type DiffCommentSelection = {
  file: ReviewFileChange;
  start: ParsedDiffLine;
  end: ParsedDiffLine;
};

export type DiscussionCommitRefs = {
  baseSha: string;
  startSha: string;
  headSha: string;
};

const isCommentableLine = (line: ParsedDiffLine) => line.kind !== 'meta' && (line.oldLine !== null || line.newLine !== null);

const lineTypeFor = (line: ParsedDiffLine): 'old' | 'new' => (
  line.kind === 'remove' || (line.newLine === null && line.oldLine !== null) ? 'old' : 'new'
);

const lineCodePathFor = (file: ReviewFileChange, type: 'old' | 'new') => (
  type === 'old' ? file.oldPath ?? file.path : file.path
);

const lineCode = async (path: string, oldLine: number | null, newLine: number | null) => {
  if (!globalThis.crypto?.subtle) throw new Error('This browser cannot create GitLab diff line anchors.');
  const digest = await globalThis.crypto.subtle.digest('SHA-1', new TextEncoder().encode(path));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hash}_${oldLine ?? 0}_${newLine ?? 0}`;
};

const toDiscussionLine = async (file: ReviewFileChange, line: ParsedDiffLine): Promise<GitLabDiscussionLine> => {
  const type = lineTypeFor(line);
  return {
    line_code: await lineCode(lineCodePathFor(file, type), line.oldLine, line.newLine),
    type,
    ...(line.oldLine === null ? {} : { old_line: line.oldLine }),
    ...(line.newLine === null ? {} : { new_line: line.newLine })
  };

};

export const parseDiff = (diff: string, limit = 260): ParsedDiff => {
  const allLines: ParsedDiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  let inHunk = false;
  let additions = 0;
  let deletions = 0;

  const rawLines = diff.split('\n');
  for (const [rawIndex, rawLine] of rawLines.entries()) {
    if (rawIndex === rawLines.length - 1 && rawLine === '') continue;
    const hunk = rawLine.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      oldLine = Number.parseInt(hunk[1], 10);
      newLine = Number.parseInt(hunk[3], 10);
      inHunk = true;
      allLines.push({
        id: `meta:${allLines.length}`,
        kind: 'meta',
        text: rawLine,
        oldLine: null,
        newLine: null
      });
      continue;
    }

    if (!inHunk || rawLine.startsWith('---') || rawLine.startsWith('+++') || rawLine.startsWith('\\')) continue;

    if (rawLine.startsWith('+')) {
      allLines.push({
        id: `add:${allLines.length}:${newLine}`,
        kind: 'add',
        text: rawLine.slice(1),
        oldLine: null,
        newLine
      });
      additions += 1;
      newLine += 1;
      continue;
    }

    if (rawLine.startsWith('-')) {
      allLines.push({
        id: `remove:${allLines.length}:${oldLine}`,
        kind: 'remove',
        text: rawLine.slice(1),
        oldLine,
        newLine: null
      });
      deletions += 1;
      oldLine += 1;
      continue;
    }

    const text = rawLine.startsWith(' ') ? rawLine.slice(1) : rawLine;
    allLines.push({
      id: `context:${allLines.length}:${oldLine}:${newLine}`,
      kind: 'context',
      text,
      oldLine,
      newLine
    });
    oldLine += 1;
    newLine += 1;
  }

  return {
    lines: allLines.slice(0, limit),
    allLines,
    additions,
    deletions,
    clipped: allLines.length > limit
  };
};

const anchorFromLine = (line: GitLabDiscussionLine | undefined | null): ReviewThreadAnchor | null => {
  if (!line) return null;
  if (line.type === 'old' && line.old_line !== null && line.old_line !== undefined) {
    return { type: 'old', line: line.old_line };
  }
  if (line.type === 'new' && line.new_line !== null && line.new_line !== undefined) {
    return { type: 'new', line: line.new_line };
  }
  if (line.new_line !== null && line.new_line !== undefined) return { type: 'new', line: line.new_line };
  if (line.old_line !== null && line.old_line !== undefined) return { type: 'old', line: line.old_line };
  return null;
};

export const discussionPosition = (discussion: GitLabMergeRequestDiscussion): GitLabDiscussionPosition | null => (
  discussion.notes.find((note) => note.position)?.position ?? null
);

export const discussionAnchors = (position: GitLabDiscussionPosition | null) => {
  if (!position) return { start: null, end: null };
  const range = position.line_range;
  if (range?.start || range?.end) {
    const start = anchorFromLine(range.start ?? range.end);
    const end = anchorFromLine(range.end ?? range.start);
    return { start, end };
  }
  const line: GitLabDiscussionLine = {
    type: position.new_line !== null && position.new_line !== undefined ? 'new' : 'old',
    old_line: position.old_line,
    new_line: position.new_line
  };
  const anchor = anchorFromLine(line);
  return { start: anchor, end: anchor };
};

const pathForPosition = (position: GitLabDiscussionPosition | null) => position?.new_path ?? position?.old_path;

const matchesPath = (file: ReviewFileChange, path: string | undefined) => Boolean(
  path && (file.path === path || file.oldPath === path)
);

const matchesAnchor = (line: ParsedDiffLine, anchor: ReviewThreadAnchor) => (
  anchor.type === 'old' ? line.oldLine === anchor.line : line.newLine === anchor.line
);

export const lineIndexForAnchor = (lines: ParsedDiffLine[], anchor: ReviewThreadAnchor | null) => (
  anchor ? lines.findIndex((line) => matchesAnchor(line, anchor)) : -1
);

export const threadLineIndexes = (lines: ParsedDiffLine[], thread: Pick<InlineReviewThread, 'start' | 'end'>) => {
  const startIndex = lineIndexForAnchor(lines, thread.start);
  const endIndex = lineIndexForAnchor(lines, thread.end ?? thread.start);
  if (startIndex < 0 || endIndex < 0) return null;
  return {
    start: Math.min(startIndex, endIndex),
    end: Math.max(startIndex, endIndex)
  };
};

export const normalizeDiscussions = (
  discussions: GitLabMergeRequestDiscussion[] | undefined,
  currentHeadSha: string,
  files: Array<{ file: ReviewFileChange; lines: ParsedDiffLine[] }>
): InlineReviewThread[] => (Array.isArray(discussions) ? discussions : []).map((discussion) => {
  const position = discussionPosition(discussion);
  const { start, end } = discussionAnchors(position);
  const filePath = pathForPosition(position);
  const fileEntry = files.find(({ file }) => matchesPath(file, filePath));
  const indexes = fileEntry && start && end
    ? threadLineIndexes(fileEntry.lines, { start, end })
    : null;
  const commitIsStale = Boolean(position?.head_sha && position.head_sha !== currentHeadSha);
  const fileIsStale = Boolean(position && filePath && !fileEntry);
  const lineIsStale = Boolean(position && (start === null || end === null || !indexes));
  const staleReason = commitIsStale ? 'commit' : fileIsStale ? 'file' : lineIsStale ? 'line' : undefined;

  return {
    id: discussion.id,
    discussion,
    position,
    filePath,
    start,
    end,
    inline: Boolean(position && fileEntry && indexes),
    stale: Boolean(staleReason),
    staleReason,
    resolved: Boolean(discussion.notes.some((note) => note.resolved))
  };
});

export const createDiscussionPosition = async (
  refs: DiscussionCommitRefs,
  file: ReviewFileChange,
  selection: Pick<DiffCommentSelection, 'start' | 'end'>
): Promise<GitLabDiscussionPosition> => {
  const { start, end } = selection;
  if (!isCommentableLine(start) || !isCommentableLine(end)) throw new Error('Select one or more changed lines to comment on.');

  const position: GitLabDiscussionPosition = {
    base_sha: refs.baseSha,
    start_sha: refs.startSha,
    head_sha: refs.headSha,
    position_type: 'text',
    old_path: file.oldPath ?? file.path,
    new_path: file.path
  };

  if (start.id === end.id) {
    if (start.kind === 'remove') {
      position.old_line = start.oldLine;
    } else {
      position.new_line = start.newLine;
      if (start.kind === 'context') position.old_line = start.oldLine;
    }
    return position;
  }

  position.line_range = {
    start: await toDiscussionLine(file, start),
    end: await toDiscussionLine(file, end)
  };
  return position;
};

export const threadLocationLabel = (thread: Pick<InlineReviewThread, 'start' | 'end'>) => {
  if (!thread.start) return 'General discussion';
  if (!thread.end || (thread.start.type === thread.end.type && thread.start.line === thread.end.line)) {
    return `Line ${thread.start.line}`;
  }
  return `Lines ${Math.min(thread.start.line, thread.end.line)}–${Math.max(thread.start.line, thread.end.line)}`;
};
