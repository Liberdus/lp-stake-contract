import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { LPStaking, MockERC20 } from "../typechain-types";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("Andrey", function () {
  let lpStaking: LPStaking;
  let rewardToken: MockERC20;
  let lpToken: MockERC20;
  let lpToken2: MockERC20;
  let owner: SignerWithAddress;
  let signers: SignerWithAddress[];
  let user: SignerWithAddress;

  // Reusable constants
  const INITIAL_BALANCE = ethers.parseEther("1000");
  const STAKE_AMOUNT = ethers.parseEther("100");
  const HOURLY_REWARD = ethers.parseEther("240");
  const REWARD_SUPPLY = ethers.parseEther("1000000");

  async function deployBaseFixture() {
    const [owner, user, ...signers] = await ethers.getSigners();

    // Deploy tokens
    const mockERC20 = await ethers.getContractFactory("MockERC20");
    const rewardToken = await mockERC20.deploy("Liberdus Token", "LIB");
    const lpToken = await mockERC20.deploy("Uniswap-V2 LP Token", "UNI-V2");
    const lpToken2 = await mockERC20.deploy(
      "Second Uniswap-V2 LP Token",
      "UNI-3"
    );
    await Promise.all([
      rewardToken.waitForDeployment(),
      lpToken.waitForDeployment(),
      lpToken2.waitForDeployment(),
    ]);

    // Deploy staking contract with the correct initial signers
    // We need to include the owner and the first 3 signers to match the test requirements
    const initialSigners = [
      owner.address,
      signers[0].address,
      signers[1].address,
      signers[2].address,
    ];

    const LPStaking = await ethers.getContractFactory("LPStaking");
    const lpStaking = await LPStaking.deploy(
      await rewardToken.getAddress(),
      initialSigners // This ensures owner and first 3 signers have ADMIN_ROLE
    );
    await lpStaking.waitForDeployment();

    return { lpStaking, rewardToken, lpToken, lpToken2, user, owner, signers };
  }

  async function setupPairAndRate(
    lpStaking: LPStaking,
    lpTokenAddress: string,
    signers: SignerWithAddress[]
  ) {
    // Helper function to propose and execute action
    async function proposeAndExecute(proposeFn: Promise<any>) {
      const receipt = await (await proposeFn).wait();
      const event = receipt.logs?.find(
        (e: any) => e.fragment.name === "ActionProposed"
      );
      const actionId = event?.args?.actionId;

      for (let i = 0; i < 2; i++) {
        await lpStaking.connect(signers[i]).approveAction(Number(actionId));
      }
      await lpStaking.executeAction(Number(actionId));
      return actionId;
    }

    // Add pair and set rate
    await proposeAndExecute(
      lpStaking.proposeAddPair(
        lpTokenAddress,
        "LIB-USDT",
        "Uniswap-V2",
        ethers.parseEther("7")
      )
    );
    await proposeAndExecute(
      lpStaking.proposeSetHourlyRewardRate(HOURLY_REWARD)
    );
  }

  beforeEach(async function () {
    ({ lpStaking, rewardToken, lpToken, lpToken2, user, owner, signers } =
      await loadFixture(deployBaseFixture));
  });

  describe("Liquidity Pair Management", function () {
    const txOptions = { gasLimit: 500000 }; // Add gas limit

    it("Should add a new liquidity pair without breaking reward, set old weight to 0, and allow unstake", async function () {
      const lpTokenAddress = await lpToken.getAddress();
      const lpTokenAddress2 = await lpToken2.getAddress();

      await lpToken.mint(user.address, INITIAL_BALANCE);
      await lpToken
        .connect(user)
        .approve(await lpStaking.getAddress(), INITIAL_BALANCE);

      await rewardToken.mint(await lpStaking.getAddress(), REWARD_SUPPLY);
      await setupPairAndRate(lpStaking, lpTokenAddress, signers);
      await lpStaking.connect(user).stake(lpTokenAddress, STAKE_AMOUNT);

      const platform = "Uniswap-V2";
      const weight = ethers.parseEther("7");

      const currentBlock = await ethers.provider.getBlock("latest");
      if (!currentBlock) throw new Error("Failed to get latest block");
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        currentBlock.timestamp + 3600,
      ]);
      await ethers.provider.send("evm_mine", []);

      const initialBalance = await rewardToken.balanceOf(user.address);
      await lpStaking.connect(user).claimRewards(lpTokenAddress);
      const secondBalance = await rewardToken.balanceOf(user.address);

      await ethers.provider.send("evm_setNextBlockTimestamp", [
        currentBlock.timestamp + 7200,
      ]);
      await ethers.provider.send("evm_mine", []);

      const receipt = await (
        await lpStaking.proposeAddPair(
          lpTokenAddress2,
          "LIB-POL",
          platform,
          weight
        )
      ).wait();
      const event = receipt?.logs?.find(
        (e: any) => e.fragment.name === "ActionProposed"
      );
      const actionId = (event as any)?.args?.actionId;

      // Add gas limit to the approval transactions
      await Promise.all(
        signers.slice(0, 2).map((signer) =>
          lpStaking.connect(signer).approveAction(Number(actionId), {
            gasLimit: 500000, // Explicitly set gas limit
          })
        )
      );

      await expect(
        lpStaking.executeAction(Number(actionId), {
          gasLimit: 500000, // Explicitly set gas limit
        })
      )
        .to.emit(lpStaking, "PairAdded")
        .withArgs(lpTokenAddress2, platform, weight);

      await lpStaking.connect(user).claimRewards(lpTokenAddress);
      const thirdBalance = await rewardToken.balanceOf(user.address);

      const tolerance = (HOURLY_REWARD * 1n) / 1000n;
      expect(secondBalance - initialBalance).to.be.closeTo(
        thirdBalance - secondBalance,
        tolerance
      );

      const pair = await lpStaking.getPairInfo(lpTokenAddress2);
      expect(pair.isActive).to.be.true;
      expect(pair.weight).to.equal(weight);

      const newWeight = ethers.parseEther("0");
      const updateReceipt = await (
        await lpStaking.proposeUpdatePairWeights(
          [lpTokenAddress],
          [newWeight],
          txOptions
        )
      ).wait();
      const updateEvent = updateReceipt?.logs?.find(
        (e: any) => e.fragment.name === "ActionProposed"
      );
      const updateActionId = (updateEvent as any)?.args?.actionId;

      await Promise.all(
        signers
          .slice(0, 2)
          .map((signer) =>
            lpStaking
              .connect(signer)
              .approveAction(Number(updateActionId), txOptions)
          )
      );

      await expect(lpStaking.executeAction(Number(updateActionId), txOptions))
        .to.emit(lpStaking, "WeightsUpdated")
        .withArgs([lpTokenAddress], [newWeight]);

      const pair2 = await lpStaking.getPairInfo(lpTokenAddress);
      expect(pair2.isActive).to.be.true;

      await expect(
        lpStaking.connect(user).unstake(lpTokenAddress, STAKE_AMOUNT)
      )
        .to.emit(lpStaking, "StakeRemoved")
        .withArgs(user.address, lpTokenAddress, STAKE_AMOUNT);
    });
  });
});
