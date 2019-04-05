const TradeSettler = artifacts.require("TradeSettler");

contract("TradeSettler", function(accounts) {
  let tradeSettler;

  before(async () => {
    tradeSettler = await TradeSettler.new();
  });

  it("settles trades");
});
