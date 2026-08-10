import type { GitLabDiffCompleteness, GitLabMergeRequestDiscussion } from '@/types/gitlab';

export type ReviewStatus =
  | 'not-started'
  | 'in-progress'
  | 'reviewed'
  | 'needs-look'
  | 'blocked'
  | 'stale';

export type RiskLevel = 'low' | 'medium' | 'high';

export type ReviewFileChange = {
  path: string;
  oldPath?: string;
  diff: string;
  kind: 'added' | 'modified' | 'deleted' | 'renamed';
  explanation?: string;
};

export type SemanticSection = {
  id: string;
  title: string;
  intent: string;
  reviewFocus: string;
  risk: RiskLevel;
  filePaths: string[];
  files: ReviewFileChange[];
  relatedSectionIds: string[];
  prompts: string[];
};

export type SemanticReview = {
  overview: {
    purpose: string;
    scope: string;
    riskSummary: string;
    areas: string[];
  };
  sections: SemanticSection[];
};

export type ReviewDelta = {
  state: 'first-review' | 'unchanged' | 'updated';
  summary: string[];
  changedPaths: string[];
  newPaths: string[];
};

export type SemanticReviewWorkspaceData = {
  mergeRequest: {
    projectId: number;
    projectPath: string;
    iid: number;
    title: string;
    author: string;
    sourceBranch: string;
    targetBranch: string;
    webUrl?: string;
    baseSha?: string;
    startSha?: string;
    headSha: string;
    changedFiles: number;
    reviewInputSignature?: string;
  };
  review: SemanticReview;
  delta: ReviewDelta;
  ai: {
    configured: boolean;
    used: boolean;
  };
  discussions?: GitLabMergeRequestDiscussion[];
  truncated: boolean;
  diffCompleteness?: GitLabDiffCompleteness;
};

export type SavedReviewState = {
  statuses: Record<string, ReviewStatus>;
  notes: Record<string, string>;
  selectedSectionId?: string;
};

export type CachedSemanticReview = {
  workspace: SemanticReviewWorkspaceData;
  state: SavedReviewState;
  updatedAt: number;
};

export type AiProviderConfig = {
  apiKey: string;
  apiBaseUrl: string;
  model: string;
};

export type AiReviewOutline = {
  overview: SemanticReview['overview'];
  sections: Array<Pick<SemanticSection, 'id' | 'title' | 'intent' | 'reviewFocus' | 'risk' | 'filePaths' | 'relatedSectionIds' | 'prompts'>>;
};
