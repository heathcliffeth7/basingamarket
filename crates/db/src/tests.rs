use super::*;

const TEST_OWNER: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const TEST_BUYER: &str = "So11111111111111111111111111111111111111112";

fn create_market() -> ProtocolEvent {
    ProtocolEvent::MarketCreated {
        market_id: 1,
        question_hash: "fixture-question".to_owned(),
        outcome_count: 2,
        open_at: 0,
        trade_until: 100,
    }
}

fn mint(ticket_id: u64) -> ProtocolEvent {
    ProtocolEvent::TicketMinted {
        ticket_id,
        market_id: 1,
        round_id: 1,
        owner: TEST_OWNER.to_owned(),
        outcome_id: 0,
        stake_amount: 1_000_000,
        reward_shares: 1_000_000,
        entry_odds: 1_000_000,
        confidence: 80,
        mood: 1,
    }
}

#[tokio::test]
async fn fixture_events_rebuild_to_same_projection() {
    let store = InMemoryProjectionStore::default();
    let engine = ProjectionEngine::new(store.clone());

    engine
        .apply_raw_event(EventMeta::fixture(1, 0), create_market())
        .await
        .unwrap();
    engine
        .apply_raw_event(EventMeta::fixture(2, 0), mint(1))
        .await
        .unwrap();
    let before = store.get_canvas(1).await;
    engine.rebuild_from_raw_events().await.unwrap();
    let after = store.get_canvas(1).await;

    assert_eq!(before, after);
    assert_eq!(store.indexer_cursor().await, Some(2));
}

#[tokio::test]
async fn ticket_resale_updates_current_owner_and_canvas() {
    let store = InMemoryProjectionStore::default();
    let engine = ProjectionEngine::new(store.clone());
    engine
        .apply_raw_event(EventMeta::fixture(1, 0), create_market())
        .await
        .unwrap();
    engine
        .apply_raw_event(EventMeta::fixture(2, 0), mint(1))
        .await
        .unwrap();
    engine
        .apply_raw_event(
            EventMeta::fixture(3, 0),
            ProtocolEvent::TicketListed {
                ticket_id: 1,
                seller: TEST_OWNER.to_owned(),
                price: 2_000_000,
            },
        )
        .await
        .unwrap();
    engine
        .apply_raw_event(
            EventMeta::fixture(4, 0),
            ProtocolEvent::TicketSold {
                ticket_id: 1,
                from: TEST_OWNER.to_owned(),
                to: TEST_BUYER.to_owned(),
                price: 2_000_000,
            },
        )
        .await
        .unwrap();

    let ticket = store.get_ticket(1).await.unwrap();
    let canvas = store.get_canvas(1).await;

    assert_eq!(ticket.current_owner, TEST_BUYER);
    assert!(!canvas[0].listed);
    assert_eq!(canvas[0].current_owner, ticket.current_owner);
}

#[tokio::test]
async fn cash_deposit_ledger_credits_signature_once() {
    let store = InMemoryProjectionStore::default();
    let row = CashDepositRow {
        wallet_address: TEST_OWNER.to_owned(),
        signature: "devnet-deposit-signature".to_owned(),
        mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU".to_owned(),
        vault_token_account: "So11111111111111111111111111111111111111112".to_owned(),
        amount: 8_490_000,
        slot: 10,
        created_at: Utc::now(),
    };

    let (balance, credited) = store.record_cash_deposit(row.clone()).await.unwrap();
    assert!(credited);
    assert_eq!(balance.cash_balance, 8_490_000);

    let (balance, credited) = store.record_cash_deposit(row).await.unwrap();
    assert!(!credited);
    assert_eq!(balance.cash_balance, 8_490_000);
    assert_eq!(
        store
            .get_cash_balance(TEST_OWNER)
            .await
            .unwrap()
            .cash_balance,
        8_490_000
    );
}

