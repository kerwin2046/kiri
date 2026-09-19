"""Keep native crash evidence on the disposable Windows acceptance runner."""
import json
import os
from pathlib import Path
import subprocess


def configure_crash_capture(output: Path):
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.name != "nt":
        raise RuntimeError("Crash capture is only for an isolated Windows CI runner")
    import winreg

    dump_dir = (output / "crash-dumps").resolve()
    dump_dir.mkdir(exist_ok=True)
    # Per-application WER settings; never enable system-wide dump collection.
    key_path = r"SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\kiri.exe"
    with winreg.CreateKeyEx(winreg.HKEY_LOCAL_MACHINE, key_path, 0, winreg.KEY_SET_VALUE) as key:
        winreg.SetValueEx(key, "DumpFolder", 0, winreg.REG_EXPAND_SZ, str(dump_dir))
        winreg.SetValueEx(key, "DumpType", 0, winreg.REG_DWORD, 1)
        winreg.SetValueEx(key, "DumpCount", 0, winreg.REG_DWORD, 2)


def collect_crash_details(output: Path, process):
    exit_code = process.poll()
    details = {"process_id": process.pid, "process_exit_code": exit_code}
    if exit_code is not None:
        details["process_exit_hex"] = f"0x{exit_code & 0xffffffff:08x}"
    script = r"""
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
Get-WinEvent -FilterHashtable @{
  LogName = 'Application'; Id = 1000, 1001; StartTime = (Get-Date).AddMinutes(-10)
} -ErrorAction SilentlyContinue |
  Where-Object { $_.Message -match '\bkiri\.exe\b' } |
  Select-Object TimeCreated, Id, ProviderName, Message | ConvertTo-Json -Depth 4
"""
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20,
        )
        (output / "windows-crash-events.json").write_text(
            result.stdout.strip() or json.dumps({"diagnostic_error": result.stderr.strip()}),
            encoding="utf-8",
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        details["crash_event_error"] = str(error)
    details["crash_dumps"] = [path.name for path in (output / "crash-dumps").glob("*.dmp")]
    return details
