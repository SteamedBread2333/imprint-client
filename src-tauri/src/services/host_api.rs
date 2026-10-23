use reqwest::{Client, Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase")]
pub enum DeskRequest {
    Health,
    Graph,
    UnifiedGraph {
        #[serde(default)]
        include_archived: bool,
    },
    RuleDetail { id: String },
    DocsSearch { query: String, top_k: u16 },
    DocChunk { id: String },
    DocFile { path: String },
    DocsStats,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeskApiError {
    pub code: &'static str,
    pub message: String,
    pub source: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl DeskApiError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            source: "host",
            status: None,
            detail: None,
        }
    }
}

pub fn host_base_url(listen: &str) -> Result<Url, DeskApiError> {
    let listen = listen.trim();
    let raw = if listen.starts_with("http://") || listen.starts_with("https://") {
        listen.to_string()
    } else {
        format!("http://{listen}")
    };
    let mut url = Url::parse(&raw)
        .map_err(|e| DeskApiError::new("INVALID_HOST", format!("invalid host.listen: {e}")))?;
    if url.scheme() != "http" {
        return Err(DeskApiError::new(
            "INVALID_HOST",
            "host.listen must use loopback HTTP",
        ));
    }
    let loopback = match url.host_str() {
        Some("localhost") => true,
        Some(host) => host
            .parse::<std::net::IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false),
        None => false,
    };
    if !loopback {
        return Err(DeskApiError::new(
            "HOST_NOT_LOOPBACK",
            "host.listen must resolve to a loopback address",
        ));
    }
    url.set_path("/");
    url.set_query(None);
    Ok(url)
}

pub struct HostApi {
    client: Client,
}

impl HostApi {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .expect("reqwest client configuration is valid");
        Self { client }
    }

    pub async fn execute(
        &self,
        base: Url,
        request: DeskRequest,
    ) -> Result<Value, DeskApiError> {
        let (method, path) = route(&request)?;
        let url = base.join(&path).map_err(|e| {
            DeskApiError::new("INVALID_REQUEST", format!("invalid Host API path: {e}"))
        })?;
        let mut builder = self.client.request(method, url);
        match &request {
            DeskRequest::UnifiedGraph { include_archived } if *include_archived => {
                builder = builder.query(&[("include_archived", "true")]);
            }
            DeskRequest::DocsSearch { query, top_k } => {
                builder = builder.json(&serde_json::json!({
                    "query": query.trim(),
                    "top_k": (*top_k).clamp(1, 100),
                }));
            }
            DeskRequest::DocFile { path } => {
                builder = builder.query(&[("path", path)]);
            }
            _ => {}
        }
        let response = builder.send().await.map_err(|e| {
            let code = if e.is_timeout() {
                "HOST_TIMEOUT"
            } else {
                "HOST_OFFLINE"
            };
            let mut err = DeskApiError::new(code, "imprint Host is not reachable");
            err.detail = Some(e.to_string());
            err
        })?;
        let status = response.status();
        let text = response.text().await.map_err(|e| {
            let mut err = DeskApiError::new("BAD_RESPONSE", "failed to read Host response");
            err.detail = Some(e.to_string());
            err
        })?;
        if !status.is_success() {
            let mut err = DeskApiError::new(
                "HOST_ERROR",
                format!("imprint Host returned {}", status.as_u16()),
            );
            err.status = Some(status.as_u16());
            err.detail = Some(text);
            return Err(err);
        }
        serde_json::from_str(&text).map_err(|e| {
            let mut err = DeskApiError::new("BAD_RESPONSE", "Host returned invalid JSON");
            err.detail = Some(e.to_string());
            err
        })
    }
}

fn route(request: &DeskRequest) -> Result<(Method, String), DeskApiError> {
    let route = match request {
        DeskRequest::Health => (Method::GET, "health".into()),
        DeskRequest::Graph => (Method::GET, "graph".into()),
        DeskRequest::UnifiedGraph { .. } => (Method::GET, "graph/unified".into()),
        DeskRequest::RuleDetail { id } => {
            require_identifier(id)?;
            (Method::GET, format!("rules/{}", encode_segment(id)))
        }
        DeskRequest::DocsSearch { query, .. } => {
            if query.trim().is_empty() {
                return Err(DeskApiError::new(
                    "INVALID_REQUEST",
                    "document search query is empty",
                ));
            }
            (Method::POST, "docs/search".into())
        }
        DeskRequest::DocChunk { id } => {
            require_identifier(id)?;
            (Method::GET, format!("docs/chunks/{}", encode_segment(id)))
        }
        DeskRequest::DocFile { path } => {
            if path.trim().is_empty() || path.contains('\0') {
                return Err(DeskApiError::new(
                    "INVALID_REQUEST",
                    "document path is empty or invalid",
                ));
            }
            (Method::GET, "docs/file".into())
        }
        DeskRequest::DocsStats => (Method::GET, "docs/stats".into()),
    };
    Ok(route)
}

fn require_identifier(id: &str) -> Result<(), DeskApiError> {
    if id.trim().is_empty() || id.contains('\0') {
        return Err(DeskApiError::new(
            "INVALID_REQUEST",
            "identifier is empty or invalid",
        ));
    }
    Ok(())
}

fn encode_segment(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;

    #[test]
    fn rejects_non_loopback_host() {
        let err = host_base_url("0.0.0.0:9470").unwrap_err();
        assert_eq!(err.code, "HOST_NOT_LOOPBACK");
        assert!(host_base_url("127.0.0.1:9470").is_ok());
        assert!(host_base_url("localhost:9470").is_ok());
    }

    #[test]
    fn sends_typed_doc_search_request() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/docs/search")
                .json_body(serde_json::json!({"query": "memory", "top_k": 12}));
            then.status(200)
                .header("content-type", "application/json")
                .json_body(serde_json::json!({"hits": []}));
        });
        let api = HostApi::new();
        let value = tauri::async_runtime::block_on(api.execute(
            Url::parse(&format!("{}/", server.base_url())).unwrap(),
            DeskRequest::DocsSearch {
                query: "memory".into(),
                top_k: 12,
            },
        ))
        .unwrap();
        mock.assert();
        assert_eq!(value["hits"], serde_json::json!([]));
    }

    #[test]
    fn encodes_dynamic_identifier() {
        let (method, path) = route(&DeskRequest::RuleDetail {
            id: "rule/with space".into(),
        })
        .unwrap();
        assert_eq!(method, Method::GET);
        assert_eq!(path, "rules/rule%2Fwith+space");
    }
}
