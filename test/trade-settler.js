const assert = require("assert");
const TradeSettler = artifacts.require("TradeSettler");
const MockERC20 = artifacts.require("MockERC20");
const MockERC1155 = artifacts.require("MockERC1155");

const { eth } = web3;
const { toBN, randomHex, keccak256, getSignatureParameters } = require('web3-utils');

contract("TradeSettler", function(accounts) {
  const [
    operator,
    erc20Minter,
    erc1155Minter,
    erc20Trader,
    erc1155Trader
  ] = accounts;
  const numTokenIds = 10;
  const tokenIds = [];
  let tradeSettler, erc20, erc1155;

  before(async () => {
    tradeSettler = await TradeSettler.new({ from: operator });
    erc20 = await MockERC20.new({ from: erc20Minter });
    erc1155 = await MockERC1155.new();
    for (let i = 0; i < numTokenIds; i++) {
      await erc1155.create(0, "", { from: erc1155Minter });
      tokenIds.push(await erc1155.nonce());
    }
  });

  it("allows users to deposit ERC20 tokens", async () => {
    const amount = toBN(1e18);

    assert.equal(await erc20.balanceOf(erc20Trader), 0);
    await erc20.mint(erc20Trader, amount, { from: erc20Minter });
    assert.equal(await erc20.balanceOf(erc20Trader), amount.toString());

    assert.equal(await erc20.balanceOf(tradeSettler.address), 0);
    await erc20.approve(tradeSettler.address, amount, { from: erc20Trader });
    await tradeSettler.depositERC20(erc20.address, amount, {
      from: erc20Trader
    });
    assert.equal(await erc20.balanceOf(erc20Trader), 0);
    assert.equal(
      await erc20.balanceOf(tradeSettler.address),
      amount.toString()
    );
    assert.equal(
      await tradeSettler.balanceOf(erc20Trader, erc20.address, 0),
      amount.toString()
    );
  });

  it("allows users to deposit ERC1155 tokens", async () => {
    async function assert1155BalancesEqual(account, ids, amount) {
      assert.deepEqual(
        await erc1155
          .balanceOfBatch(Array(ids.length).fill(account), ids)
          .then(vals => vals.map(v => v.toString())),
        Array(ids.length).fill(amount.toString())
      );
    }

    const amount = toBN(1e18);

    await assert1155BalancesEqual(erc1155Trader, tokenIds, 0);
    await Promise.all(
      tokenIds.map(id =>
        erc1155.mint(id, [erc1155Trader], [amount], { from: erc1155Minter })
      )
    );
    await assert1155BalancesEqual(erc1155Trader, tokenIds, amount);

    const [singleTokenId, ...multipleTokenIds] = tokenIds;

    await erc1155.safeTransferFrom(
      erc1155Trader,
      tradeSettler.address,
      singleTokenId,
      amount,
      "0x",
      { from: erc1155Trader }
    );
    assert.equal(await erc1155.balanceOf(erc1155Trader, singleTokenId), 0);
    assert.equal(
      await erc1155.balanceOf(tradeSettler.address, singleTokenId),
      amount.toString()
    );
    assert.equal(
      await tradeSettler.balanceOf(
        erc1155Trader,
        erc1155.address,
        singleTokenId
      ),
      amount.toString()
    );

    await erc1155.safeBatchTransferFrom(
      erc1155Trader,
      tradeSettler.address,
      multipleTokenIds,
      multipleTokenIds.map(() => amount),
      "0x",
      { from: erc1155Trader }
    );
    await assert1155BalancesEqual(erc1155Trader, multipleTokenIds, 0);
    await assert1155BalancesEqual(
      tradeSettler.address,
      multipleTokenIds,
      amount
    );
    for (const id of multipleTokenIds) {
      assert.equal(
        await tradeSettler.balanceOf(erc1155Trader, erc1155.address, id),
        amount.toString()
      );
    }
  });

  it("allows the operator (owner) to post withdrawal requests from EOAs", async () => {
    const amount = toBN(1e18);

    assert.equal(await tradeSettler.DEBUGtestSignedMessages2(erc20.address, amount, randomHex(65), erc20Trader), false)

    const signature = (await eth.sign(eth.abi.encodeParameters(
      ['address', 'uint'],
      [erc20.address, amount.toString()],
    ), erc20Trader)).replace(/00$/, '1b').replace(/01$/, '1c')

    assert(await tradeSettler.DEBUGtestSignedMessages2(erc20.address, amount, signature, erc20Trader))
  })
});
