import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Signer, BigNumber, utils } from 'ethers';
import { time } from '@openzeppelin/test-helpers';
import { VanityNameRegistry, VanityNameRegistry__factory } from '../types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

const LOCK_AMOUNT = utils.parseEther('1');
const FEE_PER_CHAR = utils.parseEther('0.01');
const LOCK_PERIOD = 3600 * 24 * 7; // 7 days
const WAIT_BLOCKS = 2;

describe('VanityNameRegistry', () => {
  let vanityNameRegistry: VanityNameRegistry;
  let deployer: SignerWithAddress, user1: SignerWithAddress, user2: SignerWithAddress, treasury: SignerWithAddress, newTreasury: SignerWithAddress;

  beforeEach(async () => {
    [deployer, user1, user2, treasury, newTreasury] = await ethers.getSigners();
    vanityNameRegistry = await (new VanityNameRegistry__factory(deployer)).deploy(
      LOCK_AMOUNT,
      FEE_PER_CHAR,
      treasury.address,
      LOCK_PERIOD,
      WAIT_BLOCKS,
    );
  });

  describe('constructor', () => {
    it('revert if lock period is zero', async () => {
      const VanityNameRegistryFactory = await ethers.getContractFactory(
        'VanityNameRegistry',
      );
      expect(
        VanityNameRegistryFactory.deploy(
          LOCK_AMOUNT,
          FEE_PER_CHAR,
          treasury.address,
          0,
          WAIT_BLOCKS,
        ),
      ).to.revertedWith('invalid period');
    });

    it('revert if lock amount is zero', async () => {
      const VanityNameRegistryFactory = await ethers.getContractFactory(
        'VanityNameRegistry',
      );
      expect(
        VanityNameRegistryFactory.deploy(
          0,
          FEE_PER_CHAR,
          treasury.address,
          LOCK_PERIOD,
          WAIT_BLOCKS,
        ),
      ).to.revertedWith('invalid amount');
    });

    it('revert if treasury.address address is 0x0', async () => {
      const VanityNameRegistryFactory = await ethers.getContractFactory(
        'VanityNameRegistry',
      );
      expect(
        VanityNameRegistryFactory.deploy(
          LOCK_AMOUNT,
          FEE_PER_CHAR,
          '0x0000000000000000000000000000000000000000',
          LOCK_PERIOD,
          WAIT_BLOCKS,
        ),
      ).to.revertedWith('invalid treasury.address');
    });

    it('check initial values', async () => {
      expect(await vanityNameRegistry.lockAmount()).to.equal(LOCK_AMOUNT);
      expect(await vanityNameRegistry.feePerChar()).to.equal(FEE_PER_CHAR);
      expect(await vanityNameRegistry.treasury()).to.equal(treasury.address);
      expect(await vanityNameRegistry.lockPeriod()).to.equal(LOCK_PERIOD);
      expect(await vanityNameRegistry.waitBlocks()).to.equal(WAIT_BLOCKS);
    });
  });

  describe('#registerSignature', () => {
    it('request signature for name register', async () => {
      const signature = await user1.signMessage(
        utils.arrayify(utils.id('test.eth')),
      );
      const tx = await vanityNameRegistry
        .connect(user1)
        .registerSignature(signature, false);
      const lastBlock = (await time.latestBlock()).toString();
      expect(tx)
        .to.emit(vanityNameRegistry, 'SignatureRequested')
        .withArgs(user1.address, signature);
      const requestSignature = await vanityNameRegistry.requestSignatures(
        user1.address,
      );
      expect(requestSignature.signature).to.equal(signature);
      expect(requestSignature.blockId).to.equal(lastBlock);
    });

    it('revert if request when pending is available', async () => {
      const signature1 = await user1.signMessage(
        utils.arrayify(utils.id('test.eth')),
      );
      const signature2 = await user1.signMessage(
        utils.arrayify(utils.id('test.eth1')),
      );
      await vanityNameRegistry
        .connect(user1)
        .registerSignature(await user1.signMessage(signature1), false);
      expect(
        vanityNameRegistry.connect(user1).registerSignature(signature2, false),
      ).to.revertedWith('has pending request');
    });

    it('can force replace new signature', async () => {
      const signature1 = await user1.signMessage(
        utils.arrayify(utils.id('test.eth')),
      );
      const signature2 = await user1.signMessage(
        utils.arrayify(utils.id('test.eth1')),
      );
      await vanityNameRegistry
        .connect(user1)
        .registerSignature(signature1, false);

      await time.advanceBlock();
      await time.advanceBlock();

      await vanityNameRegistry
        .connect(user1)
        .registerSignature(signature2, true);
      const requestSignature = await vanityNameRegistry.requestSignatures(
        user1.address,
      );
      const lastBlock = (await time.latestBlock()).toString();
      expect(requestSignature.signature).to.equal(signature2);
      expect(requestSignature.blockId).to.equal(lastBlock);
    });
  });

  describe('#registerName', () => {
    const name = 'test.eth';

    it('revert if no signature requested', async () => {
      expect(vanityNameRegistry.connect(user1).registerName(name)).to.revertedWith(
        'no request or wait more blocks',
      );
    });

    it('revert if need to wait more blocks', async () => {
      const signature = await user1.signMessage(utils.arrayify(utils.id(name)));
      await vanityNameRegistry
        .connect(user1)
        .registerSignature(signature, false);

      expect(vanityNameRegistry.connect(user1).registerName(name)).to.revertedWith(
        'no request or wait more blocks',
      );
    });

    it('revert if name does not match with signature', async () => {
      const signature = await user1.signMessage(utils.arrayify(utils.id(name)));
      await vanityNameRegistry
        .connect(user1)
        .registerSignature(signature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      expect(
        vanityNameRegistry.connect(user1).registerName('test.eth1'),
      ).to.revertedWith('invalid signature');
    });

    it('revert if not enough ether sent', async () => {
      const signature = await user1.signMessage(utils.arrayify(utils.id(name)));
      await vanityNameRegistry
        .connect(user1)
        .registerSignature(signature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      expect(vanityNameRegistry.connect(user1).registerName(name)).to.revertedWith(
        'no enough ether',
      );
    });

    it('register name and send fee to treasury', async () => {
      const signature = await user1.signMessage(utils.arrayify(utils.id(name)));
      await vanityNameRegistry
        .connect(user1)
        .registerSignature(signature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      const treasuryBalanceBefore = await ethers.provider.getBalance(treasury.address)
      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name.length));
      const tx = await vanityNameRegistry
        .connect(user1)
        .registerName(name, { value: LOCK_AMOUNT.add(registerFee) });
      expect(tx)
        .to.emit(vanityNameRegistry, 'NameRegistered')
        .withArgs(user1.address, name, LOCK_AMOUNT);
      const registerTime = Number((await time.latest()).toString());
      expect(await user1.provider.getBalance(treasury.address)).to.equal(treasuryBalanceBefore.add(registerFee));
      expect(await user1.provider.getBalance(vanityNameRegistry.address)).to.equal(
        LOCK_AMOUNT,
      );
      expect(
        await vanityNameRegistry.unlockedEthers(user1.address),
      ).to.equal(0);

      const record = await vanityNameRegistry.records(name);
      expect(record.owner).to.equal(user1.address);
      expect(record.maturity).to.equal(registerTime + LOCK_PERIOD);
      expect(record.lockAmount).to.equal(LOCK_AMOUNT);

      const requestSignature = await vanityNameRegistry.requestSignatures(
        user1.address,
      );
      expect(requestSignature.signature).to.equal('0x');
      expect(requestSignature.blockId).to.equal(0);
    });

    it('increase unlock amount if user send more ether than required', async () => {
      const signature = await user1.signMessage(utils.arrayify(utils.id(name)));
      await vanityNameRegistry
        .connect(user1)
        .registerSignature(signature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name.length));
      const moreEther = utils.parseEther('0.5');
      const treasuryBalanceBefore = await user1.provider.getBalance(treasury.address);
      await vanityNameRegistry.connect(user1).registerName(name, {
        value: LOCK_AMOUNT.add(registerFee).add(moreEther),
      });
      const registerTime = Number((await time.latest()).toString());
      expect(await user1.provider.getBalance(treasury.address)).to.equal(
        treasuryBalanceBefore.add(registerFee),
      );
      expect(await user1.provider.getBalance(vanityNameRegistry.address)).to.equal(
        LOCK_AMOUNT.add(moreEther),
      );
      expect(
        await vanityNameRegistry.unlockedEthers(user1.address),
      ).to.equal(moreEther);

      const record = await vanityNameRegistry.records(name);
      expect(record.owner).to.equal(user1.address);
      expect(record.maturity).to.equal(registerTime + LOCK_PERIOD);
      expect(record.lockAmount).to.equal(LOCK_AMOUNT);

      const requestSignature = await vanityNameRegistry.requestSignatures(
        user1.address,
      );
      expect(requestSignature.signature).to.equal('0x');
      expect(requestSignature.blockId).to.equal(0);
    });

    it('revert if name already owned', async () => {
      const user1Signature = await user1.signMessage(
        utils.arrayify(utils.id(name)),
      );
      await vanityNameRegistry
        .connect(user1)
        .registerSignature(user1Signature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name.length));
      await vanityNameRegistry
        .connect(user1)
        .registerName(name, { value: LOCK_AMOUNT.add(registerFee) });

      const user2Signature = await user2.signMessage(
        utils.arrayify(utils.id(name)),
      );
      await vanityNameRegistry
        .connect(user2)
        .registerSignature(user2Signature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      expect(
        vanityNameRegistry
          .connect(user2)
          .registerName(name, { value: LOCK_AMOUNT.add(registerFee) }),
      ).to.revertedWith('not expired');
    });

    it('replace deployer if previous name has been expired', async () => {
      const user1Signature = await user1.signMessage(
        utils.arrayify(utils.id(name)),
      );
      await vanityNameRegistry
        .connect(user1)
        .registerSignature(user1Signature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name.length));
      await vanityNameRegistry
        .connect(user1)
        .registerName(name, { value: LOCK_AMOUNT.add(registerFee) });

      await time.increase(LOCK_PERIOD);

      const user2Signature = await user2.signMessage(
        utils.arrayify(utils.id(name)),
      );
      await vanityNameRegistry
        .connect(user2)
        .registerSignature(user2Signature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      const tx = await vanityNameRegistry
        .connect(user2)
        .registerName(name, { value: LOCK_AMOUNT.add(registerFee) });

      expect(tx)
        .to.emit(vanityNameRegistry, 'EtherUnlocked')
        .withArgs(user1.address, name, LOCK_AMOUNT);
      const registerTime = Number((await time.latest()).toString());
      expect(
        await vanityNameRegistry.unlockedEthers(user1.address),
      ).to.equal(LOCK_AMOUNT);

      const record = await vanityNameRegistry.records(name);
      expect(record.owner).to.equal(user2.address);
      expect(record.maturity).to.equal(registerTime + LOCK_PERIOD);
      expect(record.lockAmount).to.equal(LOCK_AMOUNT);
    });
  });

  describe('#renew', () => {
    const name = 'test.eth';

    beforeEach(async () => {
      const signature = await user1.signMessage(utils.arrayify(utils.id(name)));
      await vanityNameRegistry
        .connect(user1)
        .registerSignature(signature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name.length));
      await vanityNameRegistry
        .connect(user1)
        .registerName(name, { value: LOCK_AMOUNT.add(registerFee) });
    });

    it('revert if not deployer', async () => {
      expect(vanityNameRegistry.connect(user2).renewName(name)).to.revertedWith(
        'not deployer',
      );
    });

    it('revert if not enough ether sent', async () => {
      expect(vanityNameRegistry.connect(user1).renewName(name)).to.revertedWith(
        'no enough ether',
      );
    });

    it('renew name and send fee to treasury.address', async () => {
      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name.length));
      await time.increase(LOCK_PERIOD);
      const treasuryBalanceBefore = await user1.provider.getBalance(treasury.address);
      const tx = await vanityNameRegistry
        .connect(user1)
        .renewName(name, { value: registerFee });
      expect(tx)
        .to.emit(vanityNameRegistry, 'NameRenew')
        .withArgs(user1.address, name);
      const renewTime = Number((await time.latest()).toString());
      expect(await user1.provider.getBalance(treasury.address)).to.equal(
        treasuryBalanceBefore.add(registerFee),
      );

      const record = await vanityNameRegistry.records(name);
      expect(record.owner).to.equal(user1.address);
      expect(record.maturity).to.equal(renewTime + LOCK_PERIOD);
      expect(record.lockAmount).to.equal(LOCK_AMOUNT);
    });

    it('increase unlock amount if user send more ether than required', async () => {
      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name.length));
      const moreEther = utils.parseEther('0.5');
      await time.increase(LOCK_PERIOD);
      const treasuryBalanceBefore = await user1.provider.getBalance(treasury.address);
      await vanityNameRegistry
        .connect(user1)
        .renewName(name, { value: registerFee.add(moreEther) });

      expect(await user1.provider.getBalance(treasury.address)).to.equal(
        treasuryBalanceBefore.add(registerFee),
      );

      expect(
        await vanityNameRegistry.unlockedEthers(user1.address),
      ).to.equal(moreEther);
    });

    it('renew from maturity if not expired yet', async () => {
      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name.length));
      await time.increase(LOCK_PERIOD / 2);
      let record = await vanityNameRegistry.records(name);
      const maturity = Number(record.maturity.toString());
      const treasuryBalanceBefore = await user1.provider.getBalance(treasury.address);
      await vanityNameRegistry.connect(user1).renewName(name, { value: registerFee });
      expect(await user1.provider.getBalance(treasury.address)).to.equal(
        treasuryBalanceBefore.add(registerFee),
      );

      record = await vanityNameRegistry.records(name);
      expect(record.owner).to.equal(user1.address);
      expect(record.maturity).to.equal(maturity + LOCK_PERIOD);
      expect(record.lockAmount).to.equal(LOCK_AMOUNT);
    });
  });

  describe('#unlock', () => {
    const name = 'test.eth';

    beforeEach(async () => {
      const signature = await user1.signMessage(utils.arrayify(utils.id(name)));
      await vanityNameRegistry
        .connect(user1)
        .registerSignature(signature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name.length));
      await vanityNameRegistry
        .connect(user1)
        .registerName(name, { value: LOCK_AMOUNT.add(registerFee) });
    });

    it('revert if not deployer', async () => {
      await time.increase(LOCK_PERIOD);
      expect(vanityNameRegistry.connect(user2).unlock(name)).to.revertedWith(
        'invalid deployer or not expired',
      );
    });

    it('revert if not expired', async () => {
      expect(vanityNameRegistry.connect(user1).unlock(name)).to.revertedWith(
        'invalid deployer or not expired',
      );
    });

    it('unlock ether for expired name and withdraw', async () => {
      await time.increase(LOCK_PERIOD);
      const user1BalanceBefore = await user1.provider.getBalance(
        user1.address,
      );
      const tx = await vanityNameRegistry.connect(user1).unlock(name);
      expect(tx)
        .to.emit(vanityNameRegistry, 'EtherUnlocked')
        .withArgs(user1.address, name, LOCK_AMOUNT);
      const receipt = await tx.wait(1);
      const gas = receipt.gasUsed.mul(tx.gasPrice);
      expect(
        await vanityNameRegistry.unlockedEthers(user1.address),
      ).to.equal(0);
      expect(
        await user1.provider.getBalance(user1.address),
      ).to.equal(user1BalanceBefore.add(LOCK_AMOUNT).sub(gas));

      const record = await vanityNameRegistry.records(name);
      expect(record.owner).to.equal(
        '0x0000000000000000000000000000000000000000',
      );
      expect(record.maturity).to.equal(0);
      expect(record.lockAmount).to.equal(0);
    });

    it('unlock ether for expired name and withdraw all unlocked funds', async () => {
      const name1 = 'test.eth1';
      const signature = await user1.signMessage(
        utils.arrayify(utils.id(name1)),
      );
      await vanityNameRegistry
        .connect(user1)
        .registerSignature(signature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name1.length));
      const moreEther = utils.parseEther('0.5');
      await vanityNameRegistry.connect(user1).registerName(name1, {
        value: LOCK_AMOUNT.add(registerFee).add(moreEther),
      });

      await time.increase(LOCK_PERIOD);
      const user1BalanceBefore = await user1.provider.getBalance(
        user1.address,
      );
      const tx = await vanityNameRegistry.connect(user1).unlock(name);
      const receipt = await tx.wait(1);
      const gas = receipt.gasUsed.mul(tx.gasPrice);
      expect(
        await vanityNameRegistry.unlockedEthers(user1.address),
      ).to.equal(0);
      expect(
        await user1.provider.getBalance(user1.address),
      ).to.equal(user1BalanceBefore.add(LOCK_AMOUNT).add(moreEther).sub(gas));

      const record = await vanityNameRegistry.records(name);
      expect(record.owner).to.equal(
        '0x0000000000000000000000000000000000000000',
      );
      expect(record.maturity).to.equal(0);
      expect(record.lockAmount).to.equal(0);
    });
  });

  describe('#withdrawUnlockedEther', () => {
    const name = 'test.eth';
    const moreEther = utils.parseEther('0.5');

    beforeEach(async () => {
      const signature = await user1.signMessage(utils.arrayify(utils.id(name)));
      await vanityNameRegistry
        .connect(user1)
        .registerSignature(signature, false);

      await time.advanceBlock();
      await time.advanceBlock();
      await time.advanceBlock();

      const registerFee = FEE_PER_CHAR.mul(BigNumber.from(name.length));
      await vanityNameRegistry.connect(user1).registerName(name, {
        value: LOCK_AMOUNT.add(registerFee).add(moreEther),
      });
    });

    it('revert if no ether unlocked', async () => {
      expect(vanityNameRegistry.connect(user2).withdrawUnlockedEther()).to.revertedWith(
        'no ether unlocked',
      );
    });

    it('withdraw unlocked ether', async () => {
      const user1BalanceBefore = await user1.provider.getBalance(
        user1.address,
      );
      const tx = await vanityNameRegistry.connect(user1).withdrawUnlockedEther();
      const receipt = await tx.wait(1);
      const gas = receipt.gasUsed.mul(tx.gasPrice);
      expect(
        await vanityNameRegistry.unlockedEthers(user1.address),
      ).to.equal(0);
      expect(
        await user1.provider.getBalance(user1.address),
      ).to.equal(user1BalanceBefore.add(moreEther).sub(gas));
    });
  });

  describe('#setLockPeriod', () => {
    const newLockPeriod = 3600 * 24;

    it('revert if msg.sender is not deployer', async () => {
      expect(
        vanityNameRegistry.connect(user1).setLockPeriod(newLockPeriod),
      ).to.revertedWith('Ownable: caller is not the deployer');
    });

    it('revert if amount is zero', async () => {
      expect(vanityNameRegistry.connect(deployer).setLockPeriod(0)).to.revertedWith(
        'invalid period',
      );
    });

    it('update lock period', async () => {
      await vanityNameRegistry.connect(deployer).setLockPeriod(newLockPeriod);

      expect(await vanityNameRegistry.lockPeriod()).to.equal(newLockPeriod);
    });
  });

  describe('#setLockAmount', () => {
    const newLockAmount = utils.parseEther('2');

    it('revert if msg.sender is not deployer', async () => {
      expect(
        vanityNameRegistry.connect(user1).setLockAmount(newLockAmount),
      ).to.revertedWith('Ownable: caller is not the deployer');
    });

    it('revert if amount is zero', async () => {
      expect(vanityNameRegistry.connect(deployer).setLockAmount(0)).to.revertedWith(
        'invalid amount',
      );
    });

    it('update lock amount', async () => {
      await vanityNameRegistry.connect(deployer).setLockAmount(newLockAmount);

      expect(await vanityNameRegistry.lockAmount()).to.equal(newLockAmount);
    });
  });

  describe('#setFeePerChar', () => {
    const newFeePerChar = utils.parseEther('0.1');

    it('revert if msg.sender is not deployer', async () => {
      expect(
        vanityNameRegistry.connect(user1).setFeePerChar(newFeePerChar),
      ).to.revertedWith('Ownable: caller is not the deployer');
    });

    it('update lock amount', async () => {
      await vanityNameRegistry.connect(deployer).setFeePerChar(newFeePerChar);

      expect(await vanityNameRegistry.feePerChar()).to.equal(newFeePerChar);
    });
  });

  describe('#setTreasury', () => {
    it('revert if msg.sender is not deployer', async () => {
      expect(
        vanityNameRegistry.connect(user1).setTreasury(newTreasury.address),
      ).to.revertedWith('Ownable: caller is not the deployer');
    });

    it('revert if address is zero', async () => {
      expect(
        vanityNameRegistry
          .connect(deployer)
          .setTreasury('0x0000000000000000000000000000000000000000'),
      ).to.revertedWith('invalid treasury.address');
    });

    it('update treasury', async () => {
      await vanityNameRegistry.connect(deployer).setTreasury(newTreasury.address);

      expect(await vanityNameRegistry.treasury()).to.equal(newTreasury.address);
    });
  });

  describe('#setWaitBlocks', () => {
    const newWaitBlocks = 5;

    it('revert if msg.sender is not deployer', async () => {
      expect(
        vanityNameRegistry.connect(user1).setWaitBlocks(newWaitBlocks),
      ).to.revertedWith('Ownable: caller is not the deployer');
    });

    it('update lock amount', async () => {
      await vanityNameRegistry.connect(deployer).setWaitBlocks(newWaitBlocks);

      expect(await vanityNameRegistry.waitBlocks()).to.equal(newWaitBlocks);
    });
  });
});
