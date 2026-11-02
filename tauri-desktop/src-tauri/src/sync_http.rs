use serde::de::DeserializeOwned;
use serde_json::Value;
use std::time::Duration;

#[derive(Debug)]
pub struct HttpError {
    pub code: String,
    pub message: String,
    pub server_time: Option<i64>,
}

impl From<String> for HttpError {
    fn from(message: String) -> Self {
        Self {
            code: "local_error".into(),
            message,
            server_time: None,
        }
    }
}

pub fn base_url() -> Result<String, String> {
    let value = option_env!("SUI_TIME_SYNC_BASE_URL")
        .unwrap_or("")
        .trim()
        .trim_end_matches('/');
    if value.is_empty() {
        return Err("未配置同步服务".into());
    }
    let url = reqwest::Url::parse(value).map_err(|_| "同步服务地址无效")?;
    if url.scheme() != "https"
        && !(url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1")))
    {
        return Err("同步服务必须使用 HTTPS".into());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("同步服务地址不能包含凭据、查询参数或片段".into());
    }
    if url.path() != "/" {
        return Err("同步服务地址必须为 origin，不能包含路径".into());
    }
    Ok(value.into())
}

pub enum Route {
    Auth,
    Sync,
}

impl Route {
    fn prefix(&self) -> &'static str {
        match self {
            Self::Auth => "/api/v1/auth",
            Self::Sync => "/api/v1/sui-time/sync",
        }
    }
}

pub async fn request<T: DeserializeOwned>(
    route: Route,
    method: reqwest::Method,
    path: &str,
    token: &str,
    body: Option<&Value>,
) -> Result<T, HttpError> {
    let base = base_url()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法初始化同步连接".to_string())?;
    let mut request = client.request(method, format!("{base}{}{path}", route.prefix()));
    if !token.is_empty() {
        request = request.bearer_auth(token);
    }
    if let Some(body) = body {
        request = request.json(body);
    }
    let response = request.send().await.map_err(|_| HttpError {
        code: "network_error".into(),
        message: "无法连接同步服务，请检查网络后重试".into(),
        server_time: None,
    })?;
    let status = response.status();
    if status.as_u16() == 204 {
        return serde_json::from_value(Value::Null)
            .map_err(|_| "同步响应格式无效".to_string().into());
    }
    let value: Value = response
        .json()
        .await
        .map_err(|_| "同步服务响应格式无效".to_string())?;
    if !status.is_success() {
        let error = value
            .get("error")
            .filter(|v| v.is_object())
            .unwrap_or(&value);
        return Err(HttpError {
            code: error
                .get("code")
                .or_else(|| value.get("code"))
                .and_then(Value::as_str)
                .unwrap_or(if status.as_u16() == 401 {
                    "token_expired"
                } else {
                    "sync_error"
                })
                .into(),
            message: error
                .get("message")
                .or_else(|| value.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("同步请求失败")
                .into(),
            server_time: value
                .get("serverTime")
                .or_else(|| error.get("serverTime"))
                .or_else(|| {
                    error
                        .get("details")
                        .and_then(|details| details.get("serverTime"))
                })
                .and_then(Value::as_i64),
        });
    }
    serde_json::from_value(value).map_err(|_| "同步服务响应数据无效".to_string().into())
}
