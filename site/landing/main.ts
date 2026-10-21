// The landing page (index.html): its type, and the screenshot viewer.
import '@fontsource/inter-tight/latin-400.css';
import '@fontsource/inter-tight/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './landing.css';

const shots = [...document.querySelectorAll<HTMLImageElement>('.viewer img')];
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.contents button')];
let at = 0;

function show(i: number): void {
  at = (i + shots.length) % shots.length;
  shots.forEach((s, j) => (s.hidden = j !== at));
  tabs.forEach((t, j) => t.setAttribute('aria-current', String(j === at)));
}

tabs.forEach((t, i) => t.addEventListener('click', () => show(i)));
document.querySelector('.prev')?.addEventListener('click', () => show(at - 1));
document.querySelector('.next')?.addEventListener('click', () => show(at + 1));
addEventListener('keydown', (e) => {
  // With a modifier, the arrows are the browser's (⌘← goes back).
  if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;
  if (e.key === 'ArrowLeft') show(at - 1);
  if (e.key === 'ArrowRight') show(at + 1);
});

const year = document.getElementById('year');
if (year) year.textContent = String(new Date().getFullYear());
