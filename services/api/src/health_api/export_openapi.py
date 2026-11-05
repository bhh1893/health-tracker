"""Writes openapi.json, the contract `web` generates its types from (ADR 0003)."""

import json
from pathlib import Path

from health_api.main import create_app

OPENAPI_PATH = Path(__file__).resolve().parents[2] / "openapi.json"


def main() -> None:
    schema = create_app().openapi()
    OPENAPI_PATH.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
