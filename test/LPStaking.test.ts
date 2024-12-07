import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { LPStaking, MockERC20 } from '../typechain-types';
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';

describe('LPStaking', function () {
  let lpStaking: LPStaking;
  let rewardToken: MockERC20;
  let lpToken: MockERC20;
  let owner: SignerWithAddress;
  let signers: SignerWithAddress[];

  async function deployERC20Token() {
    const mockERC20 = await ethers.getContractFactory('MockERC20');
    rewardToken = await mockERC20.deploy('Libedus Token', 'LIB');
    await rewardToken.waitForDeployment();

    lpToken = await mockERC20.deploy('Uniswap-V2 LP Token', 'UNI-V2');
    await lpToken.waitForDeployment();
  }

  async function deployLPStaking() {
    [owner, ...signers] = await ethers.getSigners();

    const LPStaking = await ethers.getContractFactory('LPStaking');
    lpStaking = await LPStaking.deploy(
      await rewardToken.getAddress(),
      signers.slice(0, 4).map((signer) => signer.address)
    );
    await lpStaking.waitForDeployment();

    // Grant ADMIN_ROLE to owner
    const ADMIN_ROLE = await lpStaking.ADMIN_ROLE();
    await lpStaking.grantRole(ADMIN_ROLE, owner.address);
  }

  beforeEach(async function () {
    await loadFixture(deployERC20Token);
    await loadFixture(deployLPStaking);
  });

  describe('Liquidity Pair Management', function () {
    it('Should add a new liquidity pair', async function () {
      const lpTokenAddress = await lpToken.getAddress();
      const platform = 'Uniswap-V2';
      const weight = 100;

      await expect(lpStaking.addLiquidityPair(lpTokenAddress, platform, weight))
        .to.emit(lpStaking, 'PairAdded')
        .withArgs(lpTokenAddress, platform, weight);

      const pair = await lpStaking.pairs(lpTokenAddress);
      expect(pair.isActive).to.be.true;
      expect(pair.rewardWeight).to.equal(weight);
    });
  });
});
