// This setup uses Hardhat Ignition to manage smart contract deployments.
// Learn more about it at https://hardhat.org/ignition

import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

const LPStakingModule = buildModule('LPStakingModule', (m: any) => {
  const REWARD_TOKEN = '0x0000000000000000000000000000000000000000';
  const INITIAL_SIGNERS = ['0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000'];

  const lpStaking = m.contract('LPStaking', [REWARD_TOKEN, INITIAL_SIGNERS]);

  return { lpStaking };
});

export default LPStakingModule;
