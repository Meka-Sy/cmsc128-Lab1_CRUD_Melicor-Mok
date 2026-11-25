/* Logout confirmation dialog behaviour. Styles live in logoutConfirm.css.
   Add the `data-confirm-logout` attribute to any logout <form>, then include
   this script and the stylesheet. Clicking the button opens a "Log out?" dialog
   with Cancel / Log out; the form only submits after "Log out" is chosen.
   Cancel, Escape, or a click outside closes it. */
(function () {
  const forms = document.querySelectorAll("form[data-confirm-logout]");
  if (!forms.length) return;

  const overlay = document.createElement("div");
  overlay.className = "logoutOverlay";
  overlay.innerHTML =
    '<div class="logoutDialog" role="alertdialog" aria-modal="true" ' +
    'aria-labelledby="logoutTitle" aria-describedby="logoutDesc">' +
    '<h2 id="logoutTitle">Log out?</h2>' +
    '<p id="logoutDesc">You\u2019ll need to log in again to get back to your tasks.</p>' +
    '<div class="logoutActions">' +
    '<button type="button" class="ltCancel">Cancel</button>' +
    '<button type="button" class="ltConfirm">Log out</button>' +
    "</div></div>";
  document.body.appendChild(overlay);

  const cancelBtn = overlay.querySelector(".ltCancel");
  const confirmBtn = overlay.querySelector(".ltConfirm");
  let activeForm = null;
  let opener = null;

  const isOpen = () => overlay.classList.contains("show");

  function open(form, trigger) {
    activeForm = form;
    opener = trigger;
    overlay.classList.add("show");
    // focus Cancel so a stray Enter press doesn't log the user out
    cancelBtn.focus();
  }

  function close() {
    overlay.classList.remove("show");
    if (opener) opener.focus();
    activeForm = null;
    opener = null;
  }

  forms.forEach(form => {
    form.addEventListener("submit", e => {
      e.preventDefault();
      open(form, e.submitter || form.querySelector("button"));
    });
  });

  cancelBtn.addEventListener("click", close);

  confirmBtn.addEventListener("click", () => {
    const form = activeForm;
    cancelBtn.disabled = confirmBtn.disabled = true;
    if (form) form.submit(); // form.submit() skips the submit event, so no loop
  });

  // click on the dimmed area outside the dialog closes it
  overlay.addEventListener("click", e => {
    if (e.target === overlay) close();
  });

  document.addEventListener("keydown", e => {
    if (!isOpen()) return;
    if (e.key === "Escape") {
      close();
    } else if (e.key === "Tab") {
      // keep keyboard focus inside the dialog
      const order = [cancelBtn, confirmBtn];
      const i = order.indexOf(document.activeElement);
      const next = e.shiftKey ? (i <= 0 ? 1 : i - 1) : (i === -1 || i === 1 ? 0 : i + 1);
      e.preventDefault();
      order[next].focus();
    }
  });
})();