#[tokio::test]
async fn busdc_mint_credits_wallet_until_daily_limit_and_resets_next_day() {
    let store = InMemoryProjectionStore::default();
    let amount = 50_000_000_000;
    let day = "2026-05-11";
    let created_at = chrono::DateTime::parse_from_rfc3339("2026-05-11T12:00:00Z")
        .unwrap()
        .with_timezone(&Utc);

    for index in 0..5 {
        let (balance, used_today) = store
            .record_busdc_mint(
                BusdcMintRow {
                    mint_id: format!("mint-{index}"),
                    wallet_address: TEST_OWNER.to_owned(),
                    mint_day: day.to_owned(),
                    amount,
                    created_at,
                },
                5,
            )
            .await
            .unwrap();
        assert_eq!(used_today, index + 1);
        assert_eq!(balance.cash_balance, amount * u128::from(index + 1));
    }

    assert_eq!(store.busdc_mint_count_for_day(TEST_OWNER, day).await, 5);
    let error = store
        .record_busdc_mint(
            BusdcMintRow {
                mint_id: "mint-6".to_owned(),
                wallet_address: TEST_OWNER.to_owned(),
                mint_day: day.to_owned(),
                amount,
                created_at,
            },
            5,
        )
        .await
        .unwrap_err();
    assert!(error.to_string().contains("busdc mint limit exceeded"));

    let (balance, used_today) = store
        .record_busdc_mint(
            BusdcMintRow {
                mint_id: "mint-next-day".to_owned(),
                wallet_address: TEST_OWNER.to_owned(),
                mint_day: "2026-05-12".to_owned(),
                amount,
                created_at: created_at + chrono::Duration::days(1),
            },
            5,
        )
        .await
        .unwrap();
    assert_eq!(used_today, 1);
    assert_eq!(balance.cash_balance, amount * 6);
}

#[tokio::test]
async fn cash_trade_reserves_debits_and_records_once() {
    let store = InMemoryProjectionStore::default();
    store
        .upsert_cash_balance(CashBalanceRow {
            wallet_address: TEST_OWNER.to_owned(),
            cash_balance: 5_000_000,
            updated_at: Utc::now(),
        })
        .await;
    let now = Utc::now();
    let reservation = CashTradeReservationRow {
        trade_id: "trade-1".to_owned(),
        wallet_address: TEST_OWNER.to_owned(),
        amount: 1_000_000,
        released: false,
        completed_signature: None,
        created_at: now,
        updated_at: now,
    };

    let balance = store.reserve_cash_trade(reservation).await.unwrap();
    assert_eq!(balance.cash_balance, 4_000_000);

    let trade = CashTradeRow {
        trade_id: "trade-1".to_owned(),
        wallet_address: TEST_OWNER.to_owned(),
        signature: "cash-buy-signature".to_owned(),
        mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU".to_owned(),
        vault_token_account: TEST_BUYER.to_owned(),
        market_id: 1,
        round_id: 5928339,
        position_lot: TEST_BUYER.to_owned(),
        lot_id: 42,
        side: "UP".to_owned(),
        usdc_in: 1_000_000,
        fee_usdc: 5_000,
        net_usdc: 995_000,
        tickets_out: 1_900_000,
        created_at: Utc::now(),
    };
    let (balance, recorded) = store.record_cash_trade(trade.clone()).await.unwrap();
    assert!(recorded);
    assert_eq!(balance.cash_balance, 4_000_000);
    assert_eq!(
        store.cash_trade_side_volume(1, 5928339, "UP").await,
        995_000
    );
    assert_eq!(store.cash_trade_side_volume(2, 5928339, "UP").await, 0);
    assert_eq!(store.cash_trade_side_volume(1, 5928339, "DOWN").await, 0);

    let (balance, recorded) = store.record_cash_trade(trade).await.unwrap();
    assert!(!recorded);
    assert_eq!(balance.cash_balance, 4_000_000);
}

#[tokio::test]
async fn cash_trade_with_large_lot_id_creates_canvas_without_overflow() {
    let store = InMemoryProjectionStore::default();
    store
        .upsert_cash_balance(CashBalanceRow {
            wallet_address: TEST_OWNER.to_owned(),
            cash_balance: 5_000_000,
            updated_at: Utc::now(),
        })
        .await;
    let now = Utc::now();
    store
        .reserve_cash_trade(CashTradeReservationRow {
            trade_id: "trade-large-lot".to_owned(),
            wallet_address: TEST_OWNER.to_owned(),
            amount: 1_000_000,
            released: false,
            completed_signature: None,
            created_at: now,
            updated_at: now,
        })
        .await
        .unwrap();

    let trade = CashTradeRow {
        trade_id: "trade-large-lot".to_owned(),
        wallet_address: TEST_OWNER.to_owned(),
        signature: "cash-buy-large-lot-signature".to_owned(),
        mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU".to_owned(),
        vault_token_account: TEST_BUYER.to_owned(),
        market_id: 1,
        round_id: 5928385,
        position_lot: TEST_BUYER.to_owned(),
        lot_id: u64::MAX,
        side: "UP".to_owned(),
        usdc_in: 1_000_000,
        fee_usdc: 5_000,
        net_usdc: 995_000,
        tickets_out: 1_900_000,
        created_at: now,
    };

    let (_balance, recorded) = store.record_cash_trade(trade).await.unwrap();
    assert!(recorded);

    let ticket = store.get_ticket(u64::MAX).await.unwrap();
    let canvas = store.get_canvas(1).await;
    assert_eq!(ticket.ticket_id, u64::MAX);
    assert_eq!(canvas.len(), 1);
    assert_eq!(canvas[0].ticket_id, u64::MAX);
    assert!((96..1056).contains(&canvas[0].x));
    assert!((300..540).contains(&canvas[0].y));
    assert!(canvas[0].z_index >= 0);
}

