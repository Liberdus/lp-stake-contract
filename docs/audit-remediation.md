# Reward accounting and audit coverage

## Audit coverage

The regression suites cover the six LPS findings in the 2 October 2026 audit of
revision `637477e3351d05e4e3beb5640a3fbb1af3bfcfe2`.

| Finding | Change | Regression suite |
| --- | --- | --- |
| LPS-01 | One durable owner authority per eligible proposal; no vote replenishment after owner transfers; signer epochs prevent stale votes | `AuditGovernance.test.cjs` |
| LPS-02 | Monotonic accumulator across pool removal/re-addition; saved claims continue at zero weight and with new users | `AuditRewards.test.ts` |
| LPS-03 | Reviewed network-specific public parameters; known development authorities rejected; legacy ambiguous entry points fail closed | `DeploymentConfig.audit.test.ts` |
| LPS-04 | Reject zero unstakes; time/weight/pool/user remainder accounting; bounded cohort dust; full-width multiplication | `AuditRewards.test.ts` |
| LPS-05 | Concurrent proposals let an honest quorum recover without winning a proposal-slot race; signer changes invalidate stale proposals in O(1) | `AuditGovernance.test.cjs` |
| LPS-06 | Snapshot four/five authorities; rejection thresholds two/three; same vote-exclusivity policy for both outcomes | `AuditGovernance.test.cjs` |

See [governance details](audit-governance.md) and [deployment safety](deployment-safety.md). The distinct owner can reject signer changes as well as approve them; an owner who overlaps an admin does not create a fifth authority. Ownership transfers remain standard Ownable2Step actions.

## Reward precision and cohort policy

`PRECISION` is `1e30`. `MAX_TOTAL_STAKED = uint128.max` bounds aggregate tracked stake per pool, not just each deposit. Deposits exceeding the aggregate limit revert atomically; partial withdrawals leaving a single raw unit remain supported. The accumulator scale differs from the earlier `1e18` scale. Integrators must use the contract's `PRECISION` value. Source changes do not upgrade existing immutable deployments.

With unchanged supply, rate, and weights, the time, weight, and reward-per-token division remainders carry forward. User division remainders stay with that user across claims, deposits, and withdrawals. Splitting settlement does not repeatedly discard those fractions. No-op rate and weight governance operations preserve them too. Arithmetic uses `Math.mulDiv` and `mulmod` rather than overflowing intermediate products.

On a genuine supply change, pool-level emission and reward-per-token remainders are discarded rather than assigned to a different cohort. On a real rate/weight change, old emissions are settled first and time/weight remainders are discarded; the unchanged pool's reward-per-token remainder and users' remainders survive. This prevents old pool dust from subsidizing newcomers. It does not promise a percentage-loss bound for arbitrarily tiny emissions.

Absolute rounding allowance per supply boundary is less than two raw reward units from time/weight divisions plus `S / 1e30` raw reward units from the pool accumulator, where `S` is old tracked supply. At `S = 1e30`, this is less than three raw units per boundary. At the aggregate cap, the pool term is below 340,282,367 raw units (less than 3.5e-10 tokens for an 18-decimal reward token). Decimal-independent raw-unit bounds matter for tokens with fewer decimals. Real parameter changes discard less than two raw emission units per pool. Existing user fractional entitlements remain user-owned; under one raw unit may remain unclaimable until additional earnings accumulate.

Obligations reserve all whole emitted units. Discarded pool accumulator dust can therefore remain conservatively reserved even after everybody exits. It is not administratively swept; doing so without tracking every fractional user entitlement could break solvency. The bound is per boundary, not a fixed lifetime cap. Integrators should not interpret `totalRewardsObligated` as exactly the sum of immediately claimable rounded balances.

Finite uint256 accumulators are not an unbounded-time mathematical model. At the maximum permitted hourly rate, a one-raw-unit supply, and an initially zero accumulator, the accumulator has about 38,818 years of headroom. A one-year extreme-rate/residual-supply regression protects against an overly large precision constant blocking principal withdrawal. This is not a proof for arbitrary elapsed times or malicious/rebasing tokens.

## Tests and limitations

```sh
npm ci
npm test
npm run test:audit
npx tsc --noEmit
```

`npm test` runs the full suite. `npm run test:audit` runs the governance,
deployment-configuration, and reward-accounting subsets. Reward coverage includes
3,600 one-second claims, 200 seeded two-pool transitions, pool re-addition,
cohort changes, no-op parameter updates, aggregate stake limits, and one-year
maximum-rate accrual with a single-raw-unit remaining stake.

Tests use isolated mock tokens on the explicit in-memory Hardhat network. They
do not establish live-chain bytecode, authorities, balances, or deployment
safety, and are not formal verification or a guarantee for arbitrary token
behavior. The Solidity build uses version 0.8.28, optimizer 200 runs, viaIR, and
the Paris EVM target. The lockfile records the dependency versions.

The historical Polygon journal includes a known public development signer.
[Deployment records](deployment-records.json) describe recorded constructor
arguments, not current live authorities. See the [deployment safety guide](deployment-safety.md)
for configuration requirements and verification boundaries.
