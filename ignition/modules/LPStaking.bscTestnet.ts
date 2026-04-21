import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

const rewardToken = process.env.BSC_TESTNET_REWARD_TOKEN;
const initialSigners = [
  process.env.BSC_TESTNET_SIGNER_1,
  process.env.BSC_TESTNET_SIGNER_2,
  process.env.BSC_TESTNET_SIGNER_3,
  process.env.BSC_TESTNET_SIGNER_4,
].filter((value): value is string => value !== undefined && value !== '');

if (!rewardToken) {
  throw new Error('Missing BSC_TESTNET_REWARD_TOKEN in environment');
}

if (initialSigners.length !== 4) {
  throw new Error('BSC testnet deployment requires exactly 4 signer addresses');
}

const LPStakingModule = buildModule('LPStakingModule', (m) => {
  const lpStaking = m.contract('LPStaking', [rewardToken, initialSigners], {
    id: 'LPStaking',
  });

  return { lpStaking };
});

export default LPStakingModule;
