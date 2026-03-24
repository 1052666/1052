// ─── Utility helpers ──────────────────────────────────────────────

/** Shorthand for document.getElementById */
function $(id) {
  return document.getElementById(id);
}

/** Escape HTML special characters */
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Temporarily show a different label on a button, then restore original */
function flashBtn(btn, text) {
  const orig = btn.textContent;
  btn.textContent = text;
  setTimeout(() => btn.textContent = orig, 1500);
}
