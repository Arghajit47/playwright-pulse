"""pytest-pulse-report — Python pytest plugin for Playwright test reporting.

The plugin is auto-discovered by pytest via the ``pytest11`` entry point.
You can also import the public API directly:

    from pytest_pulse.static_generator import generate_static_html
    from pytest_pulse.merge_reports import merge_shard_directories
    from pytest_pulse.email_sender import send_report
    from pytest_pulse.decorators import step
"""

from .decorators import step, pulse_step

__version__ = "1.0.5"
__author__ = "Arghajit Singha"
