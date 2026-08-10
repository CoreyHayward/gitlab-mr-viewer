'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Flag,
  HelpCircle,
  Loader2,
  LockKeyhole,
  MessageSquare,
  MessageSquarePlus,
  RefreshCw,
  Send,
  Sparkles,
  X
} from 'lucide-react';
import { askAiAboutReviewSection, createAiReviewOutline } from '@/review/ai';
import {
  createDiscussionPosition,
  normalizeDiscussions,
  parseDiff,
  threadLineIndexes,
  threadLocationLabel,
  type InlineReviewThread,
  type ParsedDiffLine
} from '@/review/comments';
import { createHeuristicReview, normaliseAiReview } from '@/review/organizeReview';
import { readSemanticReviewCache, semanticReviewCacheKey, writeSemanticReviewCache } from '@/review/storage';
import type {
  AiProviderConfig,
  ReviewDelta,
  ReviewFileChange,
  ReviewStatus,
  SavedReviewState,
  SemanticReviewWorkspaceData,
  SemanticSection
} from '@/review/types';
import { GitLabService } from '@/services/gitlab';
import type {
  GitLabDiscussionNote,
  GitLabMergeRequest,
  GitLabMergeRequestChange,
  GitLabMergeRequestReviewDetails
} from '@/types/gitlab';

interface SemanticReviewWorkspaceProps {
  service: GitLabService;
  mergeRequest: GitLabMergeRequest;
  aiConfig: AiProviderConfig | null;
  onClose: () => void;
  onOpenAiSettings: () => void;
}

type ReviewSession = {
  workspace: SemanticReviewWorkspaceData;
  state: SavedReviewState;
};

const MAX_FILES = 90;
const MAX_DIFF_PER_FILE = 8_000;
const MAX_DIFF_TOTAL = 260_000;
const APPROVAL_STEP_ID = '__guided-review-approval__';

type ApprovalState = 'idle' | 'approving' | 'approved' | 'error';

