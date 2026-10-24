import { expect } from 'chai';
import '@nomicfoundation/hardhat-chai-matchers';
import { ethers } from 'hardhat';
import { time, loadFixture } from '@nomicfoundation/hardhat-network-helpers';

describe('Audit rewards regressions (LPS-02 / LPS-04)', function () {
  async function fixture() {
    const accounts = await ethers.getSigners();
    const Token = await ethers.getContractFactory('MockERC20');
    const reward = await Token.deploy('Reward', 'R');
    const lp = await Token.deploy('Pool', 'LP');
    const lp2 = await Token.deploy('Pool2', 'LP2');
    const staking = await (await ethers.getContractFactory('LPStaking')).deploy(reward.target, accounts.slice(0,4).map(a=>a.address));
    async function enact(proposal: Promise<any>) {
      await proposal;
      const id = await staking.actionCounter();
      await staking.connect(accounts[1]).approveAction(id);
      await staking.connect(accounts[2]).approveAction(id);
      await staking.executeAction(id);
    }
    await enact(staking.proposeAddPair(lp.target, 'LP', 'Mock', 1));
    await enact(staking.proposeSetHourlyRewardRate(10n**15n));
    await reward.mint(staking.target, 10n**30n);
    for (const user of accounts.slice(4,7)) {
      for (const token of [lp,lp2]) {
        await token.mint(user.address, 10n**32n);
        await token.connect(user).approve(staking.target, ethers.MaxUint256);
      }
    }
    return {staking,lp,lp2,reward,accounts,enact,user:accounts[4],small:accounts[5],outsider:accounts[6]};
  }
  it('LPS-02 preserves saved claims through removal/re-addition, zero weight and new users', async()=>{
    const {staking,lp,reward,user,small,enact}=await loadFixture(fixture);
    await staking.connect(user).stake(lp.target,10n**20n);
    await time.increase(3600);
    await staking.connect(user).unstake(lp.target,10n**20n,false);
    const saved=await staking.earned(user.address,lp.target);
    const accumulator=await staking.rewardPerTokenStored(lp.target);
    await enact(staking.proposeRemovePair(lp.target));
    await staking.connect(user).claimRewards.staticCall(lp.target);
    await enact(staking.proposeAddPair(lp.target,'LP','Mock',1));
    expect(await staking.rewardPerTokenStored(lp.target)).to.equal(accumulator);
    await staking.connect(small).stake(lp.target,10n**20n);
    await time.increase(100);
    await enact(staking.proposeUpdatePairWeights([lp.target],[0]));
    expect(await staking.earned(user.address,lp.target)).to.equal(saved);
    await staking.connect(user).claimRewardsTo(lp.target,small.address);
    expect(await reward.balanceOf(small.address)).to.equal(saved);
    expect(await staking.earned(user.address,lp.target)).to.equal(0);
    await expect(staking.connect(user).claimRewards(lp.target)).to.be.revertedWith('No rewards to claim');
  });
  it('LPS-04 rejects zero unstake before settlement, including recipient route', async()=>{
    const {staking,lp,user,outsider}=await loadFixture(fixture);
    await staking.connect(user).stake(lp.target,10n**30n);
    const before=await staking.lastUpdateTime(lp.target);
    await time.increase(20);
    await expect(staking.connect(outsider).unstake(lp.target,0,false)).to.be.revertedWith('Amount must be greater than zero');
    await expect(staking.connect(user).unstakeTo(lp.target,0,false,outsider.address)).to.be.revertedWith('Amount must be greater than zero');
    expect(await staking.lastUpdateTime(lp.target)).to.equal(before);
  });
  it('LPS-04 unchanged supply: 3,600 claims preserve rewards compared with one interval', async()=>{
    const {staking,lp,user}=await loadFixture(fixture);
    await staking.connect(user).stake(lp.target,10n**30n);
    const start=await time.latest();
    let claimed=0n;
    for(let i=1;i<=3600;i++) {
      await time.setNextBlockTimestamp(start+i);
      const tx=await staking.connect(user).claimRewards(lp.target);
      const receipt=await tx.wait();
      for(const log of receipt!.logs) {
        try { const parsed=staking.interface.parseLog(log); if(parsed?.name==='RewardsClaimed') claimed+=parsed.args[2]; } catch {}
      }
    }
    expect(claimed + await staking.earned(user.address,lp.target)).to.be.within(10n**15n-1n,10n**15n);
  }).timeout(180000);
  it('LPS-04 genuine small stake changes cannot suppress the large staker rewards', async()=>{
    const {staking,lp,user,small}=await loadFixture(fixture);
    await staking.connect(user).stake(lp.target,10n**30n);
    await staking.connect(small).stake(lp.target,10n**15n);
    const start=await time.latest();
    const initial=await staking.earned(user.address,lp.target);
    for(let i=1;i<=100;i++) {
      await time.setNextBlockTimestamp(start+i);
      if(i%2) await staking.connect(small).unstake(lp.target,1,false);
      else await staking.connect(small).stake(lp.target,10n**15n);
    }
    const delta=(await staking.earned(user.address,lp.target))-initial;
    const expected=10n**15n*100n/3600n;
    // Each supply boundary discards <2 raw emission units plus S/P raw RPT units.
    // Here S/P is approximately one; the small participant earns <2 raw units.
    expect(delta).to.be.within(expected-302n,expected);
    expect(await staking.getTotalRewardObligation()).to.be.gte(await staking.earned(user.address,lp.target));
  });
  it('LPS-04 fractional user rewards survive repeated settlement and claims', async()=>{
    const {staking,lp,user,small,enact,reward}=await loadFixture(fixture);
    await enact(staking.proposeSetHourlyRewardRate(3600));
    await staking.connect(user).stake(lp.target,10n**15n);
    await staking.connect(small).stake(lp.target,2n*10n**15n);
    const start=await time.latest();
    const initial=await staking.earned(user.address,lp.target);
    for(let i=1;i<=30;i++) {
      await time.setNextBlockTimestamp(start+4*i);
      await staking.connect(user).claimRewards(lp.target);
    }
    expect(await reward.balanceOf(user.address)).to.equal(initial+40n);
    expect(await staking.getTotalRewardObligation()).to.be.gte(await staking.earned(small.address,lp.target));
  });
  it('LPS-04 maximal rate and a one-raw-unit residual remain usable after a year', async()=>{
    const {staking,lp,user,enact,reward}=await loadFixture(fixture);
    const max=(1n<<128n)-1n;
    await reward.mint(staking.target,max*10000n);
    await staking.connect(user).stake(lp.target,10n**15n);
    await staking.connect(user).unstake(lp.target,10n**15n-1n,false);
    await enact(staking.proposeSetHourlyRewardRate(max));
    await time.increase(365*24*3600);
    expect(await staking.earned(user.address,lp.target)).to.be.gt(max*8700n);
    await staking.connect(user).unstake(lp.target,1,true);
    expect(await staking.totalStaked(lp.target)).to.equal(0);
  });
  it('LPS-04 no-op governance settlement preserves fractional emissions in two pools', async()=>{
    const {staking,lp,lp2,user,small,enact}=await loadFixture(fixture);
    await enact(staking.proposeAddPair(lp2.target,'LP2','Mock',2));
    await enact(staking.proposeSetHourlyRewardRate(1));
    await staking.connect(user).stake(lp.target,10n**15n);
    await staking.connect(small).stake(lp2.target,10n**15n);
    const start=await time.latest();
    for(let i=1;i<=12;i++) {
      await time.setNextBlockTimestamp(start+i*300);
      if(i%2) await enact(staking.proposeSetHourlyRewardRate(1));
      else await enact(staking.proposeUpdatePairWeights([lp.target,lp2.target],[1,2]));
    }
    await time.increaseTo(start+10800);
    expect(await staking.earned(user.address,lp.target)).to.equal(1);
    expect(await staking.earned(small.address,lp2.target)).to.equal(2);
  });
  it('LPS-04 cohort dust never becomes a new user entitlement', async()=>{
    const {staking,lp,user,small,enact}=await loadFixture(fixture);
    await enact(staking.proposeSetHourlyRewardRate(1));
    await staking.connect(user).stake(lp.target,3n*10n**15n);
    const start=await time.latest();
    await time.setNextBlockTimestamp(start+3600);
    await staking.connect(user).unstake(lp.target,3n*10n**15n,false);
    const oldEarned=await staking.earned(user.address,lp.target);
    await staking.connect(small).stake(lp.target,3n*10n**15n);
    expect(await staking.earned(small.address,lp.target)).to.equal(0);
    await time.increase(3600);
    expect(await staking.earned(small.address,lp.target)).to.be.lte(1);
    expect(await staking.earned(user.address,lp.target)).to.equal(oldEarned);
  });
  it('LPS-04 aggregate supply is bounded across repeated deposits', async()=>{
    const {staking,lp,user}=await loadFixture(fixture);
    const max=(1n<<128n)-1n;
    await lp.mint(user.address,max);
    await staking.connect(user).stake(lp.target,max);
    const balanceBefore=await lp.balanceOf(user.address);
    const updateBefore=await staking.lastUpdateTime(lp.target);
    await expect(staking.connect(user).stake(lp.target,10n**15n)).to.be.revertedWith('Total stake too high');
    expect(await staking.totalStaked(lp.target)).to.equal(max);
    expect(await lp.balanceOf(user.address)).to.equal(balanceBefore);
    expect(await staking.lastUpdateTime(lp.target)).to.equal(updateBefore);
    expect(await lp.balanceOf(staking.target)).to.equal(max);
  });
  it('200 seeded two-pool transitions conserve principal/rewards and cover all sampled liabilities', async()=>{
    const {staking,lp,lp2,user,small,outsider,accounts,enact,reward}=await loadFixture(fixture);
    const users=[user,small,outsider], pools=[lp,lp2];
    await enact(staking.proposeAddPair(lp2.target,'LP2','Mock',2));
    await enact(staking.proposeSetHourlyRewardRate(10n**18n));
    let seed=20261024; const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
    for(let step=0;step<200;step++) {
      await time.increase(1+random()%100);
      const u=users[random()%users.length], p=pools[random()%2], kind=random()%6;
      const position=await staking.userStakes(u.address,p.target);
      if(kind===0 || position.amount===0n) await staking.connect(u).stake(p.target,BigInt(1+random()%10)*10n**15n);
      else if(kind===1) await staking.connect(u).unstake(p.target,position.amount/2n||1n,false);
      else if(kind===2) await staking.connect(u).unstakeTo(p.target,position.amount,true,u.address);
      else if(kind===3 && (await staking.earned(u.address,p.target))>0n) await staking.connect(u).claimRewards(p.target);
      else if(kind===4) await enact(staking.proposeSetHourlyRewardRate(BigInt(1+random()%1000)*10n**15n));
      else await enact(staking.proposeUpdatePairWeights([lp.target,lp2.target],[1+random()%3,1+random()%3]));
      let liabilities=0n, paid=0n;
      for(const token of pools) {
        let tracked=0n;
        for(const account of users) {
          tracked+=(await staking.userStakes(account.address,token.target)).amount;
          liabilities+=await staking.earned(account.address,token.target);
        }
        expect(await staking.totalStaked(token.target)).to.equal(tracked);
        expect(await token.balanceOf(staking.target)).to.equal(tracked);
      }
      for(const account of users) paid+=await reward.balanceOf(account.address);
      expect(await reward.balanceOf(staking.target)+paid).to.equal(10n**30n);
      expect(await staking.getTotalRewardObligation()).to.be.gte(liabilities);
    }
  }).timeout(180000);

});
