// This setup uses Hardhat Ignition to manage smart contract deployments.
// Learn more about it at https://hardhat.org/ignition

import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

const LPStakingModule = buildModule('LPStakingModule', (m) => {
  const libToken = '0x693ed886545970F0a3ADf8C59af5cCdb6dDF0a76'

  const INITIAL_SIGNERS = [
    '0xb5A5bD462A0a76c02990d0FBE3321e92E0B03ABC',
    '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    '0x32B6f2C027D4c9D99Ca07d047D17987390a5EB39',
    '0xEc33aDc8A175DCc44f809909B9aae9F4F5760818',
  ];

  const lpStaking = m.contract('LPStaking', [libToken, INITIAL_SIGNERS], { id: 'LPStaking' });

  return { libToken, lpStaking };
});

export default LPStakingModule;
