use axum::{
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug)]
pub(crate) struct ApiError {
    pub(crate) status: StatusCode,
    pub(crate) code: &'static str,
    pub(crate) message: &'static str,
}

impl ApiError {
    pub(crate) fn not_found(code: &'static str, message: &'static str) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            code,
            message,
        }
    }

    pub(crate) fn bad_request(code: &'static str, message: &'static str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code,
            message,
        }
    }

    pub(crate) fn unauthorized() -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            code: "unauthorized",
            message: "Authentication required.",
        }
    }

    pub(crate) fn unauthorized_with_code(code: &'static str, message: &'static str) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            code,
            message,
        }
    }

    pub(crate) fn forbidden(code: &'static str, message: &'static str) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            code,
            message,
        }
    }

    pub(crate) fn auth_not_configured() -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            code: "auth_not_configured",
            message: "Auth is not configured.",
        }
    }

    pub(crate) fn service_unavailable(code: &'static str, message: &'static str) -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            code,
            message,
        }
    }

    pub(crate) fn internal(error: impl std::fmt::Display) -> Self {
        tracing::error!(error = %error, "request failed");
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "internal_error",
            message: "Islem su anda tamamlanamadi.",
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = ErrorResponse {
            code: self.code,
            message: self.message,
            request_id: Uuid::new_v4().to_string(),
        };
        (
            self.status,
            [(header::CONTENT_TYPE, "application/json")],
            Json(body),
        )
            .into_response()
    }
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    code: &'static str,
    message: &'static str,
    request_id: String,
}
