const { expect } = require('chai');
require('@nomicfoundation/hardhat-chai-matchers');
const { ethers } = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');

describe('Audit governance regressions (LPS-01, LPS-05, LPS-06)', function () {
  async function fixture(overlap = false) {
    const accounts = await ethers.getSigners();
    const [owner, a, b, c, d, x, y, z] = accounts;
    const token = await (await ethers.getContractFactory('MockERC20')).deploy('Reward', 'R');
    const admins = overlap ? [owner, a, b, c] : [a, b, c, d];
    const staking = await (await ethers.getContractFactory('LPStaking')).deploy(token.target, admins.map(s => s.address));
    return { staking, token, owner, a, b, c, d, x, y, z, admins };
  }
  const distinct = () => fixture(false);
  const overlapping = () => fixture(true);
  async function rotateOwner(staking, from, to) {
    await staking.connect(from).transferOwnership(to.address);
    await staking.connect(to).acceptOwnership();
  }
  async function propose(staking, caller, oldSigner, newSigner) {
    await staking.connect(caller).proposeChangeSigner(oldSigner.address, newSigner.address);
    return staking.actionCounter();
  }

  it('LPS-01: an overlapping owner cannot manufacture a fifth vote by transferring ownership', async function () {
    const { staking, owner, a, x, y } = await loadFixture(overlapping);
    const id = await propose(staking, owner, a, x);
    await rotateOwner(staking, owner, y);
    await expect(staking.connect(y).approveAction(id)).to.be.reverted;
    await expect(staking.connect(owner).executeAction(id)).to.be.revertedWith('Not enough approvals');
    expect((await staking.actions(id)).approvals).to.equal(1);
  });

  it('LPS-01: successive distinct owners share one permanently consumed approval authority', async function () {
    const { staking, owner, a, d, x, y, z } = await loadFixture(distinct);
    const id = await propose(staking, a, d, x);
    await staking.connect(owner).approveAction(id);
    await rotateOwner(staking, owner, y);
    await expect(staking.connect(y).approveAction(id)).to.be.reverted;
    await rotateOwner(staking, y, z);
    await expect(staking.connect(z).approveAction(id)).to.be.reverted;
    await expect(staking.connect(a).executeAction(id)).to.be.revertedWith('Not enough approvals');
    expect((await staking.actions(id)).approvals).to.equal(2);
  });

  it('LPS-01: ownership can transfer before voting, but the departed owner cannot newly vote', async function () {
    const { staking, owner, a, b, d, x, y } = await loadFixture(distinct);
    const id = await propose(staking, a, d, x);
    await rotateOwner(staking, owner, y);
    await expect(staking.connect(owner).approveAction(id)).to.be.reverted;
    await staking.connect(y).approveAction(id);
    await staking.connect(b).approveAction(id);
    await staking.connect(a).executeAction(id);
    expect(await staking.hasRole(await staking.ADMIN_ROLE(), x.address)).to.equal(true);
  });

  it('LPS-01: a consumed owner approval survives transfer, return, and a genuine quorum', async function () {
    const { staking, owner, a, b, d, x, y } = await loadFixture(distinct);
    const id = await propose(staking, a, d, x);
    await staking.connect(owner).approveAction(id);
    await rotateOwner(staking, owner, y);
    await rotateOwner(staking, y, owner);
    await expect(staking.connect(owner).approveAction(id)).to.be.reverted;
    await staking.connect(b).approveAction(id);
    await rotateOwner(staking, owner, y);
    await expect(staking.connect(y).rejectAction(id)).to.be.reverted;
    await staking.connect(a).executeAction(id);
  });

  it('LPS-01: owner rejection cannot become successor approval or a second rejection', async function () {
    const { staking, owner, a, b, d, x, y } = await loadFixture(distinct);
    const id = await propose(staking, a, d, x);
    await staking.connect(owner).rejectAction(id);
    await rotateOwner(staking, owner, y);
    await expect(staking.connect(y).approveAction(id)).to.be.reverted;
    await expect(staking.connect(y).rejectAction(id)).to.be.reverted;
    await staking.connect(b).rejectAction(id);
    expect((await staking.actions(id)).rejections).to.equal(2);
    expect((await staking.actions(id)).rejected).to.equal(false);
  });

  it('LPS-01: an admin cannot vote twice by becoming the distinct owner', async function () {
    const { staking, owner, a, d, x } = await loadFixture(distinct);
    const id = await propose(staking, a, d, x);
    await rotateOwner(staking, owner, a);
    await expect(staking.connect(a).approveAction(id)).to.be.revertedWith('Already approved');
    await expect(staking.connect(a).rejectAction(id)).to.be.revertedWith('Cannot reject after approving');
  });

  it('LPS-01: owner renunciation does not disturb three-admin signer rotation', async function () {
    const { staking, owner, a, b, c, d, x } = await loadFixture(distinct);
    const id = await propose(staking, a, d, x);
    await staking.connect(owner).renounceOwnership();
    await expect(staking.connect(owner).approveAction(id)).to.be.reverted;
    await staking.connect(b).approveAction(id);
    await staking.connect(c).approveAction(id);
    await staking.connect(a).executeAction(id);
  });

  it('LPS-01: owners never acquire votes in ordinary admin proposals', async function () {
    const { staking, owner, a, b, c, y } = await loadFixture(distinct);
    await staking.connect(a).proposeSetHourlyRewardRate(1);
    const id = await staking.actionCounter();
    await expect(staking.connect(owner).approveAction(id)).to.be.reverted;
    await expect(staking.connect(owner).rejectAction(id)).to.be.reverted;
    await rotateOwner(staking, owner, y);
    await expect(staking.connect(y).approveAction(id)).to.be.reverted;
    await staking.connect(b).approveAction(id);
    await staking.connect(c).approveAction(id);
    await staking.connect(a).executeAction(id);
  });

  it('LPS-06: two admin rejections cannot defeat three distinct signer-change approvals', async function () {
    const { staking, owner, a, b, c, d, x } = await loadFixture(distinct);
    const id = await propose(staking, a, d, x);
    await staking.connect(b).approveAction(id);
    await staking.connect(owner).approveAction(id);
    await staking.connect(c).rejectAction(id);
    await staking.connect(d).rejectAction(id);
    expect((await staking.actions(id)).rejected).to.equal(false);
    await staking.connect(a).executeAction(id);
  });

  it('LPS-06: three distinct rejections close a five-authority signer proposal', async function () {
    const { staking, owner, a, b, c, d, x } = await loadFixture(distinct);
    const id = await propose(staking, a, d, x);
    await staking.connect(b).rejectAction(id);
    await staking.connect(c).rejectAction(id);
    expect((await staking.actions(id)).rejected).to.equal(false);
    await staking.connect(owner).rejectAction(id);
    expect((await staking.actions(id)).rejected).to.equal(true);
    await expect(staking.connect(a).executeAction(id)).to.be.revertedWith('Action was rejected');
  });

  it('LPS-06: overlap stays a four-authority proposal after transfer and two rejections suffice', async function () {
    const { staking, owner, a, b, c, x, y } = await loadFixture(overlapping);
    const id = await propose(staking, owner, c, x);
    await rotateOwner(staking, owner, y);
    await staking.connect(a).rejectAction(id);
    await staking.connect(b).rejectAction(id);
    expect((await staking.actions(id)).rejected).to.equal(true);
  });

  it('LPS-05: repeated blocking proposals cannot prevent honest quorum removal', async function () {
    const { staking, a, b, c, d, x } = await loadFixture(distinct);
    for (let round = 0; round < 3; round++) await staking.connect(d).proposeSetHourlyRewardRate(round);
    const id = await propose(staking, a, d, x);
    await staking.connect(d).proposeSetHourlyRewardRate(9);
    await staking.connect(b).approveAction(id);
    await staking.connect(c).approveAction(id);
    await staking.connect(a).executeAction(id);
    expect(await staking.hasRole(await staking.ADMIN_ROLE(), d.address)).to.equal(false);
    expect(await staking.pendingActionCount()).to.equal(0);
  });

  it('LPS-05: concurrent replacements of the same signer cannot grow the admin set', async function () {
    const { staking, a, b, c, d, x, y } = await loadFixture(distinct);
    const first = await propose(staking, a, d, x);
    const second = await propose(staking, a, d, y);
    for (const id of [first, second]) {
      await staking.connect(b).approveAction(id);
      await staking.connect(c).approveAction(id);
    }
    await staking.connect(a).executeAction(first);
    await expect(staking.connect(a).executeAction(second)).to.be.revertedWith('Governance configuration changed');
    expect((await staking.getSigners()).length).to.equal(4);
    expect(await staking.hasRole(await staking.ADMIN_ROLE(), y.address)).to.equal(false);
  });

  it('LPS-05: normal approvals become stale after rotation, including leave and rejoin', async function () {
    const { staking, a, b, c, d, x } = await loadFixture(distinct);
    await staking.connect(a).proposeSetHourlyRewardRate(111);
    const stale = await staking.actionCounter();
    await staking.connect(b).approveAction(stale);
    await staking.connect(d).approveAction(stale);
    let rotation = await propose(staking, a, d, x);
    await staking.connect(b).approveAction(rotation);
    await staking.connect(c).approveAction(rotation);
    await staking.connect(a).executeAction(rotation);
    await expect(staking.connect(a).executeAction(stale)).to.be.revertedWith('Governance configuration changed');
    rotation = await propose(staking, a, x, d);
    await staking.connect(b).approveAction(rotation);
    await staking.connect(c).approveAction(rotation);
    await staking.connect(a).executeAction(rotation);
    await expect(staking.connect(a).executeAction(stale)).to.be.revertedWith('Governance configuration changed');
    await expect(staking.connect(c).approveAction(stale)).to.be.revertedWith('Governance configuration changed');
    await expect(staking.connect(c).rejectAction(stale)).to.be.revertedWith('Governance configuration changed');
  });

  it('LPS-05: stale cleanup cannot decrement new-epoch pending accounting', async function () {
    const { staking, a, b, c, d, x } = await loadFixture(distinct);
    await staking.connect(d).proposeSetHourlyRewardRate(1);
    const stale = await staking.actionCounter();
    const rotation = await propose(staking, a, d, x);
    await staking.connect(b).approveAction(rotation);
    await staking.connect(c).approveAction(rotation);
    await staking.connect(a).executeAction(rotation);
    await staking.connect(a).proposeSetHourlyRewardRate(2);
    expect(await staking.pendingActionCount()).to.equal(1);
    await staking.connect(a).handleExpiredAction(stale);
    expect(await staking.pendingActionCount()).to.equal(1);
    expect((await staking.actions(stale)).expired).to.equal(true);
  });

  it('LPS-05: invalid, expired and rejected proposals do not occupy a recovery slot', async function () {
    const { staking, a, b, c, d, x } = await loadFixture(distinct);
    await staking.connect(d).proposeUpdatePairWeights([x.address], [1]);
    const invalid = await staking.actionCounter();
    await staking.connect(a).approveAction(invalid);
    await staking.connect(b).approveAction(invalid);
    await expect(staking.connect(a).executeAction(invalid)).to.be.revertedWith("Pair doesn't exist");
    await time.increase(7 * 24 * 3600 + 1);
    const removal = await propose(staking, a, d, x);
    await staking.connect(d).proposeSetHourlyRewardRate(1);
    const rejected = await staking.actionCounter();
    await staking.connect(a).rejectAction(rejected);
    await staking.connect(b).rejectAction(rejected);
    await staking.connect(d).proposeSetHourlyRewardRate(2);
    await staking.connect(b).approveAction(removal);
    await staking.connect(c).approveAction(removal);
    await staking.connect(a).executeAction(removal);
  });
});
