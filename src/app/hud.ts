// Tiny status pill helpers — keeps DOM querying out of main.ts.

const setPill = (el: HTMLElement, text: string, level: 'ok' | 'warn' | 'err'): void => {
  el.textContent = text;
  el.classList.remove('ok', 'warn', 'err');
  el.classList.add(level);
};

export const hud = (() => {
  const tl = document.getElementById('hud-tl') as HTMLElement;
  const renderer = document.getElementById('stat-renderer') as HTMLElement;
  const worker = document.getElementById('stat-worker') as HTMLElement;
  const fps = document.getElementById('stat-fps') as HTMLElement;
  const tick = document.getElementById('stat-tick') as HTMLElement;
  return {
    setHint: (msg: string): void => { tl.textContent = msg; },
    setRenderer: (text: string, level: 'ok' | 'warn' | 'err'): void => setPill(renderer, text, level),
    setWorker: (text: string, level: 'ok' | 'warn' | 'err'): void => setPill(worker, text, level),
    setFps: (n: number): void => { fps.textContent = n.toFixed(0); },
    setTick: (n: number): void => { tick.textContent = String(n); },
  };
})();
