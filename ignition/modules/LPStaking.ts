// This setup uses Hardhat Ignition to manage smart contract deployments.
// Learn more about it at https://hardhat.org/ignition

import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

const LPStakingModule = buildModule('LPStakingModule', (m: any) => {
  // Deploy mock tokens first
  const libToken = m.contract('MockERC20', ['Libedus Token', 'LIB'], { id: 'LibToken' });
  const uniV2Token = m.contract('MockERC20', ['Uniswap V2 LP Token', 'UNI-V2'], { id: 'UniV2Token' });

  const INITIAL_SIGNERS = [
    '0xeC122D3edADd8e5AA5cD97Dc2a541329D027d66A',
    '0xdD2FD4581271e230360230F9337D5c0430Bf44C0', 
    '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199',
    '0xbDA5747bFD65F08deb54cb465eB87D40e51B197E',
  ];

  // Deploy LPStaking with the mock LIB token address
  const lpStaking = m.contract('LPStaking', [libToken, INITIAL_SIGNERS], { id: 'LPStaking' });

  return { libToken, uniV2Token, lpStaking };
});

export default LPStakingModule;
