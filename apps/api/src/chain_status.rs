use std::time::Duration;

use axum::{extract::State, Json};
use basingamarket_chain::SolanaDevnetConfig;
use serde::Serialize;
use serde_json::{json, Value};

use crate::AppState;

pub(crate) async fn chain_status(State(state): State<AppState>) -> Json<ChainStatusResponse> {
    Json(ChainStatusResponse::from_probe(&state.chain_config).await)
}

#[derive(Debug, Serialize)]
pub(crate) struct ChainStatusResponse {
    cluster: String,
    rpc_url: String,
    ws_url: Option<String>,
    program_id: Option<String>,
    program_status: &'static str,
    rpc_health: &'static str,
    rpc_version: Option<String>,
    rpc_error: Option<String>,
}

impl ChainStatusResponse {
    async fn from_probe(config: &SolanaDevnetConfig) -> Self {
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_millis(config.request_timeout_ms))
            .build()
        {
            Ok(client) => client,
            Err(error) => {
                return Self {
                    cluster: config.cluster.clone(),
                    rpc_url: config.rpc_url.clone(),
                    ws_url: config.ws_url.clone(),
                    program_id: config.program_id.clone(),
                    program_status: program_status(config),
                    rpc_health: "unavailable",
                    rpc_version: None,
                    rpc_error: Some(error.to_string()),
                };
            }
        };

        let health = solana_rpc_request(&client, &config.rpc_url, "getHealth", 1).await;
        let version = solana_rpc_request(&client, &config.rpc_url, "getVersion", 2).await;
        let rpc_error = health
            .as_ref()
            .err()
            .or_else(|| version.as_ref().err())
            .cloned();

        Self {
            cluster: config.cluster.clone(),
            rpc_url: config.rpc_url.clone(),
            ws_url: config.ws_url.clone(),
            program_id: config.program_id.clone(),
            program_status: program_status(config),
            rpc_health: match health {
                Ok(value) if value.as_str() == Some("ok") => "ok",
                _ => "unavailable",
            },
            rpc_version: version.ok().and_then(|value| {
                value
                    .get("solana-core")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            }),
            rpc_error,
        }
    }
}

fn program_status(config: &SolanaDevnetConfig) -> &'static str {
    if config.program_id.is_some() {
        "ready"
    } else {
        "projection_pending"
    }
}

async fn solana_rpc_request(
    client: &reqwest::Client,
    rpc_url: &str,
    method: &str,
    id: u8,
) -> Result<Value, String> {
    let response = client
        .post(rpc_url)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Solana RPC {method} returned HTTP {status}"));
    }

    let value: Value = response.json().await.map_err(|error| error.to_string())?;
    if let Some(error) = value.get("error") {
        return Err(error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Solana RPC error")
            .to_owned());
    }

    value
        .get("result")
        .cloned()
        .ok_or_else(|| format!("Solana RPC {method} returned no result"))
}
