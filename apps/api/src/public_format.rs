use basingamarket_db::{ShareCardStatus, TicketRow};
use basingamarket_domain::TicketStatus;

pub(crate) fn public_ticket_status(status: TicketStatus) -> &'static str {
    match status {
        TicketStatus::Active => "active",
        TicketStatus::Listed => "listed",
        TicketStatus::Claimable => "won",
        TicketStatus::Refundable => "refundable",
        TicketStatus::Claimed => "claimed",
        TicketStatus::Lost | TicketStatus::Cancelled => "lost",
    }
}

pub(crate) fn public_canvas_ticket_status(
    ticket: Option<&TicketRow>,
    listed: bool,
) -> &'static str {
    match ticket.map(|ticket| ticket.status) {
        Some(TicketStatus::Listed) => "listed",
        Some(TicketStatus::Claimable) => "won",
        Some(TicketStatus::Refundable) => "refundable",
        Some(TicketStatus::Claimed) => "claimed",
        Some(TicketStatus::Lost | TicketStatus::Cancelled) => "lost",
        Some(TicketStatus::Active) | None => {
            if listed {
                "listed"
            } else {
                "active"
            }
        }
    }
}

pub(crate) fn public_share_status(status: ShareCardStatus) -> &'static str {
    match status {
        ShareCardStatus::Pending => "pending",
        ShareCardStatus::Processing => "rendering",
        ShareCardStatus::Completed => "ready",
        ShareCardStatus::Failed => "failed",
    }
}

pub(crate) fn short_address(address: &str) -> String {
    if address.len() <= 12 {
        return address.to_owned();
    }
    format!("{}...{}", &address[..6], &address[address.len() - 4..])
}
