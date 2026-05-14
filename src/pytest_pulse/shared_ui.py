import re
import math
from pathlib import Path
from rich.console import Console

console = Console()
error_console = Console(stderr=True)

# --- Constants ---
LOGO_BASE64 = "data:image/png;base64,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"

ANSI_CODES = {
    "0": "color:inherit;font-weight:normal;font-style:normal;text-decoration:none;opacity:1;background-color:inherit;",
    "1": "font-weight:bold",
    "2": "opacity:0.6",
    "3": "font-style:italic",
    "4": "text-decoration:underline",
    "30": "color:#000",
    "31": "color:#d00",
    "32": "color:#0a0",
    "33": "color:#aa0",
    "34": "color:#00d",
    "35": "color:#a0a",
    "36": "color:#0aa",
    "37": "color:#aaa",
    "39": "color:inherit",
    "40": "background-color:#000",
    "41": "background-color:#d00",
    "42": "background-color:#0a0",
    "43": "background-color:#aa0",
    "44": "background-color:#00d",
    "45": "background-color:#a0a",
    "46": "background-color:#0aa",
    "47": "background-color:#aaa",
    "49": "background-color:inherit",
    "90": "color:#555",
    "91": "color:#f55",
    "92": "color:#5f5",
    "93": "color:#ff5",
    "94": "color:#55f",
    "95": "color:#f5f",
    "96": "color:#5ff",
    "97": "color:#fff",
}

# --- Shared UI Helpers ---

def ansi_to_html(text):
    if not text:
        return ""
    
    current_styles_array = []
    html = ""
    open_span = [False]

    def apply_styles():
        if open_span[0]:
            nonlocal html
            html += "</span>"
            open_span[0] = False
        valid_styles = [s for s in current_styles_array if s]
        if valid_styles:
            style_string = ";".join(valid_styles)
            if style_string:
                html += f'<span style="{style_string}">'
                open_span[0] = True

    def reset_and_apply_new_codes(new_codes_str):
        nonlocal current_styles_array
        new_codes = new_codes_str.split(";")
        if "0" in new_codes:
            current_styles_array = [ANSI_CODES["0"]] if "0" in ANSI_CODES else []
        for code in new_codes:
            if code == "0": continue
            if code in ANSI_CODES:
                if code == "39":
                    current_styles_array = [s for s in current_styles_array if not s.startswith("color:")]
                    current_styles_array.append("color:inherit")
                elif code == "49":
                    current_styles_array = [s for s in current_styles_array if not s.startswith("background-color:")]
                    current_styles_array.append("background-color:inherit")
                else:
                    current_styles_array.append(ANSI_CODES[code])
            elif code.startswith("38;2;") or code.startswith("48;2;"):
                parts = code.split(";")
                type_str = "color" if parts[0] == "38" else "background-color"
                if len(parts) == 5:
                    current_styles_array = [s for s in current_styles_array if not s.startswith(type_str + ":")]
                    current_styles_array.append(f"{type_str}:rgb({parts[2]},{parts[3]},{parts[4]})")
        apply_styles()

    segments = re.split(r'(\x1b\[[0-9;]*m)', text)
    for segment in segments:
        if not segment: continue
        if segment.startswith("\x1b[") and segment.endswith("m"):
            reset_and_apply_new_codes(segment[2:-1])
        else:
            html += sanitize_html(segment)
            
    if open_span[0]: html += "</span>"
    return html

def sanitize_html(str_val):
    if str_val is None: return ""
    replacements = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"}
    return "".join(replacements.get(c, c) for c in str(str_val))

def capitalize(str_val):
    if not str_val: return ""
    return str_val[0].upper() + str_val[1:].lower()

def convert_playwright_error_to_html(str_val):
    if not str_val: return ""
    res = str_val.replace("<red>", '<span style="color: red;">')\
                 .replace("<green>", '<span style="color: green;">')\
                 .replace("<dim>", '<span style="opacity: 0.6;">')\
                 .replace("<intensity>", '<span style="font-weight: bold;">')\
                 .replace("</color>", '</span>')\
                 .replace("</intensity>", '</span>')\
                 .replace("\n", "<br>")
    return res

def format_playwright_error(error):
    error_text = error.get('message') if isinstance(error, dict) and 'message' in error else str(error)
    return convert_playwright_error_to_html(ansi_to_html(error_text))

def format_duration(ms, precision=1):
    try:
        num_ms = float(ms)
        if num_ms < 0 or math.isnan(num_ms) or math.isinf(num_ms): return "0s"
        if num_ms == 0: return "0s"
        
        total_seconds = num_ms / 1000
        if total_seconds < 60:
            return f"{total_seconds:.{precision}f}s"
        
        h = int(total_seconds // 3600)
        m = int((total_seconds % 3600) // 60)
        s = int(total_seconds % 60)
        
        parts = []
        if h > 0: parts.append(f"{h}h")
        if m > 0: parts.append(f"{m}m")
        if s > 0 or not parts: parts.append(f"{s}s")
        return " ".join(parts)
    except: return "N/A"

def get_status_badge(status):
    status = str(status).lower()
    colors = {"passed": "#2ecc71", "failed": "#e74c3c", "skipped": "#f1c40f", "flaky": "#00ccd3", "timedout": "#e67e22"}
    color = colors.get(status, "#95a5a6")
    return f'<span class="status-badge" style="background-color: {color}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.85em; font-weight: 600;">{status.upper()}</span>'

def get_small_status_badge(status):
    status = str(status).lower()
    colors = {"passed": "#2ecc71", "failed": "#e74c3c", "skipped": "#f1c40f", "flaky": "#00ccd3", "timedout": "#e67e22"}
    color = colors.get(status, "#95a5a6")
    return f'<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: {color}; margin-left: 4px;"></span>'

def get_status_icon(status):
    return {"passed": "✅", "failed": "❌", "skipped": "⏭️", "flaky": "⚠"}.get(str(status).lower(), "❓")

def get_severity_color(level):
    return {"Minor": "#006064", "Low": "#FFA07A", "Medium": "#577A11", "High": "#B71C1C", "Critical": "#64158A"}.get(level, "#577A11")

def get_local_highcharts_js():
    try:
        local_path = Path(__file__).parent / "highcharts.min.js"
        if local_path.exists():
            return local_path.read_text(encoding="utf-8")
    except: pass
    return ""
