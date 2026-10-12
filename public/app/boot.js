// Apply a saved light/dark choice and desk color before first paint (see src/theme.ts).
// A file of its own, not inline, so the Content Security Policy can allow only the
// site's own scripts (see netlify.toml).
try {
  var t = localStorage.getItem('photobook-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  var d = localStorage.getItem('photobook-desk');
  if (d && /^#[0-9a-f]{6}$/i.test(d)) document.documentElement.style.setProperty('--desk', d);
} catch (e) {}
