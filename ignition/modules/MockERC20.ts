import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

const MockERC20Module = buildModule('MockERC20Module', (m: any) => {
  const mockERC20 = m.contract('MockERC20', ['Libedus Token', 'LIB']);

  return { mockERC20 };
});

export default MockERC20Module;
