const pw = document.getElementById("password");
const cf = document.getElementById("confirm_password");

document.getElementById("showPw").addEventListener("change", e => {
  pw.type = cf.type = e.target.checked ? "text" : "password";
});

cf.addEventListener("input", () => {
  cf.setCustomValidity(cf.value === pw.value ? "" : "Passwords don't match");
});