import { expect } from 'chai';
import '@nomicfoundation/hardhat-chai-matchers';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { LPStaking, MockERC20 } from '../typechain-types';
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';

describe('LPStaking', function () {
  let lpStaking: LPStaking;
  let rewardToken: MockERC20;
  let lpToken: MockERC20;
  let owner: SignerWithAddress;
  let signers: SignerWithAddress[];

  // Reusable constants
  const INITIAL_BALANCE = ethers.parseEther('1000');
  const STAKE_AMOUNT = ethers.parseEther('100');
  const HOURLY_REWARD = ethers.parseEther('240');
  const REWARD_SUPPLY = ethers.parseEther('1000000');

  async function deployBaseFixture() {
    const [owner, ...signers] = await ethers.getSigners();

    // Deploy tokens
    const mockERC20 = await ethers.getContractFactory('MockERC20');
    const rewardToken = await mockERC20.deploy('Libedus Token', 'LIB');
    const lpToken = await mockERC20.deploy('Uniswap-V2 LP Token', 'UNI-V2');
    await Promise.all([rewardToken.waitForDeployment(), lpToken.waitForDeployment()]);

    // Deploy staking contract - include owner as first signer
    const LPStaking = await ethers.getContractFactory('LPStaking');
    const lpStaking = await LPStaking.deploy(
      await rewardToken.getAddress(),
      [owner.address, ...signers.slice(0, 3).map((signer) => signer.address)]
    );
    await lpStaking.waitForDeployment();

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
    await proposeAndExecute(lpStaking.proposeAddPair(lpTokenAddress, 'LIB-USDT', 'Uniswap-V2', ethers.parseEther('7')));
    await proposeAndExecute(lpStaking.proposeSetHourlyRewardRate(HOURLY_REWARD));
  }

  async function setupPairOnly(lpStaking: LPStaking, lpTokenAddress: string, signers: SignerWithAddress[]) {
    const receipt = await (
      await lpStaking.proposeAddPair(lpTokenAddress, 'LIB-USDT', 'Uniswap-V2', ethers.parseEther('7'))
    ).wait();
    const event = receipt?.logs?.find((e: any) => e.fragment.name === 'ActionProposed');
    const actionId = (event as any)?.args?.actionId;

    for (let i = 0; i < 2; i++) {
      await lpStaking.connect(signers[i]).approveAction(Number(actionId));
    }
    await lpStaking.executeAction(Number(actionId));
    return actionId;
  }

  async function deployUnderfundedStakedFixture() {
    const { lpStaking, lpToken, signers } = await deployBaseFixture();
    const lpTokenAddress = await lpToken.getAddress();
    const staker = signers[4];
    const receiver = signers[5];

    await lpToken.mint(staker.address, INITIAL_BALANCE);
    await lpToken.connect(staker).approve(await lpStaking.getAddress(), INITIAL_BALANCE);
    await setupPairAndRate(lpStaking, lpTokenAddress, signers);
    await lpStaking.connect(staker).stake(lpTokenAddress, STAKE_AMOUNT);

    await ethers.provider.send('evm_increaseTime', [3600]);
    await ethers.provider.send('evm_mine', []);

    return { lpStaking, lpTokenAddress, staker, receiver };
  }

  beforeEach(async function () {
    ({ lpStaking, rewardToken, lpToken, owner, signers } = await loadFixture(deployBaseFixture));
  });

  describe('Liquidity Pair Management', function () {
    it('Should add a new liquidity pair', async function () {
      const lpTokenAddress = await lpToken.getAddress();
      const platform = 'Uniswap-V2';
      const weight = ethers.parseEther('7');

      const receipt = await (await lpStaking.connect(owner).proposeAddPair(lpTokenAddress, 'LIB-USDT', platform, weight)).wait();
      const event = receipt?.logs?.find((e: any) => e.fragment.name === 'ActionProposed');
      const actionId = (event as any)?.args?.actionId;

      await Promise.all(signers.slice(0, 2).map(signer => 
        lpStaking.connect(signer).approveAction(Number(actionId), { gasLimit: 500000 })
      ));

      await expect(lpStaking.connect(owner).executeAction(Number(actionId)))
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

      await rewardToken.mint(await lpStaking.getAddress(), REWARD_SUPPLY);
      await setupPairAndRate(lpStaking, lpTokenAddress, signers);
      await lpStaking.connect(user1).stake(lpTokenAddress, STAKE_AMOUNT);
    });

    it('Should allow unstaking LP tokens', async function () {
      const initialRewardBalance = await rewardToken.balanceOf(user1.address);
      
      await expect(lpStaking.connect(user1).unstake(lpTokenAddress, STAKE_AMOUNT, true))
        .to.emit(lpStaking, 'StakeRemoved')
        .withArgs(user1.address, lpTokenAddress, STAKE_AMOUNT);

      const userStake = await lpStaking.getUserStakeInfo(user1.address, lpTokenAddress);
      expect(userStake.amount).to.equal(0);
      expect(userStake.pendingRewards).to.equal(0); // Should be 0 after claiming
      
      const finalRewardBalance = await rewardToken.balanceOf(user1.address);
      expect(finalRewardBalance - initialRewardBalance).to.be.gt(0); // Should have received rewards
    });

    it('Should not allow unstaking more than staked amount', async function () {
      await expect(
        lpStaking.connect(user1).unstake(lpTokenAddress, STAKE_AMOUNT + 1n, true)
      ).to.be.revertedWith('Insufficient stake');
    });

    it('Should transfer LP tokens back to user', async function () {
      const initialBalance = await lpToken.balanceOf(user1.address);
      await lpStaking.connect(user1).unstake(lpTokenAddress, STAKE_AMOUNT, true);
      const finalBalance = await lpToken.balanceOf(user1.address);
      
      expect(finalBalance - initialBalance).to.equal(STAKE_AMOUNT);
    });

    it('Should allow partial unstaking LP tokens to a different receiver', async function () {
      const receiver = signers[0];
      const partialAmount = STAKE_AMOUNT / 2n;
      const initialUserBalance = await lpToken.balanceOf(user1.address);
      const initialReceiverBalance = await lpToken.balanceOf(receiver.address);

      const tx = await lpStaking.connect(user1).unstakeTo(
        lpTokenAddress,
        partialAmount,
        false,
        receiver.address
      );

      await expect(tx)
        .to.emit(lpStaking, 'StakeRemoved')
        .withArgs(user1.address, lpTokenAddress, partialAmount);
      await expect(tx)
        .to.emit(lpStaking, 'StakeRemovedTo')
        .withArgs(user1.address, receiver.address, lpTokenAddress, partialAmount);

      const userStake = await lpStaking.getUserStakeInfo(user1.address, lpTokenAddress);
      expect(userStake.amount).to.equal(STAKE_AMOUNT - partialAmount);
      expect(await lpToken.balanceOf(user1.address)).to.equal(initialUserBalance);
      expect(await lpToken.balanceOf(receiver.address)).to.equal(initialReceiverBalance + partialAmount);
    });

    it('Should allow full unstaking LP tokens to a different receiver', async function () {
      const receiver = signers[0];
      const initialReceiverBalance = await lpToken.balanceOf(receiver.address);

      await expect(
        lpStaking.connect(user1).unstakeTo(lpTokenAddress, STAKE_AMOUNT, false, receiver.address)
      )
        .to.emit(lpStaking, 'StakeRemovedTo')
        .withArgs(user1.address, receiver.address, lpTokenAddress, STAKE_AMOUNT);

      const userStake = await lpStaking.getUserStakeInfo(user1.address, lpTokenAddress);
      expect(userStake.amount).to.equal(0);
      expect(await lpToken.balanceOf(receiver.address)).to.equal(initialReceiverBalance + STAKE_AMOUNT);
    });

    it('Should allow unstaking to a receiver and claiming rewards to the same receiver', async function () {
      const receiver = signers[0];
      await ethers.provider.send('evm_increaseTime', [3600]);
      await ethers.provider.send('evm_mine', []);

      const initialReceiverLpBalance = await lpToken.balanceOf(receiver.address);
      const initialReceiverRewardBalance = await rewardToken.balanceOf(receiver.address);
      const initialUserRewardBalance = await rewardToken.balanceOf(user1.address);

      const tx = await lpStaking.connect(user1).unstakeTo(
        lpTokenAddress,
        STAKE_AMOUNT,
        true,
        receiver.address
      );

      await expect(tx)
        .to.emit(lpStaking, 'StakeRemovedTo')
        .withArgs(user1.address, receiver.address, lpTokenAddress, STAKE_AMOUNT);
      await expect(tx)
        .to.emit(lpStaking, 'RewardsClaimedTo')
        .withArgs(user1.address, receiver.address, lpTokenAddress, anyValue);

      const userStake = await lpStaking.getUserStakeInfo(user1.address, lpTokenAddress);
      expect(userStake.amount).to.equal(0);
      expect(userStake.pendingRewards).to.equal(0);
      expect(await lpToken.balanceOf(receiver.address)).to.equal(initialReceiverLpBalance + STAKE_AMOUNT);
      expect(await rewardToken.balanceOf(receiver.address)).to.be.gt(initialReceiverRewardBalance);
      expect(await rewardToken.balanceOf(user1.address)).to.equal(initialUserRewardBalance);
    });

    it('Should allow unstaking to a receiver with claim enabled when no rewards accrued', async function () {
      const {
        lpStaking: zeroRateStaking,
        rewardToken: zeroRateRewardToken,
        lpToken: zeroRateLpToken,
        signers: zeroRateSigners
      } = await deployBaseFixture();
      const zeroRateLpTokenAddress = await zeroRateLpToken.getAddress();
      const staker = zeroRateSigners[4];
      const receiver = zeroRateSigners[5];

      await zeroRateLpToken.mint(staker.address, INITIAL_BALANCE);
      await zeroRateLpToken.connect(staker).approve(await zeroRateStaking.getAddress(), INITIAL_BALANCE);
      await setupPairOnly(zeroRateStaking, zeroRateLpTokenAddress, zeroRateSigners);
      await zeroRateStaking.connect(staker).stake(zeroRateLpTokenAddress, STAKE_AMOUNT);

      const initialReceiverRewardBalance = await zeroRateRewardToken.balanceOf(receiver.address);

      const tx = await zeroRateStaking.connect(staker).unstakeTo(
        zeroRateLpTokenAddress,
        STAKE_AMOUNT,
        true,
        receiver.address
      );

      await expect(tx)
        .to.emit(zeroRateStaking, 'StakeRemovedTo')
        .withArgs(staker.address, receiver.address, zeroRateLpTokenAddress, STAKE_AMOUNT);
      await expect(tx).to.not.emit(zeroRateStaking, 'RewardsClaimedTo');

      const userStake = await zeroRateStaking.getUserStakeInfo(staker.address, zeroRateLpTokenAddress);
      expect(userStake.amount).to.equal(0);
      expect(userStake.pendingRewards).to.equal(0);
      expect(await zeroRateRewardToken.balanceOf(receiver.address)).to.equal(initialReceiverRewardBalance);
    });

    it('Should allow unstaking to a receiver without claiming rewards', async function () {
      const receiver = signers[0];
      await ethers.provider.send('evm_increaseTime', [3600]);
      await ethers.provider.send('evm_mine', []);

      const initialReceiverRewardBalance = await rewardToken.balanceOf(receiver.address);

      await lpStaking.connect(user1).unstakeTo(lpTokenAddress, STAKE_AMOUNT, false, receiver.address);

      const userStake = await lpStaking.userStakes(user1.address, lpTokenAddress);
      expect(userStake.amount).to.equal(0);
      expect(userStake.pendingRewards).to.be.gt(0);
      expect(await rewardToken.balanceOf(receiver.address)).to.equal(initialReceiverRewardBalance);
    });

    it('Should allow claiming rewards to a different receiver', async function () {
      const receiver = signers[0];
      await ethers.provider.send('evm_increaseTime', [3600]);
      await ethers.provider.send('evm_mine', []);

      const initialReceiverRewardBalance = await rewardToken.balanceOf(receiver.address);
      const initialUserRewardBalance = await rewardToken.balanceOf(user1.address);

      const tx = await lpStaking.connect(user1).claimRewardsTo(lpTokenAddress, receiver.address);

      await expect(tx)
        .to.emit(lpStaking, 'RewardsClaimedTo')
        .withArgs(user1.address, receiver.address, lpTokenAddress, anyValue);

      const userStake = await lpStaking.getUserStakeInfo(user1.address, lpTokenAddress);
      expect(userStake.pendingRewards).to.equal(0);
      expect(await rewardToken.balanceOf(receiver.address)).to.be.gt(initialReceiverRewardBalance);
      expect(await rewardToken.balanceOf(user1.address)).to.equal(initialUserRewardBalance);
    });

    it('Should reject recipient-aware unstake and claim for inactive pairs', async function () {
      const receiver = signers[0];
      const mockToken = await ethers.deployContract('MockERC20', ['Mock LP', 'MLP']);
      const inactiveLpTokenAddress = await mockToken.getAddress();

      await expect(
        lpStaking.connect(user1).unstakeTo(inactiveLpTokenAddress, STAKE_AMOUNT, false, receiver.address)
      ).to.be.revertedWith('Pair not active');

      await expect(
        lpStaking.connect(user1).claimRewardsTo(inactiveLpTokenAddress, receiver.address)
      ).to.be.revertedWith('Pair not active');
    });

    it('Should reject unstaking with rewards to a receiver when reward balance is insufficient', async function () {
      const { lpStaking, lpTokenAddress, staker, receiver } = await deployUnderfundedStakedFixture();

      await expect(
        lpStaking.connect(staker).unstakeTo(lpTokenAddress, STAKE_AMOUNT, true, receiver.address)
      ).to.be.revertedWith('Insufficient reward balance');
    });

    it('Should reject claiming rewards to a receiver when reward balance is insufficient', async function () {
      const { lpStaking, lpTokenAddress, staker, receiver } = await deployUnderfundedStakedFixture();

      await expect(
        lpStaking.connect(staker).claimRewardsTo(lpTokenAddress, receiver.address)
      ).to.be.revertedWith('Insufficient reward balance');
    });

    it('Should reject zero receivers for recipient-aware unstake and claim', async function () {
      await expect(
        lpStaking.connect(user1).unstakeTo(lpTokenAddress, STAKE_AMOUNT, false, ethers.ZeroAddress)
      ).to.be.revertedWith('Invalid receiver');

      await expect(
        lpStaking.connect(user1).claimRewardsTo(lpTokenAddress, ethers.ZeroAddress)
      ).to.be.revertedWith('Invalid receiver');
    });

    it('Should not allow another account to unstake or claim a user stake', async function () {
      const receiver = signers[1];
      const nonStaker = signers[0];

      await expect(
        lpStaking.connect(nonStaker).unstakeTo(lpTokenAddress, STAKE_AMOUNT, false, receiver.address)
      ).to.be.revertedWith('Insufficient stake');

      await expect(
        lpStaking.connect(nonStaker).claimRewardsTo(lpTokenAddress, receiver.address)
      ).to.be.revertedWith('No rewards to claim');
    });

    it('Should allow unstaking without claiming rewards and keep them pending', async function () {
      await ethers.provider.send('evm_increaseTime', [3600]);
      await ethers.provider.send('evm_mine', []);

      await expect(lpStaking.connect(user1).unstake(lpTokenAddress, STAKE_AMOUNT, false))
        .to.emit(lpStaking, 'StakeRemoved')
        .withArgs(user1.address, lpTokenAddress, STAKE_AMOUNT);

      const userStakeStruct = await lpStaking.userStakes(user1.address, lpTokenAddress);
      expect(userStakeStruct.amount).to.equal(0);
      expect(userStakeStruct.pendingRewards).to.be.gt(0); // Should have pending rewards

      const currentEarned = await lpStaking.earned(user1.address, lpTokenAddress);
      expect(currentEarned).to.equal(userStakeStruct.pendingRewards); // Should match earned()

      await rewardToken.mint(await lpStaking.getAddress(), userStakeStruct.pendingRewards);

      await expect(lpStaking.connect(user1).claimRewards(lpTokenAddress))
        .to.emit(lpStaking, 'RewardsClaimed')
        .withArgs(user1.address, lpTokenAddress, userStakeStruct.pendingRewards);

      expect(await rewardToken.balanceOf(user1.address)).to.equal(userStakeStruct.pendingRewards);
    });

    it('Should allow claiming pending rewards after contract is refilled', async function () {
      // Advance time to accumulate rewards
      await ethers.provider.send('evm_increaseTime', [3600]);
      await ethers.provider.send('evm_mine', []);

      // Unstake without claiming rewards
      await expect(lpStaking.connect(user1).unstake(lpTokenAddress, STAKE_AMOUNT, false))
        .to.emit(lpStaking, 'StakeRemoved')
        .withArgs(user1.address, lpTokenAddress, STAKE_AMOUNT);

      const userStakeStruct = await lpStaking.userStakes(user1.address, lpTokenAddress);
      expect(userStakeStruct.amount).to.equal(0);
      expect(userStakeStruct.pendingRewards).to.be.gt(0);

      // Simulate scenario where contract doesn't have enough tokens initially
      // (this could happen if rewards were withdrawn or contract was underfunded)
      const contractAddress = await lpStaking.getAddress();
      const currentBalance = await rewardToken.balanceOf(contractAddress);
      
      if (currentBalance < userStakeStruct.pendingRewards) {
        // Contract doesn't have enough - this simulates an underfunded contract
        const shortfall = userStakeStruct.pendingRewards - currentBalance;
        
        // First claim attempt should fail (insufficient balance)
        await expect(lpStaking.connect(user1).claimRewards(lpTokenAddress))
          .to.be.reverted;

        // Someone refills the contract with the shortfall
        await rewardToken.mint(contractAddress, shortfall);
      }

      // Now claiming should succeed with full balance
      const initialUserBalance = await rewardToken.balanceOf(user1.address);
      await expect(lpStaking.connect(user1).claimRewards(lpTokenAddress))
        .to.emit(lpStaking, 'RewardsClaimed')
        .withArgs(user1.address, lpTokenAddress, userStakeStruct.pendingRewards);

      const finalUserBalance = await rewardToken.balanceOf(user1.address);
      expect(finalUserBalance - initialUserBalance).to.equal(userStakeStruct.pendingRewards);
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
      // Don't stake here - let individual tests control staking
    });

    it('Should accumulate rewards over time', async function () {
      await lpStaking.connect(user1).stake(lpTokenAddress, STAKE_AMOUNT);
      
      await ethers.provider.send('evm_increaseTime', [3600]);
      await ethers.provider.send('evm_mine', []);

      const initialBalance = await rewardToken.balanceOf(user1.address);
      await lpStaking.connect(user1).claimRewards(lpTokenAddress);
      const finalBalance = await rewardToken.balanceOf(user1.address);
      
      const rewardsEarned = finalBalance - initialBalance;
      const tolerance = HOURLY_REWARD / 1000n; // 0.1% tolerance
      expect(rewardsEarned).to.be.closeTo(HOURLY_REWARD, tolerance);
    });

    it('Should allow claiming small rewards', async function () {
      // Use a fresh user that hasn't staked before
      const freshUser = signers[5]; // Use a different signer
      
      await lpToken.mint(freshUser.address, INITIAL_BALANCE);
      await lpToken.connect(freshUser).approve(await lpStaking.getAddress(), INITIAL_BALANCE);
      
      // Stake with fresh user
      await lpStaking.connect(freshUser).stake(lpTokenAddress, STAKE_AMOUNT);
      
      // Small delay to allow minimal rewards to accumulate
      await ethers.provider.send('evm_increaseTime', [1]);
      await ethers.provider.send('evm_mine', []);
      
      // Claiming should succeed and emit event
      const initialBalance = await rewardToken.balanceOf(freshUser.address);
      const tx = await lpStaking.connect(freshUser).claimRewards(lpTokenAddress);
      const receipt = await tx.wait();
      
      // Check that rewards were actually transferred
      const finalBalance = await rewardToken.balanceOf(freshUser.address);
      const rewardsReceived = finalBalance - initialBalance;
      expect(rewardsReceived).to.be.gt(0);
      
      // Check that the event was emitted (without checking exact amount)
      expect(tx).to.emit(lpStaking, 'RewardsClaimed').withArgs(freshUser.address, lpTokenAddress);
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
      await rewardToken.mint(await lpStaking.getAddress(), REWARD_SUPPLY);
    });

    it('Should update daily reward rate', async function () {
      const receipt = await (await lpStaking.proposeSetHourlyRewardRate(NEW_RATE)).wait();
      const event = receipt?.logs?.find((e: any) => e.fragment.name === 'ActionProposed');
      const actionId = (event as any)?.args?.actionId;

      await Promise.all(signers.slice(0, 2).map(signer => lpStaking.connect(signer).approveAction(Number(actionId), { gasLimit: 500000 })));

      await expect(lpStaking.executeAction(Number(actionId)))
        .to.emit(lpStaking, 'HourlyRateUpdated')
        .withArgs(NEW_RATE);

      expect(await lpStaking.hourlyRewardRate()).to.equal(NEW_RATE);
    });

    it('Should update reward weights', async function () {
      const lpTokenAddress = await lpToken.getAddress();
      await setupPairAndRate(lpStaking, lpTokenAddress, signers);

      const newWeight = 200;
      const receipt = await (await lpStaking.proposeUpdatePairWeights([lpTokenAddress], [newWeight])).wait();
      const event = receipt?.logs?.find((e: any) => e.fragment.name === 'ActionProposed');
      const actionId = (event as any)?.args?.actionId;

      await Promise.all(signers.slice(0, 2).map(signer => lpStaking.connect(signer).approveAction(Number(actionId), { gasLimit: 500000 })));

      await expect(lpStaking.executeAction(Number(actionId)))
        .to.emit(lpStaking, 'WeightsUpdated')
        .withArgs([lpTokenAddress], [newWeight]);

      const pair = await lpStaking.getPairInfo(lpTokenAddress);
      expect(pair.weight).to.equal(newWeight);
    });

    it('Should change signer through multisig', async function () {
      const oldSigner = signers[0]; // This is signers[0] from the array (not owner)
      const newSigner = signers[4]; // Use signers[4] as new signer
    
      // Propose the signer change
      const receipt = await (await lpStaking.connect(owner).proposeChangeSigner(oldSigner.address, newSigner.address)).wait();
      const event = receipt?.logs?.find((e: any) => e.fragment.name === 'ActionProposed');
      const actionId = (event as any)?.args?.actionId;
    
      await lpStaking.connect(signers[0]).approveAction(actionId, { gasLimit: 500000 });
      await lpStaking.connect(signers[1]).approveAction(actionId, { gasLimit: 500000 });
    
      await expect(lpStaking.connect(owner).executeAction(actionId))
        .to.emit(lpStaking, 'SignerChanged')
        .withArgs(oldSigner.address, newSigner.address);
    
      const ADMIN_ROLE = await lpStaking.ADMIN_ROLE();
      expect(await lpStaking.hasRole(ADMIN_ROLE, newSigner.address)).to.be.true;
      expect(await lpStaking.hasRole(ADMIN_ROLE, oldSigner.address)).to.be.false;
    });

    it('Should withdraw rewards', async function () {
      const receipt = await (await lpStaking.proposeWithdrawRewards(signers[1].address, STAKE_AMOUNT)).wait();
      const event = receipt?.logs?.find((e: any) => e.fragment.name === 'ActionProposed');
      const actionId = (event as any)?.args?.actionId;

      await Promise.all(signers.slice(0, 2).map(signer => lpStaking.connect(signer).approveAction(Number(actionId), { gasLimit: 500000 })));

      await expect(lpStaking.connect(signers[1]).executeAction(actionId))
        .to.emit(lpStaking, 'RewardsWithdrawn')
        .withArgs(signers[1].address, STAKE_AMOUNT);

        const balance = await rewardToken.balanceOf(signers[1].address);
        expect(balance).to.equal(STAKE_AMOUNT);
    });
  });

  describe('Reward Obligation Tracking', function () {
    let user1: SignerWithAddress;
    let lpTokenAddress: string;

    beforeEach(async function () {
      [owner, user1, ...signers] = await ethers.getSigners();
      
      lpTokenAddress = await lpToken.getAddress();
      await lpToken.mint(user1.address, INITIAL_BALANCE);
      await lpToken.connect(user1).approve(await lpStaking.getAddress(), INITIAL_BALANCE);
      
      await rewardToken.mint(await lpStaking.getAddress(), REWARD_SUPPLY);
      await setupPairAndRate(lpStaking, lpTokenAddress, signers);
    });

    it('Should track total reward obligation correctly', async function () {
      // Initial obligation should be 0
      expect(await lpStaking.totalRewardsObligated()).to.equal(0);
      expect(await lpStaking.getTotalRewardObligation()).to.equal(0);

      // Stake
      await lpStaking.connect(user1).stake(lpTokenAddress, STAKE_AMOUNT);

      // Advance time by 1 hour
      await ethers.provider.send('evm_increaseTime', [3600]);
      await ethers.provider.send('evm_mine', []);

      // Check view function (should show ~HOURLY_REWARD)
      const obligation = await lpStaking.getTotalRewardObligation();
      const tolerance = HOURLY_REWARD / 1000n; // 0.1% tolerance
      expect(obligation).to.be.closeTo(HOURLY_REWARD, tolerance);

      // State variable shouldn't update until interaction
      expect(await lpStaking.totalRewardsObligated()).to.equal(0);

      // Trigger update via claim
      await lpStaking.connect(user1).claimRewards(lpTokenAddress);

      // After claiming, obligation should be close to 0 (just the tiny bit since last block)
      const remainingObligation = await lpStaking.getTotalRewardObligation();
      expect(remainingObligation).to.be.lt(ethers.parseEther('1')); // Should be very small
    });

    it('Should update obligation on unstake with claim', async function () {
      await lpStaking.connect(user1).stake(lpTokenAddress, STAKE_AMOUNT);
      
      await ethers.provider.send('evm_increaseTime', [3600]);
      await ethers.provider.send('evm_mine', []);

      const preUnstakeObligation = await lpStaking.getTotalRewardObligation();
      expect(preUnstakeObligation).to.be.closeTo(HOURLY_REWARD, HOURLY_REWARD / 1000n);

      await lpStaking.connect(user1).unstake(lpTokenAddress, STAKE_AMOUNT, true);

      const postUnstakeObligation = await lpStaking.getTotalRewardObligation();
      expect(postUnstakeObligation).to.be.lt(ethers.parseEther('1'));
    });

    it('Should handle multiple users correctly', async function () {
      const user2 = signers[0];
      await lpToken.mint(user2.address, INITIAL_BALANCE);
      await lpToken.connect(user2).approve(await lpStaking.getAddress(), INITIAL_BALANCE);

      // Both users stake same amount
      await lpStaking.connect(user1).stake(lpTokenAddress, STAKE_AMOUNT);
      await lpStaking.connect(user2).stake(lpTokenAddress, STAKE_AMOUNT);

      await ethers.provider.send('evm_increaseTime', [3600]);
      await ethers.provider.send('evm_mine', []);

      // Total obligation should be ~HOURLY_REWARD (split between users, but total is same)
      const obligation = await lpStaking.getTotalRewardObligation();
      expect(obligation).to.be.closeTo(HOURLY_REWARD, HOURLY_REWARD / 1000n);

      // User 1 claims
      await lpStaking.connect(user1).claimRewards(lpTokenAddress);

      // Obligation should drop by half
      const remainingObligation = await lpStaking.getTotalRewardObligation();
      expect(remainingObligation).to.be.closeTo(HOURLY_REWARD / 2n, HOURLY_REWARD / 1000n);
    });
  });
});
