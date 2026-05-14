"""Send the pulse report via email — mirrors sendReport.mjs.

Environment variables (same as the JS version):
  PULSE_MAIL_HOST        "gmail" | "outlook" | "smtp"  (default: "gmail")
  PULSE_MAIL_USERNAME    sender email address
  PULSE_MAIL_PASSWORD    app password / SMTP password
  PULSE_MAIL_PORT        SMTP port override (optional)
  PULSE_MAIL_SERVER      SMTP server hostname when PULSE_MAIL_HOST="smtp"
  RECIPIENT_EMAIL_1      recipient address (up to RECIPIENT_EMAIL_5)
"""
from __future__ import annotations

import os
import smtplib
import mimetypes
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from typing import List, Optional

from .email_generator import generate_email_html
from .shared_ui import console, error_console


_SMTP_CONFIGS = {
    "gmail":   ("smtp.gmail.com", 587),
    "outlook": ("smtp.office365.com", 587),
}


def send_report(
    report_json_path: str,
    attachment_path: Optional[str] = None,
    *,
    host: Optional[str] = None,
    username: Optional[str] = None,
    password: Optional[str] = None,
    recipients: Optional[List[str]] = None,
    smtp_server: Optional[str] = None,
    smtp_port: Optional[int] = None,
) -> None:
    """
    Generate an email summary from *report_json_path* and send it.

    Parameters can be provided directly or via environment variables.
    *attachment_path*, if given, is attached to the email (e.g. the static HTML).
    """
    # Load .env if dotenv is available
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    host = host or os.environ.get("PULSE_MAIL_HOST", "gmail").lower()
    username = username or os.environ.get("PULSE_MAIL_USERNAME", "")
    password = password or os.environ.get("PULSE_MAIL_PASSWORD", "")

    if not username or not password:
        raise ValueError(
            "Email credentials missing. Set PULSE_MAIL_USERNAME and "
            "PULSE_MAIL_PASSWORD environment variables (or pass them directly)."
        )

    # Resolve recipients
    if recipients is None:
        recipients = []
        for i in range(1, 6):
            addr = os.environ.get(f"RECIPIENT_EMAIL_{i}", "").strip()
            if addr:
                recipients.append(addr)
    recipients = [r for r in recipients if r]
    if not recipients:
        raise ValueError(
            "No recipients configured. Set RECIPIENT_EMAIL_1 … RECIPIENT_EMAIL_5 "
            "environment variables (or pass recipients directly)."
        )

    # SMTP server + port
    if smtp_server is None:
        if host == "smtp":
            smtp_server = os.environ.get("PULSE_MAIL_SERVER", "")
            if not smtp_server:
                raise ValueError("PULSE_MAIL_SERVER is required when PULSE_MAIL_HOST=smtp")
        else:
            smtp_server, default_port = _SMTP_CONFIGS.get(host, ("smtp.gmail.com", 587))
    if smtp_port is None:
        smtp_port = int(os.environ.get("PULSE_MAIL_PORT", default_port if "default_port" in dir() else 587))

    # Generate email body
    html_body = generate_email_html(report_json_path)

    msg = MIMEMultipart("mixed")
    msg["Subject"] = f"Pulse Report — {_now_str()}"
    msg["From"] = username
    msg["To"] = ", ".join(recipients)

    # HTML alternative part
    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(html_body, "html", "utf-8"))
    msg.attach(alt)

    # Optional attachment (static HTML report)
    if attachment_path and os.path.isfile(attachment_path):
        mime_type, _ = mimetypes.guess_type(attachment_path)
        main_type, sub_type = (mime_type or "application/octet-stream").split("/", 1)
        with open(attachment_path, "rb") as fh:
            payload = fh.read()
        part = MIMEBase(main_type, sub_type)
        part.set_payload(payload)
        encoders.encode_base64(part)
        part.add_header(
            "Content-Disposition",
            "attachment",
            filename=os.path.basename(attachment_path),
        )
        msg.attach(part)

    console.print(f"[bold blue]PulseReport:[/bold blue] Connecting to {smtp_server}:{smtp_port} as {username} …")
    with smtplib.SMTP(smtp_server, smtp_port) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(username, password)
        server.sendmail(username, recipients, msg.as_string())

    console.print(f"[bold blue]PulseReport:[/bold blue] Email sent to {', '.join(recipients)}")


def _now_str() -> str:
    from datetime import datetime
    return datetime.now().strftime("%Y-%m-%d %H:%M")
