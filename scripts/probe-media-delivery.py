#!/usr/bin/env python3
"""Read-only delivery probe. Uses curl; never retries or changes remote objects.

Input is a local delivery manifest. Default: serial 1 MiB range requests.
--full downloads each entire file, checks its declared size, hashes it, and
inspects streams with ffprobe when available. Output files stay outside git.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time
from urllib.parse import urlsplit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--indices", help="One-based comma-separated item numbers")
    args = parser.parse_args()
    items = json.loads(args.manifest.read_text())["items"]
    selected = {int(i) for i in args.indices.split(",")} if args.indices else None
    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    for index, item in enumerate(items, 1):
        if selected and index not in selected:
            continue
        url = item["url"]
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.username or parsed.password:
            raise ValueError("Only HTTPS URLs without embedded credentials are allowed")
        for repeat in range(1, args.repeat + 1):
            stem = f"{index:02d}-{repeat}"
            payload = args.output / (stem + (".mp4" if args.full else ".part"))
            headers_path = args.output / (stem + ".headers")
            cmd = [
                "curl", "--silent", "--show-error", "--fail", "--location",
                "--proto", "=https", "--proto-redir", "=https",
                "--connect-timeout", "15", "--max-time", str(args.timeout),
                "--header", "Origin: https://nightshift.tianyi.live",
                "--dump-header", str(headers_path), "--output", str(payload),
                "--write-out", "%{json}",
            ]
            if not args.full:
                cmd += ["--range", "0-1048575", "--max-filesize", "1048576"]
            started = time.time()
            response = subprocess.run(cmd + [url], capture_output=True, text=True)
            metrics = json.loads(response.stdout) if response.stdout.strip() else {}
            headers = {}
            if headers_path.exists():
                for line in headers_path.read_text(errors="replace").splitlines():
                    if line.startswith("HTTP/"):
                        headers = {}
                    elif ":" in line:
                        key, value = line.split(":", 1)
                        headers[key.lower()] = value.strip()
                # Do not retain cookies or other unrelated response headers.
                headers_path.unlink()
            safe_headers = {key: headers[key] for key in [
                "content-type", "content-length", "content-range", "accept-ranges",
                "cache-control", "cf-cache-status", "cf-ray", "age", "etag",
                "access-control-allow-origin", "access-control-expose-headers",
            ] if key in headers}
            result = {
                "index": index, "repeat": repeat, "mode": "full" if args.full else "range",
                "started_unix": started, "host": parsed.hostname,
                "path": parsed.path, "exit_code": response.returncode,
                "error": response.stderr.strip(),
                **{key: metrics.get(key) for key in [
                    "http_code", "time_namelookup", "time_connect", "time_appconnect",
                    "time_starttransfer", "time_total", "size_download", "speed_download",
                ]},
                "headers": safe_headers,
            }
            if response.returncode == 0:
                if args.full:
                    size = payload.stat().st_size
                    result["expected_bytes"] = item.get("bytes")
                    result["size_matches"] = size == item.get("bytes")
                    digest = hashlib.sha256()
                    with payload.open("rb") as file:
                        for chunk in iter(lambda: file.read(1024 * 1024), b""):
                            digest.update(chunk)
                    result["sha256"] = digest.hexdigest()
                    if shutil.which("ffprobe"):
                        probe = subprocess.run([
                            "ffprobe", "-v", "error", "-show_entries",
                            "format=duration,size,bit_rate:stream=codec_name,width,height",
                            "-of", "json", str(payload),
                        ], capture_output=True, text=True)
                        result["probe_exit_code"] = probe.returncode
                        result["media"] = json.loads(probe.stdout) if probe.returncode == 0 else probe.stderr
                else:
                    expected = min(item.get("bytes", 1048576), 1048576)
                    result["range_matches"] = (
                        metrics.get("http_code") == 206
                        and payload.stat().st_size == expected
                        and headers.get("content-range", "").startswith(f"bytes 0-{expected - 1}/")
                    )
            results.append(result)
            (args.output / "results.json").write_text(json.dumps(results, indent=2) + "\n")
            print(json.dumps(result), flush=True)
    failed = any(r["exit_code"] or r.get("size_matches") is False
                 or r.get("range_matches") is False or r.get("probe_exit_code", 0)
                 for r in results)
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
