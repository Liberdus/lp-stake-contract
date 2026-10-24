const { getAddress, ZeroAddress } = require('ethers');

// Public Hardhat/Anvil default accounts (indices 0-19). This denylist is a
// guardrail, not proof that an otherwise valid address is securely controlled.
const DEVELOPMENT_ACCOUNTS = new Set([
  '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
  '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
  '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
  '0x90f79bf6eb2c4f870365e785982e1f101e93b906',
  '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65',
  '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc',
  '0x976ea74026e726554db657fa54763abd0c3a0aa9',
  '0x14dc79964da2c08b23698b3d3cc7ca32193d9955',
  '0x23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f',
  '0xa0ee7a142d267c1f36714e4a8f75612f20a79720',
  '0xbcd4042de499d14e55001ccbb24a551f3b954096',
  '0x71be63f3384f5fb98995898a86b02fb2426c5788',
  '0xfabb0ac9d68b0b445fb7357272ff202c5651694a',
  '0x1cbd3b2770909d4e10f157cabc84c7264073c9ec',
  '0xdf3e18d64bc6a983f673ab319ccae4f1a57c7097',
  '0xcd3b766ccdd6ae721141f452c550ca635964ce71',
  '0x2546bcd3c84621e976d8185a91a922ae77ecec30',
  '0xbda5747bfd65f08deb54cb465eb87d40e51b197e',
  '0xdd2fd4581271e230360230f9337d5c0430bf44c0',
  '0x8626f6940e2eb28930efb4cef49b2d1f2c9c1199',
]);

function address(value, label, authority = false) {
  if (!value) throw new Error(`Missing ${label} in environment`);
  let normalized;
  try {
    normalized = getAddress(value);
  } catch {
    throw new Error(`${label} must be a valid address`);
  }
  if (normalized === ZeroAddress) throw new Error(`${label} must be a nonzero address`);
  if (authority && DEVELOPMENT_ACCOUNTS.has(normalized.toLowerCase())) {
    throw new Error(`Known development account is forbidden for ${label}`);
  }
  return normalized;
}

/** Load one explicit reviewed configuration; no account secrets are read here. */
function loadDeploymentConfig(prefix, env = process.env) {
  if (prefix !== 'BSC_MAINNET' && prefix !== 'BSC_TESTNET') {
    throw new Error('Deployment configuration must select BSC_MAINNET or BSC_TESTNET');
  }
  if (env[`${prefix}_CONFIG_REVIEWED`] !== 'true') {
    throw new Error(`Review the deployment parameters and set ${prefix}_CONFIG_REVIEWED=true`);
  }

  const rewardToken = address(env[`${prefix}_REWARD_TOKEN`], `${prefix}_REWARD_TOKEN`);
  const owner = address(env[`${prefix}_OWNER`], `${prefix}_OWNER`, true);
  const initialSigners = Array.from({ length: 4 }, (_, i) =>
    address(env[`${prefix}_SIGNER_${i + 1}`], `${prefix}_SIGNER_${i + 1}`, true)
  );
  if (new Set(initialSigners).size !== 4) {
    throw new Error('Deployment requires exactly four distinct signer addresses');
  }

  const overlap = env[`${prefix}_ALLOW_OWNER_SIGNER_OVERLAP`];
  if (overlap !== undefined && overlap !== '' && overlap !== 'false' && overlap !== 'true') {
    throw new Error(`${prefix}_ALLOW_OWNER_SIGNER_OVERLAP must be true or false`);
  }
  if (initialSigners.includes(owner) && overlap !== 'true') {
    throw new Error(`Owner/signer overlap requires ${prefix}_ALLOW_OWNER_SIGNER_OVERLAP=true`);
  }

  return { rewardToken, initialSigners, owner };
}

module.exports = { loadDeploymentConfig };
