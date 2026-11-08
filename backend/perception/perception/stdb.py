"""SpacetimeDB HTTP client (perception.md section 8).

- Identity: POST {uri}/v1/identity once, saved to data/identity.json (git-ignored).
- Reducer call: POST {uri}/v1/database/{db}/call/{reducer}, JSON array of positional arguments,
  Authorization: Bearer <token>. 5 s timeout. Network errors and 5xx other than 530 are retried
  after 0.5, 1, 2, 4, 8 s. A 4xx or 530 is a reducer rejection and is never retried.
- SQL: POST {uri}/v1/database/{db}/sql with the SQL text as the body.
  The response is a JSON array with one {"schema": ProductType, "rows": [...]} per statement.
- SATS-JSON encoding of arguments: encode_enum and encode_option.
- decode_rows maps SQL rows to plain dicts in the same shape the Node helper prints:
  enums as their tag string, options as the value or None, Timestamps as ISO 8601 strings,
  Identities as 64-character hex.

Python has no maintained SpacetimeDB SDK, so this is plain httpx.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import httpx

log = logging.getLogger(__name__)

DEFAULT_BACKOFF = (0.5, 1.0, 2.0, 4.0, 8.0)
REREGISTER = re.compile(r"not registered|role not granted", re.I)
TIMESTAMP_FIELD = "__timestamp_micros_since_unix_epoch__"
IDENTITY_FIELD = "__identity__"
DURATION_FIELD = "__time_duration_micros__"


class StdbError(Exception):
    def __init__(self, message: str, status: int | None = None, text: str = ""):
        super().__init__(message)
        self.status = status
        self.text = text


class StdbRejected(StdbError):
    """4xx or 530: the module refused the call (for example a SenderError). Do not retry."""


class StdbUnavailable(StdbError):
    """The network or the server failed for longer than the retries. Keep the write and retry later."""


# SATS-JSON argument encoding (perception.md section 8.3)

def encode_enum(tag: str, data: Any = None) -> dict:
    """{"detected": []} for a variant with no data."""
    return {tag: [] if data is None else data}


def encode_option(value: Any) -> dict:
    """{"some": x} or {"none": []}."""
    return {"none": []} if value is None else {"some": value}


# SQL row decoding (perception.md section 8.5)

def micros_to_iso(micros: int) -> str:
    dt = datetime.fromtimestamp(int(micros) / 1_000_000, tz=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def parse_iso(text: str | None) -> datetime | None:
    """ISO 8601 (with Z or an offset) to an aware datetime; None if missing or unreadable."""
    if not text:
        return None
    if isinstance(text, (int, float)):
        return datetime.fromtimestamp(float(text) / 1_000_000, tz=timezone.utc)
    try:
        return datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    except ValueError:
        return None


def _element_name(element: dict) -> str | None:
    name = element.get("name")
    if isinstance(name, dict):
        if "some" in name:
            return name["some"]
        return None
    return name


def _type_kind(algebraic_type: Any) -> tuple[str | None, Any]:
    """{"Product": {...}} -> ("Product", {...}); {"U64": []} -> ("U64", [])."""
    if isinstance(algebraic_type, dict) and len(algebraic_type) == 1:
        (k, v), = algebraic_type.items()
        return k, v
    return None, None


def _special_product(names: list[str | None]) -> str | None:
    if names == [TIMESTAMP_FIELD]:
        return "timestamp"
    if names == [IDENTITY_FIELD]:
        return "identity"
    if names == [DURATION_FIELD]:
        return "duration"
    return None


def _scalar(value: Any) -> Any:
    """Unwrap a one-element list ([1730000000000000] for a timestamp)."""
    if isinstance(value, list) and len(value) == 1:
        return value[0]
    return value


def _identity_hex(value: Any) -> str:
    value = _scalar(value)
    if isinstance(value, dict) and IDENTITY_FIELD in value:
        value = value[IDENTITY_FIELD]
    if isinstance(value, int):
        return f"{value:064x}"
    text = str(value)
    return text[2:].lower() if text.startswith("0x") else text.lower()


def decode_heuristic(value: Any) -> Any:
    """Decode a SATS-JSON value without a schema (an object row, or a Ref type)."""
    if isinstance(value, dict):
        if len(value) == 1:
            (k, v), = value.items()
            if k == "some":
                return decode_heuristic(v)
            if k == "none":
                return None
            if k == TIMESTAMP_FIELD:
                return micros_to_iso(_scalar(v))
            if k == IDENTITY_FIELD:
                return _identity_hex(v)
            if k == DURATION_FIELD:
                return int(_scalar(v))
            if v == [] or v == {}:
                return k  # unit enum variant
        return {k: decode_heuristic(v) for k, v in value.items()}
    if isinstance(value, list):
        return [decode_heuristic(v) for v in value]
    return value


def decode_value(value: Any, algebraic_type: Any) -> Any:
    kind, body = _type_kind(algebraic_type)
    if kind is None or kind == "Ref":
        return decode_heuristic(value)

    if kind == "Product":
        elements = (body or {}).get("elements", [])
        names = [_element_name(e) for e in elements]
        special = _special_product(names)
        if special == "timestamp":
            inner = value.get(TIMESTAMP_FIELD) if isinstance(value, dict) else _scalar(value)
            return micros_to_iso(_scalar(inner))
        if special == "identity":
            return _identity_hex(value)
        if special == "duration":
            inner = value.get(DURATION_FIELD) if isinstance(value, dict) else _scalar(value)
            return int(_scalar(inner))
        if isinstance(value, dict):
            out = {}
            for name, element in zip(names, elements):
                if name in value:
                    out[name] = decode_value(value[name], element.get("algebraic_type"))
            return out
        if isinstance(value, list):
            return {
                (name if name is not None else str(i)): decode_value(v, element.get("algebraic_type"))
                for i, (name, element, v) in enumerate(zip(names, elements, value))
            }
        return value

    if kind == "Sum":
        variants = (body or {}).get("variants", [])
        vnames = [_element_name(v) for v in variants]
        tag, data = None, None
        if isinstance(value, dict) and len(value) == 1:
            (k, data), = value.items()
            tag = int(k) if k.isdigit() and k not in vnames else k
        elif isinstance(value, list) and len(value) == 2 and isinstance(value[0], int):
            tag, data = value
        elif isinstance(value, int) and not isinstance(value, bool):
            tag, data = value, []
        elif isinstance(value, str):
            return value
        else:
            return decode_heuristic(value)
        if isinstance(tag, int):
            idx = tag
            tag = vnames[idx] if 0 <= idx < len(vnames) else str(idx)
        else:
            idx = vnames.index(tag) if tag in vnames else -1
        vtype = variants[idx].get("algebraic_type") if idx >= 0 else None
        if set(vnames) == {"some", "none"}:
            return None if tag == "none" else decode_value(data, vtype)
        vkind, vbody = _type_kind(vtype)
        unit = data in ([], {}, None) or (vkind == "Product" and not (vbody or {}).get("elements"))
        return tag if unit else {tag: decode_value(data, vtype)}

    if kind == "Array":
        if isinstance(value, list):
            return [decode_value(v, body) for v in value]
        return value

    if kind in ("U128", "I128", "U256", "I256") and isinstance(value, str):
        try:
            return int(value, 0)
        except ValueError:
            return value
    return value


def decode_rows(statement: dict) -> list[dict]:
    """One {"schema", "rows"} statement result to a list of dicts keyed by column name.
    Accepts a row as an array (the default) or as an object."""
    schema = statement.get("schema") or {}
    if "Product" in schema:
        schema = schema["Product"]
    elements = schema.get("elements", [])
    names = [_element_name(e) or str(i) for i, e in enumerate(elements)]
    types = [e.get("algebraic_type") for e in elements]
    out = []
    for row in statement.get("rows", []):
        if isinstance(row, dict):
            by_name = dict(zip(names, types))
            out.append({k: decode_value(v, by_name.get(k)) for k, v in row.items()})
        else:
            out.append({name: decode_value(v, t) for name, t, v in zip(names, types, row)})
    return out


def decode_sql_response(payload: Any) -> list[list[dict]]:
    """The full SQL response (a list of statements) to one list of row dicts per statement."""
    if isinstance(payload, dict):
        payload = [payload]
    return [decode_rows(s) for s in payload]


# Client

class StdbClient:
    def __init__(self, uri: str, database: str, *, token: str | None = None,
                 identity_path: str | Path | None = None, timeout_s: float = 5.0,
                 backoff_s: tuple[float, ...] | list[float] = DEFAULT_BACKOFF,
                 transport: httpx.BaseTransport | None = None,
                 sleep: Callable[[float], None] = time.sleep):
        self.uri = uri.rstrip("/")
        self.database = database
        self.token = token or None
        self.identity: str | None = None
        self.identity_path = Path(identity_path) if identity_path else None
        self.backoff_s = tuple(float(b) for b in backoff_s)
        self._sleep = sleep
        self._client = httpx.Client(timeout=timeout_s, transport=transport)
        self._lock = threading.Lock()
        self.ok_once = False  # set after the first successful reducer call (GET /health)
        # Set when a write is rejected because this identity is not registered (or its role is not
        # granted yet); app._startup_stdb waits on it and calls register_participant again.
        self.needs_register = threading.Event()
        self.last_error: str | None = None

    @classmethod
    def from_config(cls, cfg: dict, **kwargs) -> "StdbClient":
        s = cfg["stdb"]
        return cls(s["uri"], s["database"], token=s.get("token") or None,
                   identity_path=Path(cfg["paths"]["data_dir"]) / "identity.json",
                   timeout_s=float(s.get("timeout_s", 5)),
                   backoff_s=s.get("retry_backoff_s", DEFAULT_BACKOFF), **kwargs)

    def close(self) -> None:
        self._client.close()

    def _url(self, path: str) -> str:
        return f"{self.uri}{path}"

    def _headers(self) -> dict:
        h = {}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        return h

    # identity (perception.md section 8.2 step 1)
    def ensure_identity(self, *, retry: bool = True) -> str:
        """Use the configured token, else data/identity.json, else create one and save it.
        Returns the token. SQL reads pass retry=False so a down server does not stall the worker."""
        with self._lock:
            if self.token:
                if self.identity is None and self.identity_path and self.identity_path.is_file():
                    saved = json.loads(self.identity_path.read_text())
                    if saved.get("token") == self.token:
                        self.identity = saved.get("identity")
                return self.token
            if self.identity_path and self.identity_path.is_file():
                saved = json.loads(self.identity_path.read_text())
                self.token = saved["token"]
                self.identity = saved.get("identity")
                return self.token
            resp = self._send("POST", "/v1/identity", retry=retry)
            body = resp.json()
            self.token = body["token"]
            self.identity = body.get("identity")
            if self.identity_path:
                self.identity_path.parent.mkdir(parents=True, exist_ok=True)
                self.identity_path.write_text(json.dumps({"identity": self.identity, "token": self.token}))
                try:
                    self.identity_path.chmod(0o600)
                except OSError:
                    pass
            log.info("created SpacetimeDB identity %s", self.identity)
            return self.token

    def register_participant(self, name: str = "perception", role: str = "perception") -> None:
        """register_participant(name, role); rejected outside demo mode without a grant_role."""
        self.call("register_participant", [name, encode_enum(role)])

    # transport with retries
    def _send(self, method: str, path: str, *, content: bytes | str | None = None,
              json_body: Any = None, retry: bool = True) -> httpx.Response:
        attempts = len(self.backoff_s) + 1 if retry else 1
        last: Exception | None = None
        for attempt in range(attempts):
            try:
                resp = self._client.request(method, self._url(path), headers=self._headers(),
                                            content=content, json=json_body)
            except httpx.HTTPError as exc:
                last = exc
                self.last_error = f"network: {exc}"
            else:
                status = resp.status_code
                if 200 <= status < 300:
                    return resp
                text = resp.text
                if 400 <= status < 500 or status == 530:
                    self.last_error = f"HTTP {status}: {text}"
                    raise StdbRejected(f"{path} rejected with HTTP {status}: {text}", status, text)
                last = StdbError(f"HTTP {status}: {text}", status, text)
                self.last_error = f"HTTP {status}: {text}"
            if attempt < attempts - 1:
                self._sleep(self.backoff_s[attempt])
        raise StdbUnavailable(f"{path} failed after {attempts} attempts: {last}",
                              getattr(last, "status", None), getattr(last, "text", ""))

    def call(self, reducer: str, args: list) -> None:
        """Call a reducer with positional SATS-JSON arguments.
        Raises StdbRejected (4xx, 530) or StdbUnavailable (after the retries)."""
        if not self.token:
            self.ensure_identity()
        try:
            self._send("POST", f"/v1/database/{self.database}/call/{reducer}", json_body=args)
        except StdbRejected as exc:
            if reducer != "register_participant" and REREGISTER.search(exc.text or str(exc)):
                self.needs_register.set()
            raise
        self.ok_once = True
        self.last_error = None

    def sql_raw(self, query: str, *, retry: bool = False) -> Any:
        """SQL reads do not retry by default: the poller asks again in 2 s anyway."""
        if not self.token:
            self.ensure_identity(retry=retry)
        resp = self._send("POST", f"/v1/database/{self.database}/sql", content=query.encode("utf-8"),
                          retry=retry)
        return resp.json()

    def sql(self, query: str, *, retry: bool = False) -> list[dict]:
        """Rows of the first statement as dicts."""
        decoded = decode_sql_response(self.sql_raw(query, retry=retry))
        return decoded[0] if decoded else []
