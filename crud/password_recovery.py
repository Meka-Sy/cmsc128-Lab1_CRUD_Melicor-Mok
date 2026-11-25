"""password_recovery.py — email-based password reset.

Changes vs the migration version:
* The debug `print(f"DEBUG: email = ...")` line is gone.
* Reset links are only written to the log in development (app.debug). In
  production the link is never printed, even if SMTP is misconfigured.
* Email failures are logged, not raised, so /forgot stays non-enumerable.
"""
import hashlib
import logging
import os
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from flask import Blueprint, current_app, flash, redirect, render_template, request, url_for
from psycopg2.extras import RealDictCursor
from werkzeug.security import generate_password_hash

from db import get_db

recovery_bp = Blueprint("recovery", __name__)
log = logging.getLogger(__name__)

TOKEN_TTL = timedelta(minutes=15)
GENERIC_MSG = "A reset link has been sent to your registered email."


def _hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def _now():
    return datetime.now(timezone.utc)


def _find_valid_token(conn, token):
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT * FROM reset_tokens WHERE token_hash = %s AND used = 0",
            (_hash(token),),
        )
        row = cur.fetchone()
    if row is None or row["expires_at"] <= _now():
        return None
    return row


def _send_reset_email(to_email, reset_link):
    sender_email = os.environ.get("SMTP_EMAIL")
    sender_password = os.environ.get("SMTP_PASSWORD")

    if not sender_email or not sender_password:
        if current_app.debug:
            log.warning("[DEV] Reset link for %s: %s", to_email, reset_link)
        else:
            log.error("SMTP not configured; reset email NOT sent for %s", to_email)
        return

    try:
        msg = MIMEMultipart()
        msg["From"] = sender_email
        msg["To"] = to_email
        msg["Subject"] = "Reset your password"
        msg.attach(MIMEText(
            "Hi,\n\n"
            "Click the link below to reset your password. It expires in 15 minutes.\n\n"
            f"{reset_link}\n\n"
            "If you didn't request this, you can ignore this email.\n",
            "plain",
        ))
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=10) as server:
            server.login(sender_email, sender_password)
            server.send_message(msg)
        log.info("Reset email sent to %s", to_email)
    except Exception:
        log.exception("Failed to send reset email to %s", to_email)


@recovery_bp.route("/forgot", methods=["GET", "POST"])
def forgot():
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        conn = get_db()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT id FROM users WHERE email = %s", (email,))
            user = cur.fetchone()

            if user:
                token = secrets.token_urlsafe(32)
                cur.execute(
                    "UPDATE reset_tokens SET used = 1 WHERE user_id = %s AND used = 0",
                    (user["id"],),
                )
                cur.execute(
                    "INSERT INTO reset_tokens (user_id, token_hash, expires_at) "
                    "VALUES (%s, %s, %s)",
                    (user["id"], _hash(token), _now() + TOKEN_TTL),
                )
                conn.commit()
                link = url_for("recovery.reset", token=token, _external=True)
                _send_reset_email(email, link)
                log.info("Reset requested for user_id=%s", user["id"])
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
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE reset_tokens SET used = 1 WHERE id = %s AND used = 0",
                    (row["id"],),
                )
                if cur.rowcount == 0:
                    conn.rollback()
                    return render_template("reset.html", valid=False, error=None), 400
                cur.execute(
                    "UPDATE users SET password_hash = %s WHERE id = %s",
                    (generate_password_hash(password), row["user_id"]),
                )
                cur.execute(
                    "UPDATE reset_tokens SET used = 1 WHERE user_id = %s",
                    (row["user_id"],),
                )
            conn.commit()
            log.info("Password reset completed for user_id=%s", row["user_id"])
            flash("Password updated. Please log in.", "success")
            return redirect(url_for("auth.login"))
    return render_template("reset.html", valid=True, error=error)