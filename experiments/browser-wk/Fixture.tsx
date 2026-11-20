import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const activity = { timeouts: 0, animationFrames: 0, fetches: 0 };

declare global {
  interface Window {
    probeActivity: typeof activity;
  }
}
window.probeActivity = activity;

function Fixture() {
  const [count, setCount] = useState(0);
  const [value, setValue] = useState("original");
  const [progress, setProgress] = useState({ ...activity });
  useEffect(() => {
    let disposed = false;
    let timeout = 0;
    let fetchTimeout = 0;
    let animation = 0;
    const timerTick = () => {
      if (disposed) return;
      activity.timeouts++;
      setProgress({ ...activity });
      timeout = window.setTimeout(timerTick, 100);
    };
    const animationTick = () => {
      if (disposed) return;
      activity.animationFrames++;
      setProgress({ ...activity });
      animation = requestAnimationFrame(animationTick);
    };
    const fetchTick = async () => {
      try {
        const response = await fetch("/tick");
        if (!response.ok) throw new Error("The activity fixture is unavailable.");
        await response.json();
        if (disposed) return;
        activity.fetches++;
        setProgress({ ...activity });
        fetchTimeout = window.setTimeout(() => { void fetchTick(); }, 200);
      } catch (error) {
        document.body.dataset.fetchError = String(error);
      }
    };
    timeout = window.setTimeout(timerTick, 100);
    animation = requestAnimationFrame(animationTick);
    void fetchTick();
    return () => {
      disposed = true;
      clearTimeout(timeout);
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
        <p>Animation frames <output>{progress.animationFrames}</output></p>
        <p>Completed fetches <output>{progress.fetches}</output></p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
