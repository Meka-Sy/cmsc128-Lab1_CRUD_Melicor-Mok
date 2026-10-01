const f = document.getElementById("profileForm");
const np = document.getElementById("new_password");
const cf = document.getElementById("confirm_password");
const hint = document.getElementById("matchHint");
let dirty = false, submitting = false;

f.addEventListener("input", () => {
  dirty = true;
  hint.hidden = !cf.value || cf.value === np.value;
});
// warn before leaving with unsaved edits instead of silently discarding them
window.addEventListener("beforeunload", e => {
  if (dirty && !submitting) { e.preventDefault(); e.returnValue = ""; }
});
f.addEventListener("submit", e => {
  if (cf.value !== np.value) { e.preventDefault(); hint.hidden = false; return; }
  submitting = true;
  const b = document.getElementById("saveBtn");
  b.disabled = true; b.textContent = "Saving…";
});