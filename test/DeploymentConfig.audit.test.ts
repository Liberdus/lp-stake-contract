import { expect } from 'chai';
import { ethers } from 'hardhat';
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Module inspection only: these tests never broadcast deployment transactions.
describe('LPS-03: reviewed deployment configuration', function () {
  const token = '0x1000000000000000000000000000000000000001';
  const owner = '0x2000000000000000000000000000000000000002';
  const signers = [3, 4, 5, 6].map((n) => `0x${n.toString().padStart(40, '0')}`);
  const developmentSigner = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
  const originalEnv = { ...process.env };

  afterEach(function () {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('BSC_MAINNET_') || key.startsWith('BSC_TESTNET_')) delete process.env[key];
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (key.startsWith('BSC_MAINNET_') || key.startsWith('BSC_TESTNET_')) process.env[key] = value;
    }
  });

  function setConfig(prefix: string) {
    process.env[`${prefix}_REWARD_TOKEN`] = token;
    process.env[`${prefix}_OWNER`] = owner;
    process.env[`${prefix}_CONFIG_REVIEWED`] = 'true';
    delete process.env[`${prefix}_ALLOW_OWNER_SIGNER_OVERLAP`];
    signers.forEach((signer, i) => { process.env[`${prefix}_SIGNER_${i + 1}`] = signer; });
  }

  function loadModule(name: string) {
    const path = require.resolve(`../ignition/modules/LPStaking.${name}`);
    delete require.cache[path];
    return require(path).default;
  }

  for (const [name, prefix] of [['bscMainnet', 'BSC_MAINNET'], ['bscTestnet', 'BSC_TESTNET']]) {
    describe(name, function () {
      beforeEach(function () { setConfig(prefix); });

      it('rejects the demonstrated public development signer', function () {
        process.env[`${prefix}_SIGNER_2`] = developmentSigner;
        expect(() => loadModule(name)).to.throw('Known development account');
      });

      it('rejects every default account supplied by the local Hardhat network', async function () {
        for (const signer of await ethers.getSigners()) {
          process.env[`${prefix}_SIGNER_2`] = signer.address;
          expect(() => loadModule(name)).to.throw('Known development account');
        }
      });

      it('rejects zero signer addresses', function () {
        process.env[`${prefix}_SIGNER_2`] = ethers.ZeroAddress;
        expect(() => loadModule(name)).to.throw('nonzero address');
      });

      it('rejects duplicate signers independent of address casing', function () {
        const signer = ethers.getAddress('0xabcdef0000000000000000000000000000000001');
        process.env[`${prefix}_SIGNER_1`] = signer;
        process.env[`${prefix}_SIGNER_2`] = signer.toLowerCase();
        expect(() => loadModule(name)).to.throw('distinct signer addresses');
      });

      it('rejects malformed addresses', function () {
        process.env[`${prefix}_SIGNER_2`] = 'not-an-address';
        expect(() => loadModule(name)).to.throw('valid address');
      });

      it('rejects missing signer entries rather than filtering them', function () {
        delete process.env[`${prefix}_SIGNER_3`];
        expect(() => loadModule(name)).to.throw();
      });

      it('rejects an unintended owner/signer overlap', function () {
        process.env[`${prefix}_OWNER`] = signers[0];
        expect(() => loadModule(name)).to.throw('Owner/signer overlap');
      });

      it('requires explicit review and a valid owner', function () {
        delete process.env[`${prefix}_CONFIG_REVIEWED`];
        expect(() => loadModule(name)).to.throw('CONFIG_REVIEWED=true');
        process.env[`${prefix}_CONFIG_REVIEWED`] = 'true';
        delete process.env[`${prefix}_OWNER`];
        expect(() => loadModule(name)).to.throw('OWNER');
      });

      it('rejects a development owner even with reviewed signers', function () {
        process.env[`${prefix}_OWNER`] = developmentSigner;
        expect(() => loadModule(name)).to.throw('Known development account');
      });

      it('rejects a zero owner and ambiguous overlap flags', function () {
        process.env[`${prefix}_OWNER`] = ethers.ZeroAddress;
        expect(() => loadModule(name)).to.throw('nonzero address');
        process.env[`${prefix}_OWNER`] = owner;
        process.env[`${prefix}_ALLOW_OWNER_SIGNER_OVERLAP`] = 'yes';
        expect(() => loadModule(name)).to.throw('must be true or false');
      });

      it('uses the same validation in the verification entry point before any network access', function () {
        const network = name === 'bscMainnet' ? 'mainnet' : 'testnet';
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
          if (key.startsWith(prefix) && value !== undefined) env[key] = value;
        }
        env[`${prefix}_SIGNER_2`] = developmentSigner;
        // No credentials are provided. Invalid configuration must stop before
        // API-key checks, build artifact access, or explorer requests.
        const result = spawnSync(process.execPath, [
          resolve(`scripts/verify-bsc-${network}-v2.js`), token,
        ], { env, encoding: 'utf8', cwd: process.cwd() });
        expect(result.status).to.equal(1);
        expect(result.stderr).to.contain('Known development account');
      });

      it('rejects invalid and zero reward tokens', function () {
        process.env[`${prefix}_REWARD_TOKEN`] = 'invalid';
        expect(() => loadModule(name)).to.throw('valid address');
        process.env[`${prefix}_REWARD_TOKEN`] = ethers.ZeroAddress;
        expect(() => loadModule(name)).to.throw('nonzero address');
      });

      it('pins the deployment sender to the reviewed owner and exact constructor arguments', function () {
        const future = loadModule(name).results.lpStaking;
        expect(future.from).to.equal(owner);
        expect(future.constructorArgs).to.deep.equal([token, signers]);
      });

      it('permits deliberate owner/signer overlap only when explicitly configured', function () {
        process.env[`${prefix}_OWNER`] = signers[0];
        process.env[`${prefix}_ALLOW_OWNER_SIGNER_OVERLAP`] = 'true';
        expect(loadModule(name).results.lpStaking.from).to.equal(signers[0]);
      });
    });
  }

  for (const name of ['prod', 'test']) {
    it(`quarantines the legacy ${name} module instead of retaining public signers`, function () {
      expect(() => loadModule(name)).to.throw('Legacy deployment module is disabled');
    });
  }

  it('routes every package deployment command through a guarded BSC module', function () {
    const scripts = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).scripts;
    for (const [name, command] of Object.entries(scripts)) {
      if (!name.startsWith('deploy:')) continue;
      const source = String(command).startsWith('node ')
        ? readFileSync(resolve(String(command).slice(5)), 'utf8')
        : String(command);
      expect(source).to.match(/ignition\/modules\/LPStaking\.bsc(Mainnet|Testnet)\.ts/);
    }
  });
});
