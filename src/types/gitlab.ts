export type ApprovalFilterState = 'needs-review' | 'needs-approval' | 'partially-approved' | 'approved';

export interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  web_url: string;
}

export interface GitLabGroup {
  id: number;
  name: string;
  path: string;
  full_path: string;
}

export interface GitLabUser {
  id: number;
  name: string;
  username: string;
  avatar_url: string | null;
}

export interface GitLabApproval {
  user: GitLabUser;
  approved_at: string | null;
}

export interface GitLabMergeRequestApprovalStatus {
  approvals_required: number;
  approvals_left: number;
  approved_by: GitLabApproval[];
}

export interface GitLabMergeRequest {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  state: 'opened' | 'closed' | 'merged';
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
  author: GitLabUser;
  assignees: GitLabUser[];
  reviewers: GitLabUser[];
  source_branch: string;
  target_branch: string;
  web_url: string;
  project_id: number;
  references?: {
    short?: string;
    relative?: string;
    full?: string;
  };
  project?: {
    id: number;
    name: string;
    path_with_namespace: string;
    web_url: string;
  };
  labels: string[];
  draft: boolean;
  work_in_progress: boolean;
  merge_status: string;
  detailed_merge_status: string;
  conflicts_can_be_resolved_in_ui: boolean;
  upvotes: number;
  downvotes: number;
  user_notes_count: number;
  should_remove_source_branch: boolean;
  force_remove_source_branch: boolean;
  squash: boolean;
  pipeline?: {
    id: number;
    status: string;
    ref: string;
    sha: string;
    web_url: string;
  };
  approval_status?: GitLabMergeRequestApprovalStatus;
  diff_stats?: GitLabMergeRequestDiffStats;
}

export interface GitLabMergeRequestDiffStats {
  additions: number;
  deletions: number;
  file_count: number;
}

export interface GitLabMergeRequestChange {
  old_path?: string;
  new_path?: string;
  diff?: string;
  new_file?: boolean;
  deleted_file?: boolean;
  renamed_file?: boolean;
  collapsed?: boolean;
  too_large?: boolean;
  generated_file?: boolean;
}

export interface GitLabDiffCompleteness {
  complete: boolean;
  truncated: boolean;
  total_files?: number;
  loaded_files: number;
  collapsed_files: number;
  too_large_files: number;
  generated_files: number;
  reason?: string;
}

export interface GitLabMergeRequestReviewDetails {
  iid?: number;
  title?: string;
  description?: string | null;
  author?: Pick<GitLabUser, 'name' | 'username'>;
  source_branch?: string;
  target_branch?: string;
  web_url?: string;
  sha?: string;
  diff_refs?: {
    base_sha?: string;
    start_sha?: string;
    head_sha?: string;
  };
  changes?: GitLabMergeRequestChange[];
  diff_completeness?: GitLabDiffCompleteness;
}

export type GitLabDiscussionLineType = 'old' | 'new';

export interface GitLabDiscussionLine {
  line_code?: string;
  type?: GitLabDiscussionLineType;
  old_line?: number | null;
  new_line?: number | null;
}

export interface GitLabDiscussionLineRange {
  start?: GitLabDiscussionLine;
  end?: GitLabDiscussionLine;
}

export interface GitLabDiscussionPosition {
  base_sha?: string;
  start_sha?: string;
  head_sha?: string;
  old_path?: string;
  new_path?: string;
  position_type?: 'text' | 'image' | 'file' | string;
  old_line?: number | null;
  new_line?: number | null;
  line_range?: GitLabDiscussionLineRange;
}

export interface GitLabDiscussionNote {
  id: number;
  type: 'DiscussionNote' | 'DiffNote' | string | null;
  body: string;
  author: GitLabUser | null;
  created_at: string;
  updated_at?: string;
  system?: boolean;
  resolved?: boolean;
  resolvable?: boolean;
  position?: GitLabDiscussionPosition | null;
}

export interface GitLabMergeRequestDiscussion {
  id: string;
  individual_note: boolean;
  notes: GitLabDiscussionNote[];
}

export interface GitLabCommitComparison {
  diffs?: Array<Pick<GitLabMergeRequestChange, 'old_path' | 'new_path' | 'new_file'>>;
}

export interface GitLabMergeTrain {
  id: number;
  status: string;
  target_branch: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  duration: number | null;
  merge_request: Pick<
    GitLabMergeRequest,
    'id' | 'iid' | 'project_id' | 'title' | 'description' | 'state' | 'created_at' | 'updated_at' | 'web_url'
  >;
  pipeline: {
    id: number;
    iid?: number;
    project_id: number;
    ref: string;
    sha: string;
    source?: string;
    status: string;
    created_at: string;
    updated_at: string;
    web_url: string;
  } | null;
  user: GitLabUser & {
    state?: string;
    web_url?: string;
  };
}

export interface GitLabMergeTrainProjectStatus {
  project: GitLabProject;
  trains: GitLabMergeTrain[];
  error?: string;
}

export interface FilterOptions {
  state?: 'opened' | 'closed' | 'merged' | 'all';
  approvalState?: ApprovalFilterState;
  notReviewedByMe?: boolean;
  authors?: string[];
  title?: string;
  excludeTitle?: string;
  draft?: boolean;
  dateFrom?: string;
  dateTo?: string;
  mergedAfter?: string;
  projects?: string[]; // Filter by project names/paths
}
