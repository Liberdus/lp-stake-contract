// This setup uses Hardhat Ignition to manage smart contract deployments.
// Learn more about it at https://hardhat.org/ignition

import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
import { ethers } from 'ethers';

const { parseEther } = ethers;

const LPStakingModule = buildModule('LPStakingModule', (m) => {
  const libToken = m.contract('MockERC20', ['Libedus Token', 'LIB'], { id: 'LibToken' });
  const lpLIBETH = m.contract('MockERC20', ['Uniswap V2 LP Token(LIB-ETH)', 'UNI-V2'], { id: 'LPLIBETH' });
  const lpLIBUSDT = m.contract('MockERC20', ['Uniswap V2 LP Token(LIB-USDT)', 'UNI-V2'], { id: 'LPLIBUSDT' });
  const lpLIBUSDC = m.contract('MockERC20', ['Uniswap V2 LP Token(LIB-USDC)', 'UNI-V2'], { id: 'LPLIBUSDC' });

  const INITIAL_SIGNERS = [
    '0xeC122D3edADd8e5AA5cD97Dc2a541329D027d66A',
    '0xdD2FD4581271e230360230F9337D5c0430Bf44C0',
    '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199',
    '0xbDA5747bFD65F08deb54cb465eB87D40e51B197E',
  ];

  const lpStaking = m.contract('LPStaking', [libToken, INITIAL_SIGNERS], { id: 'LPStaking' });

  // Mint LIB tokens to LPStaking
  m.call(libToken, 'mint', [lpStaking, parseEther('10000')], { id: 'Mint_LIB_To_LPStaking' });

  // Mint LP tokens to signers
  INITIAL_SIGNERS.forEach((signerAddress, index) => {
    m.call(libToken, 'mint', [signerAddress, parseEther('10000')], { id: `Mint_LIB_To_${signerAddress}` });
    m.call(lpLIBETH, 'mint', [signerAddress, parseEther('100')], { id: `Mint_LP_LIBETH_${index}` });
    m.call(lpLIBUSDT, 'mint', [signerAddress, parseEther('100')], { id: `Mint_LP_LIBUSDT_${index}` });
    m.call(lpLIBUSDC, 'mint', [signerAddress, parseEther('100')], { id: `Mint_LP_LIBUSDC_${index}` });
  });

  return { libToken, lpLIBETH, lpLIBUSDT, lpLIBUSDC, lpStaking };
});

export default LPStakingModule;
