use serde_json::{json, Value};
use zorvo_lib::acp::manager::{AcpEvent, AcpLaunch};

use crate::common::{cwd, fake_agent, manager, WAIT};

fn marked_as(agent: &str) -> AcpLaunch {
    let mut launch = fake_agent();
    launch
        .env
        .push(("FAKE_ACP_SUBAGENT".to_string(), agent.to_string()));
    launch
}

/// Runs the fake agent's "subagent" prompt and returns the updates of the turn, in order.
fn subagent_updates(agent: &str) -> Vec<Value> {
    let (manager, rx) = manager();
    manager
        .start("s-1", &cwd(), &marked_as(agent), json!([]))
        .unwrap();
    manager.prompt("s-1", "subagent", &[]).unwrap();

    let mut updates = Vec::new();
    loop {
        match rx
            .recv_timeout(WAIT)
            .expect("timed out waiting for the turn to end")
        {
            AcpEvent::Update { update, .. } => updates.push(update),
            AcpEvent::TurnEnded { .. } => break,
            _ => {}
        }
    }
    manager.stop("s-1");
    updates
}

fn tool_call<'a>(updates: &'a [Value], id: &str) -> &'a Value {
    updates
        .iter()
        .find(|update| update["sessionUpdate"] == "tool_call" && update["toolCallId"] == id)
        .unwrap_or_else(|| panic!("no tool call {id}"))
}

#[test]
fn relays_a_qwen_subagents_meta_unchanged() {
    let updates = subagent_updates("qwen");

    let parent = tool_call(&updates, "sub-parent");
    let meta = &tool_call(&updates, "sub-c1")["_meta"];
    assert_eq!(meta["parentToolCallId"], parent["toolCallId"]);
    assert_eq!(meta["subagentType"], "general-purpose");
    let text = updates
        .iter()
        .find(|update| update["sessionUpdate"] == "agent_message_chunk")
        .expect("the subagent's text");
    assert_eq!(text["_meta"]["parentToolCallId"], parent["toolCallId"]);
}

#[test]
fn relays_a_claude_subagents_meta_unchanged() {
    let updates = subagent_updates("claude");

    let parent = tool_call(&updates, "sub-parent");
    let meta = &tool_call(&updates, "sub-c1")["_meta"];
    assert_eq!(meta["claudeCode"]["parentToolUseId"], parent["toolCallId"]);
}
