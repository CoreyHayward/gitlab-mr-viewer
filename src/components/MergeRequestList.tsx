'use client';

import Image from 'next/image';
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

  const getApprovalSummary = (mr: GitLabMergeRequest) => {
    const approvalCategory = getApprovalCategory(mr);

    if (approvalCategory === 'not-open') {
      return null;
    }

    const approvalStatus = mr.approval_status;
    if (approvalCategory === 'loading' || !approvalStatus) {
      return {
        tone: 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-neutral-900/50 dark:text-gray-300 dark:border-neutral-700',
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
          label: 'Reviewed and approved',
          detail: `${approvalCount} teammate approval${approvalCount === 1 ? '' : 's'} recorded.`
        };
      }

      return {
        tone: 'bg-sky-50 text-sky-900 border-sky-200 dark:bg-sky-950/30 dark:text-sky-200 dark:border-sky-900',
        label: 'No formal approvals required',
        detail: mr.reviewers.length > 0
          ? `${mr.reviewers.length} reviewer${mr.reviewers.length === 1 ? '' : 's'} assigned, but there is no approval gate on this MR.`
          : 'GitLab does not require approvals before this MR can merge.'
      };
    }

    if (approvalCategory === 'approved') {
      return {
        tone: 'bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900',
        label: 'Ready on approvals',
        detail: `${approvalCount} of ${requiredApprovals} required approval${requiredApprovals === 1 ? '' : 's'} recorded.`
      };
    }

    if (approvalCategory === 'partially-approved') {
      return {
        tone: 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/30 dark:text-amber-100 dark:border-amber-900',
        label: `${approvalsLeft} approval${approvalsLeft === 1 ? '' : 's'} still needed`,
        detail: `${approvalCount} of ${requiredApprovals} required approval${requiredApprovals === 1 ? '' : 's'} already recorded.`
      };
    }

    return {
      tone: 'bg-rose-50 text-rose-900 border-rose-200 dark:bg-rose-950/30 dark:text-rose-100 dark:border-rose-900',
      label: `${requiredApprovals} approval${requiredApprovals === 1 ? '' : 's'} required`,
      detail: 'No one has approved this MR yet.'
    };
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();
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
        <div
          key={mr.id}
          className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-xl shadow-sm hover:shadow-md hover:border-gray-300 dark:hover:border-neutral-600 transition-all duration-200 overflow-hidden group"
        >
          {/* Header */}
          <div className="p-5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <a
                    href={mr.web_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-base font-semibold text-gray-900 dark:text-white hover:text-violet-600 dark:hover:text-violet-400 transition-colors group-hover:text-violet-600 dark:group-hover:text-violet-400 line-clamp-2 pr-2"
                  >
                    {mr.title}
                  </a>
                  {mr.draft && (
                    <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800 rounded-full">
                      DRAFT
                    </span>
                  )}
                </div>
                
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                  <span className="font-medium">#{mr.iid}</span>
                  {showProjectInfo && mr.project && (
                    <span className="inline-flex items-center px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs font-medium">
                      {mr.project.web_url ? (
                        <a
                          href={mr.project.web_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
                        >
                          {mr.project.name}
                        </a>
                      ) : (
                        mr.project.name || `Project #${mr.project_id}`
                      )}
                    </span>
                  )}
                  <span>by <span className="font-medium text-gray-700 dark:text-gray-300">{mr.author.name}</span></span>
                  <span>created {formatDate(mr.created_at)}</span>
                  <span>updated {formatDate(mr.updated_at)}</span>
                </div>
              </div>
              
              <div className="flex flex-wrap items-center justify-end gap-2 max-w-xs">
                {mr.pipeline && (
                  <div className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full border ${getPipelineColor(mr.pipeline.status)}`}>
                    {getPipelineIcon(mr.pipeline.status)}
                    <span className="ml-1 capitalize">{mr.pipeline.status}</span>
                  </div>
                )}
                <div className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full border ${getStateColor(mr.state)}`}>
                  {getStateIcon(mr.state)}
                  <span className="ml-1 capitalize">{mr.state}</span>
                </div>
              </div>
            </div>

            {(() => {
              const approvalSummary = getApprovalSummary(mr);

              if (!approvalSummary) {
                return null;
              }

              return (
                <div className={`mb-4 rounded-xl border px-4 py-3 ${approvalSummary.tone}`}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-70">
                        Review Status
                      </div>
                      <div className="mt-1 text-sm font-semibold">
                        {approvalSummary.label}
                      </div>
                      <div className="mt-1 text-xs opacity-80">
                        {approvalSummary.detail}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      {mr.approval_status && mr.approval_status.approved_by.length > 0 ? (
                        mr.approval_status.approved_by.slice(0, 3).map(({ user }) => (
                          <div
                            key={user.id}
                            className="inline-flex items-center gap-2 rounded-full border border-white/50 bg-white/70 px-2.5 py-1 text-xs font-medium text-current shadow-sm dark:border-white/10 dark:bg-black/10"
                            title={`Approved by ${user.name}`}
                          >
                            {user.avatar_url ? (
                              <Image
                                src={user.avatar_url}
                                alt={user.name}
                                width={20}
                                height={20}
                                className="h-5 w-5 rounded-full object-cover"
                              />
                            ) : (
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/10 text-[10px] font-bold uppercase dark:bg-white/10">
                                {getInitials(user.name)}
                              </span>
                            )}
                            <span>{user.name}</span>
                          </div>
                        ))
                      ) : (
                        <div className="inline-flex items-center rounded-full border border-dashed border-current/30 px-2.5 py-1 text-xs font-medium opacity-80">
                          No approvals yet
                        </div>
                      )}

                      {mr.approval_status && mr.approval_status.approved_by.length > 3 && (
                        <div className="inline-flex items-center rounded-full border border-current/20 px-2.5 py-1 text-xs font-medium opacity-80">
                          +{mr.approval_status.approved_by.length - 3} more
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Branch Info - Compact */}
            <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
              <span className="font-mono text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-xs">
                {mr.source_branch}
              </span>
              <svg className="w-3 h-3 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              <span className="font-mono text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-xs">
                {mr.target_branch}
              </span>
            </div>

            {/* Compact Meta Row */}
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600 dark:text-gray-400">
                {mr.assignees.length > 0 && (
                  <div className="flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                    </svg>
                    <span className="text-xs"><span className="font-semibold text-gray-700 dark:text-gray-300">Assignees:</span> {mr.assignees.map(a => a.name).join(', ')}</span>
                  </div>
                )}

                {mr.user_notes_count > 0 && (
                  <div className="flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
                    </svg>
                    <span className="text-xs font-medium">{mr.user_notes_count}</span>
                  </div>
                )}

                {(mr.upvotes > 0 || mr.downvotes > 0) && (
                  <div className="flex items-center space-x-2">
                    {mr.upvotes > 0 && (
                      <div className="flex items-center space-x-1 text-emerald-600 dark:text-emerald-400">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
                        </svg>
                        <span className="text-xs font-medium">{mr.upvotes}</span>
                      </div>
                    )}
                    {mr.downvotes > 0 && (
                      <div className="flex items-center space-x-1 text-red-600 dark:text-red-400">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M18 9.5a1.5 1.5 0 11-3 0v-6a1.5 1.5 0 013 0v6zM14 9.667v-5.43a2 2 0 00-1.106-1.79l-.05-.025A4 4 0 0011.057 2H5.64a2 2 0 00-1.962 1.608l-1.2 6A2 2 0 004.44 12H8v4a2 2 0 002 2 1 1 0 001-1v-.667a4 4 0 01.8-2.4l1.4-1.866a4 4 0 00.8-2.4z" />
                        </svg>
                        <span className="text-xs font-medium">{mr.downvotes}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Labels - Compact */}
              {mr.labels.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {mr.labels.slice(0, 3).map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded"
                    >
                      {label}
                    </span>
                  ))}
                  {mr.labels.length > 3 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded">
                      +{mr.labels.length - 3}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Merge Status - Only show if not mergeable */}
            {mr.detailed_merge_status && mr.detailed_merge_status !== 'mergeable' && (
              <div className="mt-2 flex items-center">
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800 rounded-full">
                  <svg className="w-3 h-3 mr-1 text-amber-600 dark:text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {mr.detailed_merge_status.replace(/_/g, ' ')}
                </span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
