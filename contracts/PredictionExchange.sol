pragma solidity ^0.5.0;

import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { Address } from "openzeppelin-solidity/contracts/utils/Address.sol";
import { ECDSA } from "openzeppelin-solidity/contracts/cryptography/ECDSA.sol";
import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { IERC1155TokenReceiver } from "erc-1155/contracts/IERC1155TokenReceiver.sol";
import { ISignatureValidator } from "@gnosis.pm/safe-contracts/contracts/interfaces/ISignatureValidator.sol";
import { PredictionMarketSystem } from "@gnosis.pm/hg-contracts/contracts/PredictionMarketSystem.sol";
import { Ownable } from "openzeppelin-solidity/contracts/ownership/Ownable.sol";

contract PredictionExchange is IERC1155TokenReceiver, Ownable {
    bytes32 constant DOMAIN_SEPARATOR = keccak256(abi.encode(
        keccak256("EIP712Domain(string name,string version)"),
        keccak256("PredictionExchange"),
        keccak256("0.1")
    ));

    using SafeMath for uint;

    PredictionMarketSystem public pmSystem;
    mapping(address => mapping(address => mapping(uint => uint))) internal balances;
    mapping(address => uint) internal lastNonces;

    constructor(PredictionMarketSystem _pmSystem) public {
        pmSystem = _pmSystem;
    }

    function balanceOf(address user, address collateralToken, uint positionId) external view returns (uint) {
        return balances[user][collateralToken][positionId];
    }

    function depositCollateral(IERC20 token, uint amount) external {
        require(token.transferFrom(msg.sender, address(this), amount), "could not transfer collateral from depositor");
        balances[msg.sender][address(token)][0] = balances[msg.sender][address(token)][0].add(amount);
    }

    function onERC1155Received(address _operator, address _from, uint256 _id, uint256 _value, bytes calldata _data) external returns(bytes4) {
        require(msg.sender == address(pmSystem), "wrong ERC1155 contract");
        balances[_operator][msg.sender][_id] = balances[_operator][msg.sender][_id].add(_value);
        return bytes4(keccak256("onERC1155Received(address,address,uint256,uint256,bytes)"));
    }

    function onERC1155BatchReceived(address _operator, address _from, uint256[] calldata _ids, uint256[] calldata _values, bytes calldata _data) external returns(bytes4) {
        require(msg.sender == address(pmSystem), "wrong ERC1155 contract");
        require(_ids.length == _values.length, "ids and values arrays length mismatch");

        for(uint i = 0; i < _ids.length; i++) {
            balances[_operator][msg.sender][_ids[i]] = balances[_operator][msg.sender][_ids[i]].add(_values[i]);
        }

        return bytes4(keccak256("onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)"));
    }

    function getNonce(address user) external view returns (uint) {
        return lastNonces[user] + 1;
    }

    function withdraw(address collateralToken, uint positionId, uint amount, bytes calldata signature, address signer) external onlyOwner {
        bytes memory data = abi.encodePacked(
            "\x19\x01", DOMAIN_SEPARATOR,
            keccak256(abi.encode(
                keccak256("Withdraw(uint nonce,address collateralToken,uint positionId,uint amount)"),
                ++lastNonces[signer],
                collateralToken,
                positionId,
                amount
            ))
        );
        if(Address.isContract(signer)) {
            require(ISignatureValidator(signer).isValidSignature(data, signature) == bytes4(keccak256("isValidSignature(bytes,bytes)")), "contract signature invalid");
        } else {
            require(signer == ECDSA.recover(keccak256(data), signature), "signature does not match");
        }

        require(balances[signer][collateralToken][positionId] >= amount, "not enough deposited by user");
        balances[signer][collateralToken][positionId] -= amount;

        if(positionId == 0)
            require(IERC20(collateralToken).transfer(signer, amount), "withdrawal transfer failed");
        else
            pmSystem.safeTransferFrom(address(this), signer, positionId, amount, "");
    }
}
