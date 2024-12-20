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
    uint256 public constant REQUIRED_APPROVALS = 3;
    uint256 private constant SECONDS_PER_HOUR = 3600;
    uint256 private constant ACTION_EXPIRY = 7 days; // Actions expire after 7 days

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
        uint256 rewardPerTokenPaid;
    }

    enum ActionType {
        SET_HOURLY_REWARD_RATE,
        UPDATE_PAIR_WEIGHTS,
        ADD_PAIR,
        REMOVE_PAIR,
        CHANGE_SIGNER,
        WITHDRAW_REWARDS
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
        address recipient;
        uint256 withdrawAmount;
        bool executed;
        bool expired;
        uint8 approvals;
        address[] approvedBy;
        uint256 proposedTime; // Timestamp when action was proposed
    }

    // State variables
    IERC20 public rewardToken;
    uint256 public hourlyRewardRate;
    mapping(address => LiquidityPair) public pairs;
    mapping(address => mapping(address => UserStake)) public userStakes;
    address[] public activePairs;
    address[] public signers;

    // Reward tracking
    mapping(address => uint256) public rewardPerTokenStored;
    mapping(address => uint256) public lastUpdateTime;
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
    event ActionExpired(uint256 actionId);
    event RewardsWithdrawn(address recipient, uint256 amount);

    constructor(address _rewardToken, address[] memory _initialSigners) {
        require(
            _initialSigners.length == TOTAL_SIGNERS,
            "Must provide exactly 4 signers"
        );
        require(_rewardToken != address(0), "Invalid reward token address");
        rewardToken = IERC20(_rewardToken);
        signers = _initialSigners;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        for (uint i = 0; i < _initialSigners.length; i++) {
            require(_initialSigners[i] != address(0), "Invalid signer address");
            _grantRole(ADMIN_ROLE, _initialSigners[i]);
        }
    }

    // Add getter functions for array data in PendingAction
    function getActionPairs(
        uint256 actionId
    ) external view returns (address[] memory) {
        return actions[actionId].pairs;
    }

    function getActionWeights(
        uint256 actionId
    ) external view returns (uint256[] memory) {
        return actions[actionId].weights;
    }

    function getActionApproval(
        uint256 actionId
    ) external view returns (address[] memory) {
        return actions[actionId].approvedBy;
    }

    function isActionExpired(uint256 actionId) public view returns (bool) {
        PendingAction storage pa = actions[actionId];
        return block.timestamp > pa.proposedTime + ACTION_EXPIRY;
    }

    function handleExpiredAction(uint256 actionId) external onlyRole(ADMIN_ROLE) {
        require(actionId > 0 && actionId <= actionCounter, "Invalid actionId");
        PendingAction storage pa = actions[actionId];
        require(!pa.executed, "Action already executed");
        require(!pa.expired, "Action already marked expired");
        require(isActionExpired(actionId), "Action not expired yet");

        pa.expired = true;
        emit ActionExpired(actionId);
    }

    function cleanupExpiredActions() external onlyRole(ADMIN_ROLE) {
        for(uint256 i = 1; i <= actionCounter; i++) {
            PendingAction storage pa = actions[i];
            if(!pa.executed && !pa.expired && isActionExpired(i)) {
                pa.expired = true;
                emit ActionExpired(i);
            }
        }
    }

    function proposeWithdrawRewards(
        address recipient,
        uint256 amount
    ) external onlyRole(ADMIN_ROLE) returns (uint256) {
        require(recipient != address(0), "Invalid recipient address");
        require(amount > 0, "Amount must be greater than zero");
        require(
            amount <= rewardToken.balanceOf(address(this)),
            "Amount exceeds contract balance"
        );
        require(amount <= type(uint128).max, "Amount too large");

        actionCounter++;
        PendingAction storage pa = actions[actionCounter];
        pa.actionType = ActionType.WITHDRAW_REWARDS;
        pa.recipient = recipient;
        pa.withdrawAmount = amount;
        pa.proposedTime = block.timestamp;

        emit ActionProposed(
            actionCounter,
            msg.sender,
            ActionType.WITHDRAW_REWARDS
        );
        _approveActionInternal(actionCounter);
        return actionCounter;
    }

    function proposeSetHourlyRewardRate(
        uint256 newRate
    ) external onlyRole(ADMIN_ROLE) returns (uint256) {
        require(newRate <= type(uint128).max, "Rate too high");
        
        actionCounter++;
        PendingAction storage pa = actions[actionCounter];
        pa.actionType = ActionType.SET_HOURLY_REWARD_RATE;
        pa.newHourlyRewardRate = newRate;
        pa.proposedTime = block.timestamp;

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
        require(lpTokens.length > 0, "Empty arrays not allowed");
        require(lpTokens.length <= MAX_PAIRS, "Too many pairs");
        
        for(uint i = 0; i < weights.length; i++) {
            require(weights[i] <= MAX_WEIGHT, "Weight exceeds maximum");
            require(lpTokens[i] != address(0), "Invalid LP token address");
        }

        actionCounter++;
        PendingAction storage pa = actions[actionCounter];
        pa.actionType = ActionType.UPDATE_PAIR_WEIGHTS;
        pa.pairs = lpTokens;
        pa.weights = weights;
        pa.proposedTime = block.timestamp;

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
            updateRewardPerToken(lpToken);
        }
    }

    function updateRewardPerToken(address lpToken) internal {
        uint256 totalSupply = IERC20(lpToken).balanceOf(address(this));
        uint256 timeDelta = block.timestamp - lastUpdateTime[lpToken];
        
        if (totalSupply > 0 && timeDelta > 0) {
            uint256 rewardPerSecond = hourlyRewardRate / SECONDS_PER_HOUR;
            uint256 pairRewards = (rewardPerSecond * timeDelta * pairs[lpToken].weight) / totalWeight;
            rewardPerTokenStored[lpToken] += (pairRewards * PRECISION) / totalSupply;
        }
        
        lastUpdateTime[lpToken] = block.timestamp;
    }

    function earned(address user, address lpToken) public view returns (uint256) {
        UserStake storage stake = userStakes[user][lpToken];
        uint256 currentRewardPerToken = rewardPerTokenStored[lpToken];
        
        if (block.timestamp > lastUpdateTime[lpToken] && IERC20(lpToken).balanceOf(address(this)) > 0) {
            uint256 timeDelta = block.timestamp - lastUpdateTime[lpToken];
            uint256 rewardPerSecond = hourlyRewardRate / SECONDS_PER_HOUR;
            uint256 pairRewards = (rewardPerSecond * timeDelta * pairs[lpToken].weight) / totalWeight;
            currentRewardPerToken += (pairRewards * PRECISION) / IERC20(lpToken).balanceOf(address(this));
        }
        
        return stake.amount * (currentRewardPerToken - stake.rewardPerTokenPaid) / PRECISION + stake.pendingRewards;
    }

    function proposeAddPair(
        address lpToken,
        string calldata pairName,
        string calldata platform,
        uint256 weight
    ) external onlyRole(ADMIN_ROLE) returns (uint256) {
        require(lpToken != address(0), "Invalid pair");
        require(weight > 0, "Weight must be greater than 0");
        require(weight <= MAX_WEIGHT, "Weight exceeds maximum");
        require(bytes(pairName).length > 0, "Empty pair name");
        require(bytes(pairName).length <= 32, "Pair name too long");
        require(bytes(platform).length > 0, "Empty platform name");
        require(bytes(platform).length <= 32, "Platform name too long");

        actionCounter++;
        PendingAction storage pa = actions[actionCounter];
        pa.actionType = ActionType.ADD_PAIR;
        pa.pairToAdd = lpToken;
        pa.pairNameToAdd = pairName;
        pa.platformToAdd = platform;
        pa.weightToAdd = weight;
        pa.proposedTime = block.timestamp;

        emit ActionProposed(actionCounter, msg.sender, ActionType.ADD_PAIR);
        _approveActionInternal(actionCounter);
        return actionCounter;
    }

    function proposeRemovePair(
        address lpToken
    ) external onlyRole(ADMIN_ROLE) returns (uint256) {
        require(lpToken != address(0), "Invalid pair address");
        require(pairs[lpToken].isActive, "Pair not active or doesn't exist");

        actionCounter++;
        PendingAction storage pa = actions[actionCounter];
        pa.actionType = ActionType.REMOVE_PAIR;
        pa.pairToRemove = lpToken;
        pa.proposedTime = block.timestamp;

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
        require(!pa.expired, "Action has expired");
        require(
            block.timestamp <= pa.proposedTime + ACTION_EXPIRY,
            "Action has expired"
        );

        // Check if already approved
        for (uint i = 0; i < pa.approvedBy.length; i++) {
            require(pa.approvedBy[i] != msg.sender, "Already approved");
        }

        pa.approvedBy.push(msg.sender);
        pa.approvals++;
        emit ActionApproved(actionId, msg.sender);
    }

    function executeAction(uint256 actionId) external onlyRole(ADMIN_ROLE) {
        require(actionId > 0 && actionId <= actionCounter, "Invalid actionId");
        PendingAction storage pa = actions[actionId];
        require(!pa.executed, "Already executed");
        require(!pa.expired, "Action has expired");
        require(pa.approvals >= REQUIRED_APPROVALS, "Not enough approvals");
        require(
            block.timestamp <= pa.proposedTime + ACTION_EXPIRY,
            "Action has expired"
        );

        if (pa.actionType == ActionType.SET_HOURLY_REWARD_RATE ||
            pa.actionType == ActionType.UPDATE_PAIR_WEIGHTS) {
            updateAllRewards();
        }

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
            lastUpdateTime[pa.pairToAdd] = block.timestamp;
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
        } else if (pa.actionType == ActionType.WITHDRAW_REWARDS) {
            require(pa.recipient != address(0), "Invalid recipient");
            require(
                rewardToken.balanceOf(address(this)) >= pa.withdrawAmount,
                "Insufficient contract balance"
            );

            rewardToken.safeTransfer(pa.recipient, pa.withdrawAmount);
            emit RewardsWithdrawn(pa.recipient, pa.withdrawAmount);
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

        updateRewardPerToken(lpToken);
        UserStake storage userStake = userStakes[msg.sender][lpToken];
        
        if (userStake.amount > 0) {
            userStake.pendingRewards = earned(msg.sender, lpToken);
        }
        
        userStake.amount += amount;
        userStake.rewardPerTokenPaid = rewardPerTokenStored[lpToken];
        userStake.lastRewardTime = uint64(block.timestamp);

        IERC20(lpToken).safeTransferFrom(msg.sender, address(this), amount);
        emit StakeAdded(msg.sender, lpToken, amount);
    }

    function unstake(address lpToken, uint256 amount) external nonReentrant {
        LiquidityPair storage pair = pairs[lpToken];
        require(pair.isActive, "Pair not active");

        UserStake storage userStake = userStakes[msg.sender][lpToken];
        require(userStake.amount >= amount, "Insufficient stake");

        updateRewardPerToken(lpToken);
        uint256 rewards = earned(msg.sender, lpToken);
        userStake.pendingRewards = 0;
        userStake.rewardPerTokenPaid = rewardPerTokenStored[lpToken];

        if (amount == userStake.amount) {
            userStake.amount = 0;
            IERC20(lpToken).safeTransfer(msg.sender, amount);
            if (rewards > 0) {
                rewardToken.safeTransfer(msg.sender, rewards);
            }
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

        updateRewardPerToken(lpToken);
        uint256 rewards = earned(msg.sender, lpToken);
        require(rewards > 0, "No rewards to claim");

        UserStake storage userStake = userStakes[msg.sender][lpToken];
        userStake.pendingRewards = 0;
        userStake.rewardPerTokenPaid = rewardPerTokenStored[lpToken];
        
        rewardToken.safeTransfer(msg.sender, rewards);
        emit RewardsClaimed(msg.sender, lpToken, rewards);
    }

    function updateRewards(address user, address lpToken) internal {
        updateRewardPerToken(lpToken);
        UserStake storage userStake = userStakes[user][lpToken];
        userStake.pendingRewards = earned(user, lpToken);
        userStake.rewardPerTokenPaid = rewardPerTokenStored[lpToken];
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
        pa.proposedTime = block.timestamp;

        emit ActionProposed(
            actionCounter,
            msg.sender,
            ActionType.CHANGE_SIGNER
        );
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
        UserStake storage stake = userStakes[user][lpToken];
        return (
            stake.amount,
            earned(user, lpToken),
            stake.lastRewardTime
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
