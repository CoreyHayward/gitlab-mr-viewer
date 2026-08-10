'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileCode2, Loader2, MessageSquare, MessageSquarePlus, Sparkles, X } from 'lucide-react';
import {
  parseDiff,
  threadLineIndexes,
  threadLocationLabel,
  type InlineReviewThread,
  type ParsedDiffLine
} from '@/review/comments';
import type { ReviewFileChange } from '@/review/types';
import type { GitLabDiscussionNote } from '@/types/gitlab';

export type CommentDraft = {
  file: ReviewFileChange;
  start: ParsedDiffLine;
  end: ParsedDiffLine;
};

export type RangeStart = {
  filePath: string;
  line: ParsedDiffLine;
};

export type CommentAiResult = {
  question: string;
  answer: string;
};

export type CommentAiControls = {
  available: boolean;
  asking: boolean;
  result: CommentAiResult | null;
  error: string | null;
  onAsk: () => void;
  onConfigure: () => void;
  onDismiss: () => void;
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
  context?: { path: string; location: string };
  ai?: CommentAiControls;
};

function CommentComposer({ label, value, onChange, onSubmit, onCancel, saving, error, autoFocus = false, context, ai }: CommentComposerProps) {
  return (
    <form onSubmit={onSubmit} className="mt-2 rounded-xl border border-indigo-200 bg-white p-3 text-slate-950 shadow-lg dark:border-indigo-400/30 dark:bg-slate-900 dark:text-white">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-700 dark:text-indigo-300">{label}</span>
        <button type="button" onClick={onCancel} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white" aria-label="Cancel comment"><X className="h-4 w-4" /></button>
      </div>
      {context && <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-slate-100 px-2.5 py-2 text-[11px] text-slate-600 dark:bg-white/[0.06] dark:text-slate-300"><FileCode2 className="h-3.5 w-3.5 shrink-0 text-indigo-500 dark:text-indigo-300" /><code className="min-w-0 break-all font-semibold">{context.path}</code><span className="rounded-full border border-slate-200 bg-white px-1.5 py-0.5 font-semibold dark:border-white/10 dark:bg-white/[0.06]">{context.location}</span></div>}
      <textarea value={value} onChange={(event) => onChange(event.target.value)} autoFocus={autoFocus} rows={5} placeholder={ai ? 'Write a GitLab comment or ask the AI a question…' : 'Leave a clear, actionable comment…'} className="mt-3 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-white/15 dark:bg-white/[0.05] dark:focus:border-indigo-400 dark:focus:ring-indigo-500/20" aria-label={label} />
      {error && <p className="mt-2 text-xs leading-5 text-rose-700 dark:text-rose-200" role="alert">{error}</p>}
      {ai && (ai.result || ai.error) && <div className={`mt-3 rounded-xl border p-3 ${ai.error ? 'border-rose-200 bg-rose-50 dark:border-rose-500/25 dark:bg-rose-500/10' : 'border-violet-200 bg-violet-50 dark:border-violet-500/25 dark:bg-violet-500/10'}`} role={ai.error ? 'alert' : 'status'}>
        <div className="flex items-center justify-between gap-2"><span className={`inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.14em] ${ai.error ? 'text-rose-700 dark:text-rose-200' : 'text-violet-700 dark:text-violet-200'}`}><Sparkles className="h-3.5 w-3.5" />{ai.error ? 'AI could not answer' : 'Private AI response'}</span><button type="button" onClick={ai.onDismiss} className="rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-white" aria-label="Dismiss AI response"><X className="h-4 w-4" /></button></div>
        {ai.result && <><p className="mt-2 text-xs font-medium text-violet-900 dark:text-violet-100">You asked: {ai.result.question}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">{ai.result.answer}</p></>}
        {ai.error && <p className="mt-2 text-sm leading-6 text-rose-800 dark:text-rose-100">{ai.error}</p>}
        <p className="mt-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">This response has not been posted to GitLab.</p>
      </div>}
      {ai && <p className="mt-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">Ask AI sends this draft and the selected code to your configured provider. It never posts to GitLab.</p>}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving || ai?.asking} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-white/10">Cancel</button>
        {ai && <button type="button" onClick={ai.available ? ai.onAsk : ai.onConfigure} disabled={saving || ai.asking || (ai.available && !value.trim())} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-3 py-2 text-xs font-semibold text-violet-700 shadow-sm hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-400/35 dark:bg-white/[0.04] dark:text-violet-200 dark:hover:bg-violet-500/10">{ai.asking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{ai.asking ? 'Asking…' : ai.available ? 'Ask AI' : 'Set up AI'}</button>}
        <button type="submit" disabled={saving || ai?.asking || !value.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{saving ? 'Posting…' : 'Post comment'}</button>
      </div>
    </form>
  );
}

const diffLineLocation = (line: ParsedDiffLine) => {
  if (line.kind === 'remove' && line.oldLine !== null) return `old line ${line.oldLine}`;
  if (line.newLine !== null) return `new line ${line.newLine}`;
  if (line.oldLine !== null) return `old line ${line.oldLine}`;
  return 'selected line';
};

const commentDraftLocation = (draft: CommentDraft) => draft.start.id === draft.end.id
  ? diffLineLocation(draft.start)
  : `${diffLineLocation(draft.start)} – ${diffLineLocation(draft.end)}`;

export type ThreadCardProps = {
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

export function ThreadCard({ thread, replyThreadId, replyText, replyError, replySaving, onStartReply, onReplyTextChange, onSubmitReply, onCancelReply }: ThreadCardProps) {
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

export type DiffFileProps = {
  file: ReviewFileChange;
  threads: InlineReviewThread[];
  rangeMode: boolean;
  rangeStart: RangeStart | null;
  draft: CommentDraft | null;
  commentText: string;
  commentError: string | null;
  commentSaving: boolean;
  commentAi: CommentAiControls;
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

export function DiffFile({ file, threads, rangeMode, rangeStart, draft, commentText, commentError, commentSaving, commentAi, replyThreadId, replyText, replyError, replySaving, commentsEnabled, onLineAction, onToggleRange, onCommentTextChange, onSubmitComment, onCancelComment, onStartReply, onReplyTextChange, onSubmitReply, onCancelReply }: DiffFileProps) {
  const [open, setOpen] = useState(true);
  const [showAllLines, setShowAllLines] = useState(false);
  const parsed = useMemo(() => parseDiff(file.diff), [file.diff]);
  const displayedLines = showAllLines ? parsed.allLines : parsed.lines;
  const threadsByEndLineId = useMemo(() => {
    const result = new Map<string, InlineReviewThread[]>();
    for (const thread of threads) {
      const indexes = threadLineIndexes(parsed.allLines, thread);
      const lineId = indexes === null ? undefined : parsed.allLines[indexes.end]?.id;
      if (!lineId) continue;
      result.set(lineId, [...(result.get(lineId) ?? []), thread]);
    }
    return result;
  }, [parsed.allLines, threads]);
  const kindLabel = file.kind === 'added' ? 'New file' : file.kind === 'deleted' ? 'Deleted' : file.kind === 'renamed' ? 'Renamed' : 'Changed';
  const kindClass = file.kind === 'added'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200'
    : file.kind === 'deleted'
      ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-100'
      : 'border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300';

  return (
    <figure className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
      <div onClick={() => setOpen((value) => !value)} className="flex cursor-pointer items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-white/10">
        <button type="button" className="min-w-0 text-left" aria-expanded={open}><span className={`mr-2 inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${kindClass}`}>{kindLabel}</span><code className="break-all text-xs font-medium text-slate-800 dark:text-slate-100">{file.path}</code>{file.oldPath && <span className="mt-1 block break-all text-xs text-slate-400">renamed from {file.oldPath}</span>}</button>
        <div className="flex shrink-0 items-center gap-2"><span className="text-xs font-medium"><span className="text-emerald-600 dark:text-emerald-300">+{parsed.additions}</span><span className="ml-2 text-rose-600 dark:text-rose-300">−{parsed.deletions}</span></span><button type="button" onClick={(event) => { event.stopPropagation(); onToggleRange(); }} disabled={!commentsEnabled} className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors ${rangeMode ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-400/35 dark:bg-indigo-500/10 dark:text-indigo-200' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/[0.06]'} disabled:cursor-not-allowed disabled:opacity-50`}>{rangeStart?.filePath === file.path ? 'Choose end line' : 'Select range'}</button>{open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}</div>
      </div>
      {open && <>
        <div className="max-h-[42rem] overflow-x-hidden overflow-y-auto bg-slate-950 py-2 text-xs leading-5 text-slate-200" tabIndex={0} aria-label={`Diff for ${file.path}`}>
          {displayedLines.map((line) => {
            const lineClass = line.kind === 'add' ? 'bg-emerald-500/15 text-emerald-100' : line.kind === 'remove' ? 'bg-rose-500/15 text-rose-100' : line.kind === 'meta' ? 'bg-indigo-500/15 text-indigo-200' : '';
            const marker = line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' ';
            const threadRows = threadsByEndLineId.get(line.id) ?? [];
            const draftEnd = draft?.file.path === file.path && draft.end.id === line.id;
            const rangeSelected = rangeStart?.filePath === file.path && rangeStart.line.id === line.id;
            return <div key={line.id}>
              <div className={`group grid min-w-0 grid-cols-[2rem_3.5rem_3.5rem_1.25rem_minmax(0,1fr)] px-3 ${lineClass} ${rangeSelected ? 'bg-indigo-500/25' : ''}`}><button type="button" onClick={(event) => onLineAction(line, event.shiftKey)} disabled={!commentsEnabled || line.kind === 'meta'} className="flex items-center justify-center rounded text-slate-500 opacity-0 transition-opacity hover:bg-white/10 hover:text-white group-hover:opacity-100 focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-30" aria-label={rangeMode ? `Select ${rangeStart ? 'end' : 'start'} line for comment` : 'Comment on this line'}><MessageSquarePlus className="h-3.5 w-3.5" /></button><span className="select-none pr-3 text-right text-slate-500">{line.oldLine ?? ''}</span><span className="select-none pr-3 text-right text-slate-500">{line.newLine ?? ''}</span><span className="select-none text-slate-500">{marker}</span><code className="diff-line-text min-w-0">{line.text || ' '}</code></div>
              {threadRows.map((thread) => <ThreadCard key={thread.id} thread={thread} replyThreadId={replyThreadId} replyText={replyText} replyError={replyError} replySaving={replySaving} onStartReply={onStartReply} onReplyTextChange={onReplyTextChange} onSubmitReply={onSubmitReply} onCancelReply={onCancelReply} />)}
              {draftEnd && <CommentComposer label={draft.start.id === draft.end.id ? 'Comment on line' : 'Comment on selected lines'} value={commentText} onChange={onCommentTextChange} onSubmit={onSubmitComment} onCancel={onCancelComment} saving={commentSaving} error={commentError} autoFocus context={{ path: draft.file.path, location: commentDraftLocation(draft) }} ai={commentAi} />}
            </div>;
          })}
          {parsed.clipped && !showAllLines && <div className="flex items-center justify-center border-t border-white/10 px-3 py-3"><button type="button" onClick={() => setShowAllLines(true)} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10">Show all {parsed.allLines.length} diff lines</button></div>}
        </div>
        {file.explanation && <figcaption className="border-t border-slate-100 px-4 py-3 text-xs leading-5 text-slate-600 dark:border-white/10 dark:text-slate-300"><strong className="mr-1 font-semibold text-slate-800 dark:text-white">Why this file is here:</strong>{file.explanation}</figcaption>}
      </>}
    </figure>
  );
}
