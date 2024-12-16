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
    uint256 public constant MAX_WEIGHT = 1e21; // weight 1000 precision 1e18
    uint256 public constant MIN_STAKE = 1e15; // 1e15 precision 1e18
    uint256 public constant MAX_PAIRS = 100;
    uint256 public constant REQUIRED_APPROVALS = 1;
    uint256 private constant SECONDS_PER_HOUR = 3600;

    // Structs
    struct LiquidityPair {
        IERC20 lpToken;
        string pairName;
        string platform;
        uint256 weight;
        bool isActive;
    }

    struct UserStake {
        uint256 amount;
        uint256 lastRewardTime;
        uint256 pendingRewards;
    }

    enum ActionType {
        SET_HOURLY_REWARD_RATE,
        UPDATE_PAIR_WEIGHTS,
        ADD_PAIR,
        REMOVE_PAIR,
        CHANGE_SIGNER
    }

    struct PendingAction {
        ActionType actionType;
        uint256 newHourlyRewardRate;
        address[] pairs;
        uint256[] weights;
        address pairToAdd;
        string pairNameToAdd;
        string platformToAdd;
        uint256 weightToAdd;
        address pairToRemove;
        bool executed;
        uint8 approvals;
        mapping(address => bool) approvedBy;
    }

    // State variables
    IERC20 public rewardToken;
    uint256 public hourlyRewardRate;
    mapping(address => LiquidityPair) public pairs;
    mapping(address => mapping(address => UserStake)) public userStakes;
    address[] public activePairs;
    address[] public signers;

    uint256 public totalWeight;
    uint256 public actionCounter;
    mapping(uint256 => PendingAction) public actions;

    // Events
    event PairAdded(address lpToken, string platform, uint256 weight);
    event PairRemoved(address lpToken);
    event StakeAdded(address user, address lpToken, uint256 amount);
    event StakeRemoved(address user, address lpToken, uint256 amount);
    event RewardsClaimed(address user, address lpToken, uint256 amount);
    event HourlyRateUpdated(uint256 newRate);
    event WeightsUpdated(address[] pairs, uint256[] weights);
    event SignerChanged(address oldSigner, address newSigner);
    event ActionProposed(
        uint256 actionId,
        address proposer,
        ActionType actionType
    );
    event ActionApproved(uint256 actionId, address approver);
    event ActionExecuted(uint256 actionId);
    event RewardsWithdrawn(address recipient, uint256 amount);

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

    function withdrawRewards(address recipient, uint256 amount) external onlyRole(ADMIN_ROLE) {
        require(recipient != address(0), "Invalid recipient address");
        require(amount > 0, "Amount must be greater than zero");

        rewardToken.safeTransfer(recipient, amount);
        emit RewardsWithdrawn(recipient, amount);
    }

    function proposeSetHourlyRewardRate(
        uint256 newRate
    ) external onlyRole(ADMIN_ROLE) returns (uint256) {
        updateAllRewards();
        actionCounter++;
        PendingAction storage pa = actions[actionCounter];
        pa.actionType = ActionType.SET_HOURLY_REWARD_RATE;
        pa.newHourlyRewardRate = newRate;

        emit ActionProposed(
            actionCounter,
            msg.sender,
            ActionType.SET_HOURLY_REWARD_RATE
        );
        _approveActionInternal(actionCounter);
        return actionCounter;
    }

    function proposeUpdatePairWeights(
        address[] calldata lpTokens,
        uint256[] calldata weights
    ) external onlyRole(ADMIN_ROLE) returns (uint256) {
        require(lpTokens.length == weights.length, "Array lengths must match");
        updateAllRewards();
        actionCounter++;
        PendingAction storage pa = actions[actionCounter];
        pa.actionType = ActionType.UPDATE_PAIR_WEIGHTS;
        pa.pairs = lpTokens;
        pa.weights = weights;

        emit ActionProposed(
            actionCounter,
            msg.sender,
            ActionType.UPDATE_PAIR_WEIGHTS
        );
        _approveActionInternal(actionCounter);
        return actionCounter;
    }

    function updateAllRewards() internal {
        for (uint i = 0; i < activePairs.length; i++) {
            address lpToken = activePairs[i];
            uint256 totalSupply = IERC20(lpToken).balanceOf(address(this));

            if (totalSupply > 0) {
                for (uint j = 0; j < activePairs.length; j++) {
                    address user = activePairs[j];
                    updateRewards(user, lpToken);
                }
            }
        }
    }

    function proposeAddPair(
        address lpToken,
        string calldata pairName,
        string calldata platform,
        uint256 weight
    ) external onlyRole(ADMIN_ROLE) returns (uint256) {
        require(lpToken != address(0), "Invalid pair");
        actionCounter++;
        PendingAction storage pa = actions[actionCounter];
        pa.actionType = ActionType.ADD_PAIR;
        pa.pairToAdd = lpToken;
        pa.pairNameToAdd = pairName;
        pa.platformToAdd = platform;
        pa.weightToAdd = weight;

        emit ActionProposed(actionCounter, msg.sender, ActionType.ADD_PAIR);
        _approveActionInternal(actionCounter);
        return actionCounter;
    }

    function proposeRemovePair(address lpToken)
        external
        onlyRole(ADMIN_ROLE)
        returns (uint256)
    {
        require(pairs[lpToken].isActive, "Pair not active or doesn't exist");

        actionCounter++;
        PendingAction storage pa = actions[actionCounter];
        pa.actionType = ActionType.REMOVE_PAIR;
        pa.pairToRemove = lpToken;

        emit ActionProposed(actionCounter, msg.sender, ActionType.REMOVE_PAIR);
        _approveActionInternal(actionCounter);
        return actionCounter;
    }

    function approveAction(uint256 actionId) external onlyRole(ADMIN_ROLE) {
        require(actionId > 0 && actionId <= actionCounter, "Invalid actionId");
        _approveActionInternal(actionId);
    }

    function _approveActionInternal(uint256 actionId) internal {
        PendingAction storage pa = actions[actionId];
        require(!pa.executed, "Already executed");
        require(!pa.approvedBy[msg.sender], "Already approved");
        pa.approvedBy[msg.sender] = true;
        pa.approvals++;
        emit ActionApproved(actionId, msg.sender);
    }

    function executeAction(uint256 actionId) external onlyRole(ADMIN_ROLE) {
        require(actionId > 0 && actionId <= actionCounter, "Invalid actionId");
        PendingAction storage pa = actions[actionId];
        require(!pa.executed, "Already executed");
        require(pa.approvals >= REQUIRED_APPROVALS, "Not enough approvals");

        if (pa.actionType == ActionType.SET_HOURLY_REWARD_RATE) {
            hourlyRewardRate = pa.newHourlyRewardRate;
            emit HourlyRateUpdated(hourlyRewardRate);
        } else if (pa.actionType == ActionType.UPDATE_PAIR_WEIGHTS) {
            uint256 len = pa.pairs.length;
            totalWeight = 0;
            for (uint i = 0; i < len; i++) {
                require(
                    pairs[pa.pairs[i]].lpToken != IERC20(address(0)),
                    "Pair doesn't exist"
                );
                pairs[pa.pairs[i]].weight = pa.weights[i];
            }
            for (uint j = 0; j < activePairs.length; j++) {
                totalWeight += pairs[activePairs[j]].weight;
            }
            emit WeightsUpdated(pa.pairs, pa.weights);
        } else if (pa.actionType == ActionType.ADD_PAIR) {
            require(
                pairs[pa.pairToAdd].lpToken == IERC20(address(0)),
                "Pair already exists"
            );
            require(activePairs.length < MAX_PAIRS, "Too many pairs");
            require(pa.weightToAdd <= MAX_WEIGHT, "Weight too high");
            require(
                bytes(pa.platformToAdd).length <= 32,
                "Platform name too long"
            );

            pairs[pa.pairToAdd] = LiquidityPair({
                lpToken: IERC20(pa.pairToAdd),
                pairName: pa.pairNameToAdd,
                platform: pa.platformToAdd,
                weight: pa.weightToAdd,
                isActive: true
            });
            activePairs.push(pa.pairToAdd);
            totalWeight += pa.weightToAdd;
            emit PairAdded(pa.pairToAdd, pa.platformToAdd, pa.weightToAdd);
        } else if (pa.actionType == ActionType.REMOVE_PAIR) {
            address lpToken = pa.pairToRemove;
            require(pairs[lpToken].isActive, "Pair not active");
            
            totalWeight -= pairs[lpToken].weight;
            
            pairs[lpToken].isActive = false;
            pairs[lpToken].weight = 0;

            _removeActivePair(lpToken);

            emit PairRemoved(lpToken);
        } else if (pa.actionType == ActionType.CHANGE_SIGNER) {
            address oldSigner = pa.pairToAdd;
            address newSigner = pa.pairToRemove;

            _revokeRole(ADMIN_ROLE, oldSigner);
            _grantRole(ADMIN_ROLE, newSigner);

            for (uint i = 0; i < signers.length; i++) {
                if (signers[i] == oldSigner) {
                    signers[i] = newSigner;
                    break;
                }
            }
            emit SignerChanged(oldSigner, newSigner);
        }

        pa.executed = true;
        emit ActionExecuted(actionId);
    }

    function _removeActivePair(address lpToken) internal {
        uint256 length = activePairs.length;
        for (uint256 i = 0; i < length; i++) {
            if (activePairs[i] == lpToken) {
                activePairs[i] = activePairs[length - 1];
                activePairs.pop();
                break;
            }
        }
    }

    function stake(address lpToken, uint256 amount) external nonReentrant {
        LiquidityPair storage pair = pairs[lpToken];
        require(pair.isActive, "Pair not active");
        require(pair.weight > 0, "Pair has zero weight");
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

        uint256 rewards = userStake.pendingRewards;
        userStake.pendingRewards = 0;

        if (amount == userStake.amount) {
            userStake.amount = 0;
            IERC20(lpToken).safeTransfer(msg.sender, amount);
            rewardToken.safeTransfer(msg.sender, rewards);
        } else {
            userStake.amount -= amount;
            IERC20(lpToken).safeTransfer(msg.sender, amount);
        }

        emit StakeRemoved(msg.sender, lpToken, amount);
        if (rewards > 0) {
            emit RewardsClaimed(msg.sender, lpToken, rewards);
        }
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
            if (timeElapsed > 0 && totalWeight > 0) {
                uint256 totalLPSupply = IERC20(lpToken).balanceOf(
                    address(this)
                );
                if (totalLPSupply > 0) {
                    uint256 rewardPerSecond = hourlyRewardRate / SECONDS_PER_HOUR;
                    uint256 pairRewards = (rewardPerSecond *
                        timeElapsed *
                        pair.weight) / totalWeight;
                    uint256 rewards = (pairRewards * userStake.amount) /
                        (totalLPSupply * PRECISION);

                    if (rewards > 0 && rewards < type(uint128).max) {
                        userStake.pendingRewards += uint128(rewards);
                    }
                }
            }
        }
        userStake.lastRewardTime = uint64(block.timestamp);
    }

    function proposeChangeSigner(
        address oldSigner,
        address newSigner
    ) external onlyRole(ADMIN_ROLE) returns (uint256) {
        require(hasRole(ADMIN_ROLE, oldSigner), "Old signer not found");
        require(!hasRole(ADMIN_ROLE, newSigner), "New signer already exists");
        require(newSigner != address(0), "Invalid new signer");

        actionCounter++;
        PendingAction storage pa = actions[actionCounter];
        pa.actionType = ActionType.CHANGE_SIGNER;
        pa.pairToAdd = oldSigner; // Reusing fields for signer addresses
        pa.pairToRemove = newSigner;

        emit ActionProposed(actionCounter, msg.sender, ActionType.CHANGE_SIGNER);
        _approveActionInternal(actionCounter);
        return actionCounter;
    }

    function getPairInfo(
        address lpToken
    )
        external
        view
        returns (
            IERC20 token,
            string memory platform,
            uint256 weight,
            bool isActive
        )
    {
        LiquidityPair storage pair = pairs[lpToken];
        return (pair.lpToken, pair.platform, pair.weight, pair.isActive);
    }

    function getUserStakeInfo(
        address user,
        address lpToken
    )
        external
        view
        returns (uint256 amount, uint256 pendingRewards, uint256 lastRewardTime)
    {
        return (
            userStakes[user][lpToken].amount,
            userStakes[user][lpToken].pendingRewards,
            userStakes[user][lpToken].lastRewardTime
        );
    }

    function getActivePairs() external view returns (address[] memory) {
        return activePairs;
    }

    function getSigners() external view returns (address[] memory) {
        return signers;
    }

    function getPairs() external view returns (LiquidityPair[] memory) {
        LiquidityPair[] memory pairsArray = new LiquidityPair[](
            activePairs.length
        );
        for (uint i = 0; i < activePairs.length; i++) {
            pairsArray[i] = pairs[activePairs[i]];
        }
        return pairsArray;
    }

    function getUserStakes(
        address user
    ) external view returns (UserStake[] memory) {
        uint256 stakeCount = 0;
        for (uint i = 0; i < activePairs.length; i++) {
            if (userStakes[user][activePairs[i]].amount > 0) {
                stakeCount++;
            }
        }

        UserStake[] memory stakesArray = new UserStake[](stakeCount);
        uint256 index = 0;
        for (uint i = 0; i < activePairs.length; i++) {
            if (userStakes[user][activePairs[i]].amount > 0) {
                stakesArray[index] = userStakes[user][activePairs[i]];
                index++;
            }
        }
        return stakesArray;
    }
}
