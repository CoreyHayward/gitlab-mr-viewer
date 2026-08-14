import type {
  DashboardView,
  DesktopReview,
  ExecutableStatus,
  RepositorySummary,
  ReviewDashboard,
  ReviewPerson,
  ReviewRef,
  SourceControlKind,
  SourceControlStatus
} from '../contracts';

export type ReviewSource = {
  review: DesktopReview;
  repository: RepositorySummary;
  cloneUrls: string[];
  sourceBranch: string;
  targetBranch: string;
  baseSha: string;
  startSha: string;
  headSha: string;
  targetRemoteRef: string;
  headRemoteRef: string;
};

export type ManagedReviewRefs = {
  targetRef: string;
  headRef: string;
};

export interface SourceControlAdapter {
  readonly kind: SourceControlKind;
  readonly label: string;
  status(): Promise<ExecutableStatus>;
  listReviews(host: string, view: DashboardView, signal?: AbortSignal): Promise<ReviewDashboard>;
  getReviewSource(ref: ReviewRef, signal?: AbortSignal): Promise<ReviewSource>;
  cloneRepository(source: ReviewSource, destination: string, signal?: AbortSignal): Promise<void>;
  fetchReviewRefs(repositoryPath: string, source: ReviewSource, refs: ManagedReviewRefs, signal?: AbortSignal): Promise<void>;
}

const futureStatus = (kind: SourceControlKind, label: string): SourceControlStatus => ({
  kind,
  label,
  implemented: false,
  executable: { installed: false, error: `${label} support is reserved for a future source-control adapter.` }
});

export class SourceControlRegistry {
  private readonly adapters = new Map<SourceControlKind, SourceControlAdapter>();

  constructor(adapters: SourceControlAdapter[]) {
    for (const adapter of adapters) this.adapters.set(adapter.kind, adapter);
  }

  get(kind: SourceControlKind) {
    const adapter = this.adapters.get(kind);
    if (!adapter) throw new Error(`${kind === 'github' ? 'GitHub' : 'GitLab'} is not available in this ReviewFlow build yet.`);
    return adapter;
  }

  async statuses(): Promise<SourceControlStatus[]> {
    const known: Array<{ kind: SourceControlKind; label: string }> = [
      { kind: 'gitlab', label: 'GitLab' },
      { kind: 'github', label: 'GitHub' }
    ];
    return Promise.all(known.map(async ({ kind, label }) => {
      const adapter = this.adapters.get(kind);
      return adapter
        ? { kind, label: adapter.label, implemented: true, executable: await adapter.status() }
        : futureStatus(kind, label);
    }));
  }
}

export type SourceControlListResult = {
  sourceControl: SourceControlKind;
  host: string;
  currentUser: ReviewPerson;
  reviews: DesktopReview[];
  fetchedAt: string;
};
