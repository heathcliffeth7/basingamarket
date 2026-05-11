use basingamarket_db::InMemoryProjectionStore;
use basingamarket_observability::init_tracing;
use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "basingamarket-worker")]
#[command(about = "Background worker for render, snapshot, and reconciliation jobs")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Listen,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing("basingamarket-worker");
    let cli = Cli::parse();

    match cli.command {
        Command::Listen => {
            let _store = InMemoryProjectionStore::default();
            tracing::info!(
                "worker ready; wire NATS share.render.requested consumer in production config"
            );
            tokio::signal::ctrl_c().await?;
        }
    }

    Ok(())
}
