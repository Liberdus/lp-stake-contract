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

  // Reusable constants
  const INITIAL_BALANCE = ethers.parseEther('1000');
  const STAKE_AMOUNT = ethers.parseEther('100');
  const DAILY_REWARD = ethers.parseEther('240'); // 10 per hour
  const REWARD_SUPPLY = ethers.parseEther('1000000');

  async function deployBaseFixture() {
    const [owner, ...signers] = await ethers.getSigners();

    // Deploy tokens
    const mockERC20 = await ethers.getContractFactory('MockERC20');
    const rewardToken = await mockERC20.deploy('Libedus Token', 'LIB');
    const lpToken = await mockERC20.deploy('Uniswap-V2 LP Token', 'UNI-V2');
    await Promise.all([rewardToken.waitForDeployment(), lpToken.waitForDeployment()]);

    // Deploy staking contract
    const LPStaking = await ethers.getContractFactory('LPStaking');
    const lpStaking = await LPStaking.deploy(
      await rewardToken.getAddress(),
      signers.slice(0, 4).map((signer) => signer.address)
    );
    await lpStaking.waitForDeployment();

    // Setup admin role
    const ADMIN_ROLE = await lpStaking.ADMIN_ROLE();
    await lpStaking.grantRole(ADMIN_ROLE, owner.address);

    return { lpStaking, rewardToken, lpToken, owner, signers };
  }

  async function setupPairAndRate(lpStaking: LPStaking, lpTokenAddress: string, signers: SignerWithAddress[]) {
    // Helper function to propose and execute action
    async function proposeAndExecute(proposeFn: Promise<any>) {
      const receipt = await (await proposeFn).wait();
      const event = receipt.logs?.find((e: any) => e.fragment.name === 'ActionProposed');
      const actionId = event?.args?.actionId;

      for (let i = 0; i < 2; i++) {
        await lpStaking.connect(signers[i]).approveAction(Number(actionId));
      }
      await lpStaking.executeAction(Number(actionId));
      return actionId;
    }

    // Add pair and set rate
    await proposeAndExecute(lpStaking.proposeAddPair(lpTokenAddress, 'LIB-USDT', 'Uniswap-V2', 100000000000000));
    await proposeAndExecute(lpStaking.proposeSetDailyRewardRate(DAILY_REWARD));
  }

  beforeEach(async function () {
    ({ lpStaking, rewardToken, lpToken, owner, signers } = await loadFixture(deployBaseFixture));
  });

  describe('Liquidity Pair Management', function () {
    it('Should add a new liquidity pair', async function () {
      const lpTokenAddress = await lpToken.getAddress();
      const platform = 'Uniswap-V2';
      const weight = 100000000000000000000n;

      const receipt = await (await lpStaking.proposeAddPair(lpTokenAddress, 'LIB-USDT', platform, weight)).wait();
      const event = receipt?.logs?.find((e: any) => e.fragment.name === 'ActionProposed');
      const actionId = (event as any)?.args?.actionId;

      await Promise.all(signers.slice(0, 2).map(signer => lpStaking.connect(signer).approveAction(Number(actionId))));

      await expect(lpStaking.executeAction(Number(actionId)))
        .to.emit(lpStaking, 'PairAdded')
        .withArgs(lpTokenAddress, platform, weight);

      const pair = await lpStaking.getPairInfo(lpTokenAddress);
      expect(pair.isActive).to.be.true;
      expect(pair.weight).to.equal(weight);
    });
  });

  describe('Staking', function () {
    let user1: SignerWithAddress;
    let lpTokenAddress: string;

    beforeEach(async function () {
      [owner, user1, ...signers] = await ethers.getSigners();
      
      lpTokenAddress = await lpToken.getAddress();
      await lpToken.mint(user1.address, INITIAL_BALANCE);
      await lpToken.connect(user1).approve(await lpStaking.getAddress(), INITIAL_BALANCE);

      await setupPairAndRate(lpStaking, lpTokenAddress, signers);
    });

    it('Should allow staking LP tokens', async function () {
      await expect(lpStaking.connect(user1).stake(lpTokenAddress, STAKE_AMOUNT))
        .to.emit(lpStaking, 'StakeAdded')
        .withArgs(user1.address, lpTokenAddress, STAKE_AMOUNT);

      const userStake = await lpStaking.getUserStakeInfo(user1.address, lpTokenAddress);
      expect(userStake.amount).to.equal(STAKE_AMOUNT);
    });

    it('Should not allow staking below minimum', async function () {
      const minStake = await lpStaking.MIN_STAKE();
      await expect(
        lpStaking.connect(user1).stake(lpTokenAddress, minStake - 1n)
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
      
      const userStake = await lpStaking.getUserStakeInfo(user1.address, lpTokenAddress);
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
      const userStake = await lpStaking.getUserStakeInfo(user1.address, lpTokenAddress);
      
      expect(userStake[2]).to.equal(block?.timestamp);
    });
  });

  describe('Unstaking', function () {
    let user1: SignerWithAddress;
    let lpTokenAddress: string;

    beforeEach(async function () {
      [owner, user1, ...signers] = await ethers.getSigners();
      
      lpTokenAddress = await lpToken.getAddress();
      await lpToken.mint(user1.address, INITIAL_BALANCE);
      await lpToken.connect(user1).approve(await lpStaking.getAddress(), INITIAL_BALANCE);

      await setupPairAndRate(lpStaking, lpTokenAddress, signers);
      await lpStaking.connect(user1).stake(lpTokenAddress, STAKE_AMOUNT);
    });

    it('Should allow unstaking LP tokens', async function () {
      await expect(lpStaking.connect(user1).unstake(lpTokenAddress, STAKE_AMOUNT))
        .to.emit(lpStaking, 'StakeRemoved')
        .withArgs(user1.address, lpTokenAddress, STAKE_AMOUNT);

      const userStake = await lpStaking.getUserStakeInfo(user1.address, lpTokenAddress);
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
    let user1: SignerWithAddress;
    let lpTokenAddress: string;

    beforeEach(async function () {
      [owner, user1, ...signers] = await ethers.getSigners();
      
      lpTokenAddress = await lpToken.getAddress();
      await lpToken.mint(user1.address, INITIAL_BALANCE);
      await lpToken.connect(user1).approve(await lpStaking.getAddress(), INITIAL_BALANCE);
      
      await rewardToken.mint(await lpStaking.getAddress(), REWARD_SUPPLY);
      await setupPairAndRate(lpStaking, lpTokenAddress, signers);
      await lpStaking.connect(user1).stake(lpTokenAddress, STAKE_AMOUNT);
    });

    it('Should accumulate rewards over time', async function () {
      await ethers.provider.send('evm_increaseTime', [3600]);
      await ethers.provider.send('evm_mine', []);

      const initialBalance = await rewardToken.balanceOf(user1.address);
      await lpStaking.connect(user1).claimRewards(lpTokenAddress);
      const finalBalance = await rewardToken.balanceOf(user1.address);
      
      const expectedRewards = DAILY_REWARD / 24n;
      expect(ethers.parseEther(finalBalance.toString()) - ethers.parseEther(initialBalance.toString())).to.equal(expectedRewards);
    });

    it('Should not allow claiming zero rewards', async function () {
      await expect(
        lpStaking.connect(user1).claimRewards(lpTokenAddress)
      ).to.be.revertedWith('No rewards to claim');
    });
  });

  describe('Admin Functions', function () {
    const NEW_RATE = ethers.parseEther('480'); // 20 per hour
    let newSigner: SignerWithAddress;

    beforeEach(async function () {
      const allSigners = await ethers.getSigners();
      [owner, ...signers] = allSigners;
      newSigner = allSigners[10];

      ({ lpStaking, rewardToken, lpToken } = await loadFixture(deployBaseFixture));
    });

    it('Should update daily reward rate', async function () {
      const receipt = await (await lpStaking.proposeSetDailyRewardRate(NEW_RATE)).wait();
      const event = receipt?.logs?.find((e: any) => e.fragment.name === 'ActionProposed');
      const actionId = (event as any)?.args?.actionId;

      await Promise.all(signers.slice(0, 2).map(signer => lpStaking.connect(signer).approveAction(Number(actionId))));

      await expect(lpStaking.executeAction(Number(actionId)))
        .to.emit(lpStaking, 'DailyRateUpdated')
        .withArgs(NEW_RATE);

      expect(await lpStaking.dailyRewardRate()).to.equal(NEW_RATE);
    });

    it('Should update reward weights', async function () {
      const lpTokenAddress = await lpToken.getAddress();
      await setupPairAndRate(lpStaking, lpTokenAddress, signers);

      const newWeight = 200;
      const receipt = await (await lpStaking.proposeUpdatePairWeights([lpTokenAddress], [newWeight])).wait();
      const event = receipt?.logs?.find((e: any) => e.fragment.name === 'ActionProposed');
      const actionId = (event as any)?.args?.actionId;

      await Promise.all(signers.slice(0, 2).map(signer => lpStaking.connect(signer).approveAction(Number(actionId))));

      await expect(lpStaking.executeAction(Number(actionId)))
        .to.emit(lpStaking, 'WeightsUpdated')
        .withArgs([lpTokenAddress], [newWeight]);

      const pair = await lpStaking.getPairInfo(lpTokenAddress);
      expect(pair.weight).to.equal(newWeight);
    });

    it('Should change signer', async function () {
      const oldSigner = signers[0];
      
      await expect(lpStaking.changeSigner(oldSigner.address, newSigner.address))
        .to.emit(lpStaking, 'SignerChanged')
        .withArgs(oldSigner.address, newSigner.address);

      const ADMIN_ROLE = await lpStaking.ADMIN_ROLE();
      expect(await lpStaking.hasRole(ADMIN_ROLE, newSigner.address)).to.be.true;
      expect(await lpStaking.hasRole(ADMIN_ROLE, oldSigner.address)).to.be.false;
    });
  });
});
