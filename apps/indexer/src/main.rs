use basingamarket_chain::SolanaDevnetConfig;
use basingamarket_db::InMemoryProjectionStore;
use basingamarket_indexer::{replay_fixture_events, sample_fixture_events};
use basingamarket_observability::init_tracing;
use basingamarket_realtime::MemoryEventBus;
use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "basingamarket-indexer")]
#[command(about = "Custom Rust indexer skeleton for basingamarket")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    ReplayFixture,
    PrintPlan {
        #[arg(long, default_value_t = 1)]
        latest_slot: u64,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing("basingamarket-indexer");
    let cli = Cli::parse();

    match cli.command {
        Command::ReplayFixture => {
            let store = InMemoryProjectionStore::default();
            let bus = MemoryEventBus::default();
            let processed =
                replay_fixture_events(store.clone(), bus.clone(), sample_fixture_events()).await?;
            println!("processed={processed}");
            println!("markets={}", store.list_markets().await.len());
            println!("tickets={}", store.get_tickets_for_market(1).await.len());
            println!("published_events={}", bus.events().await.len());
        }
        Command::PrintPlan { latest_slot } => {
            let config = SolanaDevnetConfig::from_env()?;
            println!("cluster={}", config.cluster);
            println!("rpc_url={}", config.rpc_url);
            println!("ws_url={}", config.ws_url.as_deref().unwrap_or(""));
            println!(
                "program_status={}",
                if config.program_id.is_some() {
                    "ready"
                } else {
                    "projection_pending"
                }
            );
            println!("latest_slot={latest_slot}");
        }
    }

    Ok(())
}
