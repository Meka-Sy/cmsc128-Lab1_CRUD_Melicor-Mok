const pw = document.getElementById("password");
const cf = document.getElementById("confirm_password");

document.getElementById("showPw").addEventListener("change", e => {
  const type = e.target.checked ? "text" : "password";
  pw.type = type;
  if (cf) cf.type = type;
});

if (cf) {
  cf.addEventListener("input", () => {
    cf.setCustomValidity(cf.value === pw.value ? "" : "Passwords don't match");
  });
}