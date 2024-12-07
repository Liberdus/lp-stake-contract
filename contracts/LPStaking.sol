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

    // Events
    event PairAdded(address lpToken, string platform, uint256 rewardWeight);
    event StakeAdded(address user, address lpToken, uint256 amount);
    event StakeRemoved(address user, address lpToken, uint256 amount);
    event RewardsClaimed(address user, address lpToken, uint256 amount);
    event HourlyRateUpdated(uint256 newRate);
    event WeightsUpdated(address[] pairs, uint256[] weights);
    event SignerChanged(address oldSigner, address newSigner);

    constructor(address _rewardToken, address[] memory _initialSigners) {
        require(
            _initialSigners.length == TOTAL_SIGNERS,
            "Must provide exactly 4 signers"
        );
        rewardToken = IERC20(_rewardToken);
        signers = _initialSigners;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        for (uint i = 0; i < _initialSigners.length; i++) {
            _grantRole(ADMIN_ROLE, _initialSigners[i]);
        }
    }

    function addLiquidityPair(
        address lpToken,
        string memory platform,
        uint256 rewardWeight
    ) external onlyRole(ADMIN_ROLE) {
        require(
            pairs[lpToken].lpToken == IERC20(address(0)),
            "Pair already exists"
        );

        pairs[lpToken] = LiquidityPair({
            lpToken: IERC20(lpToken),
            platform: platform,
            rewardWeight: rewardWeight,
            isActive: true
        });
        activePairs.push(lpToken);

        emit PairAdded(lpToken, platform, rewardWeight);
    }

    function stake(address lpToken, uint256 amount) external nonReentrant {}

    function unstake(address lpToken, uint256 amount) external nonReentrant {}

    function claimRewards(address lpToken) external nonReentrant {}

    function updateRewards(address user, address lpToken) internal {}

    function setHourlyRewardRate(
        uint256 newRate
    ) external onlyRole(ADMIN_ROLE) {}

    function updateRewardWeights(
        address[] calldata lpTokens,
        uint256[] calldata weights
    ) external onlyRole(ADMIN_ROLE) {
        require(lpTokens.length == weights.length, "Array lengths must match");

        for (uint i = 0; i < lpTokens.length; i++) {
            require(
                pairs[lpTokens[i]].lpToken != IERC20(address(0)),
                "Pair doesn't exist"
            );
            pairs[lpTokens[i]].rewardWeight = weights[i];
        }

        emit WeightsUpdated(lpTokens, weights);
    }

    function changeSigner(address oldSigner, address newSigner) external {}

    function getPairInfo(
        address lpToken
    )
        external
        view
        returns (
            IERC20 token,
            string memory platform,
            uint256 rewardWeight,
            bool isActive
        )
    {}

    function getUserStakeInfo(
        address user,
        address lpToken
    ) external view returns (uint256 amount, uint256 pendingRewards) {}
}
