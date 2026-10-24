# Reviewed deployment configuration (LPS-03)

## Supported entry points

- `npm run deploy:bsc-mainnet` and `deploy:bsc-mainnet:verify` use `ignition/modules/LPStaking.bscMainnet.ts` and the `BSC_MAINNET_*` configuration.
- `npm run deploy:bsc-testnet` and `deploy:bsc-testnet:verify` use `ignition/modules/LPStaking.bscTestnet.ts` and the `BSC_TESTNET_*` configuration.
- Both modules and both V2 verification scripts load `scripts/deployment-config.cjs`. The generic `constructor-args.cjs` loader requires `LPSTAKING_DEPLOYMENT_CONFIG=BSC_MAINNET` or `BSC_TESTNET` and uses that same validation.
- The generic `LPStaking.prod.ts`, `LPStaking.test.ts`, and `scripts/verify.ts` are disabled. They previously hard-coded public development authorities. Unit tests should deploy isolated mocks, not use public-network deployment modules.

For the selected network, supply the reward token, four individually reviewed signer addresses, and the intended initial owner in the corresponding `_OWNER` variable. `Ownable` assigns the deployer as owner; the module explicitly sets its transaction sender to this reviewed address. Ignition must have that account available as a signer, otherwise deployment fails rather than silently using a different owner.

`_CONFIG_REVIEWED=true` is required and defaults to false in `.env.example`. This records an operator's explicit review checkpoint, not independent cryptographic approval. Validation rejects missing/malformed/zero addresses, duplicate signer addresses after checksum normalization, and the first 20 public Hardhat/Anvil development authorities as either signer or owner. The list cannot identify every compromised key. Verify custody and independence of the chosen authorities separately.

Owner/signer overlap is rejected by default. If the project's reviewed governance policy deliberately overlaps the owner with one signer, set `_ALLOW_OWNER_SIGNER_OVERLAP=true`. This means the owner is not an independent fifth authority. An explicit overlap never permits a known development account.

The validation module reads public configuration only. No new credentials or permissions are created, and tests never transmit a transaction to a public network. Source remediation is not authorization to deploy, change live authorities, or move assets.

## Deployment record requirements

For every new deployment, retain the source commit, exact module filename, chain ID, reviewed public constructor arguments, intended owner, explicit overlap decision, transaction hash, resulting address, and Ignition journal/build artifacts. Record verification results separately. Do not commit credentials or private keys. Confirm the actual deployed owner and four signer roles through a separately authorized operational check before declaring a deployment safe.

[deployment-records.json](deployment-records.json) inventories all four historical deployment directories at audited revision `637477e3351d05e4e3beb5640a3fbb1af3bfcfe2`, including exact constructor arguments and the recorded deployer/address. It is generated from the committed `journal.jsonl` and `deployed_addresses.json` files without contacting a chain. These journals name `LPStakingModule`, but do not identify the original source module filename; that field is deliberately null rather than inferred. The records do not establish live bytecode, current roles, ownership, balances, or whether a module was safe to use. They are preserved unchanged, including the historical Polygon configuration containing the development signer.

## Regression evidence

Run `npx hardhat test --network hardhat test/DeploymentConfig.audit.test.ts` (or `--no-compile` when inspecting only module configuration). Before remediation at the audited revision, the final 31 configuration regressions had 28 failures and three passes: the old BSC modules already rejected missing signer entries and package scripts selected the BSC modules, but unsafe configurations were accepted and the reviewed owner was not bound. The same 31 pass after remediation. The tests inspect module definitions and use the in-memory Hardhat account list only; no deployment request is submitted.
