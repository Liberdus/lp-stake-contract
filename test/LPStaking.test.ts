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

  describe('Unstaking', function () {
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
      
      // Stake tokens for testing unstake
      await lpStaking.connect(user1).stake(lpTokenAddress, STAKE_AMOUNT);
    });

    it('Should allow unstaking LP tokens', async function () {
      await expect(lpStaking.connect(user1).unstake(lpTokenAddress, STAKE_AMOUNT))
        .to.emit(lpStaking, 'StakeRemoved')
        .withArgs(user1.address, lpTokenAddress, STAKE_AMOUNT);

      const userStake = await lpStaking.userStakes(user1.address, lpTokenAddress);
      expect(userStake.amount).to.equal(0);
    });

    it('Should not allow unstaking more than staked amount', async function () {
      await expect(
        lpStaking.connect(user1).unstake(lpTokenAddress, STAKE_AMOUNT + 1n)
      ).to.be.revertedWith('Insufficient stake');
    });

    it('Should transfer LP tokens back to user', async function () {
      const initialBalance = await lpToken.balanceOf(user1.address);
      await lpStaking.connect(user1).unstake(lpTokenAddress, STAKE_AMOUNT);
      const finalBalance = await lpToken.balanceOf(user1.address);
      
      expect(finalBalance - initialBalance).to.equal(STAKE_AMOUNT);
    });
  });

  describe('Rewards', function () {
    const INITIAL_BALANCE = ethers.parseEther('1000');
    const STAKE_AMOUNT = ethers.parseEther('100');
    const HOURLY_REWARD = ethers.parseEther('10');
    let user1: SignerWithAddress;
    let lpTokenAddress: string;

    beforeEach(async function () {
      [owner, user1, ...signers] = await ethers.getSigners();
      
      lpTokenAddress = await lpToken.getAddress();
      await lpToken.mint(user1.address, INITIAL_BALANCE);
      await lpToken.connect(user1).approve(await lpStaking.getAddress(), INITIAL_BALANCE);
      
      // Mint sufficient reward tokens to contract
      const REWARD_SUPPLY = ethers.parseEther('1000000');
      await rewardToken.mint(await lpStaking.getAddress(), REWARD_SUPPLY);

      await lpStaking.addLiquidityPair(lpTokenAddress, 'Uniswap-V2', 100); // Set rewardWeight to 100
      await lpStaking.setHourlyRewardRate(HOURLY_REWARD);
      
      await lpStaking.connect(user1).stake(lpTokenAddress, STAKE_AMOUNT);
    });

    it('Should accumulate rewards over time', async function () {
      // Simulate time passing (1 hour)
      await ethers.provider.send('evm_increaseTime', [3600]);
      await ethers.provider.send('evm_mine', []);

      const initialBalance = await rewardToken.balanceOf(user1.address);
      await lpStaking.connect(user1).claimRewards(lpTokenAddress);
      const finalBalance = await rewardToken.balanceOf(user1.address);
      
      const expectedRewards = HOURLY_REWARD;

      const rewardDifference = finalBalance - initialBalance;

      expect(rewardDifference).to.equal(HOURLY_REWARD);
    });

    it('Should not allow claiming zero rewards', async function () {
      await expect(
        lpStaking.connect(user1).claimRewards(lpTokenAddress)
      ).to.be.revertedWith('No rewards to claim');
    });
  });

  describe('Admin Functions', function () {
    const NEW_RATE = ethers.parseEther('20');
    let admin1: SignerWithAddress;
    let admin2: SignerWithAddress;
    let newSigner: SignerWithAddress;

    beforeEach(async function () {
      // Get fresh set of signers
      const allSigners = await ethers.getSigners();
      [owner, ...signers] = allSigners;

      // Deploy contracts with specific signers
      await loadFixture(deployERC20Token);
      
      // Deploy LPStaking with first 4 signers as admins
      const LPStaking = await ethers.getContractFactory('LPStaking');
      lpStaking = await LPStaking.deploy(
        await rewardToken.getAddress(),
        allSigners.slice(0, 4).map(s => s.address)
      );
      await lpStaking.waitForDeployment();

      // Set up roles
      const ADMIN_ROLE = await lpStaking.ADMIN_ROLE();
      await lpStaking.grantRole(ADMIN_ROLE, owner.address);

      // Use a non-admin signer for the test
      newSigner = allSigners[10]; // Use a signer well beyond the initial admins
    });

    it('Should update hourly reward rate', async function () {
      await expect(lpStaking.setHourlyRewardRate(NEW_RATE))
        .to.emit(lpStaking, 'HourlyRateUpdated')
        .withArgs(NEW_RATE);

      expect(await lpStaking.hourlyRewardRate()).to.equal(NEW_RATE);
    });

    it('Should update reward weights', async function () {
      // First add the LP pair
      const lpTokenAddress = await lpToken.getAddress();
      await lpStaking.addLiquidityPair(lpTokenAddress, 'Uniswap-V2', 100);

      const newWeight = 200;
      await expect(
        lpStaking.updateRewardWeights([lpTokenAddress], [newWeight])
      ).to.emit(lpStaking, 'WeightsUpdated')
        .withArgs([lpTokenAddress], [newWeight]);

      const pair = await lpStaking.pairs(lpTokenAddress);
      expect(pair.rewardWeight).to.equal(newWeight);
    });

    it('Should change signer', async function () {
      const oldSigner = signers[0]; // First signer from the admin group
      
      await expect(lpStaking.changeSigner(oldSigner.address, newSigner.address))
        .to.emit(lpStaking, 'SignerChanged')
        .withArgs(oldSigner.address, newSigner.address);

      const ADMIN_ROLE = await lpStaking.ADMIN_ROLE();
      expect(await lpStaking.hasRole(ADMIN_ROLE, newSigner.address)).to.be.true;
      expect(await lpStaking.hasRole(ADMIN_ROLE, oldSigner.address)).to.be.false;
    });
  });
});
