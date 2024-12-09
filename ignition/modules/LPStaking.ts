// This setup uses Hardhat Ignition to manage smart contract deployments.
// Learn more about it at https://hardhat.org/ignition

import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

const LPStakingModule = buildModule('LPStakingModule', (m: any) => {
  const LIB_TOKEN = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
  const UNI_V2_TOKEN = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
  const INITIAL_SIGNERS = [
    '0xfae66C83A8eE918CFA791C97622F0470437D999c',
    '0xF1B66a95D3E0aAf0Aa3616b34BA6584bA3e7CEC7',
    '0x7CcC849aA3c7648c072D34520e3e857f621B81fb',
    '0x8DB17888258cAe47B7001a90613E1990B7b2b65B'
  ];

  const lpStaking = m.contract('LPStaking', [LIB_TOKEN, INITIAL_SIGNERS]);

  return { lpStaking };
});

export default LPStakingModule;
