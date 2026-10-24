require('dotenv').config();
const { loadDeploymentConfig } = require('./scripts/deployment-config.cjs');

// Select the same reviewed configuration as the deployment module. Historical
// constructor arguments remain in ignition/deployments/*/journal.jsonl.
const { rewardToken, initialSigners } = loadDeploymentConfig(process.env.LPSTAKING_DEPLOYMENT_CONFIG);
module.exports = [rewardToken, initialSigners];
