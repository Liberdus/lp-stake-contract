require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

async function main() {
  const contractAddress = process.argv[2];
  if (!contractAddress) {
    throw new Error("Usage: node scripts/verify-bsc-mainnet-v2.js <contractAddress>");
  }

  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ETHERSCAN_API_KEY");
  }

  const rewardToken = process.env.BSC_MAINNET_REWARD_TOKEN;
  const initialSigners = [
    process.env.BSC_MAINNET_SIGNER_1,
    process.env.BSC_MAINNET_SIGNER_2,
    process.env.BSC_MAINNET_SIGNER_3,
    process.env.BSC_MAINNET_SIGNER_4,
  ];

  if (!rewardToken || initialSigners.some((value) => !value)) {
    throw new Error("Missing BSC mainnet constructor env vars");
  }

  const constructorArguments = ethers.AbiCoder.defaultAbiCoder()
    .encode(["address", "address[]"], [rewardToken, initialSigners])
    .slice(2);

  const buildInfo = loadLpStakingBuildInfo(contractAddress);
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

  const submit = await fetch("https://api.etherscan.io/v2/api?chainid=56", {
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
    const status = await fetch("https://api.etherscan.io/v2/api?chainid=56", {
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

function loadLpStakingBuildInfo(contractAddress) {
  const dbgFile = resolveDebugArtifact(contractAddress);
  const dbgJson = JSON.parse(fs.readFileSync(dbgFile, "utf8"));
  const buildInfoFile = path.resolve(path.dirname(dbgFile), dbgJson.buildInfo);

  if (!fs.existsSync(buildInfoFile)) {
    throw new Error(`Could not find build-info referenced by ${dbgFile}`);
  }

  return JSON.parse(fs.readFileSync(buildInfoFile, "utf8"));
}

function resolveDebugArtifact(contractAddress) {
  const deploymentDir = path.join(process.cwd(), "ignition", "deployments", "chain-56");
  const deployedAddressesFile = path.join(deploymentDir, "deployed_addresses.json");

  if (fs.existsSync(deployedAddressesFile)) {
    const deployedAddresses = JSON.parse(fs.readFileSync(deployedAddressesFile, "utf8"));
    const deploymentKey = Object.entries(deployedAddresses).find(
      ([, address]) => String(address).toLowerCase() === contractAddress.toLowerCase()
    )?.[0];

    if (deploymentKey) {
      const deploymentDebugFile = path.join(
        deploymentDir,
        "artifacts",
        `${deploymentKey}.dbg.json`
      );

      if (fs.existsSync(deploymentDebugFile)) {
        return deploymentDebugFile;
      }
    }
  }

  const artifactDebugFile = path.join(
    process.cwd(),
    "artifacts",
    "contracts",
    "LPStaking.sol",
    "LPStaking.dbg.json"
  );

  if (fs.existsSync(artifactDebugFile)) {
    return artifactDebugFile;
  }

  throw new Error("Could not find LPStaking debug artifact");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
