import { run } from "hardhat";

async function main() {
  const contractAddress = "0xef15eB728CEF704f40269319BBA495d4131Beb71";
  const rewardToken = "0x693ed886545970F0a3ADf8C59af5cCdb6dDF0a76";
  const initialSigners = [
    "0xb5A5bD462A0a76c02990d0FBE3321e92E0B03ABC",
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "0x32B6f2C027D4c9D99Ca07d047D17987390a5EB39",
    "0xEc33aDc8A175DCc44f809909B9aae9F4F5760818"
  ];

  console.log("Verifying contract...");
  console.log("Contract Address:", contractAddress);
  console.log("Reward Token:", rewardToken);
  console.log("Initial Signers:", initialSigners);

  try {
    await run("verify:verify", {
      address: contractAddress,
      constructorArguments: [rewardToken, initialSigners],
      contract: "contracts/LPStaking.sol:LPStaking"
    });
    console.log("Contract verified successfully!");
  } catch (error) {
    console.error("Verification failed:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
