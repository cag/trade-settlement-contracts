const assert = require("assert");
const ethSigUtil = require("eth-sig-util");
const Web3 = require("web3");
const PredictionExchange = artifacts.require("PredictionExchange");
const PredictionMarketSystem = artifacts.require("PredictionMarketSystem");
const MockERC20 = artifacts.require("MockERC20");
const GnosisSafe = artifacts.require("GnosisSafe")

web3 = new Web3(web3.currentProvider);
const { eth } = web3;
const {
  toBN,
  hexToBytes,
  randomHex,
  keccak256,
  soliditySha3,
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

const predictionExchangeTypedDataCommon = {
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" }
      // { name: 'chainId', type: 'uint' },
      // { name: 'verifyingContract', type: 'address' },
    ],
    WithdrawCollateral: [
      { name: "nonce", type: "uint" },
      { name: "collateralToken", type: "address" },
      { name: "amount", type: "uint" }
    ]
  },
  domain: {
    name: "PredictionExchange",
    version: "0.1"
    // chainId: await eth.getChainId(),
    // verifyingContract: predictionExchange.address,
  }
};

const safeOperations = {
  CALL: 0,
  DELEGATECALL: 1,
  CREATE: 2
}

contract("PredictionExchange", function(accounts) {
  const [
    operator,
    minter,
    oracle,
    trader1,
    trader2,
    safeOwner1,
    safeOwner2,
    safeExecutor,
  ] = accounts;

  const questionId = randomHex(32)
  const outcomeSlotCount = 2
  const conditionId = soliditySha3(
    {t: 'address', v: oracle},
    {t: 'bytes32', v: questionId},
    {t: 'uint', v: outcomeSlotCount},
  )
  const partition = [0b01, 0b10]
  const collectionIds = partition.map(indexSet => soliditySha3(
    {t: 'bytes32', v: conditionId},
    {t: 'uint', v: indexSet},
  ))
  const safeOwners = [safeOwner1, safeOwner2]
  safeOwners.sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a === b ? 0 : 1)
  const zeroAccount = `0x${'0'.repeat(40)}`

  let predictionExchange, collateralToken, predictionMarketSystem, positionIds, gnosisSafe, gnosisSafeTypedDataCommon;
  before(async () => {
    collateralToken = await MockERC20.new({ from: minter });
    predictionMarketSystem = await PredictionMarketSystem.new()
    predictionExchange = await PredictionExchange.new(predictionMarketSystem.address, { from: operator });

    await predictionMarketSystem.prepareCondition(oracle, questionId, outcomeSlotCount)
    positionIds = collectionIds.map(collectionId => soliditySha3(
      {t: 'address', v: collateralToken.address},
      {t: 'bytes32', v: collectionId},
    ))

    gnosisSafe = await GnosisSafe.new()
    await gnosisSafe.setup([safeOwner1, safeOwner2], 2, zeroAccount, "0x", zeroAccount, 0, zeroAccount)
    gnosisSafeTypedDataCommon = {
      types: {
        EIP712Domain: [
          { name: 'verifyingContract', type: 'address' }
        ],
        SafeTx: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
          { name: 'operation', type: 'uint8' },
          { name: 'safeTxGas', type: 'uint256' },
          { name: 'baseGas', type: 'uint256' },
          { name: 'gasPrice', type: 'uint256' },
          { name: 'gasToken', type: 'address' },
          { name: 'refundReceiver', type: 'address' },
          { name: 'nonce', type: 'uint256' },
        ],
        SafeMessage: [
          { name: 'message', type: 'bytes' }
        ]
      },
      domain: {
        verifyingContract: gnosisSafe.address,
      }
    }
  });

  it("allows users to deposit collateral tokens", async () => {
    const amount = toBN(1e18);

    assert.equal(await collateralToken.balanceOf(trader1), 0);
    await collateralToken.mint(trader1, amount, { from: minter });
    assert.equal(await collateralToken.balanceOf(trader1), amount.toString());

    assert.equal(await collateralToken.balanceOf(predictionExchange.address), 0);
    await collateralToken.approve(predictionExchange.address, amount, { from: trader1 });
    await predictionExchange.depositCollateral(collateralToken.address, amount, {
      from: trader1
    });
    assert.equal(await collateralToken.balanceOf(trader1), 0);
    assert.equal(
      await collateralToken.balanceOf(predictionExchange.address),
      amount.toString()
    );
    assert.equal(
      await predictionExchange.balanceOf(trader1, collateralToken.address, 0),
      amount.toString()
    );
  });

  it("allows users to deposit prediction market tokens", async () => {
    async function assert1155BalancesEqual(account, ids, amount) {
      assert.deepEqual(
        await predictionMarketSystem
          .balanceOfBatch(Array(ids.length).fill(account), ids)
          .then(vals => vals.map(v => v.toString())),
        Array(ids.length).fill(amount.toString())
      );
    }

    const amount = toBN(1e18);

    await assert1155BalancesEqual(trader2, positionIds, 0);
    await collateralToken.mint(trader2, amount, { from: minter });
    await collateralToken.approve(predictionMarketSystem.address, amount, {from: trader2})
    await predictionMarketSystem.splitPosition(collateralToken.address, '0x', conditionId, partition, amount, {from:trader2})
    await assert1155BalancesEqual(trader2, positionIds, amount);

    const [singlePositionId, ...multiplePositionIds] = positionIds;

    await predictionMarketSystem.safeTransferFrom(
      trader2,
      predictionExchange.address,
      singlePositionId,
      amount,
      "0x",
      { from: trader2 }
    );
    assert.equal(await predictionMarketSystem.balanceOf(trader2, singlePositionId), 0);
    assert.equal(
      await predictionMarketSystem.balanceOf(predictionExchange.address, singlePositionId),
      amount.toString()
    );
    assert.equal(
      await predictionExchange.balanceOf(
        trader2,
        predictionMarketSystem.address,
        singlePositionId
      ),
      amount.toString()
    );

    await predictionMarketSystem.safeBatchTransferFrom(
      trader2,
      predictionExchange.address,
      multiplePositionIds,
      multiplePositionIds.map(() => amount),
      "0x",
      { from: trader2 }
    );
    await assert1155BalancesEqual(trader2, multiplePositionIds, 0);
    await assert1155BalancesEqual(
      predictionExchange.address,
      multiplePositionIds,
      amount
    );
    for (const id of multiplePositionIds) {
      assert.equal(
        await predictionExchange.balanceOf(trader2, predictionMarketSystem.address, id),
        amount.toString()
      );
    }
  });

  it("allows the operator (owner) to post collateral withdrawal requests from EOAs", async () => {
    const amount = toBN(1e18);

    await assert.rejects(
      predictionExchange.withdrawCollateral(
        collateralToken.address,
        amount,
        randomHex(65),
        trader1,
        { from: operator }
      ),
      /signature does not match/
    );

    const signature = ethSigUtil.signTypedData(getPrivateKey(trader1), {
      data: Object.assign(
        {
          primaryType: "WithdrawCollateral",
          message: {
            nonce: await predictionExchange.getNonce(trader1),
            collateralToken: collateralToken.address,
            amount
          }
        },
        predictionExchangeTypedDataCommon
      )
    });

    await assert.rejects(
      predictionExchange.withdrawCollateral(
        collateralToken.address,
        amount,
        signature,
        trader1,
        { from: trader1 }
      ),
      /revert/
    );

    assert.equal(
      await predictionExchange.balanceOf(trader1, collateralToken.address, "0x"),
      amount.toString()
    );

    assert.equal(await collateralToken.balanceOf(trader1), 0);

    await predictionExchange.withdrawCollateral(
      collateralToken.address,
      amount,
      signature,
      trader1
    );

    assert.equal(
      await predictionExchange.balanceOf(trader1, collateralToken.address, "0x"),
      0
    );

    assert.equal(await collateralToken.balanceOf(trader1), amount.toString());
  });

  it("allows the operator (owner) to post collateral withdrawal requests from contracts", async () => {
    async function gnosisSafeCall(contract, method, ...args) {
      const nonce = await gnosisSafe.nonce()
      const txData = contract.contract.methods[method](...args).encodeABI()
      const signatures = safeOwners.map(safeOwner => ethSigUtil.signTypedData(getPrivateKey(safeOwner), {
        data: Object.assign(
          {
            primaryType: "SafeTx",
            message: {
              to: contract.address,
              value: 0,
              data: txData,
              operation: safeOperations.CALL,
              safeTxGas: 0,
              baseGas: 0,
              gasPrice: 0,
              gasToken: zeroAccount,
              refundReceiver: zeroAccount,
              nonce,
            }
          },
          gnosisSafeTypedDataCommon
        )
      }));
      return await gnosisSafe.execTransaction(
        contract.address,
        0,
        txData,
        safeOperations.CALL,
        0,
        0,
        0,
        zeroAccount,
        zeroAccount,
        `0x${ signatures.map(s => s.replace('0x', '')).join('') }`,
        { from: safeExecutor }
      )
    }

    const amount = toBN(1e18);
    assert.equal(await collateralToken.balanceOf(gnosisSafe.address), 0);
    await collateralToken.mint(gnosisSafe.address, amount, { from: minter });
    assert.equal(await collateralToken.balanceOf(gnosisSafe.address), amount.toString());

    await gnosisSafeCall(collateralToken, 'approve', predictionExchange.address, amount.toString())
    await gnosisSafeCall(predictionExchange, 'depositCollateral', collateralToken.address, amount.toString())
    assert.equal(await collateralToken.balanceOf(gnosisSafe.address), 0);

    const nonce = await predictionExchange.getNonce(gnosisSafe.address)
    const signatures = safeOwners.map(safeOwner => ethSigUtil.signTypedData(getPrivateKey(safeOwner), {
      data: Object.assign(
        {
          primaryType: "SafeMessage",
          message: {
            message: `0x${Buffer.concat([
              Buffer.from('1901', 'hex'),
              ethSigUtil.TypedDataUtils.hashStruct('EIP712Domain', predictionExchangeTypedDataCommon.domain, predictionExchangeTypedDataCommon.types),
              ethSigUtil.TypedDataUtils.hashStruct("WithdrawCollateral", {
                nonce,
                collateralToken: collateralToken.address,
                amount
              }, predictionExchangeTypedDataCommon.types)
            ]).toString('hex')}`
          }
        },
        gnosisSafeTypedDataCommon
      )
    }));

    await predictionExchange.withdrawCollateral(
      collateralToken.address,
      amount,
      `0x${ signatures.map(s => s.replace('0x', '')).join('') }`,
      gnosisSafe.address,
      { from: operator }
    )

    assert.equal(await collateralToken.balanceOf(gnosisSafe.address), amount.toString());
  })
});
