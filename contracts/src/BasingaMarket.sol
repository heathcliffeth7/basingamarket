// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract BasingaMarket {
    event MarketCreated(
        uint256 indexed marketId,
        bytes32 questionHash,
        uint8 outcomeCount,
        uint64 openAt,
        uint64 tradeUntil
    );

    event TicketMinted(
        uint256 indexed ticketId,
        uint256 indexed marketId,
        address indexed owner,
        uint8 outcomeId,
        uint256 stakeAmount,
        uint256 rewardShares,
        uint256 entryOdds,
        uint16 confidence,
        uint8 mood
    );

    event TicketListed(uint256 indexed ticketId, address indexed seller, uint256 price);
    event TicketSold(uint256 indexed ticketId, address indexed from, address indexed to, uint256 price);
    event MarketClosed(uint256 indexed marketId);
    event MarketResolved(uint256 indexed marketId, uint8 winningOutcome);
    event PayoutClaimed(uint256 indexed ticketId, address indexed claimer, uint256 amount);

    struct Market {
        bytes32 questionHash;
        uint8 outcomeCount;
        uint64 openAt;
        uint64 tradeUntil;
        bool closed;
        bool resolved;
        uint8 winningOutcome;
    }

    struct Ticket {
        uint256 marketId;
        address originalCaller;
        address currentOwner;
        uint8 outcomeId;
        uint256 stakeAmount;
        uint256 rewardShares;
        uint256 entryOdds;
        bool listed;
        uint256 listedPrice;
        bool claimed;
    }

    address public immutable admin;
    uint256 public nextMarketId = 1;
    uint256 public nextTicketId = 1;

    mapping(uint256 => Market) public markets;
    mapping(uint256 => Ticket) public tickets;

    modifier onlyAdmin() {
        require(msg.sender == admin, "not_admin");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    function createMarket(bytes32 questionHash, uint8 outcomeCount, uint64 openAt, uint64 tradeUntil)
        external
        onlyAdmin
        returns (uint256 marketId)
    {
        require(outcomeCount >= 2, "bad_outcome_count");
        require(tradeUntil == 0 || tradeUntil > openAt, "bad_window");

        marketId = nextMarketId++;
        markets[marketId] = Market({
            questionHash: questionHash,
            outcomeCount: outcomeCount,
            openAt: openAt,
            tradeUntil: tradeUntil,
            closed: false,
            resolved: false,
            winningOutcome: 0
        });

        emit MarketCreated(marketId, questionHash, outcomeCount, openAt, tradeUntil);
    }

    function mintTicket(
        uint256 marketId,
        uint8 outcomeId,
        uint256 stakeAmount,
        uint256 rewardShares,
        uint256 entryOdds,
        uint16 confidence,
        uint8 mood
    ) external returns (uint256 ticketId) {
        Market storage market = markets[marketId];
        require(market.outcomeCount > 0, "market_missing");
        require(!market.closed && !market.resolved, "market_not_open");
        require(outcomeId < market.outcomeCount, "bad_outcome");
        require(stakeAmount > 0, "zero_stake");

        ticketId = nextTicketId++;
        tickets[ticketId] = Ticket({
            marketId: marketId,
            originalCaller: msg.sender,
            currentOwner: msg.sender,
            outcomeId: outcomeId,
            stakeAmount: stakeAmount,
            rewardShares: rewardShares,
            entryOdds: entryOdds,
            listed: false,
            listedPrice: 0,
            claimed: false
        });

        emit TicketMinted(ticketId, marketId, msg.sender, outcomeId, stakeAmount, rewardShares, entryOdds, confidence, mood);
    }

    function listTicket(uint256 ticketId, uint256 price) external {
        Ticket storage ticket = tickets[ticketId];
        require(ticket.currentOwner == msg.sender, "not_owner");
        require(price > 0, "zero_price");
        Market storage market = markets[ticket.marketId];
        require(!market.closed && !market.resolved, "market_closed");

        ticket.listed = true;
        ticket.listedPrice = price;
        emit TicketListed(ticketId, msg.sender, price);
    }

    function buyTicket(uint256 ticketId) external payable {
        Ticket storage ticket = tickets[ticketId];
        require(ticket.listed, "not_listed");
        Market storage market = markets[ticket.marketId];
        require(!market.closed && !market.resolved, "market_closed");

        address seller = ticket.currentOwner;
        uint256 price = ticket.listedPrice;
        ticket.currentOwner = msg.sender;
        ticket.listed = false;
        ticket.listedPrice = 0;

        emit TicketSold(ticketId, seller, msg.sender, price);
    }

    function closeMarket(uint256 marketId) external onlyAdmin {
        Market storage market = markets[marketId];
        require(market.outcomeCount > 0, "market_missing");
        market.closed = true;
        emit MarketClosed(marketId);
    }

    function resolveMarket(uint256 marketId, uint8 winningOutcome) external onlyAdmin {
        Market storage market = markets[marketId];
        require(market.outcomeCount > 0, "market_missing");
        require(winningOutcome < market.outcomeCount, "bad_outcome");
        market.closed = true;
        market.resolved = true;
        market.winningOutcome = winningOutcome;
        emit MarketResolved(marketId, winningOutcome);
    }

    function claimPayout(uint256 ticketId, uint256 amount) external {
        Ticket storage ticket = tickets[ticketId];
        Market storage market = markets[ticket.marketId];
        require(market.resolved, "not_resolved");
        require(ticket.currentOwner == msg.sender, "not_owner");
        require(!ticket.claimed, "already_claimed");
        require(ticket.outcomeId == market.winningOutcome, "losing_ticket");

        ticket.claimed = true;
        emit PayoutClaimed(ticketId, msg.sender, amount);
    }
}
