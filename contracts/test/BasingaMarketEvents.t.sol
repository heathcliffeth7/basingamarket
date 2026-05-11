// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/BasingaMarket.sol";

contract BasingaMarketEventsTest {
    function testFullEventSurfaceFlow() public {
        BasingaMarket market = new BasingaMarket();
        uint256 marketId = market.createMarket(bytes32(uint256(1)), 2, 0, 100);
        uint256 ticketId = market.mintTicket(marketId, 0, 1_000_000, 1_000_000, 1_000_000, 80, 1);
        market.listTicket(ticketId, 1_200_000);
        market.buyTicket(ticketId);
        market.closeMarket(marketId);
        market.resolveMarket(marketId, 0);
        market.claimPayout(ticketId, 1_000_000);
        assert(ticketId == 1);
    }
}
