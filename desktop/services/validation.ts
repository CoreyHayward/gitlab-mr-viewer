import type { AgentSelection, DashboardView, ReviewRef, SourceControlKind } from '../contracts';

const dashboardViews = new Set<DashboardView>(['review-requested', 'assigned', 'authored', 'all-open']);

export const validatedHost = (value: unknown) => {
  const host = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!host || host.length > 255 || !/^[a-z0-9.-]+(?::[0-9]{1,5})?$/.test(host)) {
    throw new Error('Enter a valid source-control hostname, such as gitlab.com.');
  }
  return host;
};

export const validatedDashboardView = (value: unknown): DashboardView => {
  if (!dashboardViews.has(value as DashboardView)) throw new Error('Choose a valid merge request view.');
  return value as DashboardView;
};

export const validatedSourceControl = (value: unknown): SourceControlKind => {
  if (value !== 'gitlab' && value !== 'github') throw new Error('Choose a valid source-control provider.');
  return value;
};

export const validatedOperationId = (value: unknown) => {
  const operationId = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(operationId)) throw new Error('The operation identifier is invalid.');
  return operationId;
};

export const validatedReviewRef = (value: unknown): ReviewRef => {
  if (!value || typeof value !== 'object') throw new Error('The code review reference is invalid.');
  const candidate = value as Partial<ReviewRef>;
  const sourceControl = validatedSourceControl(candidate.sourceControl);
  const number = Number(candidate.number);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error('The code review reference is invalid.');
  }
  const host = validatedHost(candidate.host);
  if (sourceControl === 'gitlab') {
    const projectId = Number('projectId' in candidate ? candidate.projectId : 0);
    if (!Number.isSafeInteger(projectId) || projectId <= 0) throw new Error('The GitLab project reference is invalid.');
    return { sourceControl, host, projectId, number };
  }
  const owner = 'owner' in candidate && typeof candidate.owner === 'string' ? candidate.owner.trim() : '';
  const repository = 'repository' in candidate && typeof candidate.repository === 'string' ? candidate.repository.trim() : '';
  if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(owner) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(repository)) {
    throw new Error('The GitHub repository reference is invalid.');
  }
  return { sourceControl, host, owner, repository, number };
};

export const validatedAgent = (value: unknown): AgentSelection => {
  if (!value || typeof value !== 'object') throw new Error('Choose a local agent harness.');
  const candidate = value as Partial<AgentSelection>;
  if (candidate.kind !== 'codex' && candidate.kind !== 'claude') throw new Error('Choose Codex or Claude Code.');
  const model = typeof candidate.model === 'string' ? candidate.model.trim() : '';
  if (model && (!/^[a-zA-Z0-9._:/-]{1,120}$/.test(model) || model.startsWith('-'))) {
    throw new Error('The agent model name is invalid.');
  }
  return { kind: candidate.kind, ...(model ? { model } : {}) };
};

export const validatedQuestion = (value: unknown) => {
  const question = typeof value === 'string' ? value.trim() : '';
  if (!question) throw new Error('Ask a question about this review.');
  if (question.length > 4_000) throw new Error('Keep the question under 4,000 characters.');
  return question;
};
