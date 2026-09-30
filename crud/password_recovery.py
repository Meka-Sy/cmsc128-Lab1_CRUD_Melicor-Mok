"""password recovery (/forgot, /reset/<token>).

Delivery method: reset links are sent via SMTP (Gmail).
Set in .env:
  SMTP_EMAIL=your-email@gmail.com
  SMTP_PASSWORD=your-app-password
"""
import hashlib
import os
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from flask import Blueprint, flash, redirect, render_template, request, url_for
from werkzeug.security import generate_password_hash

from db import get_db

recovery_bp = Blueprint("recovery", __name__)

TOKEN_TTL = timedelta(minutes=15)
GENERIC_MSG = "A reset link has been sent to your registered email."


def _hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def _now():
    return datetime.now(timezone.utc)


def _find_valid_token(conn, token):
    row = conn.execute(
        "SELECT * FROM reset_tokens WHERE token_hash = ? AND used = 0", (_hash(token),)
    ).fetchone()
    if row is None or datetime.fromisoformat(row["expires_at"]) <= _now():
        return None
    return row


def _send_reset_email(to_email, reset_link):
    sender_email = os.environ.get("SMTP_EMAIL")
    sender_password = os.environ.get("SMTP_PASSWORD")

    if not sender_email or not sender_password:
        # Fallback: print to console if env vars are not set
        print(f"\n[PASSWORD RESET] {to_email}\n  {reset_link}\n  (expires in 15 minutes)\n", flush=True)
        return
    
    try:
        msg = MIMEMultipart()
        msg["From"] = sender_email
        msg["To"] = to_email
        msg["Subject"] = "Reset your password"
        
        body = f"""\
Hi, TO-DO LIST USER!

Click the link below to reset your password. It expires in 15 minutes.

{reset_link}

If you didn't request this, you can ignore this email.
"""
        msg.attach(MIMEText(body, "plain"))
        
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(sender_email, sender_password)
            server.send_message(msg)
    except Exception as e:
        print(f"ERROR sending email to {to_email}: {e}", flush=True)


@recovery_bp.route("/forgot", methods=["GET", "POST"])
def forgot():
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        print(f"DEBUG: email = {email}", flush=True)
        conn = get_db()
        user = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()

        if user:
            token = secrets.token_urlsafe(32)
            # one live token per user
            conn.execute("UPDATE reset_tokens SET used = 1 WHERE user_id = ? AND used = 0", (user["id"],))
            conn.execute(
                "INSERT INTO reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
                (user["id"], _hash(token), (_now() + TOKEN_TTL).isoformat()),
            )
            conn.commit()
            link = url_for("recovery.reset", token=token, _external=True)
            _send_reset_email(email, link)
        flash(GENERIC_MSG, "success")
        return redirect(url_for("auth.login"))
    return render_template("forgot.html")


@recovery_bp.route("/reset/<token>", methods=["GET", "POST"])
def reset(token):
    conn = get_db()
    row = _find_valid_token(conn, token)
    if row is None:
        return render_template("reset.html", valid=False, error=None), 400

    error = None
    if request.method == "POST":
        password = request.form.get("password", "")
        confirm = request.form.get("confirm_password", "")
        if len(password) < 8:
            error = "Password must be at least 8 characters."
        elif password != confirm:
            error = "Passwords don't match."
        else:
            # claim the token atomically so a link can't be used twice
            claimed = conn.execute(
                "UPDATE reset_tokens SET used = 1 WHERE id = ? AND used = 0", (row["id"],)
            ).rowcount
            if claimed == 0:
                conn.rollback()
                return render_template("reset.html", valid=False, error=None), 400
            conn.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (generate_password_hash(password), row["user_id"]),
            )
            conn.execute("UPDATE reset_tokens SET used = 1 WHERE user_id = ?", (row["user_id"],))
            conn.commit()
            flash("Password updated. Please log in.", "success")
            return redirect(url_for("auth.login"))
    return render_template("reset.html", valid=True, error=error)