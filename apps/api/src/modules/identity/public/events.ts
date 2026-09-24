/** События модуля Identity. */
export const IdentityEvents = {
  BranchChanged: 'identity.branch_changed',
} as const;

export interface BranchChangedPayload {
  branchId: string;
}
