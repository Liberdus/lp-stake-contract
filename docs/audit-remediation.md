# October audit remediation

## Scope and prior pull requests

This branch starts at `637477e3351d05e4e3beb5640a3fbb1af3bfcfe2`, the exact current revision named in the 2 October 2026 LPStaking audit. It addresses the six current LPS findings, not a fresh deployment or a claim of universal security.

The earlier remediation PRs already exist and their changes are in that baseline:

- [#14 governance](https://github.com/Liberdus/lp-stake-contract/pull/14), [#15 surplus withdrawal](https://github.com/Liberdus/lp-stake-contract/pull/15), [#16 internal accounting](https://github.com/Liberdus/lp-stake-contract/pull/16), and [#17 pair lifecycle](https://github.com/Liberdus/lp-stake-contract/pull/17) were merged on 27 July 2026.
- [#18 cleanup](https://github.com/Liberdus/lp-stake-contract/pull/18) was closed unmerged; [#19 rebased cleanup](https://github.com/Liberdus/lp-stake-contract/pull/19) was merged on 27 July.
- #14's single pending proposal defense is replaced with concurrent proposals and signer epochs because the October audit identifies a recovery/liveness problem. #17's accumulator reset is removed because surviving user checkpoints make that reset unsafe. Neither change rewrites earlier history or removes the internal-stake/surplus defenses.

## Decisions and acceptance coverage

| Finding | Change | Regression suite |
| --- | --- | --- |
| LPS-01 | One durable owner authority per eligible proposal; no vote replenishment after owner transfers; signer epochs prevent stale votes | `AuditGovernance.test.cjs` |
| LPS-02 | Monotonic accumulator across pool removal/re-addition; saved claims continue at zero weight and with new users | `AuditRewards.test.ts` |
| LPS-03 | Reviewed network-specific public parameters; known development authorities rejected; legacy ambiguous entry points fail closed | `DeploymentConfig.audit.test.ts` |
| LPS-04 | Reject zero unstakes; time/weight/pool/user remainder accounting; bounded cohort dust; full-width multiplication | `AuditRewards.test.ts` |
| LPS-05 | Concurrent proposals let an honest quorum recover without winning a proposal-slot race; signer changes invalidate stale proposals in O(1) | `AuditGovernance.test.cjs` |
| LPS-06 | Snapshot four/five authorities; rejection thresholds two/three; same vote-exclusivity policy for both outcomes | `AuditGovernance.test.cjs` |

See [governance details](audit-governance.md) and [deployment safety](deployment-safety.md). The distinct owner can reject signer changes as well as approve them; an owner who overlaps an admin does not create a fifth authority. Ownership transfers remain standard Ownable2Step actions. This is an explicit governance decision, not a prohibition on ownership transfer.

## Reward precision and cohort policy

`PRECISION` becomes `1e30`. `MAX_TOTAL_STAKED = uint128.max` bounds aggregate tracked stake per pool, not just each deposit. Deposits exceeding the aggregate limit revert atomically; partial withdrawals leaving a single raw unit remain supported. This is a new deposit constraint and an accumulator/API scaling change. Existing immutable deployments are not upgraded by this source branch.

With unchanged supply, rate, and weights, the time, weight, and reward-per-token division remainders carry forward. User division remainders stay with that user across claims, deposits, and withdrawals. Splitting settlement does not repeatedly discard those fractions. No-op rate and weight governance operations preserve them too. Arithmetic uses `Math.mulDiv` and `mulmod` rather than overflowing intermediate products.

On a genuine supply change, pool-level emission and reward-per-token remainders are discarded rather than assigned to a different cohort. On a real rate/weight change, old emissions are settled first and time/weight remainders are discarded; the unchanged pool's reward-per-token remainder and users' remainders survive. This prevents old pool dust from subsidizing newcomers. It does not promise a percentage-loss bound for arbitrarily tiny emissions.

Absolute rounding allowance per supply boundary is less than two raw reward units from time/weight divisions plus `S / 1e30` raw reward units from the pool accumulator, where `S` is old tracked supply. At the audited `S = 1e30`, this is less than three raw units per boundary. At the aggregate cap, the pool term is below 340,282,367 raw units (less than 3.5e-10 tokens for an 18-decimal reward token). Decimal-independent raw-unit bounds matter for tokens with fewer decimals. Real parameter changes discard less than two raw emission units per pool. Existing user fractional entitlements remain user-owned; under one raw unit may remain unclaimable until future earnings accumulate.

Obligations reserve all whole emitted units. Discarded pool accumulator dust can therefore remain conservatively reserved even after everybody exits. It is not administratively swept; doing so without tracking every fractional user entitlement could break solvency. The bound is per boundary, not a fixed lifetime cap. Integrators should not interpret `totalRewardsObligated` as exactly the sum of immediately claimable rounded balances.

Finite uint256 accumulators are not an unbounded-time mathematical model. At the maximum permitted hourly rate, a one-raw-unit supply, and an initially zero accumulator, the accumulator has about 38,818 years of headroom. A one-year extreme-rate/residual-supply regression protects against an overly large precision constant blocking principal withdrawal. This is not a proof for arbitrary elapsed times or malicious/rebasing tokens.

## Verification and operational limits

All tests use local mock tokens and the explicit in-memory Hardhat network. No public-network transaction, signer rotation, wallet operation, deployment, or merge is part of this work. No private key values were retrieved or added. The known development address is public address metadata, not newly discovered secret material.

The repository journals include a historical Polygon constructor using the reported development signer. Those records do not establish current live authorities, bytecode, balances, or exploitability. A separately authorized operational review is required before deciding whether any live action is needed.

Run:

```sh
npm ci
npm test
npm run test:audit
npx tsc --noEmit
```

In a read-only-home sandbox, set `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, and `XDG_DATA_HOME` to writable task-local directories. No production environment file or funded account is needed. Toolchain remains the locked dependency graph and Solidity 0.8.28 with optimizer/viaIR; compiler target is Paris. This work does not refresh or resolve the audit's separate dependency-advisory snapshot, license inconsistency, all informational API observations, or arbitrary-token compatibility.

## Recorded local verification (24 October 2026)

- Original repository suite at the audited baseline: **66 passed**.
- Exact final audit regression files against baseline `637477e`: **45 failed, 12 passed**. Those 12 are existing defenses/boundary controls, not evidence of a failed repair.
- Integrated repaired repository suite: **123 passed** (66 repository tests, with obsolete assertions replaced, plus 57 new audit tests).
- New audit suites comprise 16 governance, 31 deployment configuration, and 10 rewards/accounting tests. Rewards coverage includes 3,600 one-second claims and a 200-transition seeded two-pool conservation/solvency control.
- TypeScript `npx tsc --noEmit` and `git diff --check`: passed.
- Compiled deployed LPStaking bytecode: **22,409 bytes**, below the 24,576-byte EIP-170 limit.
- Independent review identified and corrected an initial precision overflow before final verification, then independently checked that maximum-rate, one-raw-unit principal remains withdrawable.
- No GitHub CI result is claimed: publication is still pending an authenticated supported route. No merge or deployment occurred.

All test claims above refer to local isolated runs, not live-chain reproduction or a formal proof. Raw red/green execution logs are retained with the recoverable remediation package.
