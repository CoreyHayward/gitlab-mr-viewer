'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Check,
  Circle,
  Clock,
  Eye,
  FileText,
  GitBranch,
  Loader2,
  MessageSquare,
  Tag,
  TriangleAlert,
  User,
  X
} from 'lucide-react';
import { getApprovalCategory } from '@/utils/approvalState';
import { GitLabMergeRequest, GitLabUser } from '@/types/gitlab';

export type DeskView = 'inbox' | 'my-work' | 'team-pulse';

interface MergeDeskProps {
  mergeRequests: GitLabMergeRequest[];
  loading: boolean;
  currentUser: GitLabUser | null;
  view: DeskView;
  scopeLabel: string;
}

type RowTone = 'review' | 'blocked' | 'waiting' | 'ready' | 'watch';

interface RowSignal {
  tone: RowTone;
  action: string;
  reason: string;
}

interface DeskClassification {
  authorIsCurrentUser: boolean;
  approvalNeeded: boolean;
  blocked: boolean;
  ready: boolean;
  reviewNeeded: boolean;
  signal: RowSignal;
}

interface DeskGroup {
  title: string;
  description: string;
  emptyMessage: string;
  mergeRequests: GitLabMergeRequest[];
}

const failedPipelineStatuses = new Set(['failed', 'canceled']);

