import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

const MockERC20Module = buildModule('MockERC20Module', (m: any) => {
  const libToken = m.contract('MockERC20', ['Libedus Token', 'LIB'], { id: 'LibToken' });
  const uniV2Token = m.contract('MockERC20', ['Uniswap V2 LP Token', 'UNI-V2'], { id: 'UniV2Token' });

  return { libToken, uniV2Token };
});

export default MockERC20Module;