#[tokio::test]
async fn cash_trade_release_restores_reserved_cash() {
    let store = InMemoryProjectionStore::default();
    store
        .upsert_cash_balance(CashBalanceRow {
            wallet_address: TEST_OWNER.to_owned(),
            cash_balance: 5_000_000,
            updated_at: Utc::now(),
        })
        .await;
    let now = Utc::now();
    store
        .reserve_cash_trade(CashTradeReservationRow {
            trade_id: "trade-2".to_owned(),
            wallet_address: TEST_OWNER.to_owned(),
            amount: 1_000_000,
            released: false,
            completed_signature: None,
            created_at: now,
            updated_at: now,
        })
        .await
        .unwrap();

    let balance = store
        .release_cash_trade_reservation("trade-2")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(balance.cash_balance, 5_000_000);
}

#[tokio::test]
async fn sol_deposit_ledger_uses_quote_once_and_updates_total_cash() {
    let store = InMemoryProjectionStore::default();
    let quote = SolDepositQuoteRow {
        quote_id: "quote-1".to_owned(),
        wallet_address: TEST_OWNER.to_owned(),
        cash_amount: 1_000_000,
        lamports: 6_666_667,
        price: 150_000_000,
        treasury: TEST_BUYER.to_owned(),
        expires_at: Utc::now() + chrono::Duration::seconds(60),
        used_signature: None,
        created_at: Utc::now(),
    };
    store.insert_sol_deposit_quote(quote).await;
    let row = SolDepositRow {
        wallet_address: TEST_OWNER.to_owned(),
        signature: "devnet-sol-deposit-signature".to_owned(),
        quote_id: "quote-1".to_owned(),
        treasury: TEST_BUYER.to_owned(),
        lamports: 6_666_667,
        cash_amount: 1_000_000,
        price: 150_000_000,
        slot: 12,
        created_at: Utc::now(),
    };

    let (balance, credited) = store.record_sol_deposit(row.clone()).await.unwrap();
    assert!(credited);
    assert_eq!(balance.cash_balance, 1_000_000);
    assert_eq!(store.total_cash_balance().await.unwrap(), 1_000_000);
    assert!(store
        .get_sol_deposit_quote("quote-1")
        .await
        .unwrap()
        .used_signature
        .is_some());

    let (balance, credited) = store.record_sol_deposit(row).await.unwrap();
    assert!(!credited);
    assert_eq!(balance.cash_balance, 1_000_000);
}

#[tokio::test]
async fn transfer_deposit_ledger_uses_quote_once_and_updates_cash() {
    let store = InMemoryProjectionStore::default();
    let quote = TransferDepositQuoteRow {
        quote_id: "transfer-quote-1".to_owned(),
        wallet_address: TEST_OWNER.to_owned(),
        asset: "USDC".to_owned(),
        cash_amount: 2_000_000,
        transfer_amount: 2_000_000,
        price: None,
        destination: TEST_BUYER.to_owned(),
        mint: Some("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU".to_owned()),
        reference: "bm:transfer-quote-1".to_owned(),
        expires_at: Utc::now() + chrono::Duration::seconds(60),
        used_signature: None,
        created_at: Utc::now(),
    };
    store.insert_transfer_deposit_quote(quote).await;
    let row = TransferDepositRow {
        wallet_address: TEST_OWNER.to_owned(),
        signature: "devnet-transfer-deposit-signature".to_owned(),
        quote_id: "transfer-quote-1".to_owned(),
        asset: "USDC".to_owned(),
        destination: TEST_BUYER.to_owned(),
        transfer_amount: 2_000_000,
        cash_amount: 2_000_000,
        price: None,
        slot: 14,
        created_at: Utc::now(),
    };

    let (balance, credited) = store.record_transfer_deposit(row.clone()).await.unwrap();
    assert!(credited);
    assert_eq!(balance.cash_balance, 2_000_000);
    assert!(store
        .get_transfer_deposit_quote("transfer-quote-1")
        .await
        .unwrap()
        .used_signature
        .is_some());

    let (balance, credited) = store.record_transfer_deposit(row).await.unwrap();
    assert!(!credited);
    assert_eq!(balance.cash_balance, 2_000_000);
}
