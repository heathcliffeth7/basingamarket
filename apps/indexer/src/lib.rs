use basingamarket_db::{EventMeta, InMemoryProjectionStore, ProjectionEngine};
use basingamarket_protocol_events::ProtocolEvent;
use basingamarket_realtime::{EventPublisher, MemoryEventBus};

const FIXTURE_OWNER: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const FIXTURE_BUYER: &str = "So11111111111111111111111111111111111111112";

pub async fn replay_fixture_events(
    store: InMemoryProjectionStore,
    bus: MemoryEventBus,
    events: Vec<(EventMeta, ProtocolEvent)>,
) -> anyhow::Result<usize> {
    let engine = ProjectionEngine::new(store);
    let mut processed = 0;

    for (meta, event) in events {
        let deltas = engine.apply_raw_event(meta, event).await?;
        for delta in deltas {
            let topic = delta.event_type.clone();
            bus.publish(&topic, delta).await?;
        }
        processed += 1;
    }

    Ok(processed)
}

pub fn sample_fixture_events() -> Vec<(EventMeta, ProtocolEvent)> {
    vec![
        (
            EventMeta::fixture(1, 0),
            ProtocolEvent::MarketCreated {
                market_id: 1,
                question_hash: "crypto-round-fixture".to_owned(),
                outcome_count: 2,
                open_at: 0,
                trade_until: 4_102_444_800,
            },
        ),
        (
            EventMeta::fixture(2, 0),
            ProtocolEvent::TicketMinted {
                ticket_id: 1,
                market_id: 1,
                owner: FIXTURE_OWNER.to_owned(),
                outcome_id: 0,
                stake_amount: 1_000_000,
                reward_shares: 1_000_000,
                entry_odds: 1_000_000,
                confidence: 72,
                mood: 1,
            },
        ),
        (
            EventMeta::fixture(3, 0),
            ProtocolEvent::TicketListed {
                ticket_id: 1,
                seller: FIXTURE_OWNER.to_owned(),
                price: 1_200_000,
            },
        ),
        (
            EventMeta::fixture(4, 0),
            ProtocolEvent::TicketSold {
                ticket_id: 1,
                from: FIXTURE_OWNER.to_owned(),
                to: FIXTURE_BUYER.to_owned(),
                price: 1_200_000,
            },
        ),
        (
            EventMeta::fixture(5, 0),
            ProtocolEvent::MarketResolved {
                market_id: 1,
                winning_outcome: 0,
            },
        ),
        (
            EventMeta::fixture(6, 0),
            ProtocolEvent::PayoutClaimed {
                ticket_id: 1,
                claimer: FIXTURE_BUYER.to_owned(),
                amount: 1_000_000,
            },
        ),
    ]
}

#[cfg(test)]
mod tests {
    use basingamarket_realtime::topics;

    use super::*;

    #[tokio::test]
    async fn fixture_replay_builds_projection_and_publishes_deltas() {
        let store = InMemoryProjectionStore::default();
        let bus = MemoryEventBus::default();

        replay_fixture_events(store.clone(), bus.clone(), sample_fixture_events())
            .await
            .unwrap();

        assert!(store.get_ticket(1).await.unwrap().claimed);
        assert!(!bus.events_for_topic(topics::TICKET_SOLD).await.is_empty());
    }
}
