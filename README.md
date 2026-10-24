## LP Staking Rewards

Similar to how node operators are rewarded for providing resources to the network, liquidity providers can be rewarded for providing the project's tokens for trading on decentralized AMMs such as Uniswap. It is better for the project to spend on rewarding liquidity on DEXs than paying listing and market making fees on CEXs. The project can set aside some of its tokens to be distributed to liquidity providers. However, unlike node operator reward that provides a fixed USD amount per hour for each node (but paid in the project token), the liquidity provider reward is a fixed amount per hour that is shared by all liquidity providers proportional to their share of the liquidity pool.

Here is how the LP staking works:

- A smart contract is setup where liquidity providers (LPs) can deposit their LP tokens to earn rewards from the contract.
- The project sends the liquidity reward tokens to the LP staking contract (LIB token in the case of Liberdus) and sets the hourly distribution rate and the percent allocation for each liquidity pair.
- When a user adds assets of a trading pair to an AMM such as Uniswap, they are given LP tokens which represent the assets they have added to the pool and can be used to redeem the underlying assets.
- The smart contract will only give rewards for specified trading pairs on a specified AMM. For example for LIB-WETH on Uniswap. This helps to concentrate the liquidity into the same pools rather than being spread across many pools.
- The smart contract can allocate different reward amounts for different pairs. For example 70% for LIB-WETH and 30% for LIB-USDC. This is done by setting a reward weight for each pair.
- The intended staking assets are supported Uniswap V2-style fungible LP tokens. Governance is responsible for reviewing and admitting each token; the contract does not verify LP provenance on-chain. Uniswap V3 position NFTs are not supported.
- When a user stakes their LP tokens to the smart contract, they effectively transfer custody to the contract and it is recorded as a ledger balance in the contract. For each address the contract records what the address has staked.

A web based interface allows users to stake and unstake their LP tokens as well as view what they have staked and earned. It also allows the users to view what the current estimated APR is.

- On the web page the user can see the current APR for each pair.

| Pair     | Platform   | Est. APR | Reward Weight | TVL    | My Pool Share | My Earnings |
| -------- | ---------- | -------- | ------------- | ------ | ------------- | ----------- |
| LIB-USDC | Uniswap-V2 | 17.3%    | 3.0 (50%)     | $230K  | 0.0%          | 0 LIB       |
| LIB-WETH | Uniswap-V2 | 15.1%    | 1.5 (25%)     | $1.03M | 0.3702%       | 385.77 LIB  |
| LIB-WBTC | Uniswap-V2 | 12.6%    | 1.5 (25%)     | $720K  | 0.2844%       | 283.93 LIB  |
| LIB-WPOL | Uniswap-V2 | 0.0%     | 0.0 (0%)      | $5K    | 0.0%          | 0 LIB       |

- The user can also see the total hourly reward rate.
- The user must connect their wallet to see the My Share and My Earnings info. They can see the other columns without connecting the wallet.
- Pairs are ordered with the highest estimated APR at the top; ties broken by higher TVL (total value locked)
  Pairs with a weight of zero are shown at the bottom of the LP Staking table
- Clicking on the trading pair takes the user to the AMM site for adding or removing liquidity.
- Clicking on the My Share or My Earnings value opens a modal to stake or unstake LP tokens for that pair as well as withdraw the earnings.
- The modal has a tab for Stake, Unstake and Withdraw.
  - The Stake tab allows the user to select the percent of LP tokens they want to stake. The liquidity pair can also be selected but defaults to the pair that corresponds to the My Share link that the user clicked.
    - Users cannot add stake to a pair with zero weight.
  - The Unstake tab allows the user to select the percent of staked LP tokens they want to unstake. The liquidity pair can also be selected but defaults to the pair that corresponds to the My Share link that the user clicked.
    - Both full and partial unstakes use `shouldClaimRewards` to select whether earned rewards are paid or saved for a separate claim.
  - The Withdraw tab allows the user to withdraw the earned reward token to their wallet.
    - 100% of the earned reward token for that pair is withdrawn; partial withdrawals are not allowed
    - Claiming rewards does not unstake LP tokens. A full unstake only claims rewards when `shouldClaimRewards` is true.
    - The reward tokens are supplied by the admin. The contract will throw an error and the withdrawal will fail if the contract does not have sufficient reward tokens.
- When a user makes any change such as adding or removing stake or a full or partial withdrawal, the earned amount since the last change for the liquidity pair is added to the total earned for that pair and the earning start time for that pair is set to the current time.

Aside from the web page for users, a separate web page allows the administrator to add liquidity pairs, set the hourly reward amount and set the reward allocation for the pairs. Ordinary governance actions require three approvals from the four admins. Signer changes can also include one distinct owner authority, as described in the [governance guide](docs/audit-governance.md).

The actions available through the admin interface are:

- Add a liquidity pair
- Update the hourly reward rate; when executed it takes effect immediately
- Update the reward weights for one or more pairs
  - the reward weights are normalized by setting the weight to the percentage value
  - When an admin changes the hourly reward rate or reward weights, the earned amount since the start of the earnings time for all liquidity pairs for all users is added to the corresponding total earned and the corresponding earning start time for all users for all pairs is set to the current time.
  - Rate and weight changes take effect when the quorum-approved action executes.
  - If the weight of a liquidity pair is set to zero, the contract does not accept new staking for this pair
  - Users can continue to leave the LP tokens staked but will not be earning anything; but they should be encouraged to unstake; there is not automatic forced unstaking; it must be done by the user
- Withdraw the reward token to a specified address
- Change one of the four signers; requires three approvals. A distinct nonzero owner adds one voting authority, giving five instead of four. An owner who is already an admin does not add a vote.
- Multisig feature is managed by the contract itself and not done by different multisig contract

## Deployment configuration

Use only the reviewed BSC mainnet/testnet modules described in [the deployment safety guide](docs/deployment-safety.md). The legacy generic prod/test modules are disabled; they contained a public development signer. Local regression tests do not require any deployment credentials.
