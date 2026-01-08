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
  avatar_url: string;
}

export interface GitLabMergeRequest {
  id: number;
  iid: number;
  title: string;
  description: string;
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
}

export interface FilterOptions {
  state?: 'opened' | 'closed' | 'merged' | 'all';
  authors?: string[];
  title?: string;
  excludeTitle?: string;
  draft?: boolean;
  dateFrom?: string;
  dateTo?: string;
  projects?: string[]; // Filter by project names/paths
}
