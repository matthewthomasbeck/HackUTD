"""SpacetimeDB HTTP writes and schema-driven SATS SQL decoding."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import time
from urllib.parse import quote
import httpx


class ReducerRejected(RuntimeError):
    pass


def encode_enum(value):
    return {value: []}


def encode_option(value):
    return {"none": []} if value is None else {"some": value}


def decode_value(value, type_info=None):
    if isinstance(value, dict) and "__timestamp_micros_since_unix_epoch__" in value:
        return datetime.fromtimestamp(value["__timestamp_micros_since_unix_epoch__"]/1e6, timezone.utc).isoformat()
    variants = (type_info or {}).get("Sum", {}).get("variants", []) if isinstance(type_info, dict) else []
    if isinstance(value, dict) and len(value) == 1:
        tag, payload = next(iter(value.items()))
        if tag == "none":
            return None
        if tag == "some":
            return decode_value(payload)
        if payload == []:
            return tag
    if variants and isinstance(value, list) and len(value) == 2 and isinstance(value[0], int):
        variant = variants[value[0]]
        name = variant["name"]
        if name == "none":
            return None
        if name == "some":
            return decode_value(value[1], variant.get("algebraic_type"))
        return name
    return value


def decode_sql(response):
    result = []
    for statement in response:
        schema = statement.get("schema", {})
        elements = schema.get("elements", schema.get("Product", {}).get("elements", []))
        for row in statement.get("rows", []):
            if isinstance(row, dict):
                result.append({k:decode_value(v) for k,v in row.items()})
            else:
                result.append({item["name"]:decode_value(value, item.get("algebraic_type"))
                    for item,value in zip(elements,row)})
    return result


class SpacetimeDB:
    def __init__(self, config, client=None, sleep=time.sleep):
        self.config, self.sleep = config, sleep
        self.client = client or httpx.Client(timeout=5)
        self.token = config.stdb_token
        self.identity = None
        self.healthy = False

    @property
    def configured(self):
        return bool(self.config.stdb_uri and self.config.stdb_database)

    def initialize(self):
        if not self.configured:
            return False
        identity_file = self.config.data_dir / "identity.json"
        if not self.token:
            if identity_file.exists():
                identity = json.loads(identity_file.read_text())
            else:
                response = self.client.post(self.config.stdb_uri.rstrip("/")+"/v1/identity")
                response.raise_for_status()
                identity = response.json()
                identity_file.parent.mkdir(parents=True, exist_ok=True)
                descriptor = os.open(identity_file, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
                with os.fdopen(descriptor,"w") as stream:
                    json.dump(identity,stream)
            self.token, self.identity = identity["token"], identity["identity"]
        self.call("register_participant", ["perception",encode_enum("perception")])
        return True

    def call(self, reducer, args):
        if not self.configured:
            raise ConnectionError("SpacetimeDB not configured")
        url = (self.config.stdb_uri.rstrip("/") + "/v1/database/" + quote(self.config.stdb_database,safe="")
            + "/call/" + quote(reducer,safe=""))
        for attempt in range(6):
            try:
                response = self.client.post(url, json=args, headers={"Authorization":"Bearer "+self.token})
                if response.status_code == 530 or 400 <= response.status_code < 500:
                    self.healthy = False
                    raise ReducerRejected(response.text)
                response.raise_for_status()
                self.healthy = True
                return
            except (httpx.TransportError, httpx.HTTPStatusError):
                self.healthy = False
                if attempt == 5:
                    raise
                self.sleep(0.5 * 2**attempt)

    def rows(self, table):
        if table not in {"survivor", "detection", "search_cell", "run", "robot"}:
            raise ValueError("unsupported read table")
        if not self.configured:
            raise ConnectionError("SpacetimeDB not configured")
        response = self.client.post(self.config.stdb_uri.rstrip("/") + "/v1/database/"
            + quote(self.config.stdb_database,safe="") + "/sql", content=f"SELECT * FROM {table}",
            headers={"Authorization":"Bearer "+self.token,"Content-Type":"text/plain"})
        response.raise_for_status()
        return decode_sql(response.json())
