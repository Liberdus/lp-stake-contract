// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract LPStaking is ReentrancyGuard, AccessControl {
    using SafeERC20 for IERC20;

    // Constants
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    uint256 public constant PRECISION = 1e18;
    uint256 public constant MIN_SIGNERS = 3;
    uint256 public constant TOTAL_SIGNERS = 4;

    // Structs
    struct LiquidityPair {
        IERC20 lpToken;
        string platform; // Platform name (e.g., "Uniswap-V2")
        uint256 rewardWeight; // Reward weight for this pair
        bool isActive;
    }

    struct UserStake {
        uint256 amount;
        uint256 lastRewardTime; // Last time rewards were calculated
        uint256 pendingRewards; // Accumulated rewards not yet claimed
    }

    // State variables
    IERC20 public rewardToken;
    uint256 public hourlyRewardRate;
    mapping(address => LiquidityPair) public pairs; // LP token address => Pair info
    mapping(address => mapping(address => UserStake)) public userStakes; // user => lpToken => stake
    address[] public activePairs;
    address[] public signers;

    constructor(address _rewardToken, address[] memory _initialSigners) {
        require(
            _initialSigners.length == TOTAL_SIGNERS,
            "Must provide exactly 5 signers"
        );
        rewardToken = IERC20(_rewardToken);
        signers = _initialSigners;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        for (uint i = 0; i < _initialSigners.length; i++) {
            _grantRole(ADMIN_ROLE, _initialSigners[i]);
        }
    }
}
