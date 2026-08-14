import type {
  AgentReviewOutline,
  AutomatedReview,
  DesktopReview,
  ReviewRef
} from '../../desktop/contracts';
import type { ReviewStatus } from '@/review/types';

const REVIEW_PREFIX = 'reviewflow:desktop:review:v1:';
const RECENT_KEY = 'reviewflow:desktop:recent:v1';
const MAX_RECENT = 12;

export type DesktopSavedReview = {
  headSha: string;
  outline?: AgentReviewOutline;
  automatedReview?: AutomatedReview;
  statuses: Record<string, ReviewStatus>;
  notes: Record<string, string>;
  selectedSectionId?: string;
  updatedAt: number;
};

export type RecentDesktopReview = {
  ref: ReviewRef;
  title: string;
  repositoryPath: string;
  headSha: string;
  updatedAt: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

const readJson = (key: string): unknown => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeJson = (key: string, value: unknown) => {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

const refIdentity = (ref: ReviewRef) => ref.sourceControl === 'gitlab'
  ? `gitlab|${ref.host.toLowerCase()}|${ref.projectId}|${ref.number}`
  : `github|${ref.host.toLowerCase()}|${ref.owner.toLowerCase()}|${ref.repository.toLowerCase()}|${ref.number}`;

export const desktopReviewStorageKey = (ref: ReviewRef) => `${REVIEW_PREFIX}${encodeURIComponent(refIdentity(ref))}`;

const validStatus = (value: unknown): value is ReviewStatus => (
  typeof value === 'string' && ['not-started', 'in-progress', 'reviewed', 'needs-look', 'blocked', 'stale'].includes(value)
);

export const readDesktopReview = (ref: ReviewRef): DesktopSavedReview | null => {
  const value = readJson(desktopReviewStorageKey(ref));
  if (!isRecord(value) || typeof value.headSha !== 'string' || !isRecord(value.statuses) || !isRecord(value.notes) || typeof value.updatedAt !== 'number') return null;
  const statuses = Object.fromEntries(Object.entries(value.statuses).filter((entry): entry is [string, ReviewStatus] => validStatus(entry[1])));
  const notes = Object.fromEntries(Object.entries(value.notes).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  return {
    headSha: value.headSha,
    ...(isRecord(value.outline) ? { outline: value.outline as AgentReviewOutline } : {}),
    ...(isRecord(value.automatedReview) ? { automatedReview: value.automatedReview as AutomatedReview } : {}),
    statuses,
    notes,
    ...(typeof value.selectedSectionId === 'string' ? { selectedSectionId: value.selectedSectionId } : {}),
    updatedAt: value.updatedAt
  };
};

export const writeDesktopReview = (ref: ReviewRef, review: DesktopSavedReview) => (
  writeJson(desktopReviewStorageKey(ref), review)
);

const recentFrom = (value: unknown): RecentDesktopReview[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const ref = candidate.ref;
    if (!isRecord(ref) || (ref.sourceControl !== 'gitlab' && ref.sourceControl !== 'github')) return [];
    const number = Number(ref.number);
    if (
      typeof ref.host !== 'string' ||
      !Number.isSafeInteger(number) || number <= 0 ||
      typeof candidate.title !== 'string' ||
      typeof candidate.repositoryPath !== 'string' ||
      typeof candidate.headSha !== 'string' ||
      typeof candidate.updatedAt !== 'number'
    ) return [];
    let validatedRef: ReviewRef;
    if (ref.sourceControl === 'gitlab') {
      const projectId = Number(ref.projectId);
      if (!Number.isSafeInteger(projectId) || projectId <= 0) return [];
      validatedRef = { sourceControl: 'gitlab', host: ref.host, projectId, number };
    } else {
      if (typeof ref.owner !== 'string' || typeof ref.repository !== 'string') return [];
      validatedRef = { sourceControl: 'github', host: ref.host, owner: ref.owner, repository: ref.repository, number };
    }
    return [{
      ref: validatedRef,
      title: candidate.title,
      repositoryPath: candidate.repositoryPath,
      headSha: candidate.headSha,
      updatedAt: candidate.updatedAt
    }];
  }).slice(0, MAX_RECENT);
};

export const readRecentDesktopReviews = () => recentFrom(readJson(RECENT_KEY));

export const touchRecentDesktopReview = (review: DesktopReview) => {
  const next: RecentDesktopReview = {
    ref: review.ref,
    title: review.title,
    repositoryPath: review.repository.pathWithNamespace,
    headSha: review.headSha,
    updatedAt: Date.now()
  };
  const current = readRecentDesktopReviews().filter((item) => !(
    refIdentity(item.ref) === refIdentity(next.ref)
  ));
  writeJson(RECENT_KEY, [next, ...current].slice(0, MAX_RECENT));
  return [next, ...current].slice(0, MAX_RECENT);
};
