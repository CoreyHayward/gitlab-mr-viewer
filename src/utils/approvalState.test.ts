import { describe, expect, it } from 'vitest';
import { matchesApprovalFilter } from '@/utils/approvalState';

describe('matchesApprovalFilter', () => {
  it('includes partially approved merge requests in the needs approval filter', () => {
    const approvalStatus = {
      approvals_required: 2,
      approvals_left: 1,
      approved_by: [{
        user: {
          id: 1,
          name: 'Reviewer',
          username: 'reviewer',
          avatar_url: ''
        },
        approved_at: null
      }]
    };

    expect(matchesApprovalFilter(approvalStatus, 'needs-approval', 'opened')).toBe(true);
    expect(matchesApprovalFilter({ ...approvalStatus, approvals_left: 0 }, 'needs-approval', 'opened')).toBe(false);
  });
});
