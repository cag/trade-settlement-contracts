pragma solidity ^0.5.0;

import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { IERC1155 } from "erc-1155/contracts/IERC1155.sol";
import { IERC1155TokenReceiver } from "erc-1155/contracts/IERC1155TokenReceiver.sol";
import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { ISignatureValidator } from "@gnosis.pm/safe-contracts/contracts/interfaces/ISignatureValidator.sol";

contract TradeSettler is IERC1155TokenReceiver {
    using SafeMath for uint;

    mapping(address => mapping(address => mapping(uint => uint))) internal balances;

    function balanceOf(address user, address tokenContractAddress, uint tokenId) external view returns (uint) {
        return balances[user][tokenContractAddress][tokenId];
    }

    function depositERC20(IERC20 token, uint amount) external {
        require(token.transferFrom(msg.sender, address(this), amount), "could not transfer erc20 from depositor");
        balances[msg.sender][address(token)][0] = balances[msg.sender][address(token)][0].add(amount);
    }

    function onERC1155Received(address _operator, address _from, uint256 _id, uint256 _value, bytes calldata _data) external returns(bytes4) {
        balances[_operator][msg.sender][_id] = balances[_operator][msg.sender][_id].add(_value);
        return bytes4(keccak256("onERC1155Received(address,address,uint256,uint256,bytes)"));
    }

    function onERC1155BatchReceived(address _operator, address _from, uint256[] calldata _ids, uint256[] calldata _values, bytes calldata _data) external returns(bytes4) {
        require(_ids.length == _values.length, "ids and values arrays length mismatch");

        for(uint i = 0; i < _ids.length; i++) {
            balances[_operator][msg.sender][_ids[i]] = balances[_operator][msg.sender][_ids[i]].add(_values[i]);
        }

        return bytes4(keccak256("onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)"));
    }
}
