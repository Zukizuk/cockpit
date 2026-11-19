#!/usr/bin/env python3
"""Cockpit's only way into Kokoro: the journal, nothing else.

Installed on the Kokoro server (e.g. as ~/services/cockpit-gate/gate.py) and named as the forced command of Cockpit's own SSH key
in ~/.ssh/authorized_keys ("restrict,command=..."), so that key can run this and only this: no shell, no
forwarding, no other part of the server. It reads one JSON request on stdin and writes one JSON answer:

    {"op": "list"}                                  -> {"entries": [{id, created, updated, title, text, rev, media}]}
    {"op": "save", "entries": [{id?, title, text, rev}]}
                                                    -> {"results": [{"status": 200|409|..., "entry"?: {...}, "error"?}]}

A save without an id makes a new entry. It can't archive or delete an entry, or touch photos and voice notes:
only the title and text are passed on to Kokoro, which refuses a save over a change made on another device (409).
"""
import json
import sys
import urllib.error
import urllib.request

DESK = "http://127.0.0.1:8095"
MAX_IN = 8 * 1024 * 1024
MAX_SAVES = 60
MAX_TEXT = 50000


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(DESK + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {"error": f"Kokoro answered {e.code}"}


def slim(e):
    return {"id": e.get("id"), "created": e.get("created"), "updated": e.get("updated"), "title": e.get("title", ""),
            "text": e.get("text", ""), "rev": e.get("rev"), "media": len(e.get("media") or [])}


def main():
    try:
        req = json.loads(sys.stdin.buffer.read(MAX_IN).decode("utf-8") or "{}")
    except ValueError:
        return {"error": "send one JSON request"}
    op = req.get("op") if isinstance(req, dict) else None
    if op == "list":
        status, body = call("GET", "/api/journal")
        if status != 200:
            return {"error": body.get("error", f"Kokoro answered {status}")}
        return {"entries": [slim(e) for e in body.get("entries", [])]}
    if op == "save":
        entries = req.get("entries")
        if not isinstance(entries, list) or len(entries) > MAX_SAVES:
            return {"error": f"send 1 to {MAX_SAVES} entries"}
        results = []
        for e in entries:
            if not isinstance(e, dict) or not isinstance(e.get("text"), str) or len(e["text"]) > MAX_TEXT:
                results.append({"status": 400, "error": "bad entry"})
                continue
            body = {"text": e["text"], "rev": str(e.get("rev") or "")}
            if isinstance(e.get("id"), str) and e["id"]:
                body["id"] = e["id"]
            if isinstance(e.get("title"), str):
                body["title"] = e["title"][:200]
            status, got = call("POST", "/api/journal/entry", body)
            if status == 200:
                results.append({"status": 200, "entry": slim(got)})
            elif status == 409:
                results.append({"status": 409, "entry": slim(got.get("entry") or {})})
            else:
                results.append({"status": status, "error": got.get("error", f"Kokoro answered {status}")})
        return {"results": results}
    return {"error": "unknown request"}


if __name__ == "__main__":
    # plain ASCII out (\u escapes), whatever the locale of the SSH session or the reader on the other end
    sys.stdout.write(json.dumps(main(), ensure_ascii=True))
