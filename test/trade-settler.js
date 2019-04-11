const assert = require("assert");
const ethSigUtil = require("eth-sig-util");
const Web3 = require("web3");
const TradeSettler = artifacts.require("TradeSettler");
const MockERC20 = artifacts.require("MockERC20");
const MockERC1155 = artifacts.require("MockERC1155");

web3 = new Web3(web3.currentProvider);
const { eth } = web3;
const {
  toBN,
  hexToBytes,
  randomHex,
  keccak256,
  getSignatureParameters
} = web3.utils;

const getPrivateKey = account =>
  Buffer.from(
    {
      "0x90f8bf6a479f320ead074411a4b0e7944ea8c9c1":
        "4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d",
      "0xffcf8fdee72ac11b5c542428b35eef5769c409f0":
        "6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1",
      "0x22d491bde2303f2f43325b2108d26f1eaba1e32b":
        "6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c",
      "0xe11ba2b4d45eaed5996cd0823791e0c93114882d":
        "646f1ce2fdad0e6deeeb5c7e8e5543bdde65e86029e2fd9fc169899c440a7913",
      "0xd03ea8624c8c5987235048901fb614fdca89b117":
        "add53f9a7e588d003326d1cbf9e4a43c061aadd9bc938c843a79e7b4fd2ad743",
      "0x95ced938f7991cd0dfcb48f0a06a40fa1af46ebc":
        "395df67f0c2d2d9fe1ad08d1bc8b6627011959b79c53d7dd6a3536a33ab8a4fd",
      "0x3e5e9111ae8eb78fe1cc3bb8915d5d461f3ef9a9":
        "e485d098507f54e7733a205420dfddbe58db035fa577fc294ebd14db90767a52",
      "0x28a8746e75304c0780e011bed21c72cd78cd535e":
        "a453611d9419d0e56f499079478fd72c37b251a94bfde4d19872c44cf65386e3",
      "0xaca94ef8bd5ffee41947b4585a84bda5a3d3da6e":
        "829e924fdf021ba3dbbc4225edfece9aca04b929d6e75613329ca6f1d31c0bb4",
      "0x1df62f291b2e969fb0849d99d9ce41e2f137006e":
        "b0057716d5917badaf911b193b12b910811c1497b5bada8d7711f758981c3773"
    }[account.toLowerCase()],
    "hex"
  );

const typedDataCommon = {
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" }
      // { name: 'chainId', type: 'uint' },
      // { name: 'verifyingContract', type: 'address' },
    ],
    WithdrawERC20: [{ name: "amount", type: "uint" }]
  },
  domain: {
    name: "TradeSettler",
    version: "0.1"
    // chainId: await eth.getChainId(),
    // verifyingContract: tradeSettler.address,
  }
};

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

    assert.equal(
      await tradeSettler.DEBUGtestSignedMessages2(
        erc20.address,
        amount,
        randomHex(65),
        erc20Trader
      ),
      false
    );

    const signature = ethSigUtil.signTypedData(getPrivateKey(erc20Trader), {
      data: Object.assign(
        {
          primaryType: "WithdrawERC20",
          message: {
            amount
          }
        },
        typedDataCommon
      )
    });

    assert(
      await tradeSettler.DEBUGtestSignedMessages2(
        erc20.address,
        amount,
        signature,
        erc20Trader
      )
    );
  });
});
