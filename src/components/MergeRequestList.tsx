'use client';

import { GitLabMergeRequest } from '@/types/gitlab';

interface MergeRequestListProps {
  mergeRequests: GitLabMergeRequest[];
  loading: boolean;
  showProjectInfo?: boolean; // New prop to control whether to show project info
  loadingMessage?: string; // Custom loading message
}

export default function MergeRequestList({ mergeRequests, loading, showProjectInfo = false, loadingMessage }: MergeRequestListProps) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStateColor = (state: string) => {
    switch (state) {
      case 'opened':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400';
      case 'merged':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400';
      case 'closed':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400';
    }
  };

  const getPipelineColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'text-green-600 dark:text-green-400';
      case 'failed':
        return 'text-red-600 dark:text-red-400';
      case 'running':
        return 'text-blue-600 dark:text-blue-400';
      case 'pending':
        return 'text-yellow-600 dark:text-yellow-400';
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {loadingMessage && (
          <div className="text-center py-4">
            <div className="text-gray-600 dark:text-gray-400 text-sm">
              {loadingMessage}
            </div>
          </div>
        )}
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 animate-pulse">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-4"></div>
                <div className="flex space-x-4">
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-24"></div>
                </div>
              </div>
              <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (mergeRequests.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-gray-500 dark:text-gray-400 text-lg mb-2">
          No merge requests found
        </div>
        <div className="text-gray-400 dark:text-gray-500 text-sm">
          Try adjusting your filters or select a different project
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {mergeRequests.map((mr) => (
        <div
          key={mr.id}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center space-x-2 mb-2">
                <a
                  href={mr.web_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-lg font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
                >
                  {mr.title}
                  {mr.draft && (
                    <span className="ml-2 text-xs px-2 py-1 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400 rounded-full">
                      DRAFT
                    </span>
                  )}
                </a>
              </div>

              <div className="flex items-center space-x-4 text-sm text-gray-600 dark:text-gray-400 mb-3">
                <span>#{mr.iid}</span>
                {showProjectInfo && (
                  <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs">
                    {mr.project?.web_url ? (
                      <a
                        href={mr.project.web_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      >
                        {mr.project.name}
                      </a>
                    ) : (
                      mr.project?.name || `Project #${mr.project_id}`
                    )}
                  </span>
                )}
                <span>by {mr.author.name}</span>
                <span>created {formatDate(mr.created_at)}</span>
                <span>updated {formatDate(mr.updated_at)}</span>
                {mr.pipeline && (
                  <div className="flex items-center space-x-1">
                    <div className={`w-2 h-2 rounded-full ${getPipelineColor(mr.pipeline.status) === 'text-green-600 dark:text-green-400' ? 'bg-green-500' : 
                      getPipelineColor(mr.pipeline.status) === 'text-red-600 dark:text-red-400' ? 'bg-red-500' :
                      getPipelineColor(mr.pipeline.status) === 'text-blue-600 dark:text-blue-400' ? 'bg-blue-500' :
                      getPipelineColor(mr.pipeline.status) === 'text-yellow-600 dark:text-yellow-400' ? 'bg-yellow-500' : 'bg-gray-500'}`}></div>
                    <span className={getPipelineColor(mr.pipeline.status)}>
                      {mr.pipeline.status}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center space-x-4 text-sm">
                <div className="flex items-center space-x-1 text-gray-600 dark:text-gray-400">
                  <span>📝</span>
                  <span>{mr.source_branch} → {mr.target_branch}</span>
                </div>
                
                {mr.assignees.length > 0 && (
                  <div className="flex items-center space-x-1">
                    <span className="text-gray-500">👤</span>
                    <span className="text-gray-600 dark:text-gray-400">
                      {mr.assignees.map(a => a.name).join(', ')}
                    </span>
                  </div>
                )}

                {mr.reviewers.length > 0 && (
                  <div className="flex items-center space-x-1">
                    <span className="text-gray-500">👁</span>
                    <span className="text-gray-600 dark:text-gray-400">
                      {mr.reviewers.map(r => r.name).join(', ')}
                    </span>
                  </div>
                )}

                {mr.user_notes_count > 0 && (
                  <div className="flex items-center space-x-1">
                    <span className="text-gray-500">💬</span>
                    <span className="text-gray-600 dark:text-gray-400">{mr.user_notes_count}</span>
                  </div>
                )}

                {(mr.upvotes > 0 || mr.downvotes > 0) && (
                  <div className="flex items-center space-x-1">
                    {mr.upvotes > 0 && (
                      <>
                        <span className="text-green-500">👍</span>
                        <span className="text-gray-600 dark:text-gray-400">{mr.upvotes}</span>
                      </>
                    )}
                    {mr.downvotes > 0 && (
                      <>
                        <span className="text-red-500">👎</span>
                        <span className="text-gray-600 dark:text-gray-400">{mr.downvotes}</span>
                      </>
                    )}
                  </div>
                )}
              </div>

              {mr.labels.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {mr.labels.map((label) => (
                    <span
                      key={label}
                      className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col items-end space-y-2">
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStateColor(mr.state)}`}>
                {mr.state.charAt(0).toUpperCase() + mr.state.slice(1)}
              </span>

              {mr.detailed_merge_status && mr.detailed_merge_status !== 'mergeable' && (
                <span className="px-2 py-1 text-xs bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400 rounded-full">
                  {mr.detailed_merge_status}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
