require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

async function main() {
  const contractAddress = process.argv[2];
  if (!contractAddress) {
    throw new Error("Usage: node scripts/verify-bsc-testnet-v2.js <contractAddress>");
  }

  const apiKey = process.env.BSCSCAN_API_KEY || process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    throw new Error("Missing Etherscan API key in BSCSCAN_API_KEY or ETHERSCAN_API_KEY");
  }

  const rewardToken = process.env.BSC_TESTNET_REWARD_TOKEN;
  const initialSigners = [
    process.env.BSC_TESTNET_SIGNER_1,
    process.env.BSC_TESTNET_SIGNER_2,
    process.env.BSC_TESTNET_SIGNER_3,
    process.env.BSC_TESTNET_SIGNER_4,
  ];

  if (!rewardToken || initialSigners.some((value) => !value)) {
    throw new Error("Missing BSC testnet constructor env vars");
  }

  const constructorArguments = ethers.AbiCoder.defaultAbiCoder()
    .encode(["address", "address[]"], [rewardToken, initialSigners])
    .slice(2);

  const buildInfo = loadLpStakingBuildInfo();
  const payload = new URLSearchParams({
    apikey: apiKey,
    module: "contract",
    action: "verifysourcecode",
    contractaddress: contractAddress,
    sourceCode: JSON.stringify(buildInfo.input),
    codeformat: "solidity-standard-json-input",
    contractname: "contracts/LPStaking.sol:LPStaking",
    compilerversion: `v${buildInfo.solcLongVersion}`,
    optimizationUsed: "1",
    runs: "200",
    constructorArguments,
    evmVersion: "paris",
    licenseType: "1",
  });

  const submit = await fetch("https://api.etherscan.io/v2/api?chainid=97", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload,
  });
  const submitJson = await submit.json();
  console.log(JSON.stringify(submitJson));

  if (String(submitJson.result || "").toLowerCase().includes("already verified")) {
    return;
  }

  if (submitJson.status !== "1") {
    process.exit(1);
  }

  const guid = submitJson.result;
  for (let attempt = 0; attempt < 24; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const statusPayload = new URLSearchParams({
      apikey: apiKey,
      module: "contract",
      action: "checkverifystatus",
      guid,
    });
    const status = await fetch("https://api.etherscan.io/v2/api?chainid=97", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: statusPayload,
    });
    const statusJson = await status.json();
    console.log(JSON.stringify(statusJson));

    if (statusJson.result === "Pass - Verified") {
      return;
    }

    if (!String(statusJson.result || "").includes("Pending in queue")) {
      process.exit(1);
    }
  }

  throw new Error("Timed out waiting for verification result");
}

function loadLpStakingBuildInfo() {
  const buildInfoDir = path.join(process.cwd(), "artifacts", "build-info");
  const buildInfoFile = fs
    .readdirSync(buildInfoDir)
    .map((file) => path.join(buildInfoDir, file))
    .find((file) => {
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      return json.output?.contracts?.["contracts/LPStaking.sol"]?.LPStaking;
    });

  if (!buildInfoFile) {
    throw new Error("Could not find LPStaking build-info");
  }

  return JSON.parse(fs.readFileSync(buildInfoFile, "utf8"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
