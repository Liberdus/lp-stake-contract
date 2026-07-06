// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockFeeOnTransferERC20 is ERC20 {
    uint256 public immutable feeBps;

    constructor(
        string memory name,
        string memory symbol,
        uint256 _feeBps
    ) ERC20(name, symbol) {
        require(_feeBps <= 10_000, "Invalid fee");
        feeBps = _feeBps;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || feeBps == 0) {
            super._update(from, to, value);
            return;
        }

        uint256 fee = (value * feeBps) / 10_000;
        uint256 net = value - fee;

        super._update(from, to, net);
        if (fee > 0) {
            super._update(from, address(0), fee);
        }
    }
}
