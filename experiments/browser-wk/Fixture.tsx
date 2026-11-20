import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const activity = { timeouts: 0, intervals: 0, animationFrames: 0, fetches: 0 };
type Sample = typeof activity & { time: number };
const history: Sample[] = [{ ...activity, time: performance.now() }];

declare global {
  interface Window {
    probeActivity: typeof activity;
    probeRecentActivity: () => { windowMs: number; sampleAgeMs: number; counts: typeof activity };
  }
}
window.probeActivity = activity;
window.probeRecentActivity = () => {
  const now = performance.now();
  let baseline = history[0];
  for (const sample of history) {
    if (sample.time > now - 5000) break;
    baseline = sample;
  }
  return {
    windowMs: Math.min(5000, now - baseline.time),
    sampleAgeMs: now - history[history.length - 1].time,
    counts: {
      timeouts: activity.timeouts - baseline.timeouts,
      intervals: activity.intervals - baseline.intervals,
      animationFrames: activity.animationFrames - baseline.animationFrames,
      fetches: activity.fetches - baseline.fetches,
    },
  };
};

function Fixture() {
  const [count, setCount] = useState(0);
  const [value, setValue] = useState("original");
  const [progress, setProgress] = useState({ ...activity });
  useEffect(() => {
    let disposed = false;
    let timeout = 0;
    let fetchTimeout = 0;
    let animation = 0;
    const publish = () => {
      const time = performance.now();
      history.push({ ...activity, time });
      while (history.length > 1 && history[1].time < time - 10000) history.shift();
      setProgress({ ...activity });
    };
    const timerTick = () => {
      if (disposed) return;
      activity.timeouts++;
      publish();
      timeout = window.setTimeout(timerTick, 100);
    };
    const animationTick = () => {
      if (disposed) return;
      activity.animationFrames++;
      publish();
      animation = requestAnimationFrame(animationTick);
    };
    const fetchTick = async () => {
      try {
        const response = await fetch("/tick");
        if (!response.ok) throw new Error("The activity fixture is unavailable.");
        await response.json();
        if (disposed) return;
        activity.fetches++;
        publish();
        fetchTimeout = window.setTimeout(() => { void fetchTick(); }, 200);
      } catch (error) {
        document.body.dataset.fetchError = String(error);
      }
    };
    timeout = window.setTimeout(timerTick, 100);
    const interval = window.setInterval(() => {
      activity.intervals++;
      publish();
    }, 100);
    animation = requestAnimationFrame(animationTick);
    void fetchTick();
    return () => {
      disposed = true;
      clearTimeout(timeout);
      clearInterval(interval);
      clearTimeout(fetchTimeout);
      cancelAnimationFrame(animation);
    };
  }, []);

  return (
    <main>
      <section id="interaction">
        <button id="react-click" onClick={() => setCount(previous => previous + 1)}>Update React state</button>
        <output id="react-value">{count}</output>
      </section>
      <label>Controlled input <input id="input" value={value} onChange={event => setValue(event.target.value)} /></label>
      <output id="controlled-value">{value}</output>
      <section id="activity">
        <p>Timeouts <output>{progress.timeouts}</output></p>
        <p>Plain interval <output>{progress.intervals}</output></p>
        <p>Animation frames <output>{progress.animationFrames}</output></p>
        <p>Completed fetches <output>{progress.fetches}</output></p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
