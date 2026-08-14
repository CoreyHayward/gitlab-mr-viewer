export const DESKTOP_CHANNELS = {
  bootstrap: 'reviewflow:bootstrap',
  updateSettings: 'reviewflow:update-settings',
  listReviews: 'reviewflow:list-reviews',
  prepareReview: 'reviewflow:prepare-review',
  generateOutline: 'reviewflow:generate-outline',
  runAutomatedReview: 'reviewflow:run-automated-review',
  askAgent: 'reviewflow:ask-agent',
  cancelOperation: 'reviewflow:cancel-operation',
  openExternal: 'reviewflow:open-external',
  revealWorktree: 'reviewflow:reveal-worktree'
} as const;

export type AgentKind = 'codex' | 'claude';
export type SourceControlKind = 'gitlab' | 'github';
export type DashboardView = 'review-requested' | 'assigned' | 'authored' | 'all-open';
export type ReviewReadiness = 'ready' | 'draft' | 'blocked' | 'checking';

export type DesktopSettings = {
  sourceControl: SourceControlKind;
  hosts: Record<SourceControlKind, string>;
  defaultView: DashboardView;
  agent: {
    kind: AgentKind;
    model?: string;
  };
};

export type ExecutableStatus = {
  installed: boolean;
  path?: string;
  version?: string;
  error?: string;
};

export type HarnessStatus = ExecutableStatus & {
  kind: AgentKind;
  label: string;
  authenticated: boolean;
  authDescription?: string;
};

export type SourceControlStatus = {
  kind: SourceControlKind;
  label: string;
  implemented: boolean;
  executable: ExecutableStatus;
};

export type DesktopBootstrap = {
  appVersion: string;
  platform: 'darwin';
  settings: DesktopSettings;
  sourceControls: SourceControlStatus[];
  harnesses: HarnessStatus[];
};

export type ReviewPerson = {
  id: number;
  name: string;
  username: string;
  avatarUrl?: string;
};

export type RepositorySummary = {
  sourceControl: SourceControlKind;
  remoteId: string;
  name: string;
  pathWithNamespace: string;
  webUrl: string;
};

export type GitLabReviewRef = {
  sourceControl: 'gitlab';
  host: string;
  projectId: number;
  number: number;
};

export type GitHubReviewRef = {
  sourceControl: 'github';
  host: string;
  owner: string;
  repository: string;
  number: number;
};

export type ReviewRef = GitLabReviewRef | GitHubReviewRef;

export type DesktopReview = {
  ref: ReviewRef;
  id: string;
  number: number;
  numberLabel: string;
  repository: RepositorySummary;
  title: string;
  description: string;
  webUrl: string;
  author: ReviewPerson;
  reviewers: ReviewPerson[];
  assignees: ReviewPerson[];
  sourceBranch: string;
  targetBranch: string;
  headSha: string;
  draft: boolean;
  readiness: ReviewReadiness;
  readinessLabel: string;
  pipelineStatus?: string;
  blockingDiscussionsResolved?: boolean;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  changesCount?: number;
};

export type ListReviewsRequest = {
  sourceControl: SourceControlKind;
  host: string;
  view: DashboardView;
  operationId: string;
};

export type ReviewDashboard = {
  sourceControl: SourceControlKind;
  host: string;
  currentUser: ReviewPerson;
  reviews: DesktopReview[];
  fetchedAt: string;
};

export type LocalFileChange = {
  path: string;
  oldPath?: string;
  kind: 'added' | 'modified' | 'deleted' | 'renamed';
  diff: string;
  diffTruncated: boolean;
  additions: number;
  deletions: number;
};

export type LocalReviewInput = {
  key: string;
  review: DesktopReview;
  repository: RepositorySummary;
  worktreePath: string;
  baseSha: string;
  headSha: string;
  changes: LocalFileChange[];
  diffTruncated: boolean;
  preparedAt: string;
};

export type PrepareReviewRequest = ReviewRef & {
  operationId: string;
};

export type AgentSelection = {
  kind: AgentKind;
  model?: string;
};

export type RiskLevel = 'low' | 'medium' | 'high';

export type AgentReviewOutline = {
  overview: {
    purpose: string;
    scope: string;
    riskSummary: string;
    areas: string[];
  };
  sections: Array<{
    id: string;
    title: string;
    intent: string;
    reviewFocus: string;
    risk: RiskLevel;
    filePaths: string[];
    relatedSectionIds: string[];
    prompts: string[];
  }>;
};

export type GenerateOutlineRequest = ReviewRef & {
  operationId: string;
  agent: AgentSelection;
};

export type AgentRunMetadata = {
  provider: AgentKind;
  durationMs: number;
  sessionId?: string;
};

export type GenerateOutlineResult = AgentRunMetadata & {
  outline: AgentReviewOutline;
};

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';

export type ReviewFinding = {
  id: string;
  title: string;
  severity: FindingSeverity;
  confidence: 'high' | 'medium' | 'low';
  description: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  evidence: string;
  suggestedComment: string;
};

export type AutomatedReview = {
  summary: string;
  findings: ReviewFinding[];
};

export type AutomatedReviewRequest = ReviewRef & {
  operationId: string;
  agent: AgentSelection;
};

export type AutomatedReviewResult = AgentRunMetadata & {
  review: AutomatedReview;
};

export type AgentEvidence = {
  path: string;
  line?: number;
  reason: string;
};

export type AgentAnswer = {
  answer: string;
  evidence: AgentEvidence[];
  caveats: string[];
};

export type AskAgentRequest = ReviewRef & {
  operationId: string;
  agent: AgentSelection;
  question: string;
  section?: {
    title: string;
    intent: string;
    reviewFocus: string;
    filePaths: string[];
  };
};

export type AskAgentResult = AgentRunMetadata & {
  response: AgentAnswer;
};

export type UpdateSettingsRequest = Partial<{
  sourceControl: SourceControlKind;
  hosts: Partial<Record<SourceControlKind, string>>;
  defaultView: DashboardView;
  agent: AgentSelection;
}>;

export interface ReviewFlowDesktopApi {
  bootstrap(): Promise<DesktopBootstrap>;
  updateSettings(request: UpdateSettingsRequest): Promise<DesktopSettings>;
  listReviews(request: ListReviewsRequest): Promise<ReviewDashboard>;
  prepareReview(request: PrepareReviewRequest): Promise<LocalReviewInput>;
  generateOutline(request: GenerateOutlineRequest): Promise<GenerateOutlineResult>;
  runAutomatedReview(request: AutomatedReviewRequest): Promise<AutomatedReviewResult>;
  askAgent(request: AskAgentRequest): Promise<AskAgentResult>;
  cancelOperation(operationId: string): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  revealWorktree(ref: ReviewRef): Promise<void>;
}