const formatRelativeTime = (dateString: string) => {
  const diffMinutes = Math.round((new Date(dateString).getTime() - Date.now()) / 60_000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  if (Math.abs(diffMinutes) < 60) return formatter.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  return formatter.format(diffDays, 'day');
};

const getDiffSize = (mergeRequest: GitLabMergeRequest) => {
  if (!mergeRequest.diff_stats) return null;

  const total = mergeRequest.diff_stats.additions + mergeRequest.diff_stats.deletions;
  if (total < 10) return 'XS';
  if (total < 100) return 'S';
  if (total < 500) return 'M';
  if (total < 1000) return 'L';
  return 'XL';
};

const isCurrentUser = (user: GitLabUser | undefined, currentUser: GitLabUser | null) => (
  Boolean(user && currentUser && user.username === currentUser.username)
);

const isCurrentUserReviewer = (mergeRequest: GitLabMergeRequest, currentUser: GitLabUser | null) => (
  Boolean(currentUser && mergeRequest.reviewers.some((reviewer) => reviewer.username === currentUser.username))
);

const isApprovedByCurrentUser = (mergeRequest: GitLabMergeRequest, currentUser: GitLabUser | null) => (
  Boolean(currentUser && mergeRequest.approval_status?.approved_by.some(({ user }) => user.username === currentUser.username))
);

const hasFailedPipeline = (mergeRequest: GitLabMergeRequest) => (
  Boolean(mergeRequest.pipeline && failedPipelineStatuses.has(mergeRequest.pipeline.status))
);

const hasMergeConflict = (mergeRequest: GitLabMergeRequest) => (
  mergeRequest.detailed_merge_status.toLowerCase().includes('conflict') ||
  mergeRequest.detailed_merge_status === 'cannot_be_merged'
);

const needsApproval = (mergeRequest: GitLabMergeRequest) => {
  const category = getApprovalCategory(mergeRequest);
  return category === 'needs-review' || category === 'partially-approved';
};

const isReadyToMerge = (mergeRequest: GitLabMergeRequest) => {
  const approvalCategory = getApprovalCategory(mergeRequest);
  const pipelineReady = !mergeRequest.pipeline || mergeRequest.pipeline.status === 'success';

  return (
    mergeRequest.state === 'opened' &&
    !mergeRequest.draft &&
    !hasFailedPipeline(mergeRequest) &&
    !hasMergeConflict(mergeRequest) &&
    pipelineReady &&
    (approvalCategory === 'approved' || approvalCategory === 'no-approval-required')
  );
};

const getDeskClassification = (mergeRequest: GitLabMergeRequest, currentUser: GitLabUser | null): DeskClassification => {
  const authorIsCurrentUser = isCurrentUser(mergeRequest.author, currentUser);
  const assignedReviewer = isCurrentUserReviewer(mergeRequest, currentUser);
  const approvalNeeded = needsApproval(mergeRequest);
  const blocked = hasFailedPipeline(mergeRequest) || hasMergeConflict(mergeRequest);
  const ready = isReadyToMerge(mergeRequest);
  const reviewNeeded = assignedReviewer && !isApprovedByCurrentUser(mergeRequest, currentUser) && mergeRequest.state === 'opened' && !ready && !blocked;

  if (hasFailedPipeline(mergeRequest)) {
    return {
      authorIsCurrentUser,
      approvalNeeded,
      blocked,
      ready,
      reviewNeeded,
      signal: {
        tone: 'blocked',
        action: 'Unblock',
        reason: `${authorIsCurrentUser ? 'Your MR' : 'Pipeline'} · CI failed`
      }
    };
  }

  if (hasMergeConflict(mergeRequest)) {
    return {
      authorIsCurrentUser,
      approvalNeeded,
      blocked,
      ready,
      reviewNeeded,
      signal: {
        tone: 'blocked',
        action: 'Unblock',
        reason: `${authorIsCurrentUser ? 'Your MR' : 'Merge'} · conflict to resolve`
      }
    };
  }

  if (reviewNeeded) {
    return {
      authorIsCurrentUser,
      approvalNeeded,
      blocked,
      ready,
      reviewNeeded,
      signal: {
        tone: 'review',
        action: 'Review',
        reason: 'You are a requested reviewer'
      }
    };
  }

  if (approvalNeeded) {
    const left = mergeRequest.approval_status?.approvals_left;
    return {
      authorIsCurrentUser,
      approvalNeeded,
      blocked,
      ready,
      reviewNeeded,
      signal: {
        tone: 'waiting',
        action: authorIsCurrentUser ? 'Watch' : 'Review',
        reason: left ? `${left} approval${left === 1 ? '' : 's'} still needed` : 'Approval still needed'
      }
    };
  }

  if (ready) {
    return {
      authorIsCurrentUser,
      approvalNeeded,
      blocked,
      ready,
      reviewNeeded,
      signal: {
        tone: 'ready',
        action: 'Open',
        reason: 'Ready for merge'
      }
    };
  }

  return {
    authorIsCurrentUser,
    approvalNeeded,
    blocked,
    ready,
    reviewNeeded,
    signal: {
      tone: 'watch',
      action: 'Watch',
      reason: mergeRequest.draft ? 'Draft · work in progress' : 'Waiting for activity'
    }
  };
};

const signalStyles: Record<RowTone, { dot: string; badge: string }> = {
  review: {
    dot: 'border-indigo-500 bg-indigo-50 text-indigo-600 dark:border-indigo-400 dark:bg-indigo-400/10 dark:text-indigo-300',
    badge: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300'
  },
  blocked: {
    dot: 'border-rose-500 bg-rose-50 text-rose-600 dark:border-rose-400 dark:bg-rose-400/10 dark:text-rose-300',
    badge: 'bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300'
  },
  waiting: {
    dot: 'border-amber-500 bg-amber-50 text-amber-700 dark:border-amber-400 dark:bg-amber-400/10 dark:text-amber-300',
    badge: 'bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-200'
  },
  ready: {
    dot: 'border-emerald-500 bg-emerald-50 text-emerald-600 dark:border-emerald-400 dark:bg-emerald-400/10 dark:text-emerald-300',
    badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300'
  },
  watch: {
    dot: 'border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-600 dark:bg-white/5 dark:text-slate-300',
    badge: 'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300'
  }
};

function UrgencyGlyph({ tone }: { tone: RowTone }) {
  const styles = signalStyles[tone].dot;

  if (tone === 'blocked') {
    return <TriangleAlert className={`h-4 w-4 ${styles}`} aria-hidden="true" />;
  }

  if (tone === 'ready') {
    return <Check className={`h-4 w-4 ${styles}`} aria-hidden="true" />;
  }

  if (tone === 'waiting') {
    return <AlertTriangle className={`h-4 w-4 ${styles}`} aria-hidden="true" />;
  }

  return <Circle className={`h-4 w-4 ${styles}`} aria-hidden="true" />;
}

function MergeRequestRow({
  mergeRequest,
  currentUser,
  selected,
  onSelect
}: {
  mergeRequest: GitLabMergeRequest;
  currentUser: GitLabUser | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const signal = getDeskClassification(mergeRequest, currentUser).signal;
  const projectName = mergeRequest.project?.path_with_namespace ?? `Project #${mergeRequest.project_id}`;
  const diffSize = getDiffSize(mergeRequest);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group grid w-full grid-cols-[20px_minmax(0,1fr)_auto] gap-x-3 border-b border-slate-200/80 px-3 py-3.5 text-left transition-colors last:border-b-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:border-white/10 ${
        selected
          ? 'bg-indigo-50/80 dark:bg-indigo-400/10'
          : 'hover:bg-slate-50 dark:hover:bg-white/[0.035]'
      }`}
    >
      <div className="pt-1">
        <UrgencyGlyph tone={signal.tone} />
      </div>
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="truncate font-mono text-slate-500 dark:text-slate-400">{projectName}</span>
          <span className="font-mono text-slate-400 dark:text-slate-500">!{mergeRequest.iid}</span>
          {mergeRequest.draft && <span className="font-medium text-amber-700 dark:text-amber-300">Draft</span>}
        </div>
        <div className="truncate text-sm font-semibold text-slate-900 transition-colors group-hover:text-indigo-700 dark:text-white dark:group-hover:text-indigo-300">
          {mergeRequest.title}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span>{mergeRequest.author.name}</span>
          <span aria-hidden="true">·</span>
          <span title={new Date(mergeRequest.updated_at).toLocaleString()}>updated {formatRelativeTime(mergeRequest.updated_at)}</span>
          {diffSize && <><span aria-hidden="true">·</span><span>{diffSize} change</span></>}
          {mergeRequest.user_notes_count > 0 && <><span aria-hidden="true">·</span><span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" />{mergeRequest.user_notes_count}</span></>}
        </div>
      </div>
      <div className="flex items-center self-center">
        <span className={`rounded-md px-2 py-1 text-xs font-medium ${signalStyles[signal.tone].badge}`}>
          {signal.action}
        </span>
      </div>
      <div className="col-start-2 col-end-4 mt-2 truncate text-xs font-medium text-slate-600 dark:text-slate-300">
        {signal.reason}
      </div>
    </button>
  );
}

function QueueGroup({
  group,
  currentUser,
  selectedId,
  onSelect
}: {
  group: DeskGroup;
  currentUser: GitLabUser | null;
  selectedId: number | null;
  onSelect: (mergeRequest: GitLabMergeRequest) => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/35">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-3 dark:border-white/10">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{group.title}</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{group.description}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600 dark:bg-white/10 dark:text-slate-300">
          {group.mergeRequests.length}
        </span>
      </div>
      {group.mergeRequests.length > 0 ? (
        <div>
          {group.mergeRequests.map((mergeRequest) => (
            <MergeRequestRow
              key={mergeRequest.id}
              mergeRequest={mergeRequest}
              currentUser={currentUser}
              selected={selectedId === mergeRequest.id}
              onSelect={() => onSelect(mergeRequest)}
            />
          ))}
        </div>
      ) : (
        <div className="px-4 py-5 text-sm text-slate-500 dark:text-slate-400">{group.emptyMessage}</div>
      )}
    </section>
  );
}

function FocusPanel({
  mergeRequest,
  currentUser,
  onClose
}: {
  mergeRequest: GitLabMergeRequest | null;
  currentUser: GitLabUser | null;
  onClose: () => void;
}) {
  if (!mergeRequest) {
    return (
      <aside className="hidden rounded-xl border border-dashed border-slate-300 bg-slate-50/75 p-5 lg:block dark:border-slate-700 dark:bg-white/[0.025]">
        <Eye className="h-5 w-5 text-slate-400" />
        <h2 className="mt-4 text-sm font-semibold text-slate-900 dark:text-white">Focus</h2>
        <p className="mt-1.5 text-sm leading-6 text-slate-500 dark:text-slate-400">Select a merge request to see the evidence behind its priority.</p>
      </aside>
    );
  }

  const signal = getDeskClassification(mergeRequest, currentUser).signal;
  const approvalStatus = mergeRequest.approval_status;
  const projectName = mergeRequest.project?.path_with_namespace ?? `Project #${mergeRequest.project_id}`;
  const diffSize = getDiffSize(mergeRequest);
  const pipelineLabel = mergeRequest.pipeline ? mergeRequest.pipeline.status : 'No pipeline';
  const pipelineTone = hasFailedPipeline(mergeRequest)
    ? 'text-rose-700 dark:text-rose-300'
    : mergeRequest.pipeline?.status === 'success'
      ? 'text-emerald-700 dark:text-emerald-300'
      : 'text-slate-700 dark:text-slate-300';

  return (
    <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-5 dark:border-white/10 dark:bg-slate-950/45">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="truncate font-mono">{projectName}</span>
            <span className="font-mono">!{mergeRequest.iid}</span>
          </div>
          <h2 className="mt-2 text-base font-semibold leading-6 text-slate-950 dark:text-white">{mergeRequest.title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-200"
          aria-label="Close merge request focus"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className={`mt-4 rounded-lg px-3 py-2 text-sm font-medium ${signalStyles[signal.tone].badge}`}>
        <span className="inline-flex items-center gap-2"><UrgencyGlyph tone={signal.tone} />{signal.reason}</span>
      </div>

      <dl className="mt-5 space-y-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="inline-flex items-center gap-2 text-slate-500 dark:text-slate-400"><GitBranch className="h-3.5 w-3.5" />Pipeline</dt>
          <dd className={`font-medium capitalize ${pipelineTone}`}>{pipelineLabel}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="inline-flex items-center gap-2 text-slate-500 dark:text-slate-400"><Check className="h-3.5 w-3.5" />Approvals</dt>
          <dd className="font-medium text-slate-800 dark:text-slate-200">
            {approvalStatus
              ? `${approvalStatus.approved_by.length} of ${approvalStatus.approvals_required}`
              : 'Checking'}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="inline-flex items-center gap-2 text-slate-500 dark:text-slate-400"><FileText className="h-3.5 w-3.5" />Change size</dt>
          <dd className="font-medium text-slate-800 dark:text-slate-200">
            {mergeRequest.diff_stats ? `${diffSize} · +${mergeRequest.diff_stats.additions} −${mergeRequest.diff_stats.deletions}` : 'Checking'}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="inline-flex items-center gap-2 text-slate-500 dark:text-slate-400"><Clock className="h-3.5 w-3.5" />Updated</dt>
          <dd className="font-medium text-slate-800 dark:text-slate-200">{formatRelativeTime(mergeRequest.updated_at)}</dd>
        </div>
      </dl>

      <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/10">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">People</div>
        <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
          <div className="flex items-center gap-2"><User className="h-3.5 w-3.5 text-slate-400" /><span className="truncate">{mergeRequest.author.name}</span><span className="text-slate-400">author</span></div>
          <div className="flex items-center gap-2"><Eye className="h-3.5 w-3.5 text-slate-400" /><span className="truncate">{mergeRequest.reviewers.length ? mergeRequest.reviewers.map((reviewer) => reviewer.name).join(', ') : 'No reviewers assigned'}</span></div>
          {mergeRequest.assignees.length > 0 && <div className="flex items-center gap-2"><User className="h-3.5 w-3.5 text-slate-400" /><span className="truncate">{mergeRequest.assignees.map((assignee) => assignee.name).join(', ')}</span><span className="text-slate-400">assignee{mergeRequest.assignees.length === 1 ? '' : 's'}</span></div>}
        </div>
      </div>

      {mergeRequest.labels.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/10">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"><Tag className="h-3.5 w-3.5" />Labels</div>
          <div className="flex flex-wrap gap-1.5">
            {mergeRequest.labels.slice(0, 5).map((label) => <span key={label} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 dark:bg-white/[0.07] dark:text-slate-300">{label}</span>)}
            {mergeRequest.labels.length > 5 && <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500 dark:bg-white/[0.07] dark:text-slate-400">+{mergeRequest.labels.length - 5}</span>}
          </div>
        </div>
      )}

      <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/10">
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="truncate font-mono">{mergeRequest.source_branch}</span>
          <ArrowRight className="h-3 w-3 shrink-0" />
          <span className="truncate font-mono">{mergeRequest.target_branch}</span>
        </div>
      </div>

      <a
        href={mergeRequest.web_url}
        target="_blank"
        rel="noreferrer"
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:bg-indigo-500 dark:text-slate-950 dark:hover:bg-indigo-400 dark:focus-visible:ring-offset-slate-950"
      >
        {signal.action} in GitLab <ArrowUpRight className="h-4 w-4" />
      </a>
    </aside>
  );
}

function getGroups(
  mergeRequests: GitLabMergeRequest[],
  currentUser: GitLabUser | null,
  view: DeskView
): DeskGroup[] {
  const ordered = [...mergeRequests].sort((first, second) => (
    new Date(second.updated_at).getTime() - new Date(first.updated_at).getTime()
  ));
  const classificationById = new Map(ordered.map((mergeRequest) => [
    mergeRequest.id,
    getDeskClassification(mergeRequest, currentUser)
  ]));
  const getClassification = (mergeRequest: GitLabMergeRequest) => classificationById.get(mergeRequest.id)!;
  const isMine = (mergeRequest: GitLabMergeRequest) => getClassification(mergeRequest).authorIsCurrentUser;
  const isReview = (mergeRequest: GitLabMergeRequest) => getClassification(mergeRequest).reviewNeeded;
  const isBlocked = (mergeRequest: GitLabMergeRequest) => getClassification(mergeRequest).blocked;
  const isReady = (mergeRequest: GitLabMergeRequest) => getClassification(mergeRequest).ready;
  const needsDecision = (mergeRequest: GitLabMergeRequest) => getClassification(mergeRequest).approvalNeeded;

  if (view === 'my-work') {
    const mine = ordered.filter(isMine);
    return [
      {
        title: 'Needs an unblock',
        description: 'Your merge requests with a clear next step',
        emptyMessage: 'Nothing in your work is blocked right now.',
        mergeRequests: mine.filter((mergeRequest) => isBlocked(mergeRequest))
      },
      {
        title: 'Waiting on the team',
        description: 'Open merge requests still moving through review or CI',
        emptyMessage: 'No merge requests are waiting on others.',
        mergeRequests: mine.filter((mergeRequest) => !isBlocked(mergeRequest) && !isReady(mergeRequest) && mergeRequest.state === 'opened')
      },
      {
        title: 'Ready to merge',
        description: 'Clear on the signals currently available',
        emptyMessage: 'No merge requests are ready to merge yet.',
        mergeRequests: mine.filter(isReady)
      }
    ];
  }

  if (view === 'team-pulse') {
    return [
      {
        title: 'Blocked',
        description: 'Failed pipelines and merge conflicts across this scope',
        emptyMessage: 'No active pipeline or merge blockers.',
        mergeRequests: ordered.filter(isBlocked)
      },
      {
        title: 'Approval debt',
        description: 'Merge requests that are waiting for a decision',
        emptyMessage: 'No open approval gaps in this scope.',
        mergeRequests: ordered.filter((mergeRequest) => !isBlocked(mergeRequest) && needsDecision(mergeRequest))
      },
      {
        title: 'Ready to merge',
        description: 'Healthy merge requests that should not be lost in the noise',
        emptyMessage: 'No merge requests are currently ready.',
        mergeRequests: ordered.filter(isReady)
      }
    ];
  }

  const reviewRequests = ordered.filter(isReview);
  const unblocks = ordered.filter((mergeRequest) => !reviewRequests.includes(mergeRequest) && (isBlocked(mergeRequest) || (isMine(mergeRequest) && needsDecision(mergeRequest))));
  const monitor = ordered.filter((mergeRequest) => !reviewRequests.includes(mergeRequest) && !unblocks.includes(mergeRequest) && (isReady(mergeRequest) || isMine(mergeRequest)));

  return [
    {
      title: 'Needs your review',
      description: 'Merge requests where you are an assigned reviewer',
      emptyMessage: currentUser ? 'Your review inbox is clear.' : 'Loading your review assignments…',
      mergeRequests: reviewRequests
    },
    {
      title: 'Needs an unblock',
      description: 'Failures, conflicts, or your work awaiting approval',
      emptyMessage: 'Nothing needs an immediate unblock.',
      mergeRequests: unblocks
    },
    {
      title: 'Monitor',
      description: 'Your active work and merge-ready changes',
      emptyMessage: 'No active work to monitor in this scope.',
      mergeRequests: monitor
    }
  ];
}

export default function MergeDesk({ mergeRequests, loading, currentUser, view, scopeLabel }: MergeDeskProps) {
  const groups = useMemo(() => getGroups(mergeRequests, currentUser, view), [mergeRequests, currentUser, view]);
  const mergeRequestsById = useMemo(() => new Map(mergeRequests.map((mergeRequest) => [mergeRequest.id, mergeRequest])), [mergeRequests]);
  const [selectedMergeRequestId, setSelectedMergeRequestId] = useState<number | null>(null);
  const selectedMergeRequest = selectedMergeRequestId === null
    ? null
    : mergeRequestsById.get(selectedMergeRequestId) ?? null;

  useEffect(() => {
    if (selectedMergeRequestId !== null && !mergeRequestsById.has(selectedMergeRequestId)) {
      setSelectedMergeRequestId(null);
    }
  }, [mergeRequestsById, selectedMergeRequestId]);

  const viewTitle = view === 'inbox' ? 'Today' : view === 'my-work' ? 'My work' : 'Team pulse';
  const attentionCount = groups.slice(0, 2).reduce((total, group) => total + group.mergeRequests.length, 0);

  if (loading && mergeRequests.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-slate-950/35">
        <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300"><Loader2 className="h-4 w-4 animate-spin text-indigo-600" />Updating your desk…</div>
        <div className="mt-6 space-y-3">
          {[0, 1, 2, 3].map((index) => <div key={index} className="h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-white/[0.06]" />)}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">{scopeLabel}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">{viewTitle} <span className="font-normal text-slate-500 dark:text-slate-400">— {attentionCount} item{attentionCount === 1 ? '' : 's'} need attention</span></h1>
        </div>
        {loading && <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />Updating</span>}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="space-y-4">
          {groups.map((group) => (
            <QueueGroup
              key={group.title}
              group={group}
              currentUser={currentUser}
              selectedId={selectedMergeRequestId}
              onSelect={(mergeRequest) => setSelectedMergeRequestId(mergeRequest.id)}
            />
          ))}
        </div>
        <FocusPanel mergeRequest={selectedMergeRequest} currentUser={currentUser} onClose={() => setSelectedMergeRequestId(null)} />
      </div>
    </div>
  );
}
