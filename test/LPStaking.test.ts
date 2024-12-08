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

  describe('Staking', function () {
    const INITIAL_BALANCE = ethers.parseEther('1000');
    const STAKE_AMOUNT = ethers.parseEther('100');
    let user1: SignerWithAddress;
    let lpTokenAddress: string;

    beforeEach(async function () {
      [owner, user1, ...signers] = await ethers.getSigners();
      
      lpTokenAddress = await lpToken.getAddress();
      await lpToken.mint(user1.address, INITIAL_BALANCE);
      await lpToken.connect(user1).approve(await lpStaking.getAddress(), INITIAL_BALANCE);

      await lpStaking.addLiquidityPair(lpTokenAddress, 'Uniswap-V2', 100);

      await lpStaking.setHourlyRewardRate(ethers.parseEther('10'));
    });

    it('Should allow staking LP tokens', async function () {
      await expect(lpStaking.connect(user1).stake(lpTokenAddress, STAKE_AMOUNT))
        .to.emit(lpStaking, 'StakeAdded')
        .withArgs(user1.address, lpTokenAddress, STAKE_AMOUNT);

      const userStake = await lpStaking.userStakes(user1.address, lpTokenAddress);

      expect(userStake.amount).to.equal(STAKE_AMOUNT);
    });

    it('Should not allow staking zero amount', async function () {
      await expect(
        lpStaking.connect(user1).stake(lpTokenAddress, 0)
      ).to.be.revertedWith('Stake amount too low');
    });

    it('Should not allow staking for inactive pair', async function () {
      const mockToken = await ethers.deployContract('MockERC20', ['Mock LP', 'MLP']);
      await expect(
        lpStaking.connect(user1).stake(await mockToken.getAddress(), STAKE_AMOUNT)
      ).to.be.revertedWith('Pair not active');
    });

    it('Should update user stake amount correctly', async function () {
      await lpStaking.connect(user1).stake(lpTokenAddress, STAKE_AMOUNT);
      
      await lpStaking.connect(user1).stake(lpTokenAddress, STAKE_AMOUNT);
      
      const userStake = await lpStaking.userStakes(user1.address, lpTokenAddress);
      expect(userStake.amount).to.equal(STAKE_AMOUNT * 2n);
    });

    it('Should transfer LP tokens to contract', async function () {
      const contractAddress = await lpStaking.getAddress();
      const initialContractBalance = await lpToken.balanceOf(contractAddress);
      
      await lpStaking.connect(user1).stake(lpTokenAddress, STAKE_AMOUNT);
      
      const finalContractBalance = await lpToken.balanceOf(contractAddress);
      expect(finalContractBalance - initialContractBalance).to.equal(STAKE_AMOUNT);
    });

    it('Should update lastRewardTime on stake', async function () {
      await lpStaking.connect(user1).stake(lpTokenAddress, STAKE_AMOUNT);
      const block = await ethers.provider.getBlock('latest');
      const userStake = await lpStaking.userStakes(user1.address, lpTokenAddress);
      
      expect(userStake.lastRewardTime).to.equal(block?.timestamp);
    });
  });
});
