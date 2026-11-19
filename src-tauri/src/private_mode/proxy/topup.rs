//! Pending top-up requests from a private agent to its user. One request per app session lives in
//! memory until the user answers, the session is deleted or ten minutes pass; a decline starts a
//! five-minute cooldown. The proxy route creates
//! them, a Tauri command records the answer, and the main window gets the event.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

use super::records::{lock, now_ms};
use crate::private_mode::PrivateError;

pub const TOPUP_REQUEST_EVENT: &str = "private-topup-request";
pub const DECLINE_COOLDOWN: Duration = Duration::from_secs(5 * 60);
/// A request nobody answered for this long no longer blocks the next one: its card may be gone
/// (the window reloaded), and the event is sent only once.
pub const PENDING_TTL: Duration = Duration::from_secs(10 * 60);
pub const MAX_REASON_CHARS: usize = 200;

pub const OWN_KEY_MESSAGE: &str = "Paying with your own NEAR AI key; Zorvo top-ups don't apply.";
pub const PENDING_MESSAGE: &str =
    "You already asked the user for a top-up. Wait for their answer before asking again.";
pub const COOLDOWN_MESSAGE: &str = "The user declined a top-up a moment ago. Don't ask again yet.";

/// What the main window receives. `reason` is plain text, control characters removed and capped;
/// the card escapes it again and renders it as text, never as markdown or a link.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopupRequestEvent {
    pub session_id: String,
    pub request_id: String,
    pub usd: u32,
    pub credits: u64,
    pub reason: String,
}

/// A refusal the proxy route turns into an HTTP error; the MCP tool shows `message` to the agent.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopupRefusal {
    pub code: &'static str,
    pub message: String,
}

impl TopupRefusal {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

type Sink = Box<dyn Fn(TopupRequestEvent) + Send + Sync>;

static NEXT_REQUEST: AtomicU64 = AtomicU64::new(1);

fn new_request_id() -> String {
    format!(
        "topup-{}-{}",
        now_ms(),
        NEXT_REQUEST.fetch_add(1, Ordering::SeqCst)
    )
}

/// The agent's sentence as one plain line: control characters become spaces, runs of whitespace
/// collapse, and the result is capped. The route refuses an over-long reason before this; the cap
/// is the last line of defence.
pub fn clean_reason(reason: &str) -> String {
    reason
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_REASON_CHARS)
        .collect()
}

/// One pending request per session, with a cooldown after a decline.
#[derive(Default)]
pub struct TopupRequests {
    pending: Mutex<HashMap<String, (TopupRequestEvent, Instant)>>,
    declined: Mutex<HashMap<String, Instant>>,
    sink: Mutex<Option<Sink>>,
}

impl TopupRequests {
    /// Sets where a new request goes. The app points this at the main window once, at setup.
    pub fn set_sink(&self, sink: Sink) {
        *lock(&self.sink) = Some(sink);
    }

    /// Records a request and emits it. A session with a pending request, or one declined less than
    /// five minutes ago, is refused; the caller has already checked the package and the key source.
    pub fn request(
        &self,
        session_id: &str,
        usd: u32,
        credits: u64,
        reason: &str,
    ) -> Result<TopupRequestEvent, TopupRefusal> {
        let event = TopupRequestEvent {
            session_id: session_id.to_string(),
            request_id: new_request_id(),
            usd,
            credits,
            reason: clean_reason(reason),
        };
        {
            // Both locks are held from the check to the insert, so two asks at once cannot
            // both pass.
            let mut declined = lock(&self.declined);
            let mut pending = lock(&self.pending);
            Self::refusal(&declined, &pending, session_id)?;
            declined.remove(session_id);
            pending.insert(session_id.to_string(), (event.clone(), Instant::now()));
        }
        if let Some(sink) = lock(&self.sink).as_ref() {
            sink(event.clone());
        }
        Ok(event)
    }

    /// Whether a request from `session_id` would be refused right now, without recording one.
    /// The route asks this before it reads the Worker's packages, so an agent that keeps asking
    /// costs no Worker call.
    pub fn check(&self, session_id: &str) -> Result<(), TopupRefusal> {
        let declined = lock(&self.declined);
        let pending = lock(&self.pending);
        Self::refusal(&declined, &pending, session_id)
    }

    fn refusal(
        declined: &HashMap<String, Instant>,
        pending: &HashMap<String, (TopupRequestEvent, Instant)>,
        session_id: &str,
    ) -> Result<(), TopupRefusal> {
        if declined
            .get(session_id)
            .is_some_and(|at| at.elapsed() < DECLINE_COOLDOWN)
        {
            return Err(TopupRefusal::new("cooldown", COOLDOWN_MESSAGE));
        }
        if pending
            .get(session_id)
            .is_some_and(|(_, asked)| asked.elapsed() < PENDING_TTL)
        {
            return Err(TopupRefusal::new("pending", PENDING_MESSAGE));
        }
        Ok(())
    }

