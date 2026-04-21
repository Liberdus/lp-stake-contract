const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

async function main() {
  await runCommand("npx", [
    "hardhat",
    "ignition",
    "deploy",
    "ignition/modules/LPStaking.bscMainnet.ts",
    "--network",
    "bsc",
  ]);

  const deployedAddress = readDeployedAddress();
  console.log(`Using deployed address ${deployedAddress} for V2 verification`);

  await runCommand("node", ["scripts/verify-bsc-mainnet-v2.js", deployedAddress]);
}

function readDeployedAddress() {
  const deploymentFile = path.join(
    process.cwd(),
    "ignition",
    "deployments",
    "chain-56",
    "deployed_addresses.json"
  );
  const json = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  const address = json["LPStakingModule#LPStaking"];

  if (!address) {
    throw new Error("Could not find LPStaking deployment address in ignition output");
  }

  return address;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code}`));
    });

    child.on("error", reject);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
