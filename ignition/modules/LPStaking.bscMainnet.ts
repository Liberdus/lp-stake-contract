import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';
const { loadDeploymentConfig } = require('../../scripts/deployment-config.cjs');

const { rewardToken, initialSigners, owner } = loadDeploymentConfig('BSC_MAINNET');

const LPStakingModule = buildModule('LPStakingModule', (m) => {
  const lpStaking = m.contract('LPStaking', [rewardToken, initialSigners], {
    id: 'LPStaking',
    // Ownable initializes ownership from msg.sender. Binding the sender makes
    // the reviewed owner/overlap checks apply to the account that really deploys.
    from: owner,
  });
  return { lpStaking };
});

export default LPStakingModule;
