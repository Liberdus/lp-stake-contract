# Governance remediation: LPS-01, LPS-05, LPS-06

This change builds on the July governance work already in audited revision
`637477e3351d05e4e3beb5640a3fbb1af3bfcfe2`. It replaces the single pending
proposal lock, not the existing three-approval requirement or the four-admin
configuration.

## Voting authorities

- Ordinary proposals have four admin authorities and need three approvals.
  Two rejections make approval impossible and close the proposal.
- Signer-change proposals also have one owner authority if, at creation, the
  owner is nonzero and is not one of the four admins. These proposals need three
  approvals or three rejections to close. The distinct owner can approve or reject.
- An owner/admin overlap at proposal creation does not create a fifth authority
  later, even if ownership transfers to a non-admin address.
- The current owner can exercise an unused owner authority. A departed owner
  cannot newly vote merely because they used to own the contract. Once either
  kind of vote uses the owner authority, every successor inherits its consumed
  status. Returning ownership to a former owner does not reset it.
- Every address can cast only one vote of either kind. An admin who becomes the
  owner cannot vote twice. An admin's vote is an admin vote, not an additional
  owner vote. Existing votes by the owner authority remain counted after transfer
  or renunciation, because that one authority was legitimately exercised.
- The electorate size is fixed at proposal creation. A later owner overlap or
  renunciation does not reduce a five-authority proposal's rejection threshold.
  Three admins can still approve; an impossible-to-complete proposal can expire
  without blocking a new one.

## Concurrent proposals and stale state

Proposals may coexist, so one admin cannot monopolize a global proposal slot.
Every proposal records the current signer configuration epoch. A successful
signer rotation increments that epoch, immediately invalidating all other older
proposals and their cached approvals and rejections. No historical loop runs
during rotation. Old votes cannot regain validity if a departed signer rejoins.
Signer execution additionally revalidates that the departing admin exists and
the replacement is not already an admin.

Three approvals are still required to change the epoch; one admin cannot
invalidate honest proposals merely by opening new ones. Ownership changes do
not advance the signer epoch or invalidate ordinary admin proposals.

`isActionExpired` now also returns true for stale-epoch actions. Existing bounded
cleanup methods may mark these expired, but cleanup is not required before new
proposals. `pendingActionCount` counts unclosed actions in the current signer
epoch; it resets on rotation, and cleanup of old-epoch actions cannot decrement
the current count. `pendingChangeSignerActionId` is retained for ABI compatibility
only as the newest signer-proposal hint. It is not a global lock or a complete
enumeration of concurrently pending signer proposals.

## Local verification

Run `npx hardhat test --network hardhat test/AuditGovernance.test.cjs`.
These tests use only ephemeral local contracts and mock tokens.

The 16-test governance suite produced 10 failures and 6 passing controls against
the audited Solidity baseline. With these fixes all 16 pass. Tests cover both
owner-transfer variants, pre-vote transfer, transfer after quorum, returning and
renouncing ownership, both vote directions, owner/admin overlap, rejection
thresholds, repeated slot-griefing attempts, concurrent replacements, leave and
rejoin, stale cleanup accounting, and invalid or expired proposals. Existing
repository tests that asserted global serialization now assert concurrent
proposal accounting and epoch invalidation instead.

This is a source-level fix for a new deployment, not an upgrade or migration of
any deployed contract. No chain state, live authorities, or funds were changed.
