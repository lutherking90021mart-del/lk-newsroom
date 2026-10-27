#!/usr/bin/env python3
"""Split a generated LK Newsroom SQL import into retry-safe D1 batches.

Statements are detected with sqlite3.complete_statement so multiline article
content and quoted semicolons are preserved. The unsupported per-connection
PRAGMA foreign_keys switch from the SQLite export is omitted for D1.
"""
import argparse
import hashlib
import json
import re
import sqlite3
from pathlib import Path


def split_sql(source: Path, output_dir: Path, batch_size: int) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    files = []
    batch_statements = []
    total_statements = 0
    total_bytes = 0
    statement_count = 0
    pending = []

    def flush_batch():
        nonlocal batch_statements
        if not batch_statements:
            return
        number = len(files) + 1
        name = f"batch-{number:04d}.sql"
        path = output_dir / name
        with path.open("w", encoding="utf-8", newline="\n") as handle:
            for statement in batch_statements:
                handle.write(statement.rstrip() + "\n")
        files.append({
            "file": name,
            "statements": len(batch_statements),
            "bytes": path.stat().st_size,
        })
        batch_statements = []

    with source.open("r", encoding="utf-8-sig", newline="") as handle:
        for line in handle:
            if not pending and (not line.strip() or line.lstrip().startswith("--")):
                continue
            pending.append(line)
            if not sqlite3.complete_statement("".join(pending)):
                continue
            statement = "".join(pending).strip()
            pending = []
            if not statement or statement.lstrip().startswith("--"):
                continue
            if re.match(r"(?is)^PRAGMA\s+foreign_keys\s*=", statement):
                continue
            if not statement.endswith(";"):
                statement += ";"
            batch_statements.append(statement)
            statement_count += 1
            total_statements += 1
            total_bytes += len(statement.encode("utf-8"))
            if len(batch_statements) >= batch_size:
                flush_batch()

    if pending and "".join(pending).strip():
        raise RuntimeError("SQL file ended with an incomplete statement; refusing to batch it.")
    flush_batch()

    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    manifest = {
        "source_sql": str(source.resolve()),
        "source_sha256": digest,
        "batch_size": batch_size,
        "total_statements": total_statements,
        "total_sql_bytes": total_bytes,
        "batch_count": len(files),
        "batches": files,
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("sql_file", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--batch-size", type=int, default=30000)
    args = parser.parse_args()
    if args.batch_size < 1000:
        parser.error("--batch-size must be at least 1000")
    if not args.sql_file.is_file():
        parser.error(f"SQL file not found: {args.sql_file}")
    manifest = split_sql(args.sql_file, args.output_dir, args.batch_size)
    print(json.dumps({
        "batch_count": manifest["batch_count"],
        "total_statements": manifest["total_statements"],
        "total_sql_bytes": manifest["total_sql_bytes"],
        "source_sha256": manifest["source_sha256"],
        "manifest": str((args.output_dir / "manifest.json").resolve()),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
