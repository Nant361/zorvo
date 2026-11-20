import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatCanvas } from "../../../src/components/ChatCanvas";
import { Button } from "../../../src/components/ui/Button";
import { applyAcpUpdate } from "../../../src/lib/acp-events";
import type { ChatMessage } from "../../../src/types";
import "./style.css";

interface WorkloadResult {
  chunks: number;
  renderedText: boolean;
}

interface Workload {
  begin: (stream: boolean) => void;
  end: () => Promise<WorkloadResult>;
  dispose: () => void;
}

declare global {
  interface Window {
    __scrollWorkload?: Workload;
    webkit?: {
      messageHandlers?: {
        scrollBench?: {
          postMessage: (message: { command: string; stream: boolean }) => Promise<unknown>;
        };
      };
    };
  }
}

const duration = 20_000;
const parameters = new URLSearchParams(location.search);
const runID = parameters.get("run");
const role = parameters.get("role");
const order = parameters.get("order") === "reverse"
  ? [true, false, false, true] : [false, true, true, false];
const rows = Array.from({ length: 480 }, (_, index) => (
  <article key={index}>
    <strong>Row {index + 1}</strong>
    <p>A reproducible local document for the browser comparison.</p>
  </article>
));

function useWorkload() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const workload = useMemo<Workload>(() => {
    let timer = 0;
    let chunks = 0;
    const dispose = () => window.clearInterval(timer);
    return {
      begin(stream) {
        dispose();
        chunks = 0;
        setMessages([]);
        if (stream) {
          timer = window.setInterval(() => {
            chunks++;
            const context = {
              sessionId: "fixture", now: Date.now(), createId: () => "fixture-reply",
            };
            const update = {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: chunks % 24 ? " reply" : "\n\n**Next paragraph.** " },
            };
            setMessages(previous => applyAcpUpdate(previous, update, context));
          }, 50);
        }
      },
      async end() {
        dispose();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        return {
          chunks,
          renderedText: document.querySelector("#chat")?.textContent?.includes("reply") ?? false,
        };
      },
      dispose,
    };
  }, []);

  useEffect(() => {
    window.__scrollWorkload = workload;
    return () => {
      workload.dispose();
      delete window.__scrollWorkload;
    };
  }, [workload]);
  return { messages, workload };
}

function ChatOnly() {
  const { messages } = useWorkload();
  return <div id="chat"><ChatCanvas messages={messages} agentName="Local fixture" /></div>;
}

function Comparison() {
  const page = useRef<HTMLDivElement>(null);
  const { messages, workload } = useWorkload();
  const [status, setStatus] = useState("Ready");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running || !page.current) return;
    const viewport = page.current;
    const bridge = window.webkit?.messageHandlers?.scrollBench;
    let disposed = false;
    let animation = 0;
    let timeout = 0;
    let round = 0;
    let hidden = document.hidden;
    const samples: object[] = [];
    const visibility = () => { hidden ||= document.hidden; };
    document.addEventListener("visibilitychange", visibility);

    const command = async (operation: "begin" | "end", stream: boolean) => {
      if (role === "page") {
        if (!bridge) throw new Error("The separate chat view is unavailable.");
        return bridge.postMessage({ command: operation, stream });
      }
      if (operation === "begin") return workload.begin(stream);
      return workload.end();
    };
    const fail = (error: unknown) => {
      workload.dispose();
      setStatus("Measurement failed. " + String(error));
    };
    const begin = async () => {
      if (disposed) return;
      viewport.scrollTop = 0;
      hidden = document.hidden;
      const stream = order[round];
      setStatus("Round " + (round + 1) + " of " + order.length);
      await command("begin", stream);
      if (disposed) return;
      const times: number[] = [];
      let start: number | undefined;
      let last: number | undefined;
      const frame = (now: number) => {
        if (disposed) return;
        start ??= now;
        if (last !== undefined) times.push(now - last);
        last = now;
        const elapsed = now - start;
        viewport.scrollTop = Math.round(elapsed * 1.2);
        if (elapsed < duration) {
          animation = requestAnimationFrame(frame);
          return;
        }
        void finish(elapsed, times, stream).catch(fail);
      };
      animation = requestAnimationFrame(frame);
    };
    const finish = async (elapsed: number, times: number[], stream: boolean) => {
      const result = await command("end", stream) as WorkloadResult;
      if (disposed) return;
      if (!result || typeof result.chunks !== "number" || typeof result.renderedText !== "boolean") {
        throw new Error("The chat view returned incomplete measurements.");
      }
      samples.push({
        round: ++round, stream, ...result, hidden, framesMs: times, elapsedMs: elapsed,
        viewport: [viewport.clientWidth, viewport.clientHeight], distance: viewport.scrollTop,
        chatView: role === "page" ? "separate" : "same",
      });
      if (round < order.length) {
        timeout = window.setTimeout(() => { void begin().catch(fail); }, 600);
        return;
      }
      setStatus("Saving measurements");
      const response = await fetch("/result/" + runID, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(samples),
      });
      if (!response.ok) throw new Error("The server returned " + response.status + ".");
      setStatus("Measurements saved");
    };
    void begin().catch(fail);
    return () => {
      disposed = true;
      cancelAnimationFrame(animation);
      clearTimeout(timeout);
      workload.dispose();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [running, workload]);

  return (
    <main>
      <header>
        <Button disabled={running || !runID} onClick={() => setRunning(true)}>Start measurement</Button>
        <output>{status}</output>
      </header>
      <div className="panes">
        <div className="page" ref={page}>{rows}</div>
        {role !== "page" && <div id="chat"><ChatCanvas messages={messages} agentName="Local fixture" /></div>}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(role === "chat" ? <ChatOnly /> : <Comparison />);
