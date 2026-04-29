"""Collect machine/environment metadata — mirrors the JS _getEnvDetails() method."""
from __future__ import annotations
import os
import platform
import socket
import sys
from .types import CpuInfo, EnvDetails


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
        v8="N/A",
        cwd=cwd,
    )
