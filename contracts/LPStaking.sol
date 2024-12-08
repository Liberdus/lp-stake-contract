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
    uint256 public constant MAX_WEIGHT = 10000; // Max weight to prevent overflow
    uint256 public constant MIN_STAKE = 1e15; // Minimum stake amount
    uint256 public constant MAX_PAIRS = 100; // Maximum number of LP pairs

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
        string calldata platform,
        uint256 rewardWeight
    ) external onlyRole(ADMIN_ROLE) {
        require(
            pairs[lpToken].lpToken == IERC20(address(0)),
            "Pair already exists"
        );
        require(activePairs.length < MAX_PAIRS, "Too many pairs");
        require(rewardWeight <= MAX_WEIGHT, "Weight too high");
        require(bytes(platform).length <= 32, "Platform name too long");

        pairs[lpToken] = LiquidityPair({
            lpToken: IERC20(lpToken),
            platform: platform,
            rewardWeight: rewardWeight,
            isActive: true
        });
        activePairs.push(lpToken);

        emit PairAdded(lpToken, platform, rewardWeight);
    }

    function stake(address lpToken, uint256 amount) external nonReentrant {
        LiquidityPair storage pair = pairs[lpToken];
        require(pair.isActive, "Pair not active");
        require(pair.rewardWeight > 0, "Pair has zero weight");
        require(amount >= MIN_STAKE, "Stake amount too low");
        require(amount <= type(uint128).max, "Stake amount too high");

        updateRewards(msg.sender, lpToken);

        UserStake storage userStake = userStakes[msg.sender][lpToken];
        userStake.amount += amount;
        userStake.lastRewardTime = uint64(block.timestamp);

        IERC20(lpToken).safeTransferFrom(msg.sender, address(this), amount);
        emit StakeAdded(msg.sender, lpToken, amount);
    }

    function unstake(address lpToken, uint256 amount) external nonReentrant {
        LiquidityPair storage pair = pairs[lpToken];
        require(pair.isActive, "Pair not active");

        UserStake storage userStake = userStakes[msg.sender][lpToken];
        require(userStake.amount >= amount, "Insufficient stake");

        updateRewards(msg.sender, lpToken);

        userStake.amount -= amount;
        IERC20(lpToken).safeTransfer(msg.sender, amount);

        emit StakeRemoved(msg.sender, lpToken, amount);
    }

    function claimRewards(address lpToken) external nonReentrant {
        LiquidityPair storage pair = pairs[lpToken];
        require(pair.isActive, "Pair not active");

        updateRewards(msg.sender, lpToken);

        UserStake storage userStake = userStakes[msg.sender][lpToken];
        uint256 rewards = userStake.pendingRewards;
        require(rewards > 0, "No rewards to claim");

        userStake.pendingRewards = 0;
        rewardToken.safeTransfer(msg.sender, rewards);

        emit RewardsClaimed(msg.sender, lpToken, rewards);
    }

    function updateRewards(address user, address lpToken) internal {
        UserStake storage userStake = userStakes[user][lpToken];
        LiquidityPair storage pair = pairs[lpToken];

        if (userStake.amount > 0) {
            uint256 timeElapsed = block.timestamp - userStake.lastRewardTime;
            if (timeElapsed > 0) {
                uint256 totalLPSupply = IERC20(lpToken).balanceOf(
                    address(this)
                );
                if (totalLPSupply > 0) {
                    uint256 rewards = (hourlyRewardRate *
                        timeElapsed *
                        pair.rewardWeight) / 3600;
                    rewards =
                        (rewards * userStake.amount) /
                        (totalLPSupply * PRECISION);

                    if (rewards > 0 && rewards < type(uint128).max) {
                        userStake.pendingRewards += uint128(rewards);
                    }
                }
            }
        }
        userStake.lastRewardTime = uint64(block.timestamp);
    }

    function setHourlyRewardRate(
        uint256 newRate
    ) external onlyRole(ADMIN_ROLE) {
        require(newRate <= type(uint128).max, "Rate too high");
        hourlyRewardRate = newRate;
        emit HourlyRateUpdated(newRate);
    }

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

    function changeSigner(address oldSigner, address newSigner) external {
        require(hasRole(ADMIN_ROLE, msg.sender), "Not authorized");
        require(hasRole(ADMIN_ROLE, oldSigner), "Old signer not found");
        require(!hasRole(ADMIN_ROLE, newSigner), "New signer already exists");
        require(newSigner != address(0), "Invalid new signer");

        _revokeRole(ADMIN_ROLE, oldSigner);
        _grantRole(ADMIN_ROLE, newSigner);

        // Update signers array
        for (uint i = 0; i < signers.length; i++) {
            if (signers[i] == oldSigner) {
                signers[i] = newSigner;
                break;
            }
        }

        emit SignerChanged(oldSigner, newSigner);
    }

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
    {
        LiquidityPair storage pair = pairs[lpToken];
        return (pair.lpToken, pair.platform, pair.rewardWeight, pair.isActive);
    }

    function getUserStakeInfo(
        address user,
        address lpToken
    ) external view returns (uint256 amount, uint256 pendingRewards) {
        return (
            userStakes[user][lpToken].amount,
            userStakes[user][lpToken].pendingRewards
        );
    }
}