    /// The user's answer: approve remembers nothing, decline starts the cooldown. An unknown
    /// session or a stale request id changes nothing.
    pub fn answer(
        &self,
        session_id: &str,
        request_id: &str,
        approve: bool,
    ) -> Result<(), PrivateError> {
        let mut pending = lock(&self.pending);
        match pending.get(session_id) {
            Some((event, _)) if event.request_id == request_id => {
                pending.remove(session_id);
            }
            _ => return Err(PrivateError::NotFound),
        }
        drop(pending);
        if !approve {
            lock(&self.declined).insert(session_id.to_string(), Instant::now());
        }
        Ok(())
    }

    /// A deleted session leaves no request and no cooldown behind.
    pub fn forget(&self, session_id: &str) {
        lock(&self.pending).remove(session_id);
        lock(&self.declined).remove(session_id);
    }

    /// Tests only: the request currently waiting for `session_id`.
    #[cfg(test)]
    pub(crate) fn pending_for(&self, session_id: &str) -> Option<TopupRequestEvent> {
        lock(&self.pending)
            .get(session_id)
            .map(|(event, _)| event.clone())
    }

    /// Tests only: makes the waiting request look `age` old.
    #[cfg(test)]
    fn age_pending(&self, session_id: &str, age: Duration) {
        if let Some((_, asked)) = lock(&self.pending).get_mut(session_id) {
            *asked = Instant::now().checked_sub(age).unwrap_or(*asked);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn a_request_is_emitted_once_and_blocks_a_second() {
        let requests = TopupRequests::default();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let mine = Arc::clone(&seen);
        requests.set_sink(Box::new(move |event| {
            mine.lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(event);
        }));

        let first = requests
            .request("s-1", 5, 500, "The review needs more credits.")
            .expect("a request");
        assert_eq!(first.session_id, "s-1");
        assert_eq!(first.usd, 5);
        assert_eq!(first.credits, 500);
        assert_eq!(first.reason, "The review needs more credits.");
        assert_eq!(
            requests.request("s-1", 10, 1000, "Again"),
            Err(TopupRefusal::new("pending", PENDING_MESSAGE))
        );
        assert_eq!(lock(&seen).len(), 1);
    }

    #[test]
    fn a_decline_starts_a_five_minute_cooldown() {
        let requests = TopupRequests::default();
        let first = requests.request("s-1", 5, 500, "One").expect("a request");
        requests
            .answer("s-1", &first.request_id, false)
            .expect("declined");

        assert_eq!(
            requests.request("s-1", 5, 500, "Two"),
            Err(TopupRefusal::new("cooldown", COOLDOWN_MESSAGE))
        );
        assert_eq!(
            requests.answer("s-1", "stale", true),
            Err(PrivateError::NotFound)
        );
    }

    #[test]
    fn approving_clears_the_request_without_a_cooldown() {
        let requests = TopupRequests::default();
        let first = requests.request("s-1", 5, 500, "One").expect("a request");
        requests
            .answer("s-1", &first.request_id, true)
            .expect("approved");

        assert!(requests.pending_for("s-1").is_none());
        assert!(requests.request("s-1", 5, 500, "Two").is_ok());
    }

    #[test]
    fn a_request_nobody_answered_stops_blocking_after_ten_minutes() {
        let requests = TopupRequests::default();
        let first = requests.request("s-1", 5, 500, "One").expect("a request");
        requests.age_pending("s-1", PENDING_TTL);

        let second = requests
            .request("s-1", 5, 500, "Two")
            .expect("a new request");

        assert_eq!(
            requests.answer("s-1", &first.request_id, true),
            Err(PrivateError::NotFound)
        );
        assert!(requests.answer("s-1", &second.request_id, true).is_ok());
    }

    #[test]
    fn a_deleted_session_leaves_no_request_or_cooldown() {
        let requests = TopupRequests::default();
        let first = requests.request("s-1", 5, 500, "One").expect("a request");
        requests
            .answer("s-1", &first.request_id, false)
            .expect("declined");
        requests.request("s-2", 5, 500, "Two").expect("a request");

        requests.forget("s-1");
        requests.forget("s-2");

        assert!(requests.pending_for("s-2").is_none());
        assert!(requests.request("s-1", 5, 500, "Three").is_ok());
    }

    #[test]
    fn another_sessions_request_does_not_block_this_one() {
        let requests = TopupRequests::default();
        requests.request("s-1", 5, 500, "One").expect("a request");

        assert!(requests.request("s-2", 5, 500, "Two").is_ok());
    }

    #[test]
    fn a_reason_is_one_plain_capped_line() {
        let long = format!("{}\n\u{0007}second", "a".repeat(300));
        let cleaned = clean_reason(&long);

        assert!(!cleaned.contains('\n'));
        assert!(!cleaned.contains('\u{0007}'));
        assert_eq!(cleaned.chars().count(), MAX_REASON_CHARS);
        assert!(cleaned.starts_with("aaa"));
    }
}
