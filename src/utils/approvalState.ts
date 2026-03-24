import { ApprovalFilterState, GitLabMergeRequest, GitLabMergeRequestApprovalStatus } from '@/types/gitlab';

export type MergeRequestApprovalCategory =
  | 'loading'
  | 'no-approval-required'
  | 'needs-review'
  | 'partially-approved'
  | 'approved'
  | 'not-open';

export const getApprovalCategory = (
  mergeRequest: Pick<GitLabMergeRequest, 'state' | 'reviewers' | 'approval_status'>
): MergeRequestApprovalCategory => {
  if (mergeRequest.state !== 'opened') {
    return 'not-open';
  }

  const approvalStatus = mergeRequest.approval_status;
  if (!approvalStatus) {
    return 'loading';
  }

  const approvalCount = approvalStatus.approved_by.length;
  const requiredApprovals = approvalStatus.approvals_required;
  const approvalsLeft = approvalStatus.approvals_left;

  if (requiredApprovals === 0) {
    return 'no-approval-required';
  }

  if (approvalsLeft === 0) {
    return 'approved';
  }

  if (approvalCount > 0) {
    return 'partially-approved';
  }

  return 'needs-review';
};

export const matchesApprovalFilter = (
  approvalStatus: GitLabMergeRequestApprovalStatus | undefined,
  approvalState: ApprovalFilterState | undefined,
  mergeRequestState: GitLabMergeRequest['state']
): boolean => {
  if (!approvalState) {
    return true;
  }

  const category = getApprovalCategory({
    state: mergeRequestState,
    reviewers: [],
    approval_status: approvalStatus
  });

  return category === approvalState;
};