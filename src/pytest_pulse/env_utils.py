"""Collect machine/environment metadata — mirrors the JS _getEnvDetails() method."""
from __future__ import annotations
import os
import platform
import socket
import sys
from .types import CpuInfo, EnvDetails
from .shared_ui import console, error_console


def get_env_details() -> EnvDetails:
    try:
        host = socket.gethostname()
    except Exception:
        host = "unknown"

    os_name = f"{platform.system().lower()} {platform.release()}"

    try:
        import multiprocessing
        cpu_count = multiprocessing.cpu_count()
    except Exception:
        cpu_count = 1

    cpu_model = platform.processor() or platform.machine() or "Unknown"

    try:
        import psutil
        total_bytes = psutil.virtual_memory().total
        memory_str = f"{total_bytes / (1024 ** 3):.2f}GB"
    except ImportError:
        memory_str = "N/A"

    node_version = f"python {sys.version.split()[0]}"
    cwd = os.getcwd()

    return EnvDetails(
        host=host,
        os=os_name,
        cpu=CpuInfo(model=cpu_model, cores=cpu_count),
        memory=memory_str,
        node=node_version,
        cwd=cwd,
    )


def get_reporter_config(custom_dir: str | None = None) -> dict[str, str]:
    """Read output settings from config files (pytest.ini, pyproject.toml, etc.)."""
    output_dir = custom_dir or "pulse-report"
    output_file = "playwright-pulse-report.json"
    
    import re
    for ini in ("pytest.ini", "setup.cfg", "pyproject.toml"):
        if os.path.isfile(ini):
            try:
                with open(ini, "r", encoding="utf-8") as f:
                    content = f.read()
                m = re.search(r"pulse[_-]output[_-]dir\s*=\s*(.+)", content)
                if m and not custom_dir:
                    output_dir = m.group(1).strip().strip('"').strip("'")
                m2 = re.search(r"pulse[_-]output[_-]file\s*=\s*(.+)", content)
                if m2:
                    output_file = m2.group(1).strip().strip('"').strip("'")
            except Exception:
                pass
    return {"outputDir": output_dir, "outputFile": output_file}
