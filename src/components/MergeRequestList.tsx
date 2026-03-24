'use client';

import { GitLabMergeRequest } from '@/types/gitlab';
import { getApprovalCategory } from '@/utils/approvalState';

interface MergeRequestListProps {
  mergeRequests: GitLabMergeRequest[];
  loading: boolean;
  showProjectInfo?: boolean; // New prop to control whether to show project info
  loadingMessage?: string; // Custom loading message
}

export default function MergeRequestList({ mergeRequests, loading, showProjectInfo = false, loadingMessage }: MergeRequestListProps) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  };

  const formatRelativeTime = (dateString: string) => {
    const timestamp = new Date(dateString).getTime();
    const diffMs = timestamp - Date.now();
    const diffMinutes = Math.round(diffMs / (1000 * 60));
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

    const ranges = [
      { limit: 60, value: diffMinutes, unit: 'minute' as const },
      { limit: 60 * 24, value: Math.round(diffMinutes / 60), unit: 'hour' as const },
      { limit: 60 * 24 * 30, value: Math.round(diffMinutes / (60 * 24)), unit: 'day' as const },
      { limit: 60 * 24 * 365, value: Math.round(diffMinutes / (60 * 24 * 30)), unit: 'month' as const },
      { limit: Number.POSITIVE_INFINITY, value: Math.round(diffMinutes / (60 * 24 * 365)), unit: 'year' as const }
    ];

    const selectedRange = ranges.find((range) => Math.abs(diffMinutes) < range.limit) ?? ranges[ranges.length - 1];

    return formatter.format(selectedRange.value, selectedRange.unit);
  };

  const getApprovalSummary = (mr: GitLabMergeRequest) => {
    const approvalCategory = getApprovalCategory(mr);

    if (approvalCategory === 'not-open') {
      return null;
    }

    const approvalStatus = mr.approval_status;
    if (approvalCategory === 'loading' || !approvalStatus) {
      return {
        tone: 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-neutral-900/50 dark:text-gray-300 dark:border-neutral-700',
        chipLabel: 'Review loading',
        label: 'Loading review status',
        detail: 'Fetching approvals from GitLab so approvers are explicit on the card.'
      };
    }

    const approvalCount = approvalStatus.approved_by.length;
    const requiredApprovals = approvalStatus.approvals_required;
    const approvalsLeft = approvalStatus.approvals_left;

    if (approvalCategory === 'no-approval-required') {
      if (approvalCount > 0) {
        return {
          tone: 'bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900',
          chipLabel: 'Approved',
          label: 'Reviewed and approved',
          detail: `${approvalCount} teammate approval${approvalCount === 1 ? '' : 's'} recorded.`
        };
      }

      return {
        tone: 'bg-sky-50 text-sky-900 border-sky-200 dark:bg-sky-950/30 dark:text-sky-200 dark:border-sky-900',
        chipLabel: 'No approval gate',
        label: 'No formal approvals required',
        detail: mr.reviewers.length > 0
          ? `${mr.reviewers.length} reviewer${mr.reviewers.length === 1 ? '' : 's'} assigned, but there is no approval gate on this MR.`
          : 'GitLab does not require approvals before this MR can merge.'
      };
    }

    if (approvalCategory === 'approved') {
      return {
        tone: 'bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900',
        chipLabel: 'Approved',
        label: 'Ready on approvals',
        detail: `${approvalCount} of ${requiredApprovals} required approval${requiredApprovals === 1 ? '' : 's'} recorded.`
      };
    }

    if (approvalCategory === 'partially-approved') {
      return {
        tone: 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/30 dark:text-amber-100 dark:border-amber-900',
        chipLabel: `${approvalsLeft} left`,
        label: `${approvalsLeft} approval${approvalsLeft === 1 ? '' : 's'} still needed`,
        detail: `${approvalCount} of ${requiredApprovals} required approval${requiredApprovals === 1 ? '' : 's'} already recorded.`
      };
    }

    return {
      tone: 'bg-rose-50 text-rose-900 border-rose-200 dark:bg-rose-950/30 dark:text-rose-100 dark:border-rose-900',
      chipLabel: `${requiredApprovals} required`,
      label: `${requiredApprovals} approval${requiredApprovals === 1 ? '' : 's'} required`,
      detail: 'No one has approved this MR yet.'
    };
  };

  const getStateColor = (state: string) => {
    switch (state) {
      case 'opened':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800';
      case 'merged':
        return 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800';
      case 'closed':
        return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/20 dark:text-gray-400 dark:border-gray-700';
    }
  };

  const getMergeStatusColor = (status: string) => {
    switch (status) {
      case 'ci_must_pass':
      case 'not_approved':
      case 'draft_status':
        return 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900';
      case 'cannot_be_merged':
      case 'conflict':
        return 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-900';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-neutral-900/50 dark:text-gray-300 dark:border-neutral-700';
    }
  };

  const getStateIcon = (state: string) => {
    switch (state) {
      case 'opened':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        );
      case 'merged':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        );
      case 'closed':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        );
      default:
        return null;
    }
  };

  const getPipelineColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800';
      case 'failed':
        return 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/20 border-red-200 dark:border-red-800';
      case 'running':
        return 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
      case 'pending':
        return 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800';
      default:
        return 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-900/20 border-gray-200 dark:border-gray-700';
    }
  };

  const getPipelineIcon = (status: string) => {
    switch (status) {
      case 'success':
        return (
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        );
      case 'failed':
        return (
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        );
      case 'running':
        return (
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        );
      case 'pending':
        return (
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
          </svg>
        );
      default:
        return (
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        );
    }
  };

  const getVisiblePeople = (names: string[], maxVisible = 2) => {
    return {
      visible: names.slice(0, maxVisible),
      remaining: Math.max(names.length - maxVisible, 0)
    };
  };

  if (loading) {
    return (
      <div className="space-y-6">
        {loadingMessage && (
          <div className="text-center py-8">
            <div className="inline-flex items-center space-x-3 px-6 py-4 bg-violet-50 dark:bg-violet-900/10 border border-violet-200 dark:border-violet-800 rounded-xl">
              <svg className="animate-spin w-5 h-5 text-violet-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              <span className="text-violet-700 dark:text-violet-300 font-medium">
                {loadingMessage}
              </span>
            </div>
          </div>
        )}
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-xl overflow-hidden shadow-sm">
            <div className="p-6 animate-pulse">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 space-y-3">
                  <div className="flex items-center space-x-3">
                    <div className="h-5 bg-gray-200 dark:bg-neutral-700 rounded-lg w-3/4"></div>
                    <div className="h-5 bg-gray-200 dark:bg-neutral-700 rounded-full w-16"></div>
                  </div>
                  <div className="h-4 bg-gray-200 dark:bg-neutral-700 rounded w-1/2"></div>
                </div>
                <div className="h-6 bg-gray-200 dark:bg-neutral-700 rounded-full w-20"></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div className="h-4 bg-gray-200 dark:bg-neutral-700 rounded w-full"></div>
                <div className="h-4 bg-gray-200 dark:bg-neutral-700 rounded w-full"></div>
                <div className="h-4 bg-gray-200 dark:bg-neutral-700 rounded w-full"></div>
              </div>
              <div className="flex space-x-2">
                {[...Array(3)].map((_, j) => (
                  <div key={j} className="h-6 bg-gray-200 dark:bg-neutral-700 rounded-full w-16"></div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (mergeRequests.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="mx-auto w-24 h-24 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-6">
          <svg className="w-12 h-12 text-gray-400 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div className="text-gray-900 dark:text-white text-xl font-semibold mb-2">
          No merge requests found
        </div>
        <div className="text-gray-500 dark:text-gray-400 text-base max-w-md mx-auto">
          Try adjusting your filters or select a different project to see merge requests
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {mergeRequests.map((mr) => (
        (() => {
          const reviewSummary = getApprovalSummary(mr);

          return (
            <div
              key={mr.id}
              className="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all duration-200 hover:border-gray-300 hover:shadow-md dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-neutral-600"
            >
              <div className="p-4">
                <div className="flex flex-col gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium">
                  {mr.state === 'opened' && reviewSummary ? (
                    <div
                      className={`inline-flex cursor-default items-center rounded-full border px-2.5 py-1 ${reviewSummary.tone}`}
                      title={`${reviewSummary.label}. ${reviewSummary.detail}`}
                    >
                      <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-4a1 1 0 00-.894.553l-2 4A1 1 0 008 12h4a1 1 0 00.894-1.447l-2-4A1 1 0 0010 6zm0 7a1.25 1.25 0 100 2.5A1.25 1.25 0 0010 13z" clipRule="evenodd" />
                      </svg>
                      <span className="ml-1">{reviewSummary.chipLabel}</span>
                    </div>
                  ) : (
                    <div className={`inline-flex items-center rounded-full border px-2.5 py-1 ${getStateColor(mr.state)}`}>
                      {getStateIcon(mr.state)}
                      <span className="ml-1 capitalize">{mr.state}</span>
                    </div>
                  )}

                  {mr.pipeline && (
                    <div className={`inline-flex items-center rounded-full border px-2.5 py-1 ${getPipelineColor(mr.pipeline.status)}`}>
                      {getPipelineIcon(mr.pipeline.status)}
                      <span className="ml-1 capitalize">Pipeline {mr.pipeline.status}</span>
                    </div>
                  )}

                  {mr.draft && (
                    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-100 px-2.5 py-1 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
                      Draft
                    </span>
                  )}

                  {showProjectInfo && mr.project && (
                    <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-gray-700 dark:border-neutral-700 dark:bg-neutral-900/50 dark:text-gray-300">
                      {mr.project.web_url ? (
                        <a
                          href={mr.project.web_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="transition-colors hover:text-violet-600 dark:hover:text-violet-400"
                        >
                          {mr.project.name}
                        </a>
                      ) : (
                        mr.project.name || `Project #${mr.project_id}`
                      )}
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <a
                    href={mr.web_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pr-2 text-base font-semibold leading-6 text-gray-900 transition-colors hover:text-violet-600 group-hover:text-violet-600 dark:text-white dark:hover:text-violet-400 dark:group-hover:text-violet-400"
                  >
                    {mr.title}
                  </a>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                    <span className="font-semibold text-gray-700 dark:text-gray-200">#{mr.iid}</span>
                    <span>
                      Author <span className="font-medium text-gray-700 dark:text-gray-200">{mr.author.name}</span>
                    </span>
                    <span title={formatDate(mr.updated_at)}>Updated {formatRelativeTime(mr.updated_at)}</span>
                    <span title={formatDate(mr.created_at)}>Created {formatRelativeTime(mr.created_at)}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-neutral-900/60 dark:text-gray-300">
                      <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
                      </svg>
                      {mr.user_notes_count}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 text-sm text-gray-600 dark:border-neutral-700/70 dark:text-gray-400">
              <div className="inline-flex min-w-0 items-center gap-2 rounded-full bg-gray-50 px-2.5 py-1.5 dark:bg-neutral-900/40">
                <svg className="h-3.5 w-3.5 shrink-0 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M3 5a2 2 0 012-2h4a1 1 0 010 2H5v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm9.293-1.707a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-6 6A1 1 0 019 14H6a1 1 0 01-1-1v-3a1 1 0 01.293-.707l6-6z" clipRule="evenodd" />
                </svg>
                <span className="truncate rounded-md bg-white px-2 py-0.5 font-mono text-xs text-gray-700 shadow-sm dark:bg-neutral-800 dark:text-gray-300">
                  {mr.source_branch}
                </span>
                <svg className="h-3 w-3 shrink-0 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                <span className="truncate rounded-md bg-white px-2 py-0.5 font-mono text-xs text-gray-700 shadow-sm dark:bg-neutral-800 dark:text-gray-300">
                  {mr.target_branch}
                </span>
              </div>

              {mr.detailed_merge_status && mr.detailed_merge_status !== 'mergeable' && (
                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${getMergeStatusColor(mr.detailed_merge_status)}`}>
                  <svg className="mr-1 h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {mr.detailed_merge_status.replace(/_/g, ' ')}
                </span>
              )}

              <div className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1.5 dark:bg-neutral-900/40">
                <svg className="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
                {mr.assignees.length > 0 ? (
                  <div className="flex min-w-0 flex-wrap gap-1">
                    {(() => {
                      const { visible, remaining } = getVisiblePeople(mr.assignees.map((assignee) => assignee.name));

                      return (
                        <>
                          {visible.map((name) => (
                            <span key={name} className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-neutral-800 dark:text-gray-300">
                              {name}
                            </span>
                          ))}
                          {remaining > 0 && (
                            <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-neutral-800 dark:text-gray-400">
                              +{remaining}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <span className="text-xs text-gray-500 dark:text-gray-400">Unassigned</span>
                )}
              </div>

              <div className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1.5 dark:bg-neutral-900/40">
                <svg className="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 3C5.455 3 1.73 5.916.458 10c1.272 4.084 4.997 7 9.542 7s8.27-2.916 9.542-7c-1.272-4.084-4.997-7-9.542-7zm0 11a4 4 0 110-8 4 4 0 010 8z" />
                  <path d="M10 8a2 2 0 100 4 2 2 0 000-4z" />
                </svg>
                {mr.reviewers.length > 0 ? (
                  <div className="flex min-w-0 flex-wrap gap-1">
                    {(() => {
                      const { visible, remaining } = getVisiblePeople(mr.reviewers.map((reviewer) => reviewer.name));

                      return (
                        <>
                          {visible.map((name) => (
                            <span key={name} className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-neutral-800 dark:text-gray-300">
                              {name}
                            </span>
                          ))}
                          {remaining > 0 && (
                            <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-neutral-800 dark:text-gray-400">
                              +{remaining}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <span className="text-xs text-gray-500 dark:text-gray-400">No reviewers</span>
                )}
              </div>

              {mr.labels.length > 0 && (
                <div className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1.5 dark:bg-neutral-900/40">
                  <svg className="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M3 7a2 2 0 012-2h4.586a2 2 0 011.414.586l5.414 5.414a2 2 0 010 2.828l-3.172 3.172a2 2 0 01-2.828 0L5.414 11.586A2 2 0 014.828 10V7zm4 1a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                  </svg>
                  <div className="flex min-w-0 flex-wrap gap-1">
                    {mr.labels.slice(0, 3).map((label) => (
                      <span
                        key={label}
                        className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-neutral-800 dark:text-gray-300"
                      >
                        {label}
                      </span>
                    ))}
                    {mr.labels.length > 3 && (
                      <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-neutral-800 dark:text-gray-400">
                        +{mr.labels.length - 3}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
              </div>
            </div>
          );
        })()
      ))}
    </div>
  );
}
