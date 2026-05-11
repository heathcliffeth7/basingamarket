use basingamarket_db::{DbError, InMemoryProjectionStore, ShareCardRow};
use basingamarket_renderer::{
    render_share_card_svg, svg_hash, svg_to_png, CanvasItem, OutcomeSummary, RenderModel,
    TicketSummary,
};
use uuid::Uuid;

pub async fn process_share_render(
    store: &InMemoryProjectionStore,
    share_card_id: Uuid,
) -> Result<ShareCardRow, DbError> {
    let card = store.mark_share_card_processing(share_card_id).await?;
    let result = build_render_model(store, card.ticket_id).await;

    match result {
        Ok(model) => {
            let svg = render_share_card_svg(&model, card.ticket_id);
            let hash = svg_hash(&svg);
            let png = svg_to_png(&svg).map_err(|error| DbError::Projection(error.to_string()))?;
            let png_url = format!("object://share-cards/{share_card_id}-{}b.png", png.len());
            store
                .mark_share_card_completed(share_card_id, hash, png_url)
                .await
        }
        Err(error) => {
            store
                .mark_share_card_failed(share_card_id, error.to_string())
                .await
        }
    }
}

pub async fn build_render_model(
    store: &InMemoryProjectionStore,
    ticket_id: u64,
) -> Result<RenderModel, DbError> {
    let ticket = store
        .get_ticket(ticket_id)
        .await
        .ok_or(DbError::TicketNotFound(ticket_id))?;
    let market = store
        .get_market(ticket.market_id)
        .await
        .ok_or(DbError::MarketNotFound(ticket.market_id))?;
    let mut model = RenderModel::new(market.market_id, market.question_hash);

    model.outcomes = store
        .get_outcomes(ticket.market_id)
        .await
        .into_iter()
        .map(|outcome| OutcomeSummary {
            outcome_id: outcome.outcome_id,
            label: outcome.label,
            total_stake: outcome.total_stake.to_string(),
            current_odds: outcome.current_odds.to_string(),
        })
        .collect();
    model.tickets = store
        .get_tickets_for_market(ticket.market_id)
        .await
        .into_iter()
        .map(|ticket| TicketSummary {
            ticket_id: ticket.ticket_id,
            owner: ticket.current_owner,
            outcome_id: ticket.outcome_id,
            stake_amount: ticket.stake_amount.to_string(),
        })
        .collect();
    model.canvas_objects = store
        .get_canvas(ticket.market_id)
        .await
        .into_iter()
        .map(|object| CanvasItem {
            ticket_id: object.ticket_id,
            owner: object.current_owner,
            x: object.x,
            y: object.y,
            radius: object.radius,
            mood: object.mood,
            confidence: object.confidence,
            listed: object.listed,
            z_index: object.z_index,
            avatar_url: object.avatar_url,
        })
        .collect();

    Ok(model)
}

#[cfg(test)]
mod tests {
    use basingamarket_db::{EventMeta, ProjectionEngine, ShareCardStatus};
    use basingamarket_protocol_events::ProtocolEvent;

    use super::*;

    const TEST_OWNER: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

    #[tokio::test]
    async fn share_render_job_moves_pending_to_completed() {
        let store = InMemoryProjectionStore::default();
        let engine = ProjectionEngine::new(store.clone());
        engine
            .apply_raw_event(
                EventMeta::fixture(1, 0),
                ProtocolEvent::MarketCreated {
                    market_id: 1,
                    question_hash: "Will it render?".to_owned(),
                    outcome_count: 2,
                    open_at: 0,
                    trade_until: 100,
                },
            )
            .await
            .unwrap();
        engine
            .apply_raw_event(
                EventMeta::fixture(2, 0),
                ProtocolEvent::TicketMinted {
                    ticket_id: 1,
                    market_id: 1,
                    owner: TEST_OWNER.to_owned(),
                    outcome_id: 0,
                    stake_amount: 1_000_000,
                    reward_shares: 1_000_000,
                    entry_odds: 1_000_000,
                    confidence: 90,
                    mood: 2,
                },
            )
            .await
            .unwrap();
        let card = store.create_share_card(1).await.unwrap();

        let completed = process_share_render(&store, card.id).await.unwrap();

        assert_eq!(completed.status, ShareCardStatus::Completed);
        assert!(completed.svg_hash.is_some());
        assert!(completed.png_url.is_some());
    }
}
