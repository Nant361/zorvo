//! What fills an agent's context window, as Qwen Code reports it.
//!
//! Qwen Code answers `qwen/status/session/context_usage` on a plain ACP
//! launch (recorded in `tests/fixtures/qwen-context-usage.json`). The answer is
//! the agent's own, so every number is checked, only the categories in
//! [`CATEGORIES`] are kept, and each list is cut before it reaches the webview.

use serde::Serialize;
use serde_json::Value;

/// Qwen Code's method name: the ACP SDK inside it hands it to `extMethod` as is.
pub const CONTEXT_USAGE_METHOD: &str = "qwen/status/session/context_usage";

/// The categories the panel shows, in its order, each with the key of its
/// item list in the answer when it has one.
const CATEGORIES: [(&str, Option<&str>); 10] = [
    ("systemPrompt", None),
    ("builtinTools", Some("builtinTools")),
    ("mcpTools", Some("mcpTools")),
    ("instructionFiles", Some("instructionFiles")),
    ("memoryFiles", Some("memoryFiles")),
    ("skills", Some("skills")),
    ("startupContext", None),
    ("messages", None),
    ("freeSpace", None),
    ("autocompactBuffer", None),
];

pub const MAX_ITEMS: usize = 50;
pub const MAX_NAME_CHARS: usize = 120;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextBreakdown {
    pub model_name: Option<String>,
    /// The window's size in tokens; 0 when the agent did not say.
    pub window_size: u64,
    /// The agent counted some of it without the model's answer.
    pub is_estimated: bool,
    pub categories: Vec<ContextCategory>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextCategory {
    pub key: &'static str,
    pub tokens: u64,
    /// The largest items first, at most [`MAX_ITEMS`].
    pub items: Vec<ContextItem>,
    /// How many items were left out.
    pub more: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ContextItem {
    pub name: String,
    pub tokens: u64,
}

/// Reads Qwen Code's answer. Any number that is not a finite, non-negative
/// value, or an item or list of another shape, refuses the whole answer.
pub fn parse(answer: &Value) -> Result<ContextBreakdown, String> {
    let usage = answer
        .get("usage")
        .filter(|u| u.is_object())
        .ok_or_else(|| bad("no usage"))?;
    let breakdown = usage
        .get("breakdown")
        .filter(|b| b.is_object())
        .ok_or_else(|| bad("no breakdown"))?;
    let mut categories = Vec::new();
    for (key, list_key) in CATEGORIES {
        let Some(value) = breakdown.get(key) else {
            continue;
        };
        let tokens = count(value).ok_or_else(|| bad(key))?;
        let (items, more) = match list_key.and_then(|k| usage.get(k)) {
            Some(list) => items_of(list).ok_or_else(|| bad(key))?,
            None => (Vec::new(), 0),
        };
        categories.push(ContextCategory {
            key,
            tokens,
            items,
            more,
        });
    }
    let window_size = match usage.get("contextWindowSize") {
        Some(value) => count(value).ok_or_else(|| bad("contextWindowSize"))?,
        None => 0,
    };
    let is_estimated = match usage.get("isEstimated") {
        Some(Value::Bool(flag)) => *flag,
        None => false,
        Some(_) => return Err(bad("isEstimated")),
    };
    let model_name = usage
        .get("modelName")
        .and_then(Value::as_str)
        .map(cut)
        .filter(|name| !name.trim().is_empty());
    Ok(ContextBreakdown {
        model_name,
        window_size,
        is_estimated,
        categories,
    })
}

fn bad(what: &str) -> String {
    format!("The agent's context answer was not readable ({what}).")
}

/// A token count: a finite, non-negative number, rounded.
fn count(value: &Value) -> Option<u64> {
    let n = value.as_f64()?;
    if !n.is_finite() || n < 0.0 || n > u64::MAX as f64 {
        return None;
    }
    Some(n.round() as u64)
}

/// The list's largest items first, at most [`MAX_ITEMS`], and how many were
/// left out. A tool or skill is named by `name`, a file by `path`; any other
/// field (Qwen Code's `absolutePath`, `loaded`) is dropped.
fn items_of(list: &Value) -> Option<(Vec<ContextItem>, usize)> {
    let mut items = list
        .as_array()?
        .iter()
        .map(|item| {
            let name = item
                .get("name")
                .or_else(|| item.get("path"))
                .and_then(Value::as_str)?;
            Some(ContextItem {
                name: cut(name),
                tokens: count(item.get("tokens")?)?,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    items.sort_by(|a, b| b.tokens.cmp(&a.tokens).then_with(|| a.name.cmp(&b.name)));
    let more = items.len().saturating_sub(MAX_ITEMS);
    items.truncate(MAX_ITEMS);
    Some((items, more))
}

fn cut(text: &str) -> String {
    text.chars().take(MAX_NAME_CHARS).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> Value {
        let text = include_str!("../../tests/fixtures/qwen-context-usage.json");
        serde_json::from_str::<Value>(text).unwrap()["answer"].clone()
    }

    fn category<'a>(parsed: &'a ContextBreakdown, key: &str) -> &'a ContextCategory {
        parsed.categories.iter().find(|c| c.key == key).unwrap()
    }

    #[test]
    fn reads_the_recorded_answer() {
        let parsed = parse(&fixture()).unwrap();
        assert_eq!(parsed.model_name.as_deref(), Some("qwen4-max"));
        assert_eq!(parsed.window_size, 1_000_000);
        assert!(parsed.is_estimated);
        let keys: Vec<_> = parsed.categories.iter().map(|c| c.key).collect();
        assert_eq!(keys, CATEGORIES.map(|(key, _)| key));
        assert_eq!(category(&parsed, "skills").tokens, 42_331);
        assert_eq!(category(&parsed, "startupContext").tokens, 1_104);
        let files = category(&parsed, "instructionFiles");
        assert_eq!(
            files.items[0],
            ContextItem {
                name: "~/.qwen/AGENTS.md".into(),
                tokens: 3_348
            }
        );
        assert_eq!(files.more, 0);
    }

    #[test]
    fn never_passes_on_an_absolute_path_or_another_field() {
        let text = serde_json::to_string(&parse(&fixture()).unwrap()).unwrap();
        assert!(!text.contains("absolutePath"));
        assert!(!text.contains("/Users/"));
        assert!(!text.contains("loaded"));
        assert!(!text.contains("thresholds"));
    }

    #[test]
    fn keeps_the_largest_items_and_counts_the_rest() {
        let skills: Vec<Value> = (0..60)
            .map(|i| json!({ "name": format!("s{i}"), "tokens": i }))
            .collect();
        let answer = json!({ "usage": { "breakdown": { "skills": 10 }, "skills": skills } });
        let skills = parse(&answer).unwrap().categories.remove(0);
        assert_eq!(skills.items.len(), MAX_ITEMS);
        assert_eq!(skills.items[0].tokens, 59);
        assert_eq!(skills.more, 10);
    }

    #[test]
    fn cuts_long_names() {
        let long = "x".repeat(500);
        let answer = json!({ "usage": { "breakdown": { "skills": 1 }, "skills": [{ "name": long, "tokens": 1 }] } });
        let parsed = parse(&answer).unwrap();
        assert_eq!(
            parsed.categories[0].items[0].name.chars().count(),
            MAX_NAME_CHARS
        );
    }

    #[test]
    fn refuses_bad_numbers_and_shapes() {
        let bad_answers = [
            json!({}),
            json!({ "usage": [] }),
            json!({ "usage": { "breakdown": 3 } }),
            json!({ "usage": { "breakdown": { "messages": -1 } } }),
            json!({ "usage": { "breakdown": { "messages": "12" } } }),
            json!({ "usage": { "breakdown": { "messages": 1 }, "contextWindowSize": -5 } }),
            json!({ "usage": { "breakdown": { "skills": 1 }, "skills": {} } }),
            json!({ "usage": { "breakdown": { "skills": 1 }, "skills": [{ "tokens": 1 }] } }),
            json!({ "usage": { "breakdown": { "skills": 1 }, "skills": [{ "name": "a", "tokens": -2 }] } }),
            json!({ "usage": { "breakdown": {}, "isEstimated": "yes" } }),
        ];
        for answer in bad_answers {
            assert!(parse(&answer).is_err(), "accepted {answer}");
        }
    }

    #[test]
    fn ignores_keys_it_does_not_know() {
        let answer = json!({ "usage": { "breakdown": { "messages": 5, "cachedTokens": 9, "currentTier": "safe", "somethingNew": -1 } } });
        let parsed = parse(&answer).unwrap();
        assert_eq!(parsed.categories.len(), 1);
        assert_eq!(parsed.categories[0].key, "messages");
    }
}
