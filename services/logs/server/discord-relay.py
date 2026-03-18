"""Alertmanager → Discord webhook relay.

Receives Alertmanager webhook POSTs, reformats as Discord embeds, forwards to
a Discord webhook URL. Runs as a standalone HTTP server on port 9095.

Zero dependencies beyond Python 3 stdlib.
"""

import json
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import Request, urlopen

WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "")
if not WEBHOOK_URL:
    print("DISCORD_WEBHOOK_URL not set — relay will log alerts to stdout only", file=sys.stderr)

# Severity → Discord embed color (decimal)
COLORS = {
    "critical": 0xFF0000,  # Red
    "warning": 0xFFA500,   # Orange
    "info": 0x0099FF,      # Blue
}


def format_embed(alert):
    status = alert.get("status", "unknown")
    labels = alert.get("labels", {})
    annotations = alert.get("annotations", {})

    name = labels.get("alertname", "Alert")
    severity = labels.get("severity", "warning")
    summary = annotations.get("summary", name)
    description = annotations.get("description", "")

    if status == "resolved":
        color = 0x00FF00  # Green
        title = f"Resolved: {summary}"
    else:
        color = COLORS.get(severity, 0xFFA500)
        title = f"{summary}"

    embed = {"title": title, "color": color}
    if description:
        # Discord embeds have a 4096 char limit
        embed["description"] = description[:4000]

    fields = []
    if "host" in labels:
        fields.append({"name": "Host", "value": labels["host"], "inline": True})
    if "job" in labels:
        fields.append({"name": "Job", "value": labels["job"], "inline": True})
    if severity and status != "resolved":
        fields.append({"name": "Severity", "value": severity, "inline": True})
    if fields:
        embed["fields"] = fields

    return embed


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            return

        alerts = data.get("alerts", [])
        if not alerts:
            self.send_response(200)
            self.end_headers()
            return

        # Build Discord message with embeds (max 10 per message)
        embeds = [format_embed(a) for a in alerts[:10]]
        overflow = len(alerts) - 10

        msg = {"embeds": embeds}
        if overflow > 0:
            msg["content"] = f"(+{overflow} more alerts)"
        payload = json.dumps(msg).encode()
        print(f"Relaying {len(alerts)} alert(s) to Discord", file=sys.stderr)

        if WEBHOOK_URL:
            try:
                req = Request(WEBHOOK_URL, data=payload, headers={
                    "Content-Type": "application/json",
                    "User-Agent": "Forumline-AlertRelay/1.0",
                })
                urlopen(req, timeout=10)
            except Exception as e:
                print(f"Discord POST failed: {e}", file=sys.stderr)
        else:
            # No webhook configured — just log
            for alert in alerts:
                status = alert.get("status", "?")
                name = alert.get("labels", {}).get("alertname", "?")
                print(f"  [{status}] {name}", file=sys.stderr)

        self.send_response(200)
        self.end_headers()

    def log_message(self, format, *args):
        # Suppress noisy per-request logs
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "9095"))
    server = HTTPServer(("", port), Handler)
    print(f"Discord relay listening on :{port}", file=sys.stderr)
    server.serve_forever()