const statusMeta: Record<ReviewStatus, { label: string; dot: string; pill: string }> = {
  'not-started': { label: 'Not read yet', dot: 'bg-slate-300 dark:bg-slate-600', pill: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300' },
  'in-progress': { label: 'Reading now', dot: 'bg-blue-500', pill: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-200' },
  reviewed: { label: 'Reviewed', dot: 'bg-emerald-500', pill: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200' },
  'needs-look': { label: 'Flagged', dot: 'bg-amber-500', pill: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100' },
  blocked: { label: 'Blocking', dot: 'bg-rose-500', pill: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-100' },
  stale: { label: 'Changed since review', dot: 'bg-violet-500', pill: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-100' }
};

const riskMeta = {
  low: { label: 'Quick skim', classes: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300' },
  medium: { label: 'Worth a check', classes: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100' },
  high: { label: 'Look closely', classes: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-100' }
};

const isTypingTarget = (target: EventTarget | null) => (
  target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
);

const changedFileKind = (change: GitLabMergeRequestChange): ReviewFileChange['kind'] => {
  if (change.new_file) return 'added';
  if (change.deleted_file) return 'deleted';
  if (change.renamed_file) return 'renamed';
  return 'modified';
};

const compactChanges = (changes: GitLabMergeRequestChange[] | undefined) => {
  const source = Array.isArray(changes) ? changes : [];
  let used = 0;
  let truncated = source.length > MAX_FILES;
  const compacted: ReviewFileChange[] = [];

  for (const change of source.slice(0, MAX_FILES)) {
    const path = String(change.new_path ?? change.old_path ?? '').trim();
    if (!path) continue;
    const rawDiff = String(change.diff ?? '');
    const remaining = MAX_DIFF_TOTAL - used;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const diff = rawDiff.slice(0, Math.min(MAX_DIFF_PER_FILE, remaining));
    if (rawDiff.length > diff.length) truncated = true;
    used += diff.length;
    compacted.push({
      path,
      oldPath: change.old_path && change.old_path !== path ? change.old_path : undefined,
      kind: changedFileKind(change),
      diff
    });
  }

  return { changes: compacted, truncated };
};

const headSha = (raw: GitLabMergeRequestReviewDetails, mergeRequest: GitLabMergeRequest) => {
  const value = raw.diff_refs?.head_sha ?? raw.sha;
  return typeof value === 'string' && /^[a-f0-9]{7,80}$/i.test(value) ? value : `mr-${mergeRequest.id}-${mergeRequest.updated_at}`;
};

const validSha = (value: string | undefined): value is string => Boolean(value && /^[a-f0-9]{7,80}$/i.test(value));

const projectPathFor = async (service: GitLabService, mergeRequest: GitLabMergeRequest) => {
  if (mergeRequest.project?.path_with_namespace) return mergeRequest.project.path_with_namespace;
  return (await service.getProject(mergeRequest.project_id)).path_with_namespace;
};

const buildDelta = async (
  service: GitLabService,
  mergeRequest: GitLabMergeRequest,
  previousHeadSha: string | undefined,
  currentHeadSha: string,
  signal?: AbortSignal
): Promise<ReviewDelta> => {
  if (!previousHeadSha) {
    return { state: 'first-review', summary: ['This is the first saved review for this merge request.'], changedPaths: [], newPaths: [] };
  }
  if (previousHeadSha === currentHeadSha) {
    return { state: 'unchanged', summary: ['No new commit has landed since this review was last saved.'], changedPaths: [], newPaths: [] };
  }
  if (!/^[a-f0-9]{7,80}$/i.test(previousHeadSha) || !/^[a-f0-9]{7,80}$/i.test(currentHeadSha)) {
    return {
      state: 'updated',
      summary: ['The merge request has a new head commit since you last saved this review.', 'Previously reviewed concepts are marked stale conservatively.'],
      changedPaths: [],
      newPaths: []
    };
  }

  try {
    const comparison = await service.compareMergeRequestCommits(mergeRequest.project_id, previousHeadSha, currentHeadSha, signal);
    const diffs = comparison.diffs ?? [];
    const changedPaths = diffs
      .map((diff) => String(diff.new_path ?? diff.old_path ?? '').trim())
      .filter(Boolean)
      .slice(0, 24);
    const newPaths = diffs
      .filter((diff) => diff.new_file)
      .map((diff) => String(diff.new_path ?? '').trim())
      .filter(Boolean)
      .slice(0, 12);
    return {
      state: 'updated',
      summary: [
        `${changedPaths.length || diffs.length} ${changedPaths.length === 1 ? 'file changed' : 'files changed'} since you last saved this review.`,
        ...(newPaths.length ? [`${newPaths.length} ${newPaths.length === 1 ? 'new file was' : 'new files were'} introduced.`] : []),
        'Previously reviewed concepts touching those files are marked stale.'
      ],
      changedPaths,
      newPaths
    };
  } catch {
    return {
      state: 'updated',
      summary: ['The merge request has a new head commit since you last saved this review.', 'The file-by-file delta was unavailable, so reviewed concepts are marked stale conservatively.'],
      changedPaths: [],
      newPaths: []
    };
  }
};

const cleanSavedState = (sections: SemanticSection[], saved: SavedReviewState | undefined, delta: ReviewDelta): SavedReviewState => {
  const sectionIds = new Set(sections.map((section) => section.id));
  const statuses: SavedReviewState['statuses'] = {};
  const notes: SavedReviewState['notes'] = {};
  for (const [id, status] of Object.entries(saved?.statuses ?? {})) {
    if (sectionIds.has(id)) statuses[id] = status;
  }
  for (const [id, note] of Object.entries(saved?.notes ?? {})) {
    if (sectionIds.has(id) && typeof note === 'string') notes[id] = note;
  }

  if (delta.state === 'updated') {
    const changed = new Set(delta.changedPaths);
    for (const section of sections) {
      const touched = changed.size === 0 || section.filePaths.some((path) => changed.has(path));
      if (touched && (statuses[section.id] === 'reviewed' || statuses[section.id] === 'in-progress')) {
        statuses[section.id] = 'stale';
      }
    }
  }

  const selectedSectionId = saved?.selectedSectionId === APPROVAL_STEP_ID
    ? APPROVAL_STEP_ID
    : saved?.selectedSectionId && sectionIds.has(saved.selectedSectionId)
    ? saved.selectedSectionId
    : sections[0]?.id;
  return { statuses, notes, selectedSectionId };
};

type CommentDraft = {
  file: ReviewFileChange;
  start: ParsedDiffLine;
  end: ParsedDiffLine;
};

type RangeStart = {
  filePath: string;
  line: ParsedDiffLine;
};

type CommentComposerProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
  autoFocus?: boolean;
};

function CommentComposer({ label, value, onChange, onSubmit, onCancel, saving, error, autoFocus = false }: CommentComposerProps) {
  return (
    <form onSubmit={onSubmit} className="mt-2 rounded-xl border border-indigo-200 bg-white p-3 text-slate-950 shadow-lg dark:border-indigo-400/30 dark:bg-slate-900 dark:text-white">
      <div className="flex items-center justify-between gap-3"><span className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-700 dark:text-indigo-300">{label}</span><button type="button" onClick={onCancel} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white" aria-label="Cancel comment"><X className="h-4 w-4" /></button></div>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} autoFocus={autoFocus} rows={4} placeholder="Leave a clear, actionable comment…" className="mt-3 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-white/15 dark:bg-white/[0.05] dark:focus:border-indigo-400 dark:focus:ring-indigo-500/20" aria-label={label} />
      {error && <p className="mt-2 text-xs leading-5 text-rose-700 dark:text-rose-200" role="alert">{error}</p>}
      <div className="mt-3 flex items-center justify-end gap-2"><button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10">Cancel</button><button type="submit" disabled={saving || !value.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{saving ? 'Posting…' : 'Post comment'}</button></div>
    </form>
  );
}

type ThreadCardProps = {
  thread: InlineReviewThread;
  replyThreadId: string | null;
  replyText: string;
  replyError: string | null;
  replySaving: boolean;
  onStartReply: (threadId: string) => void;
  onReplyTextChange: (value: string) => void;
  onSubmitReply: (event: FormEvent<HTMLFormElement>, threadId: string) => void;
  onCancelReply: () => void;
};

const noteAuthor = (note: GitLabDiscussionNote) => note.author?.name || note.author?.username || 'GitLab user';

function ThreadCard({ thread, replyThreadId, replyText, replyError, replySaving, onStartReply, onReplyTextChange, onSubmitReply, onCancelReply }: ThreadCardProps) {
  const rootNote = thread.discussion.notes[0];
  const [collapsed, setCollapsed] = useState(thread.resolved);

  useEffect(() => {
    if (thread.resolved) setCollapsed(true);
  }, [thread.resolved]);

  if (!rootNote) return null;

  const preview = rootNote.body.replace(/\s+/g, ' ').trim();

  return (
    <article className={`mt-2 rounded-xl border p-3 text-left shadow-sm ${thread.stale ? 'border-violet-300 bg-violet-50/95 dark:border-violet-400/35 dark:bg-violet-950/45' : 'border-slate-200 bg-white dark:border-white/15 dark:bg-slate-900/95'}`} aria-label={`Discussion ${threadLocationLabel(thread)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-200">{noteAuthor(rootNote).slice(0, 1).toUpperCase()}</span><span className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{noteAuthor(rootNote)}</span><span className="text-[11px] text-slate-400">{rootNote.created_at ? new Date(rootNote.created_at).toLocaleDateString() : ''}</span></div>
        <div className="flex shrink-0 items-center gap-1.5"><span className="text-[10px] font-bold uppercase tracking-wide"><span className={thread.stale ? 'text-violet-700 dark:text-violet-200' : thread.resolved ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-400'}>{thread.stale ? 'Stale diff' : thread.resolved ? 'Resolved' : threadLocationLabel(thread)}</span></span><button type="button" onClick={() => setCollapsed((value) => !value)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white" aria-expanded={!collapsed} aria-label={collapsed ? 'Expand comments' : 'Collapse comments'}>{collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button></div>
      </div>
      {collapsed ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{preview || 'No comment text'}</p> : <>
        {thread.stale && <p className="mt-2 rounded-lg border border-violet-200 bg-white/60 px-2.5 py-2 text-[11px] leading-5 text-violet-900 dark:border-violet-400/20 dark:bg-white/[0.04] dark:text-violet-100">This thread is attached to an older version of the diff. Read-only placement is preserved here so the conversation is not lost.</p>}
        <div className="mt-3 space-y-3">{thread.discussion.notes.map((note, index) => <div key={note.id} className={index === 0 ? '' : 'border-t border-slate-200 pt-3 dark:border-white/10'}><div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400"><span className="font-semibold text-slate-700 dark:text-slate-200">{noteAuthor(note)}</span><span>·</span><span>{note.created_at ? new Date(note.created_at).toLocaleDateString() : ''}</span>{note.system && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold dark:bg-white/10">System</span>}</div><p className="whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">{note.body}</p></div>)}</div>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-200 pt-2.5 dark:border-white/10"><span className="text-[11px] text-slate-400">{thread.discussion.notes.length} {thread.discussion.notes.length === 1 ? 'comment' : 'comments'}</span><button type="button" onClick={() => onStartReply(thread.id)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-500/10"><MessageSquare className="h-3.5 w-3.5" />Reply</button></div>
        {replyThreadId === thread.id && <CommentComposer label="Reply to thread" value={replyText} onChange={onReplyTextChange} onSubmit={(event) => onSubmitReply(event, thread.id)} onCancel={onCancelReply} saving={replySaving} error={replyError} />}
      </>}
    </article>
  );
}

type DiffFileProps = {
  file: ReviewFileChange;
  threads: InlineReviewThread[];
  rangeMode: boolean;
  rangeStart: RangeStart | null;
  draft: CommentDraft | null;
  commentText: string;
  commentError: string | null;
  commentSaving: boolean;
  replyThreadId: string | null;
  replyText: string;
  replyError: string | null;
  replySaving: boolean;
  commentsEnabled: boolean;
  onLineAction: (line: ParsedDiffLine, shiftKey: boolean) => void;
  onToggleRange: () => void;
  onCommentTextChange: (value: string) => void;
  onSubmitComment: (event: FormEvent<HTMLFormElement>) => void;
  onCancelComment: () => void;
  onStartReply: (threadId: string) => void;
  onReplyTextChange: (value: string) => void;
  onSubmitReply: (event: FormEvent<HTMLFormElement>, threadId: string) => void;
  onCancelReply: () => void;
};

function DiffFile({ file, threads, rangeMode, rangeStart, draft, commentText, commentError, commentSaving, replyThreadId, replyText, replyError, replySaving, commentsEnabled, onLineAction, onToggleRange, onCommentTextChange, onSubmitComment, onCancelComment, onStartReply, onReplyTextChange, onSubmitReply, onCancelReply }: DiffFileProps) {
  const [open, setOpen] = useState(true);
  const parsed = useMemo(() => parseDiff(file.diff), [file.diff]);
  const kindLabel = file.kind === 'added' ? 'New file' : file.kind === 'deleted' ? 'Deleted' : file.kind === 'renamed' ? 'Renamed' : 'Changed';
  const kindClass = file.kind === 'added'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200'
    : file.kind === 'deleted'
      ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-100'
      : 'border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300';

  return (
    <figure className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
      <div onClick={() => setOpen((value) => !value)} className="flex cursor-pointer items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-white/10">
        <button type="button" className="min-w-0 text-left" aria-expanded={open}>
          <span className={`mr-2 inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${kindClass}`}>{kindLabel}</span>
          <code className="break-all text-xs font-medium text-slate-800 dark:text-slate-100">{file.path}</code>
          {file.oldPath && <span className="mt-1 block break-all text-xs text-slate-400">renamed from {file.oldPath}</span>}
        </button>
        <div className="flex shrink-0 items-center gap-2"><span className="text-xs font-medium"><span className="text-emerald-600 dark:text-emerald-300">+{parsed.additions}</span><span className="ml-2 text-rose-600 dark:text-rose-300">−{parsed.deletions}</span></span><button type="button" onClick={(event) => { event.stopPropagation(); onToggleRange(); }} disabled={!commentsEnabled} className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors ${rangeMode ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-400/35 dark:bg-indigo-500/10 dark:text-indigo-200' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/[0.06]'} disabled:cursor-not-allowed disabled:opacity-50`}>{rangeStart?.filePath === file.path ? 'Choose end line' : 'Select range'}</button>{open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}</div>
      </div>
      {open && (
        <>
          <div className="max-h-[42rem] overflow-x-hidden overflow-y-auto bg-slate-950 py-2 text-xs leading-5 text-slate-200" tabIndex={0} aria-label={`Diff for ${file.path}`}>
            {parsed.lines.map((line) => {
              const lineClass = line.kind === 'add' ? 'bg-emerald-500/15 text-emerald-100' : line.kind === 'remove' ? 'bg-rose-500/15 text-rose-100' : line.kind === 'meta' ? 'bg-indigo-500/15 text-indigo-200' : '';
              const marker = line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' ';
              const threadRows = threads.filter((thread) => {
                const indexes = threadLineIndexes(parsed.allLines, thread);
                const index = parsed.allLines.findIndex((candidate) => candidate.id === line.id);
                return indexes && index === indexes.end;
              });
              const draftEnd = draft?.file.path === file.path && draft.end.id === line.id;
              const rangeIndices = rangeStart?.filePath === file.path && rangeStart.line.id !== line.id
                ? threadLineIndexes(parsed.allLines, { start: { type: rangeStart.line.kind === 'remove' ? 'old' : 'new', line: (rangeStart.line.kind === 'remove' ? rangeStart.line.oldLine : rangeStart.line.newLine) ?? 0 }, end: { type: line.kind === 'remove' ? 'old' : 'new', line: (line.kind === 'remove' ? line.oldLine : line.newLine) ?? 0 } })
                : null;
              const rangeSelected = rangeStart?.filePath === file.path && rangeStart.line.id === line.id;
              return <div key={line.id}>
                <div className={`group grid min-w-0 grid-cols-[2rem_3.5rem_3.5rem_1.25rem_minmax(0,1fr)] px-3 ${lineClass} ${rangeSelected || rangeIndices ? 'bg-indigo-500/25' : ''}`}>
                  <button type="button" onClick={(event) => onLineAction(line, event.shiftKey)} disabled={!commentsEnabled || line.kind === 'meta'} className="flex items-center justify-center rounded text-slate-500 opacity-0 transition-opacity hover:bg-white/10 hover:text-white group-hover:opacity-100 focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-30" aria-label={rangeMode ? `Select ${rangeStart ? 'end' : 'start'} line for comment` : 'Comment on this line'}><MessageSquarePlus className="h-3.5 w-3.5" /></button>
                  <span className="select-none pr-3 text-right text-slate-500">{line.oldLine ?? ''}</span><span className="select-none pr-3 text-right text-slate-500">{line.newLine ?? ''}</span><span className="select-none text-slate-500">{marker}</span><code className="diff-line-text min-w-0">{line.text || ' '}</code>
                </div>
                {threadRows.map((thread) => <ThreadCard key={thread.id} thread={thread} replyThreadId={replyThreadId} replyText={replyText} replyError={replyError} replySaving={replySaving} onStartReply={onStartReply} onReplyTextChange={onReplyTextChange} onSubmitReply={onSubmitReply} onCancelReply={onCancelReply} />)}
                {draftEnd && <CommentComposer label={draft.start.id === draft.end.id ? 'Comment on line' : 'Comment on selected lines'} value={commentText} onChange={onCommentTextChange} onSubmit={onSubmitComment} onCancel={onCancelComment} saving={commentSaving} error={commentError} autoFocus />}
              </div>;
            })}
            {parsed.clipped && <div className="grid min-w-0 grid-cols-[2rem_3.5rem_3.5rem_1.25rem_minmax(0,1fr)] px-3 text-slate-400"><span /><span /><span /><span>…</span><span className="min-w-0">Diff clipped for this focused first pass</span></div>}
          </div>
          {file.explanation && <figcaption className="border-t border-slate-100 px-4 py-3 text-xs leading-5 text-slate-600 dark:border-white/10 dark:text-slate-300"><strong className="mr-1 font-semibold text-slate-800 dark:text-white">Why this file is here:</strong>{file.explanation}</figcaption>}
        </>
      )}
    </figure>
  );
}

function LoadingReview() {
  return (
    <div className="min-h-screen bg-[#f7f7f5] px-5 py-12 text-slate-950 dark:bg-[#10131b] dark:text-white">
      <div className="mx-auto flex max-w-xl flex-col items-center rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-white"><Loader2 className="h-6 w-6 animate-spin" /></span>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300">Opening guided review</p>
        <h1 className="mt-2 text-xl font-semibold">Fetching the current diff and building its walkthrough</h1>
        <ol className="mt-7 grid w-full gap-2 text-left text-sm text-slate-600 dark:text-slate-300">
          <li className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-white/[0.05]"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-xs text-white">1</span> Load any saved browser review</li>
          <li className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-white/[0.05]"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-xs text-white">2</span> Fetch the latest merge-request diff</li>
          <li className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-white/[0.05]"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-xs text-white">3</span> Group files into review concepts</li>
        </ol>
      </div>
    </div>
  );
}

export default function SemanticReviewWorkspace({ service, mergeRequest, aiConfig, onClose, onOpenAiSettings }: SemanticReviewWorkspaceProps) {
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [approvalState, setApprovalState] = useState<ApprovalState>('idle');
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState<CommentDraft | null>(null);
  const [commentText, setCommentText] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentSaving, setCommentSaving] = useState(false);
  const [rangeMode, setRangeMode] = useState(false);
  const [rangeStart, setRangeStart] = useState<RangeStart | null>(null);
  const [replyThreadId, setReplyThreadId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySaving, setReplySaving] = useState(false);
  const questionRef = useRef<HTMLInputElement | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const cacheKey = useMemo(
    () => semanticReviewCacheKey(service.getInstanceUrl(), mergeRequest.project_id, mergeRequest.iid),
    [mergeRequest.iid, mergeRequest.project_id, service]
  );

  const loadReview = useCallback(async (forceOrganize = false) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    setNotice(null);
    setAnswer(null);
    setAskError(null);
    setApprovalState('idle');
    setApprovalError(null);
    setCommentDraft(null);
    setCommentText('');
    setCommentError(null);
    setRangeMode(false);
    setRangeStart(null);
    setReplyThreadId(null);
    setReplyText('');
    setReplyError(null);

    try {
      const [rawResult, projectPathResult, discussionsResult] = await Promise.allSettled([
        service.getMergeRequestReviewDetails(mergeRequest.project_id, mergeRequest.iid, controller.signal),
        projectPathFor(service, mergeRequest),
        service.getMergeRequestDiscussions(mergeRequest.project_id, mergeRequest.iid, controller.signal)
      ]);
      if (controller.signal.aborted) return;
      if (rawResult.status === 'rejected') throw rawResult.reason;
      if (projectPathResult.status === 'rejected') throw projectPathResult.reason;
      const raw = rawResult.value;
      const projectPath = projectPathResult.value;
      const { changes, truncated } = compactChanges(raw.changes);
      if (!changes.length) throw new Error('GitLab returned no reviewable changes for this merge request.');

      const previous = readSemanticReviewCache(cacheKey);
      const discussions = discussionsResult.status === 'fulfilled'
        ? discussionsResult.value
        : previous?.workspace.discussions ?? [];
      const discussionsFailure = discussionsResult.status === 'rejected' && !previous?.workspace.discussions
        ? (discussionsResult.reason instanceof Error ? discussionsResult.reason.message : 'GitLab did not return existing discussions.')
        : null;
      const currentHeadSha = headSha(raw, mergeRequest);
      const delta = await buildDelta(service, mergeRequest, previous?.workspace.mergeRequest.headSha, currentHeadSha, controller.signal);
      if (controller.signal.aborted) return;

      const title = raw.title?.trim() || mergeRequest.title || `Merge request !${mergeRequest.iid}`;
      const author = raw.author?.name || raw.author?.username || mergeRequest.author.name || 'GitLab author';
      const metadata = {
        projectId: mergeRequest.project_id,
        projectPath,
        iid: raw.iid ?? mergeRequest.iid,
        title,
        author,
        sourceBranch: raw.source_branch ?? mergeRequest.source_branch,
        targetBranch: raw.target_branch ?? mergeRequest.target_branch,
        webUrl: raw.web_url ?? mergeRequest.web_url,
        baseSha: raw.diff_refs?.base_sha,
        startSha: raw.diff_refs?.start_sha,
        headSha: currentHeadSha,
        changedFiles: Array.isArray(raw.changes) ? raw.changes.length : changes.length
      };

      const shouldReuseCachedOutline = previous?.workspace.mergeRequest.headSha === currentHeadSha && !forceOrganize && (!aiConfig || previous.workspace.ai.used);
      let workspace: SemanticReviewWorkspaceData;
      let aiFailure: string | null = null;

      if (shouldReuseCachedOutline && previous) {
        workspace = {
          ...previous.workspace,
          mergeRequest: metadata,
          delta,
          discussions,
          truncated
        };
      } else {
        const fallback = createHeuristicReview(title, changes, raw.description?.slice(0, 3_000) ?? '');
        let review = fallback;
        let aiUsed = false;
        if (aiConfig) {
          try {
            const outline = await createAiReviewOutline(aiConfig, {
              title,
              description: raw.description?.slice(0, 3_000) ?? '',
              sourceBranch: metadata.sourceBranch,
              targetBranch: metadata.targetBranch
            }, changes, controller.signal);
            review = normaliseAiReview(outline, fallback, changes);
            aiUsed = true;
          } catch (aiError) {
            if (controller.signal.aborted) return;
            aiFailure = aiError instanceof Error ? aiError.message : 'AI organisation was unavailable.';
          }
        }
        workspace = {
          mergeRequest: metadata,
          review,
          delta,
          ai: { configured: Boolean(aiConfig), used: aiUsed },
          discussions,
          truncated
        };
      }

      const state = cleanSavedState(workspace.review.sections, previous?.state, delta);
      setSession({ workspace, state });
      const notices = [
        aiFailure ? `Using local semantic grouping because the AI request did not complete: ${aiFailure}` : null,
        discussionsFailure ? `Existing GitLab discussions could not be loaded: ${discussionsFailure}` : null
      ].filter(Boolean);
      setNotice(notices.length ? notices.join(' ') : null);
    } catch (loadError) {
      if (!controller.signal.aborted) {
        const previous = readSemanticReviewCache(cacheKey);
        if (previous) {
          setSession(previous);
          setNotice('GitLab is unavailable, so this browser is showing your saved review cache.');
        } else {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load this merge request for review.');
        }
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [aiConfig, cacheKey, mergeRequest, service]);

  useEffect(() => {
    void loadReview();
    return () => controllerRef.current?.abort();
  }, [loadReview]);

  useEffect(() => {
    if (!session) return;
    const persisted = writeSemanticReviewCache(cacheKey, session.workspace, session.state);
    if (!persisted) {
      setNotice((current) => current ?? 'This review remains open, but browser storage could not save its full diff.');
    }
  }, [cacheKey, session]);

  const workspace = session?.workspace;
  const sections = useMemo(() => workspace?.review.sections ?? [], [workspace]);
  const selectedId = session?.state.selectedSectionId ?? sections[0]?.id;
  const selected = sections.find((section) => section.id === selectedId) ?? sections[0];
  const selectedIndex = selected ? sections.findIndex((section) => section.id === selected.id) : -1;
  const reviewedCount = sections.filter((section) => session?.state.statuses[section.id] === 'reviewed').length;
  const progressPercent = sections.length ? Math.round((reviewedCount / sections.length) * 100) : 0;
  const isApprovalStep = selectedId === APPROVAL_STEP_ID;
  const commentFiles = useMemo(
    () => sections.flatMap((section) => section.files.map((file) => ({ file, lines: parseDiff(file.diff, Number.POSITIVE_INFINITY).allLines }))),
    [sections]
  );
  const normalizedThreads = useMemo(
    () => normalizeDiscussions(workspace?.discussions, workspace?.mergeRequest.headSha ?? '', commentFiles),
    [commentFiles, workspace?.discussions, workspace?.mergeRequest.headSha]
  );
  const commentsEnabled = Boolean(workspace && validSha(workspace.mergeRequest.baseSha) && validSha(workspace.mergeRequest.startSha) && validSha(workspace.mergeRequest.headSha));

  const scrollToReviewTop = useCallback(() => {
    window.scrollTo(0, 0);
  }, []);

  const updateState = useCallback((updater: (state: SavedReviewState) => SavedReviewState) => {
    setSession((current) => current ? { ...current, state: updater(current.state) } : current);
  }, []);

  const updateWorkspace = useCallback((updater: (workspace: SemanticReviewWorkspaceData) => SemanticReviewWorkspaceData) => {
    setSession((current) => current ? { ...current, workspace: updater(current.workspace) } : current);
  }, []);

  const cancelCommentDraft = useCallback(() => {
    setCommentDraft(null);
    setCommentText('');
    setCommentError(null);
  }, []);

  const handleLineAction = useCallback((file: ReviewFileChange, line: ParsedDiffLine, shiftKey: boolean) => {
    if (!commentsEnabled || line.kind === 'meta') return;
    const shouldSelectRange = rangeMode || shiftKey;
    if (!shouldSelectRange) {
      setCommentDraft({ file, start: line, end: line });
      setCommentText('');
      setCommentError(null);
      return;
    }

    if (!rangeStart || rangeStart.filePath !== file.path) {
      setRangeStart({ filePath: file.path, line });
      setCommentDraft(null);
      setCommentError(null);
      return;
    }

    const parsed = parseDiff(file.diff, Number.POSITIVE_INFINITY);
    const startIndex = parsed.allLines.findIndex((candidate) => candidate.id === rangeStart.line.id);
    const endIndex = parsed.allLines.findIndex((candidate) => candidate.id === line.id);
    if (startIndex < 0 || endIndex < 0) {
      setRangeStart({ filePath: file.path, line });
      return;
    }
    const [first, last] = startIndex <= endIndex
      ? [parsed.allLines[startIndex], parsed.allLines[endIndex]]
      : [parsed.allLines[endIndex], parsed.allLines[startIndex]];
    setCommentDraft({ file, start: first, end: last });
    setCommentText('');
    setCommentError(null);
    setRangeStart(null);
    setRangeMode(false);
  }, [commentsEnabled, rangeMode, rangeStart]);

  const toggleRangeMode = useCallback(() => {
    if (!commentsEnabled) return;
    setCommentDraft(null);
    setCommentText('');
    setCommentError(null);
    setRangeStart(null);
    setRangeMode((value) => !value);
  }, [commentsEnabled]);

  const submitComment = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!workspace || !commentDraft || !commentText.trim()) return;
    const { baseSha, startSha, headSha } = workspace.mergeRequest;
    if (!validSha(baseSha) || !validSha(startSha) || !validSha(headSha)) {
      setCommentError('GitLab did not return complete diff references, so this line cannot be anchored safely. Refresh the review and try again.');
      return;
    }

    setCommentSaving(true);
    setCommentError(null);
    try {
      const position = await createDiscussionPosition(
        { baseSha, startSha, headSha },
        commentDraft.file,
        commentDraft
      );
      const created = await service.createMergeRequestDiscussion(
        workspace.mergeRequest.projectId,
        workspace.mergeRequest.iid,
        commentText.trim(),
        position
      );
      updateWorkspace((current) => ({ ...current, discussions: [...(current.discussions ?? []), created] }));
      cancelCommentDraft();
      setNotice('Comment posted to GitLab.');
    } catch (commentRequestError) {
      const reason = commentRequestError instanceof Error ? ` (${commentRequestError.message})` : '';
      setCommentError(`GitLab could not post this comment. The diff may have changed since it loaded; refresh the review and try again.${reason}`);
    } finally {
      setCommentSaving(false);
    }
  }, [cancelCommentDraft, commentDraft, commentText, service, updateWorkspace, workspace]);

  const startReply = useCallback((threadId: string) => {
    setReplyThreadId(threadId);
    setReplyText('');
    setReplyError(null);
  }, []);

  const cancelReply = useCallback(() => {
    setReplyThreadId(null);
    setReplyText('');
    setReplyError(null);
  }, []);

  const submitReply = useCallback(async (event: FormEvent<HTMLFormElement>, threadId: string) => {
    event.preventDefault();
    if (!workspace || !replyText.trim()) return;
    setReplySaving(true);
    setReplyError(null);
    try {
      const note = await service.addMergeRequestDiscussionNote(
        workspace.mergeRequest.projectId,
        workspace.mergeRequest.iid,
        threadId,
        replyText.trim()
      );
      updateWorkspace((current) => ({
        ...current,
        discussions: (current.discussions ?? []).map((discussion) => discussion.id === threadId
          ? { ...discussion, notes: [...discussion.notes, note] }
          : discussion)
      }));
      cancelReply();
      setNotice('Reply posted to GitLab.');
    } catch (replyRequestError) {
      setReplyError(replyRequestError instanceof Error ? replyRequestError.message : 'GitLab could not post this reply.');
    } finally {
      setReplySaving(false);
    }
  }, [cancelReply, replyText, service, updateWorkspace, workspace]);

  const selectSection = useCallback((id: string) => {
    updateState((state) => ({
      ...state,
      selectedSectionId: id,
      statuses: state.statuses[id] || state.statuses[id] === 'not-started'
        ? state.statuses
        : { ...state.statuses, [id]: 'in-progress' }
    }));
    cancelCommentDraft();
    setRangeStart(null);
    setRangeMode(false);
    cancelReply();
    setAnswer(null);
    setAskError(null);
    scrollToReviewTop();
  }, [cancelCommentDraft, cancelReply, scrollToReviewTop, updateState]);

  const selectApprovalStep = useCallback(() => {
    updateState((state) => ({ ...state, selectedSectionId: APPROVAL_STEP_ID }));
    cancelCommentDraft();
    setRangeStart(null);
    setRangeMode(false);
    cancelReply();
    setAnswer(null);
    setAskError(null);
    scrollToReviewTop();
  }, [cancelCommentDraft, cancelReply, scrollToReviewTop, updateState]);

  const setStatus = useCallback((id: string, status: ReviewStatus) => {
    updateState((state) => ({ ...state, statuses: { ...state.statuses, [id]: status } }));
  }, [updateState]);

  const setNote = useCallback((note: string) => {
    if (!selected) return;
    updateState((state) => ({ ...state, notes: { ...state.notes, [selected.id]: note } }));
  }, [selected, updateState]);

  const moveNext = useCallback(() => {
    if (!selected || isApprovalStep) return;
    const next = sections[selectedIndex + 1];
    updateState((state) => {
      const statuses = { ...state.statuses, [selected.id]: 'reviewed' as const };
      const reviewComplete = sections.every((section) => statuses[section.id] === 'reviewed');
      return {
        ...state,
        statuses,
        selectedSectionId: next?.id ?? (reviewComplete ? APPROVAL_STEP_ID : selected.id)
      };
    });
    setAnswer(null);
    setAskError(null);
    scrollToReviewTop();
  }, [isApprovalStep, sections, scrollToReviewTop, selected, selectedIndex, updateState]);

  const approveReview = useCallback(async () => {
    if (!workspace || approvalState === 'approving' || approvalState === 'approved') return;
    setApprovalState('approving');
    setApprovalError(null);
    try {
      await service.approveMergeRequest(
        workspace.mergeRequest.projectId,
        workspace.mergeRequest.iid,
        workspace.mergeRequest.headSha
      );
      setApprovalState('approved');
    } catch (approvalRequestError) {
      setApprovalState('error');
      setApprovalError(approvalRequestError instanceof Error ? approvalRequestError.message : 'GitLab could not record your approval.');
    }
  }, [approvalState, service, workspace]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey || !selected || isApprovalStep) return;
      const key = event.key.toLowerCase();
      if (key === '?') {
        event.preventDefault();
        setShowShortcuts((open) => !open);
      }
      if (key === 'escape') setShowShortcuts(false);
      if (key === '/' && aiConfig) {
        event.preventDefault();
        questionRef.current?.focus();
      }
      if (key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        const next = sections[selectedIndex + 1];
        if (next) selectSection(next.id);
      }
      if (key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        const previous = sections[selectedIndex - 1];
        if (previous) selectSection(previous.id);
      }
      if (key === 'r') {
        event.preventDefault();
        moveNext();
      }
      if (key === 'f') {
        event.preventDefault();
        setStatus(selected.id, 'needs-look');
      }
      if (key === 'b') {
        event.preventDefault();
        setStatus(selected.id, 'blocked');
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [aiConfig, isApprovalStep, moveNext, sections, selectSection, selected, selectedIndex, setStatus]);

  const askQuestion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!aiConfig || !selected || !question.trim()) return;
    setAsking(true);
    setAskError(null);
    setAnswer(null);
    try {
      const response = await askAiAboutReviewSection(aiConfig, question.trim(), selected);
      setAnswer(response);
    } catch (askRequestError) {
      setAskError(askRequestError instanceof Error ? askRequestError.message : 'Unable to ask the AI about this section.');
    } finally {
      setAsking(false);
    }
  };

  if (loading && !session) return <LoadingReview />;

  if (!workspace || !selected || !session) {
    return (
      <div className="min-h-screen bg-[#f7f7f5] px-5 py-12 text-slate-950 dark:bg-[#10131b] dark:text-white">
        <div className="mx-auto max-w-xl rounded-2xl border border-rose-200 bg-white p-6 shadow-sm dark:border-rose-500/25 dark:bg-white/[0.035]">
          <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 text-rose-600 dark:text-rose-300" /><div><h1 className="font-semibold">Guided review could not open</h1><p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{error ?? 'No reviewable code was returned.'}</p></div></div>
          <div className="mt-5 flex gap-3"><button type="button" onClick={() => void loadReview()} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Try again</button><button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-white/10">Back to merge requests</button></div>
        </div>
      </div>
    );
  }

  const selectedStatus = session.state.statuses[selected.id] ?? 'not-started';
  const relatedFiles = sections
    .filter((section) => selected.relatedSectionIds.includes(section.id))
    .flatMap((section) => section.filePaths)
    .filter((path, index, paths) => paths.indexOf(path) === index && !selected.filePaths.includes(path));
  const otherThreads = normalizedThreads.filter((thread) => !thread.inline);
  const selectedThreadCount = selected.files.reduce((count, file) => count + normalizedThreads.filter((thread) => thread.inline && (thread.filePath === file.path || thread.filePath === file.oldPath)).length, 0);

  return (
    <div className="min-h-screen bg-[#f7f7f5] text-slate-950 dark:bg-[#10131b] dark:text-white">
      <header className="sticky top-0 z-30 border-b border-slate-200/90 bg-[#f7f7f5]/95 backdrop-blur dark:border-white/10 dark:bg-[#10131b]/95">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={onClose} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white"><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Merge requests</span></button>
            <span className="hidden h-5 w-px bg-slate-200 dark:bg-white/10 sm:block" />
            <div className="min-w-0"><div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600 text-[11px] font-bold text-white">M</span><span className="text-sm font-semibold">Guided review</span></div><p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{workspace.mergeRequest.projectPath} · !{workspace.mergeRequest.iid}</p></div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs font-medium text-slate-500 sm:inline">{reviewedCount}/{sections.length} reviewed</span>
            <span className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-slate-200 sm:inline dark:bg-white/10"><span className="block h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${progressPercent}%` }} /></span>
            {workspace.mergeRequest.webUrl && <a href={workspace.mergeRequest.webUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white"><span className="hidden sm:inline">Open merge request</span><span className="sm:hidden">Open MR</span><ArrowUpRight className="h-3.5 w-3.5" /></a>}
            <button type="button" onClick={onOpenAiSettings} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors ${aiConfig ? 'text-indigo-700 hover:bg-indigo-50 dark:text-indigo-200 dark:hover:bg-indigo-500/10' : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-white/[0.08]'}`}><Sparkles className="h-3.5 w-3.5" />{aiConfig ? 'AI settings' : 'Add AI'}</button>
            <button type="button" onClick={() => void loadReview(true)} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-60 dark:bg-indigo-500 dark:text-slate-950 dark:hover:bg-indigo-400"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Reorganise</button>
          </div>
        </div>
      </header>

      {notice && <div className="mx-auto max-w-[1800px] px-4 pt-4 sm:px-6"><div className="flex items-start gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2.5 text-xs leading-5 text-indigo-900 dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-100"><Bot className="mt-0.5 h-4 w-4 shrink-0" /><span>{notice}</span><button type="button" onClick={() => setNotice(null)} className="ml-auto p-0.5 text-indigo-500 hover:text-indigo-800 dark:text-indigo-300 dark:hover:text-white" aria-label="Dismiss notice"><X className="h-4 w-4" /></button></div></div>}

      <div className="mx-auto grid max-w-[1800px] gap-5 px-4 py-5 lg:grid-cols-[17rem_minmax(0,1fr)_20rem] sm:px-6">
        <aside className="min-w-0 lg:sticky lg:top-[4.75rem] lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
            <div className="flex items-center justify-between gap-2 px-2 pb-3"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300">Review map</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sections.length} concepts · {workspace.mergeRequest.changedFiles} files</p></div><button type="button" onClick={() => setShowShortcuts(true)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white" aria-label="Show keyboard shortcuts"><HelpCircle className="h-4 w-4" /></button></div>
            <nav className="space-y-1" aria-label="Guided review map">
              {sections.map((section, index) => {
                const status = session.state.statuses[section.id] ?? 'not-started';
                const active = !isApprovalStep && section.id === selected.id;
                return <button key={section.id} type="button" onClick={() => selectSection(section.id)} className={`w-full rounded-xl px-2.5 py-2.5 text-left transition-colors ${active ? 'bg-indigo-600 text-white shadow-sm' : 'hover:bg-slate-100 dark:hover:bg-white/[0.06]'}`} aria-current={active ? 'step' : undefined}>
                  <span className="flex items-start gap-2"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${active ? 'bg-white' : statusMeta[status].dot}`} /><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className={`text-[10px] font-bold ${active ? 'text-indigo-100' : 'text-slate-400'}`}>{index + 1}</span><span className="truncate text-sm font-semibold">{section.title}</span></span><span className={`mt-1 flex items-center gap-1 text-[11px] ${active ? 'text-indigo-100' : 'text-slate-500 dark:text-slate-400'}`}><FileCode2 className="h-3 w-3" />{section.files.length} {section.files.length === 1 ? 'file' : 'files'}<span className={`ml-auto rounded-full border px-1.5 py-0.5 font-semibold ${active ? 'border-white/25 bg-white/10 text-white' : riskMeta[section.risk].classes}`}>{section.risk}</span></span></span></span>
                </button>;
              })}
              <button type="button" onClick={selectApprovalStep} className={`w-full rounded-xl px-2.5 py-2.5 text-left transition-colors ${isApprovalStep ? 'bg-indigo-600 text-white shadow-sm' : 'hover:bg-slate-100 dark:hover:bg-white/[0.06]'}`} aria-current={isApprovalStep ? 'step' : undefined}>
                <span className="flex items-start gap-2"><span className={`mt-1.5 flex h-2 w-2 shrink-0 rounded-full ${isApprovalStep ? 'bg-white' : 'bg-emerald-500'}`} /><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><Check className={`h-3 w-3 ${isApprovalStep ? 'text-indigo-100' : 'text-emerald-600 dark:text-emerald-300'}`} /><span className="truncate text-sm font-semibold">Final decision</span></span><span className={`mt-1 block text-[11px] ${isApprovalStep ? 'text-indigo-100' : 'text-slate-500 dark:text-slate-400'}`}>Ready to approve</span></span></span>
              </button>
            </nav>
          </div>
        </aside>

        <main className={`min-w-0 space-y-5 ${isApprovalStep ? 'lg:col-span-2' : ''}`}>
          {isApprovalStep ? <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-600 dark:text-emerald-300">Final decision</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">Ready to approve?</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">You have reviewed {reviewedCount} of {sections.length} {sections.length === 1 ? 'concept' : 'concepts'} in this merge request. If everything looks good, record your approval in GitLab.</p>
            <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/[0.04]"><div className="flex items-start gap-3"><Check className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-300" /><div><p className="text-sm font-semibold text-slate-900 dark:text-white">Final review decision</p><p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">Your private notes remain saved in this browser.</p></div></div></div>
            {approvalState === 'approved' ? <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-100" role="status">Approved in GitLab.</div> : <>
              {approvalError && <p className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-100" role="alert">{approvalError}</p>}
              <div className="mt-6 flex flex-wrap gap-3"><button type="button" onClick={() => void approveReview()} disabled={approvalState === 'approving'} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60">{approvalState === 'approving' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{approvalState === 'error' ? 'Try approval again' : 'Approve merge request'}</button><button type="button" onClick={() => selectSection(sections[sections.length - 1].id)} className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/[0.06]">Back to last concept</button></div>
            </>}
          </section> : <>
          <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.035]" open>
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-5 py-4"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300">Merge request</p><h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-950 dark:text-white">{workspace.mergeRequest.title}</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{workspace.mergeRequest.author} · <code>{workspace.mergeRequest.sourceBranch}</code> → <code>{workspace.mergeRequest.targetBranch}</code></p></div><ChevronDown className="mt-1 h-5 w-5 text-slate-400 transition-transform group-open:rotate-180" /></summary>
            <div className="border-t border-slate-100 px-5 py-4 text-sm leading-6 text-slate-600 dark:border-white/10 dark:text-slate-300"><p>{workspace.review.overview.purpose}</p><dl className="mt-4 grid gap-3 sm:grid-cols-2"><div><dt className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Scope</dt><dd className="mt-1">{workspace.review.overview.scope}</dd></div><div><dt className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Attention</dt><dd className="mt-1">{workspace.review.overview.riskSummary}</dd></div></dl>{workspace.truncated && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100">Large diffs were clipped in this saved review so it remains focused and browser-safe.</p>}{workspace.delta.state === 'updated' && <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs leading-5 text-violet-900 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-100"><strong>New commits since your last review</strong><ul className="mt-1 list-disc space-y-0.5 pl-4">{workspace.delta.summary.map((item) => <li key={item}>{item}</li>)}</ul></div>}</div>
          </details>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
            <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300">Concept {selectedIndex + 1} of {sections.length}</span><span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${riskMeta[selected.risk].classes}`}>{riskMeta[selected.risk].label}</span><span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusMeta[selectedStatus].pill}`}>{statusMeta[selectedStatus].label}</span>{selectedThreadCount > 0 && <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-200"><MessageSquare className="h-3 w-3" />{selectedThreadCount} {selectedThreadCount === 1 ? 'thread' : 'threads'}</span>}</div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">{selected.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{selected.intent}</p>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-white/10 dark:bg-white/[0.04]"><p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">What to check</p><p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-200">{selected.reviewFocus}</p></div>
          </section>

          <section className="space-y-3" aria-label="Changed code">
            {selected.files.map((file) => <DiffFile key={file.path} file={file} threads={normalizedThreads.filter((thread) => thread.inline && (thread.filePath === file.path || thread.filePath === file.oldPath))} rangeMode={rangeMode} rangeStart={rangeStart} draft={commentDraft} commentText={commentText} commentError={commentError} commentSaving={commentSaving} replyThreadId={replyThreadId} replyText={replyText} replyError={replyError} replySaving={replySaving} commentsEnabled={commentsEnabled} onLineAction={(line, shiftKey) => handleLineAction(file, line, shiftKey)} onToggleRange={toggleRangeMode} onCommentTextChange={setCommentText} onSubmitComment={submitComment} onCancelComment={cancelCommentDraft} onStartReply={startReply} onReplyTextChange={setReplyText} onSubmitReply={submitReply} onCancelReply={cancelReply} />)}
          </section>
          </>}
        </main>

        {!isApprovalStep && <aside className="space-y-4 lg:sticky lg:top-[4.75rem] lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
            <div className="flex items-center justify-between gap-3"><h2 className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Ask about this code</h2>{aiConfig && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-300"><Sparkles className="h-3 w-3" />AI</span>}</div>
            {aiConfig ? <><form onSubmit={askQuestion} className="mt-3 flex gap-2"><input ref={questionRef} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What calls this? Is failure covered?" className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-white/15 dark:bg-white/[0.05] dark:text-white dark:focus:border-indigo-400 dark:focus:ring-indigo-500/20" /><button type="submit" disabled={asking || !question.trim()} className="inline-flex w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50" aria-label="Ask AI">{asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button></form><div className="mt-3 space-y-1">{selected.prompts.map((prompt) => <button key={prompt} type="button" onClick={() => { setQuestion(prompt); questionRef.current?.focus(); }} className="block w-full rounded-lg px-2 py-1.5 text-left text-xs leading-5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white">{prompt}</button>)}</div>{(answer || askError) && <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 dark:border-white/10 dark:bg-white/[0.04]"><div className="mb-2 flex items-center justify-between gap-2"><span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">{askError ? 'Could not answer' : 'Evidence-led answer'}</span><button type="button" onClick={() => { setAnswer(null); setAskError(null); }} className="text-slate-400 hover:text-slate-700 dark:hover:text-white" aria-label="Dismiss answer"><X className="h-4 w-4" /></button></div>{askError ? <p className="text-rose-700 dark:text-rose-200">{askError}</p> : <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{answer}</p>}<p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">Based only on the changed files shown in this concept.</p></div>}</> : <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 dark:border-white/15 dark:bg-white/[0.04]"><div className="flex gap-2"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /><div><p className="text-sm font-medium text-slate-700 dark:text-slate-200">AI is optional</p><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Local semantic grouping is active. Add your own provider to ask questions about this changed code.</p><button type="button" onClick={onOpenAiSettings} className="mt-2 text-xs font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Add AI settings</button></div></div></div>}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.035]"><h2 className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Private note</h2><textarea value={session.state.notes[selected.id] ?? ''} onChange={(event) => setNote(event.target.value)} placeholder="Anything you still need to verify…" rows={5} className="mt-3 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-white/15 dark:bg-white/[0.05] dark:text-white dark:focus:border-indigo-400 dark:focus:ring-indigo-500/20" /><p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">Saved only in this browser. Never sent to GitLab.</p></section>

          {otherThreads.length > 0 && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.035]"><div className="flex items-center justify-between gap-2"><h2 className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Other discussions</h2><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-white/10 dark:text-slate-300">{otherThreads.length}</span></div><p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">General comments and threads whose old anchor is no longer in this diff.</p>{otherThreads.map((thread) => <ThreadCard key={thread.id} thread={thread} replyThreadId={replyThreadId} replyText={replyText} replyError={replyError} replySaving={replySaving} onStartReply={startReply} onReplyTextChange={setReplyText} onSubmitReply={submitReply} onCancelReply={cancelReply} />)}</section>}

          {relatedFiles.length > 0 && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.035]"><h2 className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Related code</h2><ul className="mt-3 space-y-1.5">{relatedFiles.map((path) => <li key={path} className="break-all rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">{path}</li>)}</ul></section>}
        </aside>}
      </div>

      {!isApprovalStep && <footer className="sticky bottom-0 z-20 border-t border-slate-200 bg-[#f7f7f5]/95 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-[#10131b]/95 sm:px-6"><div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3"><span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400"><span className={`h-2 w-2 rounded-full ${statusMeta[selectedStatus].dot}`} />{selected.files.length} {selected.files.length === 1 ? 'file' : 'files'} in view</span><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setStatus(selected.id, 'needs-look')} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50 dark:border-amber-500/25 dark:bg-white/[0.04] dark:text-amber-100 dark:hover:bg-amber-500/10"><Flag className="h-3.5 w-3.5" />Flag <kbd className="hidden rounded bg-amber-100 px-1 font-mono text-[10px] sm:inline dark:bg-amber-500/15">F</kbd></button><button type="button" onClick={() => setStatus(selected.id, 'blocked')} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-800 hover:bg-rose-50 dark:border-rose-500/25 dark:bg-white/[0.04] dark:text-rose-100 dark:hover:bg-rose-500/10"><AlertTriangle className="h-3.5 w-3.5" />Block <kbd className="hidden rounded bg-rose-100 px-1 font-mono text-[10px] sm:inline dark:bg-rose-500/15">B</kbd></button><button type="button" onClick={moveNext} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"><Check className="h-3.5 w-3.5" />{selectedIndex === sections.length - 1 ? 'Mark reviewed' : 'Reviewed, next'} <kbd className="hidden rounded bg-white/15 px-1 font-mono text-[10px] sm:inline">R</kbd></button></div></div></footer>}

      {showShortcuts && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"><div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-[#f7f7f5] p-5 shadow-2xl dark:border-white/10 dark:bg-[#10131b]"><div className="flex items-center justify-between"><h2 className="font-semibold">Keyboard shortcuts</h2><button type="button" onClick={() => setShowShortcuts(false)} className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white" aria-label="Close shortcuts"><X className="h-5 w-5" /></button></div><dl className="mt-4 grid grid-cols-[3rem_1fr] gap-y-3 text-sm text-slate-600 dark:text-slate-300"><dt><kbd className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs dark:bg-white/10">J/K</kbd></dt><dd>Next / previous concept</dd><dt><kbd className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs dark:bg-white/10">R</kbd></dt><dd>Mark reviewed and move on</dd><dt><kbd className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs dark:bg-white/10">F/B</kbd></dt><dd>Flag / mark blocking</dd><dt><kbd className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs dark:bg-white/10">/</kbd></dt><dd>Ask AI about selected code</dd><dt><kbd className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs dark:bg-white/10">?</kbd></dt><dd>Toggle this guide</dd></dl></div></div>}
    </div>
  );
}
