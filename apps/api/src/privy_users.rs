use basingamarket_auth::{parse_privy_linked_accounts, AuthError, PrivyLinkedAccount};
use reqwest::{StatusCode, Url};
use serde::Deserialize;
use serde_json::Value;
use std::time::Duration;

const PRIVY_API_BASE_URL: &str = "https://api.privy.io";
const PRIVY_USER_LOOKUP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub(crate) struct PrivyUserLookupClient {
    app_id: String,
    app_secret: String,
    api_base_url: Url,
    http: reqwest::Client,
}

#[derive(Debug)]
pub(crate) enum PrivyUserLookupError {
    MissingConfig,
    InvalidBaseUrl,
    Request(reqwest::Error),
    Status(StatusCode),
    UserMismatch,
    InvalidLinkedAccounts(AuthError),
}

#[derive(Debug, Deserialize)]
struct PrivyUserResponse {
    id: String,
    #[serde(default)]
    linked_accounts: Value,
}

impl PrivyUserLookupClient {
    pub(crate) fn from_env() -> Option<Self> {
        let app_id = non_empty_env("PRIVY_APP_ID")?;
        let app_secret = non_empty_env("PRIVY_APP_SECRET")?;
        let api_base_url =
            non_empty_env("PRIVY_API_BASE_URL").unwrap_or_else(|| PRIVY_API_BASE_URL.to_owned());
        match Self::new(app_id, app_secret, api_base_url) {
            Ok(client) => Some(client),
            Err(error) => {
                tracing::warn!(?error, "privy user lookup disabled");
                None
            }
        }
    }

    pub(crate) fn new(
        app_id: impl Into<String>,
        app_secret: impl Into<String>,
        api_base_url: impl AsRef<str>,
    ) -> Result<Self, PrivyUserLookupError> {
        let app_id = app_id.into();
        let app_secret = app_secret.into();
        if app_id.trim().is_empty() || app_secret.trim().is_empty() {
            return Err(PrivyUserLookupError::MissingConfig);
        }
        let api_base_url =
            Url::parse(api_base_url.as_ref()).map_err(|_| PrivyUserLookupError::InvalidBaseUrl)?;
        let http = reqwest::Client::builder()
            .timeout(PRIVY_USER_LOOKUP_TIMEOUT)
            .build()
            .map_err(PrivyUserLookupError::Request)?;
        Ok(Self {
            app_id,
            app_secret,
            api_base_url,
            http,
        })
    }

    pub(crate) async fn linked_accounts_for_user(
        &self,
        user_id: &str,
    ) -> Result<Vec<PrivyLinkedAccount>, PrivyUserLookupError> {
        let mut url = self.api_base_url.clone();
        url.path_segments_mut()
            .map_err(|_| PrivyUserLookupError::InvalidBaseUrl)?
            .extend(["v1", "users", user_id]);
        let response = self
            .http
            .get(url)
            .basic_auth(&self.app_id, Some(&self.app_secret))
            .header("privy-app-id", &self.app_id)
            .send()
            .await
            .map_err(PrivyUserLookupError::Request)?;
        let status = response.status();
        if !status.is_success() {
            return Err(PrivyUserLookupError::Status(status));
        }
        let user = response
            .json::<PrivyUserResponse>()
            .await
            .map_err(PrivyUserLookupError::Request)?;
        if user.id != user_id {
            return Err(PrivyUserLookupError::UserMismatch);
        }
        parse_privy_linked_accounts(Some(&user.linked_accounts))
            .map_err(PrivyUserLookupError::InvalidLinkedAccounts)
    }
}

fn non_empty_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

impl PrivyUserLookupError {
    pub(crate) fn is_not_found(&self) -> bool {
        matches!(self, Self::Status(StatusCode::NOT_FOUND))
    }

    pub(crate) fn is_config_error(&self) -> bool {
        matches!(
            self,
            Self::MissingConfig
                | Self::InvalidBaseUrl
                | Self::Status(StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN)
        )
    }
}
