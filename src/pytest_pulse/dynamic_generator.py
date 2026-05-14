#!/usr/bin/env python3
import os
import json
import subprocess
import re
import random
from pathlib import Path
from datetime import datetime
import sys
import math
import time
import base64
from .shared_ui import (
    LOGO_BASE64, ansi_to_html, sanitize_html, capitalize,
    format_playwright_error, format_duration, get_status_badge,
    get_small_status_badge, get_severity_color, get_local_highcharts_js
)

# --- Constants & Configuration ---
DEFAULT_OUTPUT_DIR = "pulse-report"
DEFAULT_HTML_FILE = "playwright-pulse-report.html"

# --- Highcharts Loading ---
highcharts_imported = True # Always True now as we use local JS

# --- Helper functions ---

# --- Chart & Component Generation Functions ---

def generate_test_trends_chart(trend_data):
    if not trend_data or not trend_data.get('overall') or len(trend_data['overall']) == 0:
        return '<div class="no-data">No overall trend data available for test counts.</div>'

    import random
    chart_id = f"testTrendsChart-{int(time.time() * 1000)}-{str(random.random())[2:7]}"
    render_function_name = f"renderTestTrendsChart_{chart_id.replace('-', '_')}"
    runs = trend_data['overall']

    categories = [f"Run {i+1}" for i in range(len(runs))]

    def _fmt_ts(ts):
        if ts is None: return "N/A"
        try:
            if isinstance(ts, (int, float)):
                return datetime.fromtimestamp(ts / 1000).strftime("%m/%d/%y %I:%M %p")
            return format_date(ts)
        except Exception:
            return str(ts)

    runs_tooltip = [[
        str(r.get('runId', str(i+1))),
        _fmt_ts(r.get('timestamp')),
        format_duration(r.get('duration'))
    ] for i, r in enumerate(runs)]

    series_configs = [
        {"name": "Total",   "key": "totalTests", "color": "#6366f1"},
        {"name": "Passed",  "key": "passed",     "color": "#10b981"},
        {"name": "Failed",  "key": "failed",     "color": "#ef4444"},
        {"name": "Skipped", "key": "skipped",    "color": "#f59e0b"},
        {"name": "Flaky",   "key": "flaky",      "color": "#00ccd3"},
    ]

    traces = []
    for i, s in enumerate(series_configs):
        data = [r.get(s['key'], 0) for r in runs]
        if i == 0:
            ht = "Date: %{customdata[1]}<br>Duration: %{customdata[2]}<br><b>Total: %{y}</b>"
        else:
            ht = f"<b>{s['name']}: %{{y}}</b>"
        traces.append({
            "x": categories,
            "y": data,
            "name": s["name"],
            "type": "scatter",
            "mode": "lines+markers",
            "line": {"color": s["color"], "width": 2.5},
            "marker": {"color": s["color"], "size": 7, "symbol": "circle"},
            "hovertemplate": ht
        })

    traces_json = json.dumps(traces)
    categories_json = json.dumps(categories)

    return f"""
      <div id="{chart_id}" class="trend-chart-container lazy-load-chart" data-render-function-name="{render_function_name}">
          <div class="no-data">Loading Test Volume Trends...</div>
      </div>
      <script>
          window.{render_function_name} = function() {{
              const chartContainer = document.getElementById('{chart_id}');
              if (!chartContainer) {{ console.error("Chart container {chart_id} not found for lazy loading."); return; }}
              if (typeof Highcharts !== 'undefined') {{
                  try {{
                      const traces = {traces_json};
                      const series = traces.map(t => ({{
                          name: t.name,
                          data: t.y,
                          color: t.line.color,
                          marker: {{ symbol: 'circle' }}
                      }}));
                      
                      Highcharts.chart('{chart_id}', {{
                          chart: {{ type: 'line', backgroundColor: 'transparent', height: 350 }},
                          title: {{ text: null }},
                          xAxis: {{
                              categories: {categories_json},
                              gridLineColor: 'rgba(128,128,128,0.15)',
                              labels: {{ style: {{ color: '#aaa' }} }}
                          }},
                          yAxis: {{
                              title: {{ text: 'Test Count', style: {{ color: '#aaa' }} }},
                              gridLineColor: 'rgba(128,128,128,0.15)',
                              labels: {{ style: {{ color: '#aaa' }} }},
                              min: 0
                          }},
                          legend: {{
                              itemStyle: {{ color: '#ccc' }},
                              itemHoverStyle: {{ color: '#fff' }}
                          }},
                          tooltip: {{
                              shared: true,
                              backgroundColor: 'rgba(10,10,10,0.92)',
                              style: {{ color: '#f5f5f5' }},
                              borderRadius: 8,
                              borderWidth: 0,
                              shadow: true
                          }},
                          credits: {{ enabled: false }},
                          plotOptions: {{
                              series: {{
                                  lineWidth: 2.5,
                                  marker: {{ radius: 4 }}
                              }}
                          }},
                          series: series
                      }});
                  }} catch (e) {{
                      console.error("Error rendering chart {chart_id} (lazy):", e);
                      chartContainer.innerHTML = '<div class="no-data">Error rendering test trends chart.</div>';
                  }}
              }} else {{
                  chartContainer.innerHTML = '<div class="no-data">Charting library not available for test trends.</div>';
              }}
          }};
      </script>
  """

def generate_duration_trend_chart(trend_data):
    if not trend_data or not trend_data.get('overall') or len(trend_data['overall']) == 0:
        return '<div class="no-data">No overall trend data available for durations.</div>'

    import random
    chart_id = f"durationTrendChart-{int(time.time() * 1000)}-{str(random.random())[2:7]}"
    render_function_name = f"renderDurationTrendChart_{chart_id.replace('-', '_')}"
    runs = trend_data['overall']

    categories = [f"Run {i+1}" for i in range(len(runs))]
    durations = [round(r.get('duration', 0) / 1000, 3) for r in runs]

    def _fmt_ts(ts):
        if ts is None: return "N/A"
        try:
            if isinstance(ts, (int, float)):
                return datetime.fromtimestamp(ts / 1000).strftime("%m/%d/%y %I:%M %p")
            return format_date(ts)
        except Exception:
            return str(ts)

    runs_tooltip = [[
        str(r.get('runId', str(i+1))),
        _fmt_ts(r.get('timestamp')),
        format_duration(r.get('duration')),
        str(r.get('totalTests', 0))
    ] for i, r in enumerate(runs)]

    trace = {
        "x": categories,
        "y": durations,
        "name": "Duration",
        "type": "bar",
        "marker": {"color": "#ff9800"},
        "customdata": runs_tooltip,
        "hovertemplate": "Run %{customdata[0]}<br>Date: %{customdata[1]}<br><b>Duration: %{customdata[2]}</b><br>Tests: %{customdata[3]}<extra></extra>"
    }

    # Prepare Highcharts series data with extra tooltip info
    chart_data = []
    for i, r in enumerate(runs):
        chart_data.append({
            "y": durations[i],
            "runId": str(r.get('runId', str(i+1))),
            "date": _fmt_ts(r.get('timestamp')),
            "formattedDuration": format_duration(r.get('duration')),
            "tests": str(r.get('totalTests', 0))
        })

    data_json = json.dumps(chart_data)
    categories_json = json.dumps(categories)

    return f"""
      <div id="{chart_id}" class="trend-chart-container lazy-load-chart" data-render-function-name="{render_function_name}">
          <div class="no-data">Loading Duration Trends...</div>
      </div>
      <script>
          window.{render_function_name} = function() {{
              const chartContainer = document.getElementById('{chart_id}');
              if (!chartContainer) {{ console.error("Chart container {chart_id} not found for lazy loading."); return; }}
              if (typeof Highcharts !== 'undefined') {{
                  try {{
                      const chartData = {data_json};
                      
                      Highcharts.chart('{chart_id}', {{
                          chart: {{ type: 'column', backgroundColor: 'transparent', height: 350 }},
                          title: {{ text: null }},
                          xAxis: {{
                              categories: {categories_json},
                              gridLineColor: 'rgba(128,128,128,0.15)',
                              labels: {{ style: {{ color: '#aaa' }} }}
                          }},
                          yAxis: {{
                              title: {{ text: 'Duration (s)', style: {{ color: '#aaa' }} }},
                              gridLineColor: 'rgba(128,128,128,0.15)',
                              labels: {{ 
                                  format: '{{value}}s',
                                  style: {{ color: '#aaa' }} 
                              }},
                              min: 0
                          }},
                          tooltip: {{
                              backgroundColor: 'rgba(10,10,10,0.95)',
                              style: {{ color: '#f5f5f5' }},
                              borderRadius: 8,
                              borderWidth: 0,
                              useHTML: true,
                              formatter: function() {{
                                  return 'Run ' + this.point.runId + '<br/>' +
                                         'Date: ' + this.point.date + '<br/>' +
                                         '<b>Duration: ' + this.point.formattedDuration + '</b><br/>' +
                                         'Tests: ' + this.point.tests;
                              }}
                          }},
                          plotOptions: {{
                              column: {{
                                  borderRadius: 4,
                                  borderWidth: 0,
                                  color: '#ff9800'
                              }}
                          }},
                          credits: {{ enabled: false }},
                          series: [{{
                              name: 'Duration',
                              data: chartData,
                              showInLegend: false
                          }}]
                      }});
                  }} catch (e) {{
                      console.error("Error rendering chart {chart_id} (lazy):", e);
                      chartContainer.innerHTML = '<div class="no-data">Error rendering duration trend chart.</div>';
                  }}
              }} else {{
                  chartContainer.innerHTML = '<div class="no-data">Charting library not available for duration trends.</div>';
              }}
          }};
      </script>
  """

def format_date(date_str_or_date):
    if not date_str_or_date:
        return "N/A"
    try:
        if isinstance(date_str_or_date, str):
            # Try parsing standard ISO formats
            if "Z" in date_str_or_date or "T" in date_str_or_date:
                # remove Z for fromisoformat if needed, depending on Python version
                date_obj = datetime.fromisoformat(date_str_or_date.replace("Z", "+00:00"))
            else:
                date_obj = datetime.strptime(date_str_or_date, "%Y-%m-%d %H:%M:%S")
        else:
            date_obj = date_str_or_date
            
        return date_obj.strftime("%m/%d/%y %I:%M %p")
    except Exception:
        # Fallback to JS standard output style roughly
        return str(date_str_or_date)

def generate_test_history_chart(history):
    if not history or len(history) == 0:
        return '<div class="no-data-chart">No data for chart</div>'

    valid_history = [h for h in history if h and isinstance(h.get('duration'), (int, float)) and h['duration'] >= 0]
    if len(valid_history) == 0:
        return '<div class="no-data-chart">No valid data for chart</div>'

    import random
    chart_id = f"testHistoryChart-{int(time.time() * 1000)}-{str(random.random())[2:7]}"
    render_function_name = f"renderTestHistoryChart_{chart_id.replace('-', '_')}"

    STATUS_COLORS = {
        "passed": "#10b981",
        "failed": "#ef4444",
        "skipped": "#f59e0b",
        "flaky": "#00ccd3",
    }

    categories = [f"R{i+1}" for i in range(len(valid_history))]
    y_vals = [round(r.get('duration', 0) / 1000, 3) for r in valid_history]
    marker_colors = [
        STATUS_COLORS.get(str(r.get('status', '')).lower(), "#9ca3af")
        for r in valid_history
    ]
    custom_data = [[
        str(r.get('runId', str(i+1))),
        str(r.get('status', 'unknown')).upper(),
        format_duration(r.get('duration'))
    ] for i, r in enumerate(valid_history)]

    trace = {
        "x": categories,
        "y": y_vals,
        "type": "bar",
        "marker": {"color": marker_colors},
        "customdata": custom_data,
        "showlegend": False,
        "hovertemplate": "Run %{customdata[0]}<br>Status: %{customdata[1]}<br>Duration: %{customdata[2]}<extra></extra>"
    }

    # Prepare Highcharts data
    chart_data = []
    for i, r in enumerate(valid_history):
        chart_data.append({
            "y": y_vals[i],
            "color": STATUS_COLORS.get(str(r.get('status', '')).lower(), "#9ca3af"),
            "runId": str(r.get('runId', str(i+1))),
            "status": str(r.get('status', 'unknown')).upper(),
            "duration": format_duration(r.get('duration'))
        })

    data_json = json.dumps(chart_data)
    categories_json = json.dumps(categories)

    return f"""
      <div id="{chart_id}" style="width: 100%; max-width: 320px; height: 130px;" class="lazy-load-chart" data-render-function-name="{render_function_name}">
          <div class="no-data-chart">Loading History...</div>
      </div>
      <script>
          window.{render_function_name} = function() {{
              const chartContainer = document.getElementById('{chart_id}');
              if (!chartContainer) {{ console.error("Chart container {chart_id} not found for lazy loading."); return; }}
              if (typeof Highcharts !== 'undefined') {{
                  try {{
                      const chartData = {data_json};
                      
                      Highcharts.chart('{chart_id}', {{
                          chart: {{ type: 'column', backgroundColor: 'transparent', height: 130, spacingTop: 8, spacingBottom: 8 }},
                          title: {{ text: null }},
                          xAxis: {{
                              categories: {categories_json},
                              labels: {{ style: {{ fontSize: '10px', color: '#888' }} }},
                              lineWidth: 0,
                              tickWidth: 0
                          }},
                          yAxis: {{
                              title: {{ text: null }},
                              labels: {{ 
                                  format: '{{value}}s',
                                  style: {{ fontSize: '10px', color: '#888' }} 
                              }},
                              gridLineWidth: 0,
                              min: 0,
                              tickAmount: 4
                          }},
                          tooltip: {{
                              backgroundColor: 'rgba(10,10,10,0.95)',
                              style: {{ color: '#f5f5f5', fontSize: '11px' }},
                              borderRadius: 4,
                              borderWidth: 0,
                              useHTML: true,
                              formatter: function() {{
                                  return 'Run ' + this.point.runId + '<br/>' +
                                         'Status: ' + this.point.status + '<br/>' +
                                         'Duration: ' + this.point.duration;
                              }}
                          }},
                          plotOptions: {{
                              column: {{
                                  borderRadius: 2,
                                  borderWidth: 0,
                                  pointPadding: 0.1,
                                  groupPadding: 0.1
                              }}
                          }},
                          legend: {{ enabled: false }},
                          credits: {{ enabled: false }},
                          series: [{{
                              data: chartData
                          }}]
                      }});
                  }} catch (e) {{
                      console.error("Error rendering chart {chart_id} (lazy):", e);
                      chartContainer.innerHTML = '<div class="no-data-chart">Error rendering history chart.</div>';
                  }}
              }} else {{
                  chartContainer.innerHTML = '<div class="no-data-chart">Charting library not available for history.</div>';
              }}
          }};
      </script>
  """

def generate_pie_chart(data, chart_width=300, chart_height=300):
    total = sum(d.get('value', 0) for d in data)
    if total == 0:
        return '<div class="pie-chart-wrapper"><h3>Test Distribution</h3><div class="no-data">No data for Test Distribution chart.</div></div>'

    passed_entry = next((d for d in data if d.get('label') == "Passed"), None)
    passed_percentage = round(((passed_entry['value'] if passed_entry else 0) / total) * 100)

    import random
    chart_id = f"pieChart-{int(time.time() * 1000)}-{str(random.random())[2:7]}"
    render_function_name = f"render_{chart_id.replace('-', '_')}"

    LABEL_COLORS = {
        "Passed": "#10b981",
        "Failed": "#ef4444",
        "Flaky":  "#00ccd3",
        "Skipped": "#f59e0b",
    }

    labels = []
    values = []
    colors = []
    for d in data:
        if d.get('value', 0) > 0:
            lbl = d.get('label', '')
            labels.append(lbl)
            values.append(d['value'])
            colors.append(LABEL_COLORS.get(lbl, "#CCCCCC"))

    center_font_size = max(12, min(chart_width, chart_height) // 12)

    # Prepare Highcharts data
    chart_data = []
    for i in range(len(labels)):
        chart_data.append({
            "name": labels[i],
            "y": values[i],
            "color": colors[i]
        })

    data_json = json.dumps(chart_data)

    return f"""
      <div class="pie-chart-wrapper" style="width: 100%; display: flex; flex-direction: column; align-items: center;">
          <h3 style="margin-bottom: 10px; font-size: 1.1em; color: var(--text-color-secondary);">Test Distribution</h3>
          <div id="{chart_id}" class="lazy-load-chart" data-render-function-name="{render_function_name}" style="width: 100%; max-width: {chart_width}px; height: {chart_height}px;">
              <div class="no-data">Loading Chart...</div>
          </div>
      </div>
      <script>
          window.{render_function_name} = function() {{
              const chartContainer = document.getElementById('{chart_id}');
              if (!chartContainer) return;
              if (typeof Highcharts !== 'undefined') {{
                  try {{
                      const chartData = {data_json};
                      Highcharts.chart('{chart_id}', {{
                          chart: {{ type: 'pie', backgroundColor: 'transparent', height: {chart_height}, width: {chart_width} }},
                          title: {{
                              text: '<div style="text-align: center"><span style="font-size: {center_font_size}px; font-weight: bold; color: #6366f1">{passed_percentage}%</span><br/><span style="font-size: {max(10, center_font_size - 6)}px; color: #888">Passed</span></div>',
                              align: 'center',
                              verticalAlign: 'middle',
                              y: 10,
                              useHTML: true
                          }},
                          tooltip: {{
                              backgroundColor: 'rgba(10,10,10,0.92)',
                              style: {{ color: '#f5f5f5' }},
                              borderRadius: 8,
                              borderWidth: 0,
                              pointFormat: '{{point.name}}: <b>{{point.y}}</b> ({{point.percentage:.1f}}%)'
                          }},
                          plotOptions: {{
                              pie: {{
                                  innerSize: '65%',
                                  borderWidth: 2,
                                  borderColor: 'var(--bg-card, #fff)',
                                  dataLabels: {{ enabled: false }},
                                  showInLegend: false
                              }}
                          }},
                          credits: {{ enabled: false }},
                          series: [{{
                              name: 'Tests',
                              data: chartData
                          }}]
                      }});
                  }} catch (e) {{
                      console.error("Error rendering pie chart:", e);
                      chartContainer.innerHTML = '<div class="no-data">Error rendering chart.</div>';
                  }}
              }} else {{
                  chartContainer.innerHTML = '<div class="no-data">Charting library not available.</div>';
              }}
          }};
      </script>
  """

def generate_environment_dashboard(environment, hide_header=False):
    if not environment: environment = {}
    
    cpu_model = environment.get('cpu', {}).get('model', 'N/A')
    cpu_cores = environment.get('cpu', {}).get('cores', 'N/A')
    cpu_info = f"model: {cpu_model}, cores: {cpu_cores}"
    
    os_info = environment.get('os', 'N/A')
    node_info = environment.get('node', 'N/A')
    cwd_info = environment.get('cwd', 'N/A')
    host_info = environment.get('host', 'N/A')
    formatted_memory = environment.get('memory', 'N/A')
    
    no_header_class = " no-header" if hide_header else ""
    
    return f"""
    <div class="env-modern-card{no_header_class}">
      <style>
        .env-modern-card {{
          background: linear-gradient(to bottom right, #ffffff 0%, #fafafa 100%);
          border: 0;
          border-radius: 12px;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
          margin-top: 24px;
          transition: all 0.3s ease;
          font-family: var(--font-family);
          overflow: hidden;
        }}
        .env-modern-card:hover {{
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        }}
        .env-modern-card {{
          margin-bottom: 0;
        }}

        .environment-dashboard-wrapper *,
        .environment-dashboard-wrapper *::before,
        .environment-dashboard-wrapper *::after {{
          box-sizing: border-box;
        }}

        .environment-dashboard-wrapper {{
          --primary-color: #6366f1;
          --success-color: #10b981;
          --warning-color: #f59e0b;
          
          background-color: white;
          padding: 48px; 
          border-bottom: 1px solid #e2e8f0;
          font-family: var(--font-family);
          color: #0f172a;
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 32px;
          font-size: 15px;
          transform: translateZ(0);
        }}

        .env-card-header {{
          display: flex;
          flex-direction: column;
          padding: 24px 24px 12px;
        }}
        .env-modern-card.no-header .env-card-header {{
          display: none;
        }}
        .env-modern-card.no-header {{
          margin-top: 0;
        }}
        .env-modern-card.no-header .env-card-content {{
          padding-top: 24px;
        }}
        .env-card-title-row {{
          display: flex;
          justify-content: space-between;
          align-items: center;
        }}
        .env-card-title {{
          display: flex;
          align-items: center;
          font-size: 16px;
          font-weight: 600;
          color: #0f172a;
          transition: color 0.3s;
        }}
        .env-modern-card:hover .env-card-title {{
          color: #6366f1;
        }}
        .env-card-title svg {{
          width: 16px;
          height: 16px;
          margin-right: 8px;
          stroke: currentColor;
          fill: none;
        }}
        .env-card-subtitle {{
          font-size: 12px;
          color: #64748b;
          margin-top: 4px;
        }}
        .env-icon-badge {{
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: linear-gradient(to bottom right, rgba(99, 102, 241, 0.1), rgba(99, 102, 241, 0.05));
          display: flex;
          align-items: center;
          justify-content: center;
        }}
        .env-icon-badge svg {{
          width: 16px;
          height: 16px;
          stroke: #6366f1;
          fill: none;
        }}
        .env-card-content {{
          padding: 0 24px 24px;
        }}
        .env-items-grid {{
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
        }}
        @media (min-width: 768px) {{
          .env-items-grid {{
            grid-template-columns: repeat(4, 1fr);
          }}
        }}
        .env-item {{
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 8px;
          border-radius: 8px;
          transition: background-color 0.2s;
          min-height: 48px;
        }}
        .env-item:hover {{
          background-color: rgba(100, 116, 139, 0.05);
        }}
        .env-item-icon {{
          flex-shrink: 0;
        }}
        .env-item-icon svg {{
          width: 16px;
          height: 16px;
          stroke: #6366f1;
          fill: none;
        }}
        .env-item-content {{
          flex-grow: 1;
          min-width: 0;
        }}
        .env-item-label {{
          font-size: 12px;
          font-weight: 500;
          color: #64748b;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }}
        .env-item-value {{
          font-size: 12px;
          font-weight: 600;
          color: #0f172a;
          word-wrap: break-word;
          overflow-wrap: break-word;
          line-height: 1.4;
        }}
      </style>
      
      <div class="env-card-header">
        <div class="env-card-title-row">
          <div>
            <div class="env-card-title">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="20" height="8" x="2" y="2" rx="2" ry="2"></rect>
                <rect width="20" height="8" x="2" y="14" rx="2" ry="2"></rect>
                <line x1="6" x2="6.01" y1="6" y2="6"></line>
                <line x1="6" x2="6.01" y1="18" y2="18"></line>
              </svg>
              System Information
            </div>
            <div class="env-card-subtitle">Test execution environment details</div>
          </div>
          <div class="env-icon-badge">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"></path>
            </svg>
          </div>
        </div>
      </div>
      
      <div class="env-card-content">
        <div class="env-items-grid">
          <div class="env-item">
            <div class="env-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"></path>
              </svg>
            </div>
            <div class="env-item-content">
              <p class="env-item-label">Host</p>
              <div class="env-item-value" title="{host_info}">{host_info}</div>
            </div>
          </div>
          
          <div class="env-item">
            <div class="env-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"></path>
              </svg>
            </div>
            <div class="env-item-content">
              <p class="env-item-label">Os</p>
              <div class="env-item-value" title="{os_info}">{os_info}</div>
            </div>
          </div>
          
          <div class="env-item">
            <div class="env-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="16" height="16" x="4" y="4" rx="2"></rect>
                <rect width="6" height="6" x="9" y="9" rx="1"></rect>
                <path d="M15 2v2"></path>
                <path d="M15 20v2"></path>
                <path d="M2 15h2"></path>
                <path d="M2 9h2"></path>
                <path d="M20 15h2"></path>
                <path d="M20 9h2"></path>
                <path d="M9 2v2"></path>
                <path d="M9 20v2"></path>
              </svg>
            </div>
            <div class="env-item-content">
              <p class="env-item-label">Cpu</p>
              <div class="env-item-value" title='{sanitize_html(json.dumps(environment.get("cpu", {})))}'>{cpu_info}</div>
            </div>
          </div>
          
          <div class="env-item">
            <div class="env-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 19v-3"></path>
                <path d="M10 19v-3"></path>
                <path d="M14 19v-3"></path>
                <path d="M18 19v-3"></path>
                <path d="M8 11V9"></path>
                <path d="M16 11V9"></path>
                <path d="M12 11V9"></path>
                <path d="M2 15h20"></path>
                <path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.837V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.837Z"></path>
              </svg>
            </div>
            <div class="env-item-content">
              <p class="env-item-label">Memory</p>
              <div class="env-item-value" title="{formatted_memory}">{formatted_memory}</div>
            </div>
          </div>
          
          <div class="env-item">
            <div class="env-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"></path>
                <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"></path>
                <path d="M12 2v2"></path>
                <path d="M12 22v-2"></path>
                <path d="m17 20.66-1-1.73"></path>
                <path d="M11 10.27 7 3.34"></path>
                <path d="m20.66 17-1.73-1"></path>
                <path d="m3.34 7 1.73 1"></path>
                <path d="M14 12h8"></path>
                <path d="M2 12h2"></path>
                <path d="m20.66 7-1.73 1"></path>
                <path d="m3.34 17 1.73-1"></path>
                <path d="m17 3.34-1 1.73"></path>
                <path d="m11 13.73-4 6.93"></path>
              </svg>
            </div>
            <div class="env-item-content">
              <p class="env-item-label">Python</p>
              <div class="env-item-value" title="{node_info}">{node_info}</div>
            </div>
          </div>
          <div class="env-item">
            <div class="env-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
            </div>
            <div class="env-item-content">
              <p class="env-item-label">Working Dir</p>
              <div class="env-item-value" title="{cwd_info}">{("..." + cwd_info[-27:]) if len(cwd_info) > 30 else cwd_info}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  """

def generate_environment_section(environment_data):
    if not environment_data:
        return '<div class="no-data">Environment data not available.</div>'
      
    if isinstance(environment_data, list):
        envs_html = "".join([f"""
              <div class="env-card-wrapper">
                <div class="env-card-badge">Shard {index + 1}</div>
                {generate_environment_dashboard(env, True)}
              </div>
            """ for index, env in enumerate(environment_data)])
        
        return f"""
          <div class="sharded-env-section">
            <div class="sharded-env-header">
              <div class="sharded-env-title-row">
                <div>
                  <div class="sharded-env-title">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect width="20" height="8" x="2" y="2" rx="2" ry="2"></rect>
                      <rect width="20" height="8" x="2" y="14" rx="2" ry="2"></rect>
                      <line x1="6" x2="6.01" y1="6" y2="6"></line>
                      <line x1="6" x2="6.01" y1="18" y2="18"></line>
                    </svg>
                    System Information
                  </div>
                  <div class="sharded-env-subtitle">Test execution environment details - {len(environment_data)} shard{'s' if len(environment_data) > 1 else ''}</div>
                </div>
                <div class="env-icon-badge">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"></path>
                  </svg>
                </div>
              </div>
            </div>
            <div class="sharded-environments-container">
              <div class="sharded-environments-wrapper">
                {envs_html}
              </div>
            </div>
          </div>
          <style>
            .sharded-env-section {{
              border: 1px solid #e2e8f0;
              border-radius: 12px;
              background: #fafbfc;
              overflow: hidden;
            }}
            .sharded-env-header {{
              position: sticky;
              top: 0;
              z-index: 20;
              background: linear-gradient(to bottom right, #ffffff 0%, #fafafa 100%);
              border-bottom: 1px solid #e2e8f0;
              padding: 24px 24px 16px;
            }}
            .sharded-env-title-row {{
              display: flex;
              justify-content: space-between;
              align-items: center;
            }}
            .sharded-env-title {{
              display: flex;
              align-items: center;
              font-size: 18px;
              font-weight: 600;
              color: #0f172a;
            }}
            .sharded-env-title svg {{
              width: 18px;
              height: 18px;
              margin-right: 8px;
              stroke: currentColor;
              fill: none;
            }}
            .sharded-env-subtitle {{
              font-size: 13px;
              color: #64748b;
              margin-top: 4px;
            }}
            .sharded-environments-container {{
              max-height: 520px;
              overflow-y: auto;
              overflow-x: hidden;
              padding: 16px;
            }}
            .sharded-environments-container::-webkit-scrollbar {{
              width: 8px;
            }}
            .sharded-environments-container::-webkit-scrollbar-track {{
              background: #f1f1f1;
              border-radius: 4px;
            }}
            .sharded-environments-container::-webkit-scrollbar-thumb {{
              background: #cbd5e0;
              border-radius: 4px;
            }}
            .sharded-environments-container::-webkit-scrollbar-thumb:hover {{
              background: #a0aec0;
            }}
            .sharded-environments-wrapper {{
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(600px, 1fr));
              gap: 24px;
            }}
            @media (max-width: 768px) {{
              .sharded-environments-wrapper {{
                grid-template-columns: 1fr;
              }}
            }}
            .env-card-wrapper {{
              position: relative;
            }}
            .env-card-badge {{
              position: absolute;
              top: -10px;
              right: 16px;
              background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
              color: white;
              padding: 6px 14px;
              border-radius: 20px;
              font-size: 0.75em;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              z-index: 10;
              box-shadow: 0 4px 6px -1px rgba(99, 102, 241, 0.3);
            }}
          </style>
        """
      
    return generate_environment_dashboard(environment_data)

def generate_worker_distribution_chart(results):
    if not results or len(results) == 0:
        return '<div class="no-data">No test results data available to display worker distribution.</div>'

    def get_start_time(test):
        try:
            return datetime.fromisoformat(test.get('startTime', '').replace('Z', '+00:00')).timestamp()
        except:
            return 0

    sorted_results = sorted(results, key=get_start_time)

    worker_data = {}
    for test in sorted_results:
        worker_id = str(test.get('workerId', 'N/A'))
        if worker_id not in worker_data:
            worker_data[worker_id] = {'passed': 0, 'failed': 0, 'skipped': 0, 'flaky': 0, 'tests': []}
        status = str(test.get('status', '')).lower()
        if status in ["passed", "failed", "skipped", "flaky"]:
            worker_data[worker_id][status] += 1
        test_title_parts = test.get('name', '').split(" > ")
        test_title = test_title_parts[-1] if test_title_parts else "Unnamed Test"
        worker_data[worker_id]['tests'].append({'name': test_title, 'status': status})

    def sort_worker_ids(k):
        if k == "N/A": return 999999
        try: return int(k)
        except ValueError: return 0

    worker_ids = sorted(worker_data.keys(), key=sort_worker_ids)

    if len(worker_ids) == 0:
        return '<div class="no-data">Could not determine worker distribution from test data.</div>'

    import random
    chart_id = f"workerDistChart-{int(time.time() * 1000)}-{str(random.random())[2:7]}"
    render_function_name = f"renderWorkerDistChart_{chart_id.replace('-', '_')}"
    modal_js_namespace = f"modal_funcs_{chart_id.replace('-', '_')}"

    categories = [f"Worker {wid}" for wid in worker_ids]
    full_worker_data = [{"id": wid, "name": f"Worker {wid}", "tests": worker_data[wid]['tests']} for wid in worker_ids]

    series = [
        {"name": "Passed",  "data": [worker_data[wid]['passed']  for wid in worker_ids], "color": "#10b981"},
        {"name": "Failed",  "data": [worker_data[wid]['failed']  for wid in worker_ids], "color": "#ef4444"},
        {"name": "Flaky",   "data": [worker_data[wid]['flaky']   for wid in worker_ids], "color": "#00ccd3"},
        {"name": "Skipped", "data": [worker_data[wid]['skipped'] for wid in worker_ids], "color": "#f59e0b"},
    ]

    modal_style = """.worker-modal-overlay { position: fixed; z-index: 1050; left: 0; top: 0; width: 100%; height: 100%; overflow: auto; background-color: rgba(0,0,0,0.85); display: none; align-items: center; justify-content: center; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
      .worker-modal-content { background-color: var(--bg-card, #ffffff); color: var(--text-color, #1f2937); padding: 30px; border: 1px solid var(--border-color, #e5e7eb); width: 80%; max-width: 700px; border-radius: 12px; position: relative; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04); flex-shrink: 0; margin: 20px; z-index: 1051; transform: translateZ(0); -webkit-transform: translateZ(0); }
      .worker-modal-close { position: absolute; top: 20px; right: 25px; font-size: 28px; font-weight: 400; cursor: pointer; line-height: 1; z-index: 10; color: var(--text-color-secondary, #6b7280); transition: color 0.2s ease, transform 0.2s ease; user-select: none; -webkit-user-select: none; }
      .worker-modal-close:hover, .worker-modal-close:focus { color: var(--danger-color, #ef4444); transform: scale(1.15); }"""

    return f"""
    <style>
      {modal_style}
      #worker-modal-body-{chart_id} ul {{ list-style-type: none; padding-left: 0; margin-top: 15px; max-height: 45vh; overflow-y: auto; }}
      #worker-modal-body-{chart_id} li {{ padding: 8px 5px; border-bottom: 1px solid var(--border-color, #eee); font-size: 0.9em; }}
      #worker-modal-body-{chart_id} li:last-child {{ border-bottom: none; }}
      #worker-modal-body-{chart_id} li > span {{ display: inline-block; width: 70px; font-weight: bold; text-align: right; margin-right: 10px; }}
    </style>

    <div id="{chart_id}" class="trend-chart-container lazy-load-chart" data-render-function-name="{render_function_name}" style="min-height: 350px;">
      <div class="no-data">Loading Worker Distribution Chart...</div>
    </div>

    <div id="worker-modal-{chart_id}" class="worker-modal-overlay">
      <div class="worker-modal-content">
        <span class="worker-modal-close" onclick="window.{modal_js_namespace}.close()">×</span>
        <h3 id="worker-modal-title-{chart_id}" style="text-align: center; margin-top: 0; margin-bottom: 25px; font-size: 1.25em; font-weight: 600; color: var(--text-color, #1f2937)"></h3>
        <div id="worker-modal-body-{chart_id}"></div>
      </div>
    </div>

    <script>
      if (!window.{modal_js_namespace}) window.{modal_js_namespace} = {{}};

      window.{render_function_name} = function() {{
        const chartContainer = document.getElementById('{chart_id}');
        if (!chartContainer) {{ console.error("Chart container {chart_id} not found."); return; }}
        if (!window.{modal_js_namespace}) window.{modal_js_namespace} = {{}};

        const modal = document.getElementById('worker-modal-{chart_id}');
        const modalTitle = document.getElementById('worker-modal-title-{chart_id}');
        const modalBody = document.getElementById('worker-modal-body-{chart_id}');
        const closeModalBtn = modal.querySelector('.worker-modal-close');

        window.{modal_js_namespace}.open = function(worker) {{
          if (!worker) return;
          modalTitle.textContent = 'Test Details for ' + worker.name;
          let testListHtml = '<ul>';
          if (worker.tests && worker.tests.length > 0) {{
            worker.tests.forEach(function(test) {{
              let color = 'inherit';
              if (test.status === 'passed') color = '#10b981';
              else if (test.status === 'failed') color = '#ef4444';
              else if (test.status === 'skipped') color = '#f59e0b';
              else if (test.status === 'flaky') color = '#00ccd3';
              const escapedName = test.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              testListHtml += '<li style="color:' + color + '"><span style="color:' + color + '">[' + test.status.toUpperCase() + ']</span> ' + escapedName + '</li>';
            }});
          }} else {{
            testListHtml += '<li>No detailed test data available for this worker.</li>';
          }}
          testListHtml += '</ul>';
          modalBody.innerHTML = testListHtml;
          modal.style.display = 'flex';
        }};

        const closeModal = function() {{ modal.style.display = 'none'; }};
        window.{modal_js_namespace}.close = closeModal;
        if (closeModalBtn) closeModalBtn.onclick = closeModal;
        modal.onclick = function(event) {{ if (event.target === modal) closeModal(); }};

        if (typeof Highcharts !== 'undefined') {{
          try {{
            const fullData = {json.dumps(full_worker_data)};
            const categories = {json.dumps(categories)};
            const seriesData = {json.dumps(series)};
            
            Highcharts.chart('{chart_id}', {{
              chart: {{ type: 'bar', backgroundColor: 'transparent', height: 350 }},
              title: {{ text: null }},
              xAxis: {{
                categories: categories,
                title: {{ text: 'Worker ID', style: {{ color: '#aaa' }} }},
                labels: {{ style: {{ color: '#aaa' }} }},
                gridLineColor: 'rgba(128,128,128,0.15)'
              }},
              yAxis: {{
                title: {{ text: 'Number of Tests', style: {{ color: '#aaa' }} }},
                labels: {{ style: {{ color: '#aaa' }} }},
                gridLineColor: 'rgba(128,128,128,0.15)'
              }},
              tooltip: {{
                shared: true,
                backgroundColor: 'rgba(10,10,10,0.92)',
                style: {{ color: '#f5f5f5' }},
                borderRadius: 8,
                borderWidth: 0
              }},
              plotOptions: {{
                series: {{
                  stacking: 'normal',
                  cursor: 'pointer',
                  borderWidth: 0,
                  point: {{
                    events: {{
                      click: function() {{
                        const idx = categories.indexOf(this.category);
                        if (idx >= 0 && fullData[idx]) {{
                          window.{modal_js_namespace}.open(fullData[idx]);
                        }}
                      }}
                    }}
                  }}
                }}
              }},
              legend: {{
                itemStyle: {{ color: '#ccc' }},
                itemHoverStyle: {{ color: '#fff' }}
              }},
              credits: {{ enabled: false }},
              series: seriesData
            }});
          }} catch (e) {{
            console.error("Error rendering chart {chart_id}:", e);
            chartContainer.innerHTML = '<div class="no-data">Error rendering worker distribution chart.</div>';
          }}
        }} else {{
          chartContainer.innerHTML = '<div class="no-data">Charting library not available for worker distribution.</div>';
        }}
      }};
    </script>
  """

infoTooltip = """
  <span class="info-tooltip" style="display: inline-flex; align-items: center; justify-content: center; margin-left: 8px; vertical-align: middle;">
    <span class="info-icon" 
          style="cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--text-color-secondary, #6b7280); transition: color 0.2s ease, transform 0.2s ease;"
          onmouseover="this.style.color='var(--accent-color, #764ba2)'; this.style.transform='scale(1.1)';"
          onmouseout="this.style.color='var(--text-color-secondary, #6b7280)'; this.style.transform='scale(1)';"
          onclick="window.workerInfoPrompt()"
          title="Click to understand Worker -1">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
      </svg>
    </span>
  </span>
  <script>
    if (!window.workerInfoPrompt) {
      window.workerInfoPrompt = function() {
        const message = 'Why is worker -1 special?\\n\\n' +
                       'Playwright assigns all pre-skipped tests/test.skip() to worker -1 because:\\n' +
                       '1. They don\\'t require browser execution\\n' +
                       '2. This keeps real workers focused on actual tests\\n' +
                       '3. Maintains clean reporting\\n\\n' +
                       'This is an intentional optimization by Playwright.';
        alert(message);
      }
    }
  </script>
"""

def generate_test_history_content(trend_data):
    if not trend_data or not trend_data.get('testRuns') or len(trend_data['testRuns']) == 0:
        return '<div class="no-data">No historical test data available.</div>'

    all_test_names_and_paths = {}
    for run in trend_data['testRuns'].values():
        if isinstance(run, list):
            for test in run:
                if test and test.get('testName') and test['testName'] not in all_test_names_and_paths:
                    parts = test['testName'].split(" > ")
                    title = parts[-1]
                    all_test_names_and_paths[test['testName']] = title

    if len(all_test_names_and_paths) == 0:
        return '<div class="no-data">No historical test data found after processing.</div>'

    test_history_html_parts = []
    
    for full_test_name, test_title in all_test_names_and_paths.items():
        history = []
        for index, overall_run in enumerate(trend_data.get('overall', [])):
            run_id = overall_run.get('runId')
            run_key = f"test run {run_id}" if run_id else f"test run {index + 1}"
            
            test_runs_for_overall = trend_data['testRuns'].get(run_key, [])
            test_run_for_this_overall_run = next((t for t in test_runs_for_overall if t and t.get('testName') == full_test_name), None)
            
            if test_run_for_this_overall_run:
                history.append({
                    "runId": run_id or (index + 1),
                    "status": test_run_for_this_overall_run.get('status', 'unknown'),
                    "duration": test_run_for_this_overall_run.get('duration', 0),
                    "timestamp": test_run_for_this_overall_run.get('timestamp') or overall_run.get('timestamp') or datetime.now()
                })
                
        if len(history) > 0:
            latest_run = history[-1]
            history_rows = ""
            for run in reversed(history):
                history_rows += f"""
                        <tr>
                          <td>{run['runId']}</td>
                          <td><span class="status-badge-small {get_status_class(run['status'])}">{str(run['status']).upper()}</span></td>
                          <td>{format_duration(run['duration'])}</td>
                          <td>{format_date(run['timestamp'])}</td>
                        </tr>"""
                        
            test_history_html_parts.append(f"""
            <div class="test-history-card" data-test-name="{sanitize_html(test_title.lower())}" data-latest-status="{latest_run['status']}">
              <div class="test-history-header">
                <p title="{sanitize_html(test_title)}">{capitalize(sanitize_html(test_title))}</p>
                <span class="status-badge {get_status_class(latest_run['status'])}">
                  {str(latest_run['status']).upper()}
                </span>
              </div>
              <div class="test-history-trend">
                {generate_test_history_chart(history)} 
              </div>
              <details class="test-history-details-collapsible">
                <summary>Show Run Details ({len(history)})</summary>
                <div class="test-history-details">
                  <table>
                    <thead><tr><th>Run</th><th>Status</th><th>Duration</th><th>Date</th></tr></thead>
                    <tbody>
                      {history_rows}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>""")

    return f"""
    <div class="test-history-container">
      <div class="filters" style="border-color: black; border-style: groove;">
    <input type="text" id="history-filter-name" placeholder="Search by test title..." style="border-color: black; border-style: outset;">
    <select id="history-filter-status">
        <option value="">All Statuses</option>
        <option value="passed">Passed</option>
        <option value="failed">Failed</option>
        <option value="flaky">Flaky</option>
        <option value="skipped">Skipped</option>
    </select>
    <button id="clear-history-filters" class="clear-filters-btn">Clear Filters</button>
</div>
      
      <div class="test-history-grid">
        {"".join(test_history_html_parts)}
      </div>
    </div>
  """

def get_status_class(status):
    status_str = str(status).lower()
    if status_str == "passed": return "status-passed"
    if status_str == "failed": return "status-failed"
    if status_str == "skipped": return "status-skipped"
    if status_str == "flaky": return "status-flaky"
    return "status-unknown"

def get_status_icon(status):
    status_str = str(status).lower()
    if status_str == "passed": return "✅"
    if status_str == "failed": return "❌"
    if status_str == "skipped": return "⏭️"
    if status_str == "flaky": return "⚠️"
    return "❓"

def get_suites_data(results):
    suites_map = {}
    if not results or len(results) == 0: return []

    for test in results:
        browser = test.get('browser', 'unknown')
        suite_parts = test.get('name', '').split(" > ")
        
        if len(suite_parts) > 2:
            suite_name_candidate = suite_parts[1]
        elif len(suite_parts) > 1:
            # Equivalent to JS replace(/\.(spec|test)\.(ts|js|mjs|cjs)$/, "")
            pop_val = suite_parts[0].split(os.sep)[-1]
            suite_name_candidate = re.sub(r'\.(spec|test)\.(ts|js|mjs|cjs)$', '', pop_val)
        else:
            pop_val = test.get('name', '').split(os.sep)[-1]
            suite_name_candidate = re.sub(r'\.(spec|test)\.(ts|js|mjs|cjs)$', '', pop_val)
            
        suite_name = suite_name_candidate
        key = f"{suite_name}|{browser}"

        if key not in suites_map:
            suites_map[key] = {
                'id': test.get('id', key),
                'name': suite_name,
                'browser': browser,
                'passed': 0,
                'failed': 0,
                'flaky': 0,
                'skipped': 0,
                'count': 0,
                'statusOverall': "passed"
            }
            
        suite = suites_map[key]
        suite['count'] += 1
        
        current_status = str(test.get('status', '')).lower()
        if test.get('outcome') == 'flaky' or test.get('status') == 'flaky':
            current_status = 'flaky'
            
        if current_status in suite:
            suite[current_status] += 1
            
        if current_status == "failed":
            suite['statusOverall'] = "failed"
        elif current_status == "flaky" and suite['statusOverall'] != "failed":
            suite['statusOverall'] = "flaky"
        elif current_status == "skipped" and suite['statusOverall'] not in ["failed", "flaky"]:
            suite['statusOverall'] = "skipped"
            
    return list(suites_map.values())

def generate_suites_widget(suites_data):
    if not suites_data or len(suites_data) == 0:
        return '<div class="suites-widget" style="height: 450px;"><div class="suites-header"><h2>Test Suites</h2></div><div class="no-data">No suite data available.</div></div>'

    total_tests = sum(suite['count'] for suite in suites_data)
    
    cards_html = ""
    for suite in suites_data:
        cards_html += f"""
        <div class="suite-card status-{suite['statusOverall']}">
          <div class="suite-card-header">
            <h3 class="suite-name" title="{sanitize_html(suite['name'])} ({sanitize_html(suite['browser'])})">{sanitize_html(suite['name'])}</h3>
            <div class="status-indicator-dot status-{suite['statusOverall']}" title="{suite['statusOverall'].capitalize()}"></div>
          </div>
          
          <div class="browser-tag" title="🌐Browser: {sanitize_html(suite['browser'])}">
            <span style="font-size: 1.1em;">🌐</span> {sanitize_html(suite['browser'])}
          </div>
          
          <div class="suite-card-body">
            <span class="test-count-label">{suite['count']} Test{'s' if suite['count'] != 1 else ''}</span>
            <div class="suite-stats">
              <span class="stat-pill passed" title="Passed">
                <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 16 16"><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/></svg>
                {suite['passed']}
              </span>
              <span class="stat-pill failed" title="Failed">
                <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 16 16"><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293 5.354 4.646z"/></svg>
                {suite['failed']}
              </span>
              <span class="stat-pill flaky" title="Flaky">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 16 16"><path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/></svg>
                  {suite.get('flaky', 0)}
              </span>
              <span class="stat-pill skipped" title="Skipped">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 16 16"><path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/></svg>
                 {suite['skipped']}
              </span>
            </div>
          </div>
        </div>"""

    return f"""
<div class="suites-widget fixed-height-widget">
  <div class="suites-header">
    <h2>Test Suites</h2>
    <span class="summary-badge">{len(suites_data)} suites • {total_tests} tests</span>
  </div>
  
  <div class="suites-grid-container">
      <div class="suites-grid">
        {cards_html}
      </div>
  </div>
</div>"""

def get_attachment_icon(content_type):
    if not content_type: return "📎"
    norm_type = content_type.lower()
    
    if "pdf" in norm_type: return "📄"
    if "json" in norm_type: return "{ }"
    if "html" in norm_type: return "🌐"
    if "xml" in norm_type: return "<>"
    if "csv" in norm_type: return "📊"
    if norm_type.startswith("text/"): return "📝"
    return "📎"


def generate_severity_distribution_chart(results):
    if not results or len(results) == 0:
        return '<div class="trend-chart" style="height: 600px;"><div class="no-data">No results available for severity distribution.</div></div>'

    severity_levels = ["Critical", "High", "Medium", "Low", "Minor"]
    data = {
        "passed": [0, 0, 0, 0, 0],
        "failed": [0, 0, 0, 0, 0],
        "flaky": [0, 0, 0, 0, 0],
        "skipped": [0, 0, 0, 0, 0],
    }

    for test in results:
        sev = test.get('severity', "Medium")
        status = str(test.get('status', '')).lower()

        try:
            index = severity_levels.index(sev)
        except ValueError:
            index = 2

        if status == "passed":
            data['passed'][index] += 1
        elif status in ["failed", "timedout", "interrupted"]:
            data['failed'][index] += 1
        elif status == "flaky":
            data['flaky'][index] += 1
        else:
            data['skipped'][index] += 1

    import random
    chart_id = f"sevDistChart-{int(time.time() * 1000)}-{str(random.random())[2:7]}"
    render_function_name = f"renderSevDistChart_{chart_id.replace('-', '_')}"

    SEV_SERIES = [
        {"name": "Passed",  "key": "passed",  "color": "#10b981"},
        {"name": "Failed",  "key": "failed",  "color": "#ef4444"},
        {"name": "Flaky",   "key": "flaky",   "color": "#00ccd3"},
        {"name": "Skipped", "key": "skipped", "color": "#f59e0b"},
    ]
    traces = []
    for s in SEV_SERIES:
        vals = data[s['key']]
        traces.append({
            "name": s["name"],
            "y": vals,
            "marker": {"color": s["color"]}
        })

    traces_json = json.dumps(traces)
    categories_json = json.dumps(severity_levels)

    return f"""
    <div class="trend-chart" style="height: 600px; padding: 28px; box-sizing: border-box;">
        <h3 class="chart-title-header">Severity Distribution</h3>
        <div id="{chart_id}" class="lazy-load-chart" data-render-function-name="{render_function_name}" style="width: 100%; height: 100%;">
             <div class="no-data">Loading Severity Chart...</div>
        </div>
        <script>
            window.{render_function_name} = function() {{
                const chartContainer = document.getElementById('{chart_id}');
                if (!chartContainer) return;
                if (typeof Highcharts !== 'undefined') {{
                    try {{
                        const seriesData = {traces_json}.map(t => ({{
                            name: t.name,
                            data: t.y,
                            color: t.marker.color
                        }}));
                        
                        Highcharts.chart('{chart_id}', {{
                            chart: {{ type: 'column', backgroundColor: 'transparent' }},
                            title: {{ text: null }},
                            xAxis: {{
                                categories: {categories_json},
                                labels: {{ style: {{ color: '#aaa' }} }},
                                gridLineColor: 'rgba(128,128,128,0.15)'
                            }},
                            yAxis: {{
                                title: {{ text: 'Number of Tests', style: {{ color: '#aaa' }} }},
                                labels: {{ style: {{ color: '#aaa' }} }},
                                gridLineColor: 'rgba(128,128,128,0.15)',
                                min: 0
                            }},
                            tooltip: {{
                                shared: true,
                                backgroundColor: 'rgba(10,10,10,0.92)',
                                style: {{ color: '#f5f5f5' }},
                                borderRadius: 8,
                                borderWidth: 0
                            }},
                            plotOptions: {{
                                column: {{
                                    borderWidth: 0,
                                    borderRadius: 4,
                                    dataLabels: {{
                                        enabled: true,
                                        color: '#fff',
                                        formatter: function() {{ return this.y > 0 ? this.y : null; }}
                                    }}
                                }}
                            }},
                            legend: {{
                                itemStyle: {{ color: '#ccc' }},
                                itemHoverStyle: {{ color: '#fff' }}
                            }},
                            credits: {{ enabled: false }},
                            series: seriesData
                        }});
                    }} catch (e) {{
                        console.error("Error rendering chart {chart_id} (lazy):", e);
                        chartContainer.innerHTML = '<div class="no-data">Error rendering severity chart.</div>';
                    }}
                }} else {{
                    chartContainer.innerHTML = '<div class="no-data">Charting library not available for severity.</div>';
                }}
            }};
        </script>
    </div>
  """

def generate_html(report_data, trend_data=None):
    run_info = report_data.get('run', {})
    results = report_data.get('results', [])
    suites_data = get_suites_data(results)
    
    run_summary = run_info or {
        "totalTests": 0,
        "passed": 0,
        "failed": 0,
        "skipped": 0,
        "duration": 0,
        "timestamp": datetime.now().isoformat()
    }

    def fix_path(p):
        if not p: return ""
        # Handle path separators safely
        prefix = DEFAULT_OUTPUT_DIR + "/"
        prefix_win = DEFAULT_OUTPUT_DIR + "\\"
        if p.startswith(prefix): return p[len(prefix):]
        if p.startswith(prefix_win): return p[len(prefix_win):]
        return p

    avg_test_duration = format_duration(run_summary.get('duration', 0) / run_summary.get('totalTests', 1)) if run_summary.get('totalTests', 0) > 0 else "0.0s"

    flaky_count = sum(1 for r in results if r.get('outcome') == 'flaky')

    retried_tests_count = 0
    total_retried = 0
    for test in results:
        retry_hist = test.get('retryHistory', [])
        if retry_hist:
            unsuccessful_retries = [attempt for attempt in retry_hist if attempt.get('status') in ['failed', 'timedout', 'flaky']]
            if unsuccessful_retries:
                retried_tests_count += 1
            total_retried += len(unsuccessful_retries)

    calculated_passed = 0
    calculated_failed = 0
    calculated_skipped = 0
    calculated_flaky = 0
    calculated_total = 0

    for test in results:
        calculated_total += 1
        status_to_use = test.get('status')
        if test.get('outcome') == 'flaky':
            status_to_use = 'flaky'
        elif test.get('status') == 'flaky': 
            status_to_use = 'flaky'
        elif test.get('retryHistory') and test.get('final_status'):
            status_to_use = test.get('final_status')
            
        test['status'] = status_to_use
        
        s = str(status_to_use).lower()
        if s == 'passed': calculated_passed += 1
        elif s == 'skipped': calculated_skipped += 1
        elif s == 'flaky': calculated_flaky += 1
        else: calculated_failed += 1

    if results:
        run_summary['passed'] = calculated_passed
        run_summary['failed'] = calculated_failed
        run_summary['skipped'] = calculated_skipped
        run_summary['flaky'] = calculated_flaky
        run_summary['totalTests'] = calculated_total

    total_tests_or_1 = run_summary.get('totalTests', 1) or 1
    pass_percentage = round((run_summary.get('passed', 0) / total_tests_or_1) * 100)
    fail_percentage = round((run_summary.get('failed', 0) / total_tests_or_1) * 100)
    skip_percentage = round((run_summary.get('skipped', 0) / total_tests_or_1) * 100)
    flaky_percentage = round((run_summary.get('flaky', 0) / total_tests_or_1) * 100)

    browser_stats = {}
    for test in results:
        browser_name = test.get('browser', 'unknown')
        browser_stats[browser_name] = browser_stats.get(browser_name, 0) + 1

    total_tests = run_summary.get('totalTests', 1) or 1
    browser_breakdown = [
        {"browser": b, "count": c, "percentage": round((c / total_tests) * 100)}
        for b, c in browser_stats.items()
    ]
    browser_breakdown.sort(key=lambda x: x['count'], reverse=True)

    def generate_steps_html(steps, depth=0):
        if not steps: return "<div class='no-steps'>No steps recorded for this test.</div>"
        steps_html = ""
        for step in steps:
            has_nested = bool(step.get('steps'))
            is_hook = step.get('hookType')
            is_failed_step = step.get('isFailedStep') is True

            step_class = f"step-hook step-hook-{step['hookType']}" if is_hook else ""
            failed_step_class = " failed-step-highlight" if is_failed_step else ""
            hook_indicator = f" ({step['hookType']} hook)" if is_hook else ""
            failed_step_indicator = ' <span class="failed-step-marker">⚠️ Failed at this step</span>' if is_failed_step else ""
            step_status = step.get('status', 'passed')

            steps_html += f"""
            <div class="step-item{failed_step_class}" style="--depth: {depth};">
              <div class="step-header {step_class}" role="button" aria-expanded="false">
                <span class="step-icon">{get_status_icon(step_status)}</span>
                <span class="step-title">{sanitize_html(step.get('title', ''))}{hook_indicator}{failed_step_indicator}</span>
                <span class="step-duration">{format_duration(step.get('duration'))}</span>
              </div>
              <div class="step-details" style="display: none;">
                {f'''<div class="step-location-badge">
                  <span class="location-icon">&#128205;</span>
                  <code class="location-text">{sanitize_html(step.get("codeLocation"))}</code>
                </div>''' if step.get("codeLocation") else ""}
                {f'''<div class="step-code-block">
                  <div class="code-block-header">
                    <div class="code-block-left">
                      <span class="code-block-status status-{step_status}">{step_status}</span>
                      <span class="code-block-lang">python</span>
                    </div>
                    <div class="code-block-right">
                      <span class="code-block-dur">{format_duration(step.get("duration"))}</span>
                      <button class="copy-snippet-btn" onclick="(function(b){{
                        navigator.clipboard.writeText(b.closest('.step-code-block').querySelector('code').innerText)
                          .then(()=>{{b.textContent='Copied!';setTimeout(()=>b.textContent='Copy',1500)}});
                      }})(this)">Copy</button>
                    </div>
                  </div>
                  <pre class="code-snippet"><code>{sanitize_html(step.get("snippet"))}</code></pre>
                </div>''' if step.get("snippet") else ""}
            """

            if step.get('errorMessage'):
                steps_html += f"""
                <div class="test-error-summary">
                    {f'<div class="stack-trace">{format_playwright_error(step.get("stackTrace"))}</div>' if step.get('stackTrace') else ""}
                    <button 
                        class="copy-error-btn" 
                        onclick="copyErrorToClipboard(this)"
                        style="
                          margin-top: 8px;
                          padding: 6px 12px;
                          background: #f0f0f0;
                          border: 2px solid #ccc;
                          border-radius: 4px;
                          cursor: pointer;
                          font-size: 12px;
                          border-color: #8B0000;
                          color: #8B0000;
                          align-self: flex-end;
                          width: auto;
                          "
                        onmouseover="this.style.background='#e0e0e0'"
                        onmouseout="this.style.background='#f0f0f0'"
                    >Copy Error Prompt</button>
                </div>"""
                
            if has_nested:
                steps_html += f'<div class="nested-steps">{generate_steps_html(step.get("steps"), depth + 1)}</div>'
                
            steps_html += "</div></div>"
        return steps_html

    def generate_test_cases_html():
        if not results:
            return '<div class="no-tests">No test results found in this run.</div>'
            
        tests_html = ""
        for index, test in enumerate(results):
            browser = test.get('browser', 'unknown')
            test_file_parts = test.get('name', '').split(" > ")
            test_title = test_file_parts[-1] if test_file_parts else "Unnamed Test"
            
            severity = test.get('severity', "Medium")
            severity_badge = f'<span class="severity-badge" data-severity="{severity.lower()}">{severity}</span>'
            
            retry_count = len(test.get('retryHistory', []))
            retry_badge = f'<span class="retry-badge">Retry Count: {retry_count}</span>' if retry_count > 0 else ''

            def get_small_status_badge(status):
                s = str(status).lower()
                color_var = 'var(--text-tertiary)'
                if s == 'passed': color_var = 'var(--success-color)'
                elif s == 'failed': color_var = 'var(--danger-color)'
                elif s == 'skipped': color_var = 'var(--warning-color)'
                elif s == 'flaky': color_var = '#00ccd3'
                return f'<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: {color_var}; margin-left: 6px; vertical-align: middle;" title="{s}"></span>'

            def get_test_content_html(test_data, run_suffix):
                annotations_html = ""
                if test_data.get('annotations'):
                    annotations_html = '<div class="annotations-section" style="margin: 12px 0; padding: 12px; background-color: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.3); border-left: 4px solid #8b5cf6; border-radius: 4px;"><h4 style="margin-top: 0; margin-bottom: 10px; color: #8b5cf6; font-size: 1.1em;">📌 Annotations</h4>'
                    for idx, ann in enumerate(test_data['annotations']):
                        is_issue = ann.get('type') in ['issue', 'bug']
                        desc_text = ann.get('description', '')
                        type_label = sanitize_html(ann.get('type', ''))
                        
                        desc_html = sanitize_html(desc_text)
                        if is_issue and re.match(r'^[A-Z]+-\d+$', desc_text):
                            desc_html = f'<a href="#" class="annotation-link" data-annotation="{sanitize_html(desc_text)}" style="color: #3b82f6; text-decoration: underline; cursor: pointer;">{sanitize_html(desc_text)}</a>'
                            
                        loc_text = ""
                        if ann.get('location'):
                            loc_text = f'<div style="font-size: 0.85em; color: #6b7280; margin-top: 4px;">Location: {sanitize_html(ann["location"].get("file", ""))}:{ann["location"].get("line", "")}:{ann["location"].get("column", "")}</div>'
                            
                        margin_b = "10px" if idx < len(test_data['annotations']) - 1 else "0"
                        annotations_html += f'<div style="margin-bottom: {margin_b};"><strong style="color: #8b5cf6;">Type:</strong> <span style="background-color: rgba(139, 92, 246, 0.2); padding: 2px 8px; border-radius: 4px; font-size: 0.9em;">{type_label}</span>'
                        if desc_text: annotations_html += f'<br><strong style="color: #8b5cf6;">Description:</strong> {desc_html}'
                        annotations_html += loc_text + "</div>"
                    annotations_html += "</div>"

                error_html = ""
                if test_data.get('errorMessage'):
                    error_html = f"""<div class="test-error-summary"><div class="stack-trace">{format_playwright_error(test_data['errorMessage'])}</div>
                    <button class="copy-error-btn" onclick="copyErrorToClipboard(this)" style="margin-top: 8px; padding: 6px 12px; background: #f0f0f0; border: 2px solid #ccc; border-radius: 4px; cursor: pointer; font-size: 12px; border-color: #8B0000; color: #8B0000; align-self: flex-end; width: auto;" onmouseover="this.style.background='#e0e0e0'" onmouseout="this.style.background='#f0f0f0'">Copy Error Prompt</button></div>"""

                snippet_html = f'<div class="code-section"><h4>Error Snippet</h4><pre><code>{format_playwright_error(test_data["snippet"])}</code></pre></div>' if test_data.get('snippet') else ""
                
                stdout_html = ""
                if test_data.get('stdout'):
                    log_id_out = f"log-out-{test_data.get('id', 'unknown')}-{random.randint(1000, 9999)}"
                    stdout_html = f"""<div class="console-output-section"><h4>Console Output (stdout)<button class="copy-btn" onclick="copyLogContent('{log_id_out}', this)">Copy</button></h4>
                    <div class="log-wrapper"><pre id="{log_id_out}" class="console-log stdout-log" style="color: wheat; padding: 1.25em; line-height: 1.2;">{format_playwright_error(chr(10).join(test_data['stdout']))}</pre></div></div>"""

                stderr_html = ""
                if test_data.get('stderr'):
                    log_id_err = f"log-err-{test_data.get('id', 'unknown')}-{random.randint(1000, 9999)}"
                    stderr_html = f"""<div class="console-output-section"><h4>Console Output (stderr)<button class="copy-btn" onclick="copyLogContent('{log_id_err}', this)">Copy</button></h4>
                    <div class="log-wrapper"><pre id="{log_id_err}" class="console-log stderr-log" style="color: indianred; padding: 1.25em; line-height: 1.2;">{format_playwright_error(chr(10).join(test_data['stderr']))}</pre></div></div>"""

                screenshots_html = ""
                if test_data.get('screenshots'):
                    screenshots_html = '<div class="attachments-section"><h4>Screenshots</h4><div class="attachments-grid">'
                    for s_idx, screenshot in enumerate(test_data['screenshots']):
                        fixed_path = fix_path(screenshot)
                        screenshots_html += f"""<div class="attachment-item"><img src="{fixed_path}" alt="Screenshot {s_idx + 1}"><div class="attachment-info"><div class="trace-actions"><a href="{fixed_path}" target="_blank" class="view-full">View Full Image</a><a href="{fixed_path}" target="_blank" download="screenshot-{int(time.time())}-{s_idx}.png">Download</a></div></div></div>"""
                    screenshots_html += '</div></div>'

                videos_html = ""
                if test_data.get('videoPath'):
                    videos_html = '<div class="attachments-section"><h4>Videos</h4><div class="attachments-grid">'
                    for v_idx, videoUrl in enumerate(test_data['videoPath']):
                        fixed_path = fix_path(videoUrl)
                        ext = fixed_path.split('.')[-1].lower()
                        mime = {"mp4": "video/mp4", "webm": "video/webm", "ogg": "video/ogg", "mov": "video/quicktime", "avi": "video/x-msvideo"}.get(ext, "video/mp4")
                        videos_html += f"""<div class="attachment-item video-item"><video controls width="100%" height="auto" title="Video {v_idx + 1}"><source src="{sanitize_html(fixed_path)}" type="{mime}">Your browser does not support the video tag.</video><div class="attachment-info"><div class="trace-actions"><a href="{sanitize_html(fixed_path)}" target="_blank" download="video-{int(time.time())}-{v_idx}.{ext}">Download</a></div></div></div>"""
                    videos_html += '</div></div>'

                trace_html = ""
                if test_data.get('tracePath'):
                    fixed_path = fix_path(test_data['tracePath'])
                    basename = os.path.basename(test_data['tracePath'])
                    trace_html = f"""<div class="attachments-section"><h4>Trace Files</h4><div class="attachments-grid"><div class="attachment-item trace-item"><div class="trace-preview"><span class="trace-icon">📄</span><span class="trace-name">{sanitize_html(basename)}</span></div><div class="attachment-info"><div class="trace-actions"><a href="{sanitize_html(fixed_path)}" target="_blank" download="{sanitize_html(basename)}" class="download-trace">Download Trace</a></div></div></div></div></div>"""

                other_attachments_html = ""
                if test_data.get('attachments'):
                    other_attachments_html = '<div class="attachments-section"><h4>Other Attachments</h4><div class="attachments-grid">'
                    for att in test_data['attachments']:
                        fixed_path = fix_path(att.get('path', ''))
                        other_attachments_html += f"""<div class="attachment-item generic-attachment"><div class="attachment-icon">{get_attachment_icon(att.get('contentType'))}</div><div class="attachment-caption"><span class="attachment-name" title="{sanitize_html(att.get('name'))}">{sanitize_html(att.get('name'))}</span><span class="attachment-type">{sanitize_html(att.get('contentType'))}</span></div><div class="attachment-info"><div class="trace-actions"><a href="{sanitize_html(fixed_path)}" target="_blank" class="view-full">View</a><a href="{sanitize_html(fixed_path)}" target="_blank" download="{sanitize_html(att.get('name'))}" class="download-trace">Download</a></div></div></div>"""
                    other_attachments_html += '</div></div>'

                return f"""
                <p><strong>Full Path:</strong> {sanitize_html(test_data.get('name'))}</p>
                {annotations_html}
                <p><strong>Test run Worker ID:</strong> {sanitize_html(test_data.get('workerId'))} [<strong>Total No. of Workers:</strong> {sanitize_html(test_data.get('totalWorkers'))}]</p>
                {error_html}
                {snippet_html}
                <h4>Steps</h4>
                <div class="steps-list">{generate_steps_html(test_data.get('steps', []))}</div>
                {stdout_html}
                {stderr_html}
                {screenshots_html}
                {videos_html}
                {trace_html}
                {other_attachments_html}
                """

            # Prioritize 'flaky' status if it exists, otherwise use final_status or status
            header_status = test.get('status')
            if header_status != 'flaky' and test.get('retryHistory') and test.get('final_status'):
                header_status = test.get('final_status')
            outcome_badge = f'<span class="outcome-badge {test["outcome"]}">{test["outcome"]}</span>' if test.get('outcome') and test.get('outcome') != 'flaky' else ''
            tags_html = "".join([f'<span class="tag">{sanitize_html(t)}</span>' for t in test.get('tags', [])])
            
            retry_tabs_html = ""
            if test.get('retryHistory'):
                # Total attempts = len(history) + 1 (the current primary one)
                history = test.get('retryHistory', [])
                total_attempts = len(history) + 1
                
                tabs_header = ""
                tabs_content = ""
                
                # Add previous attempts from history
                for idx, retry in enumerate(history):
                    attempt_num = idx + 1
                    status = retry.get('final_status') or retry.get('status')
                    tabs_header += f"""<button class="retry-tab" onclick="switchRetryTab(event, 'retry-{attempt_num}-{test.get('id', index)}')">Attempt {attempt_num} {get_small_status_badge(status)}</button>"""
                    tabs_content += f"""<div id="retry-{attempt_num}-{test.get('id', index)}" class="retry-tab-content" style="display: none;">{get_test_content_html(retry, f"retry-{attempt_num}")}</div>"""
                
                # Add the primary (latest) attempt as the active one
                primary_status = test.get('status')
                tabs_header += f"""<button class="retry-tab active" onclick="switchRetryTab(event, 'primary-run-{test.get('id', index)}')">Attempt {total_attempts} (Latest) {get_small_status_badge(primary_status)}</button>"""
                tabs_content += f"""<div id="primary-run-{test.get('id', index)}" class="retry-tab-content active">{get_test_content_html(test, 'latest')}</div>"""
                
                retry_tabs_html = f"""<div class="retry-tabs-container"><div class="retry-tabs-header">{tabs_header}</div>{tabs_content}</div>"""
            else:
                retry_tabs_html = get_test_content_html(test, 'single')

            tests_html += f"""
            <div class="test-case" data-status="{header_status}" data-browser="{sanitize_html(browser)}" data-tags="{','.join(test.get('tags', [])).lower()}">
                <div class="test-case-header" role="button" aria-expanded="false">
                  <div class="test-case-summary">
                    <span class="test-case-title" title="{sanitize_html(test.get('name'))}">{sanitize_html(test_title)}</span>
                    <span class="test-case-browser">({sanitize_html(browser)})</span>
                  </div>
                  <div class="test-case-meta">
                    {severity_badge}
                    {retry_badge}
                    {outcome_badge}
                    {tags_html}
                  </div>
                  <div class="test-case-status-duration">
                    <span class="status-badge {get_status_class(header_status)}">{str(header_status).upper()}</span>
                    <span class="test-duration">{format_duration(test.get('duration'))}</span>
                  </div>
                </div>
                <div class="test-case-content" style="display: none;">
                  {retry_tabs_html}
                </div>
            </div>"""
            
        return tests_html

    browser_options = "".join([f'<option value="{sanitize_html(b)}">{sanitize_html(b)}</option>' for b in set([t.get('browser', 'unknown') for t in results])])

    report_desc_html = ""
    if report_data.get('metadata', {}).get('reportDescription'):
        desc = report_data['metadata']['reportDescription']
        trunc_desc = desc[:130] + "..." if len(desc) > 130 else desc
        report_desc_html = f"""<div class="report-description" title="{sanitize_html(desc)}" style="margin: 0 0 24px 0; padding: 18px 24px; background-color: var(--bg-card, var(--card-bg, #ffffff)); border: 1px solid var(--border-color, var(--border-medium, #e5e7eb)); border-left: 4px solid #764ba2; border-radius: 8px; display: flex; align-items: flex-start; gap: 16px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#764ba2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; margin-top: 1px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            <div style="flex: 1; min-width: 0;">
              <h4 style="margin: 0 0 6px 0; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.5px; color: #764ba2; font-weight: 700;">Report Description</h4>
              <p style="margin: 0; font-size: 0.95em; color: var(--text-color, #1f2937); line-height: 1.6; font-weight: 400; overflow-wrap: break-word;">{sanitize_html(trunc_desc)}</p>
            </div>
        </div>"""

    browser_breakdown_html = ""
    for b in browser_breakdown[:3]:
        browser_breakdown_html += f"""<div class="browser-item"><span class="browser-name" title="{sanitize_html(b['browser'])}">{sanitize_html(b['browser'])}</span><span class="browser-stats">{b['percentage']}% ({b['count']})</span></div>"""
    if len(browser_breakdown) > 3:
        browser_breakdown_html += f'<div class="browser-item" style="opacity: 0.6; font-style: italic; justify-content: center; border-top: 1px solid #e2e8f0; margin-top: 8px; padding-top: 8px;"><span>+{len(browser_breakdown) - 3} more browsers</span></div>'

    highcharts_content = get_local_highcharts_js()
    if highcharts_content:
        import re as _re
        highcharts_content = _re.sub(r'</(body|html|head|script|style)', r'<\/\1', highcharts_content)
    highcharts_scripts = f"<script>{highcharts_content}</script>" if highcharts_content else ""

    html_template = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" type="image/png" href="{LOGO_BASE64}">
    <link rel="apple-touch-icon" href="{LOGO_BASE64}">
    <link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="preload" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'">
    <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap"></noscript>
    
    {highcharts_scripts}
    
    <title>Pulse Report</title>
    <style>
        :root {{ 
          --primary-color: #6366f1; --primary-dark: #4f46e5; --primary-light: #818cf8;
          --secondary-color: #8b5cf6; --secondary-dark: #7c3aed; --secondary-light: #a78bfa;
          --accent-color: #ec4899; --accent-alt: #06b6d4;
          --success-color: #10b981; --success-dark: #059669; --success-light: #34d399;
          --danger-color: #ef4444; --danger-dark: #dc2626; --danger-light: #f87171;
          --warning-color: #f59e0b; --warning-dark: #d97706; --warning-light: #fbbf24;
          --info-color: #3b82f6;
          --flaky-color: #00ccd3; 
          --neutral-50: #fafafa; --neutral-100: #f5f5f5; --neutral-200: #e5e5e5; --neutral-300: #d4d4d4;
          --neutral-400: #a3a3a3; --neutral-500: #737373; --neutral-600: #525252; --neutral-700: #404040;
          --neutral-800: #262626; --neutral-900: #171717;
          --text-primary: #0f172a; --text-secondary: #475569; --text-tertiary: #94a3b8;
          --bg-primary: #ffffff; --bg-secondary: #f8fafc; --bg-tertiary: #f1f5f9;
          --border-light: #e2e8f0; --border-medium: #cbd5e1; --border-dark: #94a3b8;
          --font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          --radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px; --radius-xl: 20px; --radius-2xl: 24px;
          --shadow-xs: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
          --shadow-sm: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);
          --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
          --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
          --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
          --shadow-2xl: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          --glow-primary: 0 0 20px rgba(99, 102, 241, 0.4), 0 0 40px rgba(99, 102, 241, 0.2);
          --glow-success: 0 0 20px rgba(16, 185, 129, 0.4), 0 0 40px rgba(16, 185, 129, 0.2);
          --glow-danger: 0 0 20px rgba(239, 68, 68, 0.4), 0 0 40px rgba(239, 68, 68, 0.2);
          --bg-card: #ffffff; --bg-card-hover: #f8fafc;
          --gradient-card: linear-gradient(145deg, #ffffff 0%, #f9fafb 100%);
          --border-medium: #cbd5e1;
        }}
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        ::selection {{ background: var(--primary-color); color: white; }}
        ::-webkit-scrollbar {{ width: 0; height: 0; display: none; }}
        ::-webkit-scrollbar-track {{ display: none; }}
        ::-webkit-scrollbar-thumb {{ display: none; }}
        ::-webkit-scrollbar-thumb:hover {{ display: none; }}
        * {{ scrollbar-width: none; -ms-overflow-style: none; }}
        .trend-chart-container, .test-history-trend div[id^="testHistoryChart-"] {{ min-height: 100px; }}
        .lazy-load-chart .no-data, .lazy-load-chart .no-data-chart {{ display: flex; align-items: center; justify-content: center; height: 100%; font-style: italic; color: var(--dark-gray-color); }}
        /* Highcharts overrides */
        .highcharts-container {{ font-family: var(--font-family) !important; }}
        .highcharts-screen-reader-region,
        .highcharts-visually-hidden {{
            position: absolute !important;
            width: 1px !important;
            height: 1px !important;
            padding: 0 !important;
            margin: -1px !important;
            overflow: hidden !important;
            clip: rect(0,0,0,0) !important;
            white-space: nowrap !important;
            border: 0 !important;
        }}
        .highcharts-a11y-proxy-button,
        .highcharts-a11y-proxy-element {{
            position: absolute !important;
            width: 1px !important;
            height: 1px !important;
            overflow: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
        }}
        /* Actions Styling */
        .actions-badge {{
            background-color: rgba(52, 211, 153, 0.1);
            color: var(--success-color);
            font-size: 0.75em;
            padding: 2px 8px;
            border-radius: 12px;
            margin-left: 10px;
            border: 1px solid rgba(52, 211, 153, 0.2);
            font-weight: 600;
        }}
        .granular-actions {{
            margin-top: 15px;
            padding: 15px;
            background: rgba(0, 0, 0, 0.05);
            border-radius: 8px;
            border: 1px solid #e2e8f0;
        }}
        .granular-actions h5 {{
            margin-top: 0;
            margin-bottom: 12px;
            color: #475569;
            font-size: 0.9em;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }}
        .actions-table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 0.85em;
        }}
        .actions-table th {{
            text-align: left;
            padding: 8px;
            border-bottom: 1px solid #e2e8f0;
            color: #64748b;
            font-weight: 600;
        }}
        .actions-table td {{
            padding: 8px;
            border-bottom: 1px solid #f1f5f9;
            vertical-align: middle;
        }}
        .actions-table tr:last-child td {{
            border-bottom: none;
        }}
        .action-passed {{
            color: #1e293b;
        }}
        .action-failed {{
            color: var(--danger-color);
            background: rgba(239, 68, 68, 0.03);
        }}
        .action-status-dot {{
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            margin-right: 6px;
        }}
        .action-passed .action-status-dot {{
            background-color: var(--success-color);
            box-shadow: 0 0 5px var(--success-color);
        }}
        .action-failed .action-status-dot {{
            background-color: var(--danger-color);
            box-shadow: 0 0 5px var(--danger-color);
        }}
        .selector-text, .value-text {{
            color: #475569;
            background: rgba(0, 0, 0, 0.05);
            padding: 2px 6px;
            border-radius: 4px;
            max-width: 200px;
            display: inline-block;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }}
        html {{
          overflow-x: hidden;
        }}
        body {{
          font-family: var(--font-family);
          margin: 0;
          background: #fafbfc;
          color: var(--text-primary);
          line-height: 1.6;
          font-size: 15px;
          min-height: 100vh;
          overflow-x: hidden;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
        }}
        * {{
          transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
          will-change: transform, opacity;
        }}
        *:not(input):not(select):not(textarea):not(button) {{
          transition-duration: 0.15s;
        }}
        .container {{
          padding: 0;
          margin: 0;
          max-width: 100%;
          overflow-x: hidden;
        }}
        .header {{ 
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 32px 40px 28px 40px;
          border-bottom: 1px solid #e2e8f0;
          background: rgba(255, 255, 255, 0.95);
        }}
        .header-title {{ 
          display: flex;
          align-items: center;
          gap: 20px;
        }}
        .header h1 {{ 
          margin: 0; 
          font-size: 2.5em; 
          font-weight: 900; 
          color: #0f172a;
          line-height: 1;
          letter-spacing: -0.03em;
        }}
        #report-logo {{ 
          height: 60px; 
        }}
        .run-info {{ 
          display: flex;
          gap: 16px;
          align-items: stretch;
          background: transparent;
          border-radius: 12px;
          padding: 0;
          box-shadow: var(--shadow-md); 
          overflow: hidden; 
        }}
        .run-info-item {{
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 16px 28px;
          position: relative;
          flex: 1;
          min-width: fit-content;
        }}

        .run-info-item:first-child {{
          background: linear-gradient(135deg, rgba(251, 191, 36, 0.2) 0%, rgba(245, 158, 11, 0.15) 50%, rgba(217, 119, 6, 0.1) 100%);
          border: 1px solid rgba(251, 191, 36, 0.3);
          border-radius: var(--radius-md);
          box-shadow: 0 4px 16px rgba(251, 191, 36, 0.2), inset 0 1px 0 rgba(251, 191, 36, 0.25), 0 0 40px rgba(251, 191, 36, 0.08);
        }}
        .run-info-item:first-child:hover {{
          background: linear-gradient(135deg, rgba(251, 191, 36, 0.28) 0%, rgba(245, 158, 11, 0.22) 50%, rgba(217, 119, 6, 0.15) 100%);
          border-color: rgba(251, 191, 36, 0.4);
          box-shadow: 0 8px 24px rgba(251, 191, 36, 0.3), inset 0 1px 0 rgba(251, 191, 36, 0.35), 0 0 50px rgba(251, 191, 36, 0.15);
        }}
        .run-info-item:last-child {{
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.18) 0%, rgba(124, 58, 237, 0.12) 50%, rgba(109, 40, 217, 0.08) 100%);
          border: 1px solid rgba(139, 92, 246, 0.3);
          border-radius: var(--radius-md);
          box-shadow: 0 4px 16px rgba(139, 92, 246, 0.2), inset 0 1px 0 rgba(139, 92, 246, 0.25), 0 0 40px rgba(139, 92, 246, 0.08);
        }}
        .run-info-item:last-child:hover {{
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.25) 0%, rgba(124, 58, 237, 0.18) 50%, rgba(109, 40, 217, 0.12) 100%);
          border-color: rgba(139, 92, 246, 0.4);
          box-shadow: 0 8px 24px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(139, 92, 246, 0.35), 0 0 50px rgba(139, 92, 246, 0.15);
        }}
        .run-info strong {{ 
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.7em;
          text-transform: uppercase;
          letter-spacing: 1.2px;
          color: #9ca3af;
          margin: 0;
          font-weight: 700;
        }}
        .run-info strong::before {{
          content: '';
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: currentColor;
          opacity: 0.7;
          box-shadow: 0 0 8px currentColor;
        }}
        .run-info-item:first-child strong {{
          color: var(--warning-light);
        }}
        .run-info-item:last-child strong {{
          color: var(--secondary-light);
        }}
        .run-info span {{
          font-size: 1.5em;
          font-weight: 800;
          color: #0f172a; 
          font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
          letter-spacing: -0.02em;
          line-height: 1.2;
          white-space: nowrap;
        }}
        .tabs {{
          display: flex;
          background: #0f172a;
          padding: 0;
          margin: 0;
          position: sticky;
          top: 0;
          z-index: 100;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          max-width: 100vw;
          width: 100%;
        }}
        .tab-button {{
          flex: 1 1 auto;
          padding: 24px 20px;
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 0.85em;
          font-weight: 700;
          color: #64748b;
          transition: all 0.2s ease;
          white-space: nowrap;
          text-transform: uppercase;
          letter-spacing: 1.2px;
          border-right: 1px solid #1e293b;
          min-width: 0;
        }}
        .tab-button:last-child {{ border-right: none; }}
        .tab-button:hover {{ 
          background: #1e293b;
          color: #ffffff; 
        }}
        .tab-button.active {{ 
          background: #6366f1;
          color: #ffffff;
        }}
        .tab-content {{
          display: none;
          animation: fadeIn 0.4s ease-out;
          overflow-x: hidden;
          max-width: 100%;
        }}
        .tab-content.active {{
          display: block;
        }}
        @keyframes fadeIn {{ from {{ opacity: 0; transform: translateY(8px); }} to {{ opacity: 1; transform: translateY(0); }} }}
        
        @media (max-width: 1200px) {{
          .trend-charts-row {{ 
            grid-template-columns: 1fr; 
          }}
          .dashboard-bottom-row {{ 
            grid-template-columns: 1fr; 
          }}
        }}
        
        
        .stat-pill.flaky {{ color: #4b5563; }}

        .dashboard-grid {{ 
          display: grid; 
          grid-template-columns: repeat(4, 1fr); 
          gap: 0;
          margin: 0 0 40px 0;
        }}
        .stats-pill.failed {{ color: var(--danger-dark); }}
        .stats-pill.flaky {{ color: #4b5563; }}
        .browser-breakdown {{
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-top: 6px;
          max-height: 150px;
          overflow-y: auto;
          padding-right: 4px;
          scrollbar-width: thin;
          scrollbar-color: #cbd5e1 #f1f5f9;
        }}
        .browser-breakdown::-webkit-scrollbar {{
          width: 6px;
          display: block;
        }}
        .browser-breakdown::-webkit-scrollbar-track {{
          background: #f1f5f9;
          border-radius: 3px;
          display: block;
        }}
        .browser-breakdown::-webkit-scrollbar-thumb {{
          background: #cbd5e1;
          border-radius: 3px;
          display: block;
        }}
        .browser-breakdown::-webkit-scrollbar-thumb:hover {{
          background: #94a3b8;
          display: block;
        }}
        .browser-item {{
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.95em;
        }}
        .browser-name {{
          font-weight: 700;
          color: #0f172a;
          text-transform: capitalize;
          font-size: 1.05em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
          min-width: 0;
          margin-right: 8px;
        }}
        .browser-stats {{
          color: #64748b;
          white-space: nowrap;
          flex-shrink: 0;
          font-weight: 700;
          font-size: 0.95em;
        }}
        .summary-card {{ 
          padding: 36px 32px; 
          text-align: left;
          background: rgba(255, 255, 255, 0.95);
          border: 1px solid #e2e8f0;
          transition: background 0.2s ease;
          border-right: 1px solid #e2e8f0;
          border-bottom: 1px solid #e2e8f0;
        }}
        .summary-card:nth-child(4n) {{ border-right: none; }}
        .summary-card h3 {{ 
          margin: 0 0 12px; 
          font-size: 0.7em; 
          font-weight: 700; 
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 1.2px;
        }}
        .summary-card .value {{ 
          font-size: 2.8em; 
          font-weight: 900; 
          margin: 0;
          line-height: 1;
          letter-spacing: -0.03em;
        }}
        .summary-card .trend-percentage {{
          font-size: 0.9em;
          color: #64748b;
          margin-top: 8px;
          font-weight: 600;
        }}
        
        @media (max-width: 1024px) {{
          .header {{ 
            padding: 32px 24px;
            flex-direction: column;
            gap: 24px;
            align-items: flex-start;
          }}
          .run-info {{ 
            flex-direction: column;
            gap: 0;
            width: 100%;
            border-radius: 14px;
            overflow: hidden;
          }}
          .dashboard-grid {{ 
            grid-template-columns: repeat(2, 1fr);
          }}
          .summary-card:nth-child(2n) {{ border-right: none; }}
          .summary-card:nth-child(n+7) {{ border-bottom: none; }}
          .filters {{ 
            padding: 24px;
            flex-wrap: wrap;
            gap: 12px;
          }}
          .filters input {{ 
            flex: 1 1 auto;
            min-width: 0; 
            width: auto;
          }}
          .filters select {{ 
            flex: 0 0 auto;
            min-width: 0;
            width: auto; 
          }}
          .filters button {{ 
            width: auto;
            flex: 0 0 auto;
          }}
          .copy-btn {{
            font-size: 0.75em;
            padding: 8px 16px;
            margin-left: 0;
          }}
          .console-output-section h4 {{
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
          }}
          .log-wrapper {{
            max-height: 300px;
          }}
          .tabs {{
            overflow-x: auto;
          }}
          .tab-button {{
            padding: 20px 24px;
            font-size: 0.75em;
            white-space: nowrap;
          }}
          .tag {{
            font-size: 0.65em;
            padding: 4px 10px;
            margin-right: 4px;
            margin-bottom: 4px;
            letter-spacing: 0.3px;
          }}
          .test-case-header {{
            grid-template-columns: 1fr;
            grid-template-rows: auto auto auto;
            gap: 12px;
            padding: 16px 20px;
          }}
          .test-case-summary {{
            grid-column: 1;
            grid-row: 1;
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
            width: 100%;
            max-width: 100%;
            overflow: hidden;
          }}
          .test-case-title {{
            width: 100%;
            max-width: 100%;
          }}
          .test-case-browser {{
            width: 100%;
            max-width: 100%;
            white-space: normal;
          }}
          .test-case-meta {{
            grid-column: 1;
            grid-row: 2;
            width: 100%;
            gap: 6px;
          }}
          .test-case-status-duration {{
            grid-column: 1;
            grid-row: 3;
            align-items: flex-start;
          }}
          .test-case {{
            margin: 0 0 12px 0;
            border-radius: 8px;
          }}
          .test-case-content {{
            padding: 20px;
          }}
          .pie-chart-wrapper, .suites-widget, .trend-chart {{
            padding: 32px 24px;
          }}
          .test-history-grid {{
            grid-template-columns: 1fr;
          }}
          .ai-failure-cards-grid {{
            grid-template-columns: 1fr;
          }}
        }}
        
        @media (max-width: 768px) {{
          .header h1 {{ font-size: 1.8em; }}
          #report-logo {{ height: 48px; }}
          .tabs {{
            flex-wrap: nowrap;
            gap: 0;
            overflow-x: auto;
          }}
          .tab-button {{
            padding: 16px 20px;
            font-size: 0.7em;
            flex: 1 1 auto;
            min-width: 100px;
          }}
          .dashboard-grid {{ 
            grid-template-columns: 1fr;
          }}
          .summary-card {{ 
            padding: 32px 24px !important;
            border-right: none !important;
          }}
          .summary-card .value {{ font-size: 2.5em !important; }}
          .dashboard-bottom-row {{ 
            grid-template-columns: 1fr;
            gap: 0;
          }}
          .dashboard-column {{ 
            gap: 0; 
          }}
          .pie-chart-wrapper, .suites-widget, .trend-chart {{ 
            padding: 28px 20px;
          }}
          .pie-chart-wrapper h3, .suites-header h2, .trend-chart h3, .chart-title-header {{ 
            font-size: 1.2em;
            margin-bottom: 20px;
          }}
          .pie-chart-wrapper div[id^="pieChart-"] {{ 
            width: 100% !important;
            max-width: 100% !important;
            min-height: 280px;
            overflow: visible !important;
          }}
          .pie-chart-wrapper {{
            overflow: visible !important;
          }}
          .trend-chart-container {{ 
            min-height: 280px;
          }}
          .suites-grid {{ 
            grid-template-columns: 1fr;
          }}
          .test-case-summary {{
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
          }}
          .test-case-title {{
            width: 100%;
          }}
          .test-case-browser {{
            width: 100%;
          }}
          .test-case-meta {{
            flex-wrap: wrap;
            gap: 6px;
            width: 100%;
          }}
          .test-history-trend-section {{
            padding: 0px 20px !important;
          }}
          .ai-failure-cards-grid {{
            grid-template-columns: 1fr;
          }}
          .ai-analyzer-stats {{
            flex-direction: column;
            gap: 15px;
            text-align: center;
          }}
          .failure-header {{
            flex-direction: column;
            align-items: stretch;
            gap: 15px;
          }}
          .failure-main-info {{
            text-align: center;
          }}
          .failure-meta {{
            justify-content: center;
          }}
          .ai-buttons-group {{
            flex-direction: column;
            width: 100%;
          }}
          .compact-ai-btn, .copy-prompt-btn {{
            justify-content: center;
            padding: 12px 20px;
            width: 100%;
          }}
        }}
        
        @media (max-width: 480px) {{
          .header {{ padding: 24px 16px; }}
          .header h1 {{ font-size: 1.5em; }}
          #report-logo {{ height: 42px; }}
          .run-info {{ 
            flex-direction: column;
            gap: 12px;
            width: 100%;
          }}
          .run-info-item {{
            padding: 14px 20px;
          }}
          .run-info-item:not(:last-child)::after {{
            display: none;
          }}
          .run-info-item:not(:last-child) {{
            border-bottom: 1px solid var(--border-medium);
          }}
          .run-info strong {{ 
            font-size: 0.65em; 
          }}
          .run-info span {{ 
            font-size: 1.1em; 
          }}
          .tabs {{
            flex-wrap: wrap;
            gap: 4px;
            padding: 8px;
          }}
          .tab-button {{
            padding: 14px 10px;
            font-size: 0.6em;
            letter-spacing: 0.3px;
            flex: 1 1 calc(50% - 4px);
            min-width: 0;
            text-align: center;
          }}
          .dashboard-grid {{ gap: 0; }}
          .summary-card {{ padding: 28px 16px !important; }}
          .summary-card h3 {{ font-size: 0.65em; }}
          .summary-card .value {{ font-size: 2em !important; }}
          .dashboard-bottom-row {{ gap: 0; }}
          .dashboard-column {{ 
            gap: 0; 
          }}
          .pie-chart-wrapper, .suites-widget, .trend-chart {{ 
            padding: 20px 16px;
          }}
          .pie-chart-wrapper h3, .suites-header h2, .trend-chart h3, .chart-title-header {{ 
            font-size: 1em;
            margin-bottom: 16px;
            font-weight: 800;
          }}
          .env-dashboard-title {{ 
            font-size: 1em;
            margin-bottom: 6px;
          }}
          .env-dashboard-subtitle {{ 
            font-size: 0.85em;
          }}
          .env-card-header {{ 
            font-size: 0.85em;
          }}
          .pie-chart-wrapper div[id^="pieChart-"] {{ 
            width: 100% !important;
            max-width: 100% !important;
            min-height: 250px;
            overflow: visible !important;
          }}
          .pie-chart-wrapper {{
            overflow: visible !important;
            padding: 20px 12px;
          }}
          .trend-chart-container {{ 
            min-height: 250px;
          }}
          .suites-grid {{ 
            grid-template-columns: 1fr;
            gap: 16px;
          }}
          .suite-card {{ 
            padding: 16px;
          }}
          .filters {{
            padding: 16px;
            gap: 8px;
          }}
          .test-history-trend-section {{
            padding: 0px 16px !important;
          }}
          .test-case {{
            margin: 0 0 10px 0;
            border-radius: 6px;
          }}
          .test-case-header {{ 
            padding: 14px 16px; 
          }}
          .test-case-content {{
            padding: 16px;
          }}
          .stat-item .stat-number {{
            font-size: 1.5em;
          }}
          .failure-header {{
            padding: 15px;
          }}
          .failure-error-preview, .full-error-details {{
            padding-left: 15px;
            padding-right: 15px;
          }}
          .header h1 {{
            word-break: break-word;
            overflow-wrap: break-word;
          }}
          h2, h3, h4 {{
            word-break: break-word;
            overflow-wrap: break-word;
          }}
          .environment-dashboard-wrapper {{
            padding: 24px 16px;
            gap: 24px;
          }}
          .env-card {{
            padding: 20px;
          }}
        }}
        .summary-card.status-passed {{ background: rgba(16, 185, 129, 0.02); }}
        .summary-card.status-passed:hover {{ 
          background: rgba(16, 185, 129, 0.15); 
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
        }}
        .summary-card.status-passed .value {{ color: #10b981; }}
        .summary-card.status-failed {{ background: rgba(239, 68, 68, 0.02); }}
        .summary-card.status-failed:hover {{ 
          background: rgba(239, 68, 68, 0.15); 
          box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);
        }}
        .summary-card.status-failed .value {{ color: #ef4444; }}
        .summary-card.status-flaky::before {{ background: #00ccd3; }}
        .summary-card.status-skipped {{ background: rgba(245, 158, 11, 0.02); }}
        .summary-card.status-skipped:hover {{ 
          background: rgba(245, 158, 11, 0.15); 
          box-shadow: 0 4px 12px rgba(245, 158, 11, 0.2);
        }}
        .summary-card.status-skipped .value {{ color: #f59e0b; }}
        .summary-card.flaky-status {{ background: rgba(0, 204, 211, 0.05); }}
        .summary-card.flaky-status:hover {{ 
          background: rgba(0, 204, 211, 0.15); 
          box-shadow: 0 4px 12px rgba(0, 204, 211, 0.2);
        }}
        .summary-card.flaky-status .value {{ color: #00ccd3; }}
        .summary-card:not([class*='status-']) .value {{ color: #0f172a; }}
        .dashboard-bottom-row {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 28px; align-items: start; }}
        .dashboard-column {{ 
          display: flex; 
          flex-direction: column; 
          gap: 28px; 
        }}
        .pie-chart-wrapper, .suites-widget, .trend-chart {{ 
          background: rgba(255, 255, 255, 0.95);
          padding: 48px; 
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
          display: flex; 
          flex-direction: column;
          overflow: visible;
          margin-bottom: 24px;
        }}
        .pie-chart-wrapper {{
          position: relative;
        }}
        .pie-chart-wrapper h3, .suites-header h2, .trend-chart h3, .chart-title-header {{ 
          text-align: left; 
          margin: 0 0 40px 0; 
          font-size: 1.8em; 
          font-weight: 900; 
          color: #0f172a;
          letter-spacing: -0.02em;
        }}
        .trend-chart-container, .pie-chart-wrapper div[id^="pieChart-"] {{ 
          flex-grow: 1; 
          min-height: 250px; 
          width: 100%;
          overflow: visible;
        }}
        .status-badge-small-tooltip {{ padding: 2px 5px; border-radius: 3px; font-size: 0.9em; font-weight: 600; color: white; text-transform: uppercase; }}
        .status-badge-small-tooltip.status-passed {{ background-color: var(--success-color); }}
        .status-badge-small-tooltip.status-failed {{ background-color: var(--danger-color); }}
        .status-badge-small-tooltip.status-skipped {{ background-color: var(--warning-color); }}
        .status-badge-small-tooltip.status-unknown {{ background-color: var(--dark-gray-color); }}
        .suites-header {{
            flex-shrink: 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }}
        .summary-badge {{ background-color: var(--light-gray-color); color: var(--text-color-secondary); padding: 7px 14px; border-radius: 16px; font-size: 0.9em; }}
        .suites-grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 20px; }}
        .suites-widget {{
          display: flex;
          flex-direction: column;
        }}
        .fixed-height-widget {{
          height: 450px;
        }}
        .suites-grid-container {{
            flex-grow: 1;
            overflow-y: auto;
            padding-right: 5px;
        }}
        
        @media (max-width: 768px) {{
            .fixed-height-widget {{
                height: auto;
                max-height: 600px;
            }}
        }}
        .suite-card {{
          background: #ffffff;
          border: 1px solid var(--border-light);
          border-radius: 16px;
          padding: 24px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          flex-direction: column;
          height: 100%;
          position: relative;
          overflow: hidden;
        }}
        .suite-card:hover {{
          transform: translateY(-4px);
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
          border-color: var(--primary-light);
        }}
        .suite-card::before {{
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 4px;
          background: var(--neutral-200);
          opacity: 0.8;
          transition: background 0.3s ease;
        }}
        .suite-card.status-passed::before {{ background: var(--success-color); }}
        .suite-card.status-failed::before {{ background: var(--danger-color); }}
        .suite-card.status-flaky::before {{ background: #00ccd3; }}
        .suite-card.status-skipped::before {{ background: var(--warning-color); }}
        
        /* Outcome Badge */
        .outcome-badge {{
            background-color: var(--secondary-color); 
            color: #fff;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 0.75em;
            font-weight: 700;
            text-transform: uppercase;
            margin-right: 8px;
            letter-spacing: 0.5px;
        }}
        .outcome-badge.flaky {{
            background-color: #00ccd3;
            color: #fff;
        }}

        .suite-card-header {{
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 16px;
        }}
        .suite-name {{
          font-size: 1.15em;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          margin-right: 12px;
        }}
        .status-indicator-dot {{
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
          margin-top: 6px;
        }}
        .status-indicator-dot.status-passed {{ background-color: var(--success-color); box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.15); }}
        .status-indicator-dot.status-failed {{ background-color: var(--danger-color); box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.15); }}
        .status-indicator-dot.status-flaky {{ background-color: #00ccd3; box-shadow: 0 0 0 4px rgba(0, 204, 211, 0.15); }}
        .status-indicator-dot.status-skipped {{ background-color: rgba(245, 158, 11, 0.1); color: var(--warning-dark); border: 1px solid rgba(245, 158, 11, 0.2); }}
        .status-flaky {{ background-color: rgba(0, 204, 211, 0.1); color: #00ccd3; border: 1px solid #00ccd3; }}

        .browser-tag {{
          font-size: 0.8em;
          font-weight: 600;
          background: var(--bg-secondary);
          color: var(--text-secondary);
          padding: 4px 10px;
          border-radius: 20px;
          border: 1px solid var(--border-light);
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 20px;
          align-self: flex-start;
          box-shadow: none;
          text-shadow: none;
        }}
        
        .suite-card-body {{
          margin-top: auto;
        }}
        
        .test-count-label {{
          font-size: 0.85em;
          font-weight: 600;
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 8px;
          display: block;
        }}

        .suite-stats {{
          display: flex;
          gap: 8px;
          background: var(--bg-secondary);
          padding: 10px 14px;
          border-radius: 10px;
          justify-content: space-between;
        }}
        
        .stat-pill {{
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.9em;
          font-weight: 600;
        }}
        .stat-pill svg {{ width: 14px; height: 14px; }}
        .stat-pill.passed {{ color: var(--success-dark); }}
        .stat-pill.failed {{ color: var(--danger-dark); }}
        .stat-pill.flaky {{ color: #00ccd3; }}
        .stat-pill.skipped {{ color: var(--warning-dark); }}
        .filters {{
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin: 0;
          padding: 24px 32px;
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
        }}
        .filters input, .filters select, .filters button {{ 
          padding: 14px 18px; 
          border: 2px solid #e2e8f0; 
          font-size: 0.9em;
          font-family: var(--font-family);
          font-weight: 600;
          transition: all 0.15s ease;
        }}
        .filters input {{ 
          flex: 1 1 300px;
          min-width: 0;
          background: white;
        }}
        .filters input:focus {{ 
          outline: none;
          border-color: #6366f1;
        }}
        .filters select {{ 
          flex: 0 0 auto;
          min-width: 180px;
          background: white;
          cursor: pointer;
          width: 100%;
        }}
        .filters select:focus {{ 
          outline: none;
          border-color: #6366f1;
        }}
        .filters button {{ 
          background: #0f172a; 
          color: white; 
          cursor: pointer; 
          border: none;
          font-weight: 700;
          padding: 14px 32px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-size: 0.8em;
          flex: 0 0 auto;
        }}
        .filters button:hover {{ 
          background: #1e293b;
          color: white;
        }}
        .test-case {{ 
          margin: 0 0 16px 0;
          padding: 0;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.95);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
          transition: transform 0.2s ease;
          overflow: hidden;
        }}
        .test-case:hover {{
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
          transform: translateY(-2px);
          border-color: #cbd5e1;
        }}
        .test-case:last-child {{
          margin-bottom: 0;
        }}
        .test-case-header {{ 
          padding: 20px 24px; 
          background: linear-gradient(to right, #ffffff 0%, #f8fafc 100%);
          cursor: pointer; 
          display: grid;
          grid-template-columns: 1fr auto;
          grid-template-rows: auto auto;
          gap: 12px 20px; 
          transition: all 0.2s ease;
          border-bottom: 2px solid #f1f5f9;
          position: relative;
        }}
        .test-case-header::before {{
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 4px;
          background: transparent;
          transition: background 0.2s ease;
        }}
        .test-case-header:hover::before {{
          background: linear-gradient(to bottom, #6366f1 0%, #8b5cf6 100%);
        }}
        .test-case-header[aria-expanded="true"] {{ 
          background: linear-gradient(to right, #f8fafc 0%, #f1f5f9 100%);
          border-bottom-color: #e2e8f0;
        }}
        .test-case-header[aria-expanded="true"]::before {{
          background: linear-gradient(to bottom, #6366f1 0%, #8b5cf6 100%);
        }}
        .test-case-summary {{ 
          display: flex; 
          align-items: center;
          gap: 14px; 
          flex-wrap: wrap;
          min-width: 0;
          grid-column: 1;
          grid-row: 1;
        }}
        .test-case-title {{
          font-weight: 600;
          color: var(--text-color);
          font-size: 1em;
          word-break: break-word;
          overflow-wrap: break-word;
          flex: 1 1 auto;
          min-width: 0;
        }}
        .test-case-browser {{
          font-size: 0.9em;
          color: var(--text-color-secondary);
          word-break: break-word;
          overflow-wrap: break-word;
          max-width: 100%;
        }}
        .test-case-meta {{ 
          display: flex; 
          align-items: center; 
          gap: 8px; 
          font-size: 0.9em; 
          color: var(--text-color-secondary); 
          flex-wrap: wrap;
          min-width: 0;
          grid-column: 1;
          grid-row: 2;
        }}
        .test-case-status-duration {{
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 8px;
          grid-column: 2;
          grid-row: 1 / 3;
          align-self: center;
        }}
        .test-duration {{ 
          background-color: var(--light-gray-color); 
          padding: 6px 12px; 
          border-radius: 8px; 
          font-size: 0.9em;
          white-space: nowrap;
          flex-shrink: 0;
          font-weight: 700;
          color: #0f172a;
        }}
        .status-badge {{
          padding: 8px 20px;
          border-radius: 0;
          font-size: 0.7em;
          font-weight: 800;
          color: black;
          text-transform: uppercase;
          min-width: 100px;
          text-align: center;
          letter-spacing: 1px;
        }}
        .status-badge.status-passed {{ background: #10b981; }}
        .status-badge.status-failed {{ background: #ef4444; }}
        .status-badge.status-skipped {{ background: #f59e0b; }}
        .status-badge.status-unknown {{ background: #64748b; }}

        /* --- NEON GLASS SEVERITY BADGES --- */
        .severity-badge {{
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 12px;
          border-radius: 99px;
          font-size: 0.75em;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border: 1px solid;
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }}
        .severity-badge::before {{
          content: '';
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background-color: currentColor;
          box-shadow: 0 0 6px currentColor;
        }}
        /* Auto-map colors based on data-severity attribute */
        .severity-badge[data-severity="critical"] {{
          color: #ff4d4d;
          background-color: rgba(255, 77, 77, 0.1);
          border-color: rgba(255, 77, 77, 0.25);
        }}
        .severity-badge[data-severity="high"] {{
          color: #fb923c;
          background-color: rgba(251, 146, 60, 0.1);
          border-color: rgba(251, 146, 60, 0.25);
        }}
        .severity-badge[data-severity="medium"] {{
          color: #facc15;
          background-color: rgba(250, 204, 21, 0.1);
          border-color: rgba(250, 204, 21, 0.25);
        }}
        .severity-badge[data-severity="low"] {{
          color: #4ade80;
          background-color: rgba(74, 222, 128, 0.1);
          border-color: rgba(74, 222, 128, 0.25);
        }}
        .severity-badge[data-severity="minor"] {{
          color: #94a3b8;
          background-color: rgba(148, 163, 184, 0.1);
          border-color: rgba(148, 163, 184, 0.25);
        }}

        /* --- RETRY COUNT BADGE --- */
        .retry-badge {{
          display: inline-flex;
          align-items: center;
          padding: 5px 12px;
          border-radius: 12px;
          font-size: 0.75rem;
          font-weight: 600;
          background: rgba(147, 51, 234, 0.15);
          color: #a855f7;
          border: 1px solid rgba(147, 51, 234, 0.3);
          margin-left: 8px;
        }}

        /* --- RETRY TABS --- */
        .retry-tabs-container {{
          margin-top: 16px;
        }}

        .retry-tabs-header {{
          display: flex;
          gap: 8px;
          border-bottom: 2px solid var(--border-medium);
          margin-bottom: 20px;
          flex-wrap: wrap;
        }}

        .retry-tab {{
          padding: 10px 20px;
          background: transparent;
          border: none;
          border-bottom: 3px solid transparent;
          cursor: pointer;
          font-size: 0.95rem;
          font-weight: 600;
          color: var(--text-color-secondary);
          transition: all 0.2s ease;
        }}

        .retry-tab:hover {{
          color: var(--primary-color);
          background: rgba(147, 51, 234, 0.05);
        }}

        .retry-tab.active {{
          color: #a855f7;
          border-bottom-color: #a855f7;
          background: rgba(147, 51, 234, 0.1);
        }}

        .retry-tab-content {{
          animation: fadeIn 0.3s ease-in;
        }}

        @keyframes fadeIn {{
          from {{ opacity: 0; }}
          to {{ opacity: 1; }}
        }}

        .tag {{ 
          display: inline-flex;
          align-items: center;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          color: #ffffff;
          padding: 6px 14px;
          border-radius: 6px;
          font-size: 0.8em;
          margin-right: 8px;
          margin-bottom: 4px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          box-shadow: 0 2px 6px rgba(99, 102, 241, 0.25);
          transition: all 0.2s ease;
          flex-shrink: 0;
          white-space: nowrap;
        }}
        .tag:hover {{
          box-shadow: 0 4px 10px rgba(99, 102, 241, 0.35);
          transform: translateY(-1px);
        }}
        .test-case-content {{ 
          display: none; 
          padding: 24px; 
          background: linear-gradient(to bottom, #ffffff 0%, #f9fafb 100%);
          border-top: 1px solid #e2e8f0;
        }}
        .test-case-content h4 {{ margin-top: 22px; margin-bottom: 14px; font-size: 1.15em; color: var(--primary-color); }}
        .test-case-content p {{ margin-bottom: 10px; font-size: 1em; }}
        .test-error-summary {{ 
          margin-bottom: 20px; 
          padding: 14px; 
          background-color: rgba(244,67,54,0.05); 
          border: 1px solid rgba(244,67,54,0.2); 
          border-left: 4px solid var(--danger-color); 
          border-radius: 4px; 
          display: flex;
          flex-direction: column;
        }}
        .test-error-summary h4 {{ color: var(--danger-color); margin-top:0;}}
        .test-error-summary pre {{ white-space: pre-wrap; word-break: break-all; color: var(--danger-color); font-size: 0.95em;}}
        .steps-list {{ margin: 18px 0; }}
        .step-item {{ margin-bottom: 8px; padding-left: calc(var(--depth, 0) * 28px); }} 
        .step-header {{ display: flex; align-items: center; cursor: pointer; padding: 10px 14px; border-radius: 6px; background-color: #fff; border: 1px solid var(--light-gray-color); transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease; }}
        .step-header:hover {{ background-color: #f0f2f5; border-color: var(--medium-gray-color); box-shadow: var(--box-shadow-inset); }}
        .step-icon {{ margin-right: 12px; width: 20px; text-align: center; font-size: 1.1em; }}
        .step-title {{ flex: 1; font-size: 1em; }}
        .step-duration {{ color: var(--dark-gray-color); font-size: 0.9em; }}
        .step-details {{ display: none; padding: 14px; margin-top: 8px; background: #fdfdfd; border-radius: 6px; font-size: 0.95em; border: 1px solid var(--light-gray-color); }}
        .step-info {{ margin-bottom: 8px; }}
        .code-snippet-section {{ margin: 12px 0; }}
        .code-snippet {{ background-color: #f8f9fa; border: 1px solid #e1e4e8; border-radius: 6px; padding: 12px; font-family: 'Consolas', 'Monaco', 'Courier New', monospace; font-size: 0.9em; line-height: 1.5; overflow-x: auto; color: #24292e; margin: 0; white-space: pre; }}
        .step-location-badge {{
          display: inline-flex; align-items: center; gap: 6px;
          background: #f0f4ff; border: 1px solid #c7d4f8;
          border-radius: 20px; padding: 3px 12px 3px 8px;
          margin-bottom: 10px; font-size: 0.82em;
        }}
        .location-icon {{ font-size: 0.95em; }}
        .location-text {{ font-family: 'Consolas', 'Monaco', monospace; color: #3b5bdb; font-size: 0.95em; }}
        .step-code-block {{
          border: 1px solid #e1e4e8; border-radius: 8px;
          overflow: hidden; margin: 8px 0;
        }}
        .code-block-header {{
          display: flex; align-items: center; justify-content: space-between;
          background: #f3f4f6; padding: 6px 12px;
          border-bottom: 1px solid #e1e4e8;
        }}
        .code-block-left {{ display: flex; align-items: center; gap: 8px; }}
        .code-block-right {{ display: flex; align-items: center; gap: 8px; }}
        .code-block-lang {{
          font-size: 0.78em; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.05em; color: #6b7280;
        }}
        .code-block-status {{
          font-size: 0.72em; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.06em; padding: 2px 8px; border-radius: 10px;
        }}
        .code-block-status.status-passed {{ background: #d1fae5; color: #059669; }}
        .code-block-status.status-failed {{ background: #fee2e2; color: #dc2626; }}
        .code-block-status.status-skipped {{ background: #fef3c7; color: #d97706; }}
        .code-block-status.status-xfailed {{ background: #ede9fe; color: #7c3aed; }}
        .code-block-dur {{ font-size: 0.78em; color: #9ca3af; }}
        .copy-snippet-btn {{
          font-size: 0.78em; padding: 2px 10px; cursor: pointer;
          border: 1px solid #d1d5db; border-radius: 4px;
          background: #fff; color: #374151;
          transition: background 0.15s, color 0.15s;
        }}
        .copy-snippet-btn:hover {{ background: #6366f1; color: #fff; border-color: #6366f1; }}
        .step-code-block .code-snippet {{
          border: none; border-radius: 0; margin: 0;
          background: #fafbfc; padding: 14px 16px;
        }}
        .test-error-summary {{ color: var(--danger-color); margin-top: 12px; padding: 14px; background: rgba(244,67,54,0.05); border-radius: 4px; font-size: 0.95em; border-left: 3px solid var(--danger-color); }}
        .test-error-summary pre.stack-trace {{ margin-top: 10px; padding: 12px; background-color: rgba(0,0,0,0.03); border-radius: 4px; font-size:0.9em; max-height: 280px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }}
        .step-hook {{ background-color: rgba(33,150,243,0.04); border-left: 3px solid var(--info-color) !important; }} 
        .step-hook .step-title {{ font-style: italic; color: var(--info-color)}}
        .failed-step-highlight {{ border-left: 4px solid var(--danger-color) !important; background-color: rgba(244,67,54,0.03); }}
        .failed-step-highlight .step-header {{ background-color: rgba(244,67,54,0.05); border-color: rgba(244,67,54,0.3); }}
        .failed-step-marker {{ display: inline-block; margin-left: 10px; padding: 2px 8px; background-color: var(--danger-color); color: white; border-radius: 4px; font-size: 0.85em; font-weight: 600; }}
        .nested-steps {{ margin-top: 12px; }}
        .attachments-section {{ margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--light-gray-color); }}
        .attachments-section h4 {{ margin-top: 0; margin-bottom: 20px; font-size: 1.1em; color: var(--text-color); }}
        .attachments-grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 22px; }}
        .attachment-item {{ border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: #fff; box-shadow: var(--box-shadow-light); overflow: hidden; display: flex; flex-direction: column; transition: transform 0.2s ease-out, box-shadow 0.2s ease-out; }}
        .attachment-item:hover {{ transform: translateY(-4px); box-shadow: var(--box-shadow); }}
        .attachment-item img {{ width: 100%; height: 180px; object-fit: cover; display: block; border-bottom: 1px solid var(--border-color); transition: opacity 0.3s ease; }}
        .attachment-info {{ padding: 12px; margin-top: auto; background-color: #fafafa;}}
        .attachment-item a:hover img {{ opacity: 0.85; }}
        .attachment-caption {{ padding: 12px 15px; font-size: 0.9em; text-align: center; color: var(--text-color-secondary); word-break: break-word; background-color: var(--light-gray-color); }}
        .video-item a, .trace-item a {{ display: block; margin-bottom: 8px; color: var(--primary-color); text-decoration: none; font-weight: 500; }}
        .video-item a:hover, .trace-item a:hover {{ text-decoration: underline; }}
        .code-section pre {{ background-color: #2d2d2d; color: #f0f0f0; padding: 20px; border-radius: 6px; overflow-x: auto; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace; font-size: 0.95em; line-height:1.6;}}
        .trace-actions {{ display: flex; justify-content: center; }}
        .trace-actions a {{ text-decoration: none; color: var(--primary-color); font-weight: 500; font-size: 0.9em; }}
        .generic-attachment {{ text-align: center; padding: 1rem; justify-content: center; }}
        .attachment-icon {{ font-size: 2.5rem; display: block; margin-bottom: 0.75rem; }}
        .attachment-caption {{ display: flex; flex-direction: column; }}
        .attachment-name {{ font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
        .attachment-type {{ font-size: 0.8rem; color: var(--text-color-secondary); }}
        .trend-charts-row {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(480px, 1fr)); gap: 28px; margin-bottom: 35px; }}
        .test-history-container h2.tab-main-title, .ai-analyzer-container h2.tab-main-title {{ font-size: 1.6em; margin-bottom: 18px; color: var(--primary-color); border-bottom: 1px solid var(--border-color); padding-bottom: 12px;}}
        .test-history-grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 22px; margin-top: 22px; }}
        .test-history-card {{ background: var(--card-background-color); border: 1px solid var(--border-color); border-radius: var(--border-radius); padding: 22px; box-shadow: var(--box-shadow-light); display: flex; flex-direction: column; }}
        .test-history-header {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid var(--light-gray-color); }}
        .test-history-header h3 {{ margin: 0; font-size: 1.15em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }} 
        .test-history-header p {{ font-weight: 500 }} 
        .test-history-trend {{ margin-bottom: 20px; min-height: 110px; }}
        .test-history-trend-section {{
          padding: 0px 48px !important;
        }}
        .test-history-trend-section .chart-title-header {{
          margin: 0 0 20px 0 !important;
        }}
        .test-history-trend div[id^="testHistoryChart-"] {{ display: block; margin: 0 auto; max-width:100%; height: 100px; width: 320px; }}
        .test-history-details-collapsible summary {{ cursor: pointer; font-size: 1em; color: var(--primary-color); margin-bottom: 10px; font-weight:500; }}
        .test-history-details-collapsible summary:hover {{text-decoration: underline;}}
        .test-history-details {{
          overflow-x: auto;
          max-width: 100%;
        }}
        .test-history-details table {{
          width: 100%;
          border-collapse: collapse;
          font-size: 0.95em;
        }}
        .test-history-details th, .test-history-details td {{ padding: 9px 12px; text-align: left; border-bottom: 1px solid var(--light-gray-color); }}
        .test-history-details th {{ background-color: var(--light-gray-color); font-weight: 600; }}
        .status-badge-small {{ padding: 3px 7px; border-radius: 4px; font-size: 0.8em; font-weight: 600; color: white; text-transform: uppercase; display: inline-block; }}
        .status-badge-small.status-passed {{ background-color: var(--success-color); }}
        .status-badge-small.status-failed {{ background-color: var(--danger-color); }}
        .status-badge-small.status-skipped {{ background-color: var(--warning-color); }}
        .status-badge-small.status-unknown {{ background-color: var(--dark-gray-color); }}
        .badge-severity {{ display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; color: white; text-transform: uppercase; margin-right: 8px; vertical-align: middle; }}
        .no-data, .no-tests, .no-steps, .no-data-chart {{ padding: 28px; text-align: center; color: var(--dark-gray-color); font-style: italic; font-size:1.1em; background-color: var(--light-gray-color); border-radius: var(--border-radius); margin: 18px 0; border: 1px dashed var(--medium-gray-color); }}
        .no-data-chart {{font-size: 0.95em; padding: 18px;}}
        .ai-failure-cards-grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 22px; }}
        .ai-failure-card {{ background: var(--card-background-color); border: 1px solid var(--border-color); border-left: 5px solid var(--danger-color); border-radius: var(--border-radius); box-shadow: var(--box-shadow-light); display: flex; flex-direction: column; }}
        .ai-failure-card-header {{ padding: 15px 20px; border-bottom: 1px solid var(--light-gray-color); display: flex; align-items: center; justify-content: space-between; gap: 15px; }}
        .ai-failure-card-header h3 {{ margin: 0; font-size: 1.1em; color: var(--text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
        .ai-failure-card-body {{ padding: 20px; }}
        .ai-fix-btn {{ background-color: var(--primary-color); color: white; border: none; padding: 10px 18px; font-size: 1em; font-weight: 600; border-radius: 6px; cursor: pointer; transition: background-color 0.2s ease, transform 0.2s ease; display: inline-flex; align-items: center; gap: 8px; }}
        .ai-fix-btn:hover {{ background-color: var(--accent-color); transform: translateY(-2px); }}
        .ai-modal-overlay {{ 
          position: fixed; 
          top: 0; 
          left: 0; 
          width: 100%; 
          height: 100%; 
          background-color: rgba(0,0,0,0.8); 
          display: none; 
          align-items: center; 
          justify-content: center; 
          z-index: 1050; 
          animation: fadeIn 0.3s;
        }}
        .ai-modal-content {{ 
          background-color: var(--card-background-color); 
          color: var(--text-color); 
          border-radius: var(--border-radius); 
          width: 90%; 
          max-width: 800px; 
          max-height: 90vh;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5); 
          display: flex; 
          flex-direction: column; 
          overflow: hidden;
        }}
        .ai-modal-header {{ 
          padding: 18px 25px; 
          border-bottom: 1px solid var(--border-color); 
          display: flex; 
          justify-content: space-between; 
          align-items: center;
        }}
        .ai-modal-header h3 {{ 
          margin: 0; 
          font-size: 1.25em;
        }}
        .ai-modal-close {{ 
          font-size: 2rem; 
          font-weight: 300; 
          cursor: pointer; 
          color: var(--dark-gray-color); 
          line-height: 1; 
          transition: color 0.2s;
        }}
        .ai-modal-close:hover {{ 
          color: var(--danger-color);
        }}
        .ai-modal-body {{ 
          padding: 25px; 
          overflow-y: auto;
        }}
        .ai-modal-body h4 {{ margin-top: 18px; margin-bottom: 10px; font-size: 1.1em; color: var(--primary-color); }}
        .ai-modal-body p {{ margin-bottom: 15px; }}
        .ai-loader {{ margin: 40px auto; border: 5px solid #f3f3f3; border-top: 5px solid var(--primary-color); border-radius: 50%; width: 50px; height: 50px; animation: spin 1s linear infinite; }}
        @keyframes spin {{ 0% {{ transform: rotate(0deg); }} 100% {{ transform: rotate(360deg); }} }}
        .trace-preview {{ padding: 1rem; text-align: center; background: #f5f5f5; border-bottom: 1px solid #e1e1e1; }}
        .trace-icon {{ font-size: 2rem; display: block; margin-bottom: 0.5rem; }}
        .trace-name {{ word-break: break-word; font-size: 0.9rem; }}
        .trace-actions {{ display: flex; gap: 0.5rem; }}
        .trace-actions a {{ flex: 1; text-align: center; padding: 0.25rem 0.5rem; font-size: 0.85rem; border-radius: 4px; text-decoration: none; background: cornflowerblue; color: aliceblue; }}
        .view-trace {{ background: #3182ce; color: white; }}
        .view-trace:hover {{ background: #2c5282; }}
        .download-trace {{ background: #e2e8f0; color: #2d3748; }}
        .download-trace:hover {{ background: #cbd5e0; }}
        .filters button.clear-filters-btn {{ 
          background-color: var(--medium-gray-color); 
          color: var(--text-color); 
          pointer-events: auto;
          cursor: pointer;
          width: 100%;
        }}
        .filters button.clear-filters-btn:active,
        .filters button.clear-filters-btn:focus {{
          background-color: var(--medium-gray-color);
          color: var(--text-color);
          transform: none;
          box-shadow: none;
          outline: none;
        }}
        .copy-btn {{
          color: #ffffff;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.85em;
          font-weight: 600;
          padding: 10px 20px;
          transition: all 0.2s ease;
          box-shadow: 0 2px 8px rgba(99, 102, 241, 0.2);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-left: auto;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }}
        .copy-btn:hover {{
          background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
          box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
          transform: translateY(-1px);
        }}
        .copy-btn:active {{
          transform: translateY(0);
          box-shadow: 0 2px 6px rgba(99, 102, 241, 0.2);
        }}
        .log-wrapper {{
          max-width: 100%;
          overflow-x: auto;
          overflow-y: auto;
          max-height: 400px;
          border-radius: 8px;
          background: #2d2d2d;
        }}
        .log-wrapper pre {{
          margin: 0;
          white-space: pre;
          word-wrap: normal;
          overflow-wrap: normal;
        }}
        .console-output-section h4 {{
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 12px;
        }}


    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <div class="header-title">
                <img id="report-logo" src="{LOGO_BASE64}" alt="Report Logo">
                <h1>Pulse Report</h1>
            </div>
            <div class="run-info">
                <div class="run-info-item">
                    <strong>Run Date</strong>
                    <span>{format_date(run_summary.get('timestamp'))}</span>
                </div>
                <div class="run-info-item">
                    <strong>Total Duration</strong>
                    <span>{format_duration(run_summary.get('duration'))}</span>
                </div>
            </div>
        </header>
        {report_desc_html}
        <div class="tabs">
            <button class="tab-button active" data-tab="dashboard">Dashboard</button>
            <button class="tab-button" data-tab="test-runs">Test Run Summary</button>
            <button class="tab-button" data-tab="test-history">Test History</button>
        </div>
        <div id="dashboard" class="tab-content active">
            <div class="dashboard-grid">
                <div class="summary-card"><h3>Total Tests</h3><div class="value">{run_summary.get('totalTests', 0)}</div></div>
                <div class="summary-card status-passed"><h3>Passed</h3><div class="value">{run_summary.get('passed', 0)}</div><div class="trend-percentage">{pass_percentage}%</div></div>
                <div class="summary-card status-failed"><h3>Failed</h3><div class="value">{run_summary.get('failed', 0)}</div><div class="trend-percentage">{fail_percentage}%</div></div>
                <div class="summary-card status-skipped"><h3>Skipped</h3><div class="value">{run_summary.get('skipped', 0)}</div><div class="trend-percentage">{skip_percentage}%</div></div>
                <div class="summary-card flaky-status"><h3>Flaky</h3><div class="value">{run_summary.get('flaky', 0)}</div>
                <div class="trend-percentage">{flaky_percentage}%</div></div>
                 <div class="summary-card"><h3>Run Duration</h3><div class="value">{format_duration(run_summary.get('duration', 0))}</div><div class="trend-percentage">Avg. Test Duration {avg_test_duration}</div></div>
                 <div class="summary-card">
                   <h3>Total Retry Count</h3>
                   <div class="value">{total_retried}</div>
                   <div class="trend-percentage">Test Retried {retried_tests_count}</div>
                 </div>
                <div class="summary-card">
                  <h3>🌐 Browser Distribution <span style="font-size: 0.7em; color: var(--text-color-secondary); font-weight: 400;">({len(browser_breakdown)} total)</span></h3>
                  <div class="browser-breakdown" style="max-height: 200px; overflow-y: auto; padding-right: 4px;">
                    {browser_breakdown_html}
                  </div>
                </div>
            </div>
            <div class="dashboard-bottom-row">
              <div class="dashboard-column">
                {generate_pie_chart([
                    { "label": "Passed", "value": run_summary.get('passed', 0) },
                    { "label": "Failed", "value": run_summary.get('failed', 0) },
                    { "label": "Flaky", "value": run_summary.get('flaky', 0) },
                    { "label": "Skipped", "value": run_summary.get('skipped', 0) }
                  ], 400, 390)} 
                {generate_environment_section(run_summary.get('environment'))}
              </div> 
              
              <div class="dashboard-column">
                {generate_suites_widget(suites_data)}
                {generate_severity_distribution_chart(results)}
              </div>
            </div>
          </div>
        <div id="test-runs" class="tab-content">
            <div class="filters">
                <input type="text" id="filter-name" placeholder="Filter by test name/path..." style="border-color: black; border-style: outset;">
                <select id="filter-status"><option value="">All Statuses</option><option value="passed">Passed</option><option value="failed">Failed</option><option value="flaky">Flaky</option><option value="skipped">Skipped</option></select>
                <select id="filter-browser"><option value="">All Browsers</option>{browser_options}</select>
                <button id="clear-run-summary-filters" class="clear-filters-btn">Clear Filters</button>
            </div>
            <div class="test-cases-list">{generate_test_cases_html()}</div>
        </div>
        <div id="test-history" class="tab-content">
          <div class="trend-charts-row">
            <div class="trend-chart"><h3 class="chart-title-header">Test Volume & Outcome Trends</h3>
              {generate_test_trends_chart(trend_data) if trend_data and trend_data.get('overall') else '<div class="no-data">Overall trend data not available for test counts.</div>'}
            </div>
            <div class="trend-chart"><h3 class="chart-title-header">Execution Duration Trends</h3>
              {generate_duration_trend_chart(trend_data) if trend_data and trend_data.get('overall') else '<div class="no-data">Overall trend data not available for durations.</div>'}
            </div>
          </div>
          <div class="trend-charts-row">
             <div class="trend-chart">
                <h3 class="chart-title-header">Test Distribution by Worker {infoTooltip}</h3>
                {generate_worker_distribution_chart(results)}
             </div>
          </div>
          <div class="trend-chart test-history-trend-section" style="border-bottom: none; background: none !important; box-shadow: none !important; border: none !important; border-radius: none !important;">
             <h3 class="chart-title-header">Individual Test History</h3>
          </div>
          {generate_test_history_content(trend_data) if trend_data and trend_data.get('testRuns') else '<div class="no-data">Individual test history data not available.</div>'}
        </div>
        <footer style="padding: 0.5rem; box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.05); text-align: center; font-family: 'Segoe UI', system-ui, sans-serif;">
            <div style="display: inline-flex; align-items: center; gap: 0.5rem; color: #333; font-size: 0.9rem; font-weight: 600; letter-spacing: 0.5px;">
                <span>Created by</span>
                <img id="report-logo" src="{LOGO_BASE64}" alt="Pulse Report Logo" style="height: 20px;">
                <a href="https://www.npmjs.com/package/@arghajit/playwright-pulse-report" target="_blank" rel="noopener noreferrer" style="color: #7737BF; font-weight: 700; font-style: italic; text-decoration: none; transition: all 0.2s ease;" onmouseover="this.style.color='#BF5C37'" onmouseout="this.style.color='#7737BF'">Pulse Report</a>
            </div>
            <div style="margin-top: 0.5rem; font-size: 0.75rem; color: #666;">Crafted with precision</div>
        </footer>
    </div>
    <script>
    if (typeof formatDuration === 'undefined') {{ 
        function formatDuration(ms) {{ 
            if (ms === undefined || ms === null || ms < 0) return "0.0s"; 
            return (ms / 1000).toFixed(1) + "s"; 
        }}
    }}
    function copyLogContent(elementId, button) {{
        const logElement = document.getElementById(elementId);
        if (!logElement) {{
            console.error('Could not find log element with ID:', elementId);
            return;
        }}
        const originalText = button.textContent;
        navigator.clipboard.writeText(logElement.innerText).then(() => {{
            button.textContent = 'Copied!';
            setTimeout(() => {{ button.textContent = originalText; }}, 2000);
        }}).catch(err => {{
            console.error('Failed to copy log content:', err);
            button.textContent = 'Failed';
             setTimeout(() => {{ button.textContent = originalText; }}, 2000);
        }});
    }}
    
    function switchRetryTab(event, tabId) {{
      const tabButton = event.currentTarget;
      const tabsContainer = tabButton.closest('.retry-tabs-container');
      
      const allTabContents = tabsContainer.querySelectorAll('.retry-tab-content');
      allTabContents.forEach(content => {{
        content.style.display = 'none';
        content.classList.remove('active');
      }});
      
      const allTabs = tabsContainer.querySelectorAll('.retry-tab');
      allTabs.forEach(tab => tab.classList.remove('active'));
      
      const selectedContent = document.getElementById(tabId);
      if (selectedContent) {{
        selectedContent.style.display = 'block';
        selectedContent.classList.add('active');
      }}
      
      tabButton.classList.add('active');
    }}
    
function getAIFix(button) {{
    const failureItem = button.closest('.compact-failure-item');
    const aiContainer = failureItem.querySelector('.ai-suggestion-container');
    const aiContent = failureItem.querySelector('.ai-suggestion-content');
    
    if (aiContainer.style.display === 'block') {{
        aiContainer.style.display = 'none';
        button.querySelector('.ai-text').textContent = 'AI Fix';
        return;
    }}
    
    aiContainer.style.display = 'block';
    aiContent.innerHTML = '<div class="ai-loader" style="margin: 40px auto;"></div>';
    button.querySelector('.ai-text').textContent = 'Loading...';
    button.disabled = true;

    try {{
        const testJson = button.dataset.testJson;
        const test = JSON.parse(atob(testJson));

        const testName = test.name || 'Unknown Test';
        const failureLogsAndErrors = [
            'Error Message:',
            test.errorMessage || 'Not available.',
            '\\n\\n--- stdout ---',
            (test.stdout && test.stdout.length > 0) ? test.stdout.join('\\n') : 'Not available.',
            '\\n\\n--- stderr ---',
            (test.stderr && test.stderr.length > 0) ? test.stderr.join('\\n') : 'Not available.'
        ].join('\\n');
        const codeSnippet = test.snippet || '';

        const shortTestName = testName.split(' > ').pop();
        
        const apiUrl = 'https://ai-test-analyser.netlify.app/api/analyze';
        fetch(apiUrl, {{
            method: 'POST',
            headers: {{ 'Content-Type': 'application/json' }},
            body: JSON.stringify({{
                testName: testName,
                failureLogsAndErrors: failureLogsAndErrors,
                codeSnippet: codeSnippet,
            }}),
        }})
        .then(response => {{
            if (!response.ok) {{
                return response.text().then(text => {{ 
                    throw new Error(`API request failed with status ${{response.status}}: ${{text || response.statusText}}`);
                }});
            }}
            return response.text();
        }})
        .then(text => {{
            if (!text) {{
                throw new Error("The AI analyzer returned an empty response. This might happen during high load or if the request was blocked. Please try again in a moment.");
            }}
            try {{
                return JSON.parse(text);
            }} catch (e) {{
                console.error("Failed to parse JSON:", text);
                throw new Error(`The AI analyzer returned an invalid response. ${{e.message}}`);
            }}
        }})
        .then(data => {{
            const escapeHtml = (unsafe) => {{
                if (typeof unsafe !== 'string') return '';
                return unsafe
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");
            }};

            const analysisHtml = `<h4>Analysis</h4><p>${{escapeHtml(data.rootCause) || 'No analysis provided.'}}</p>`;
            
            let suggestionsHtml = '<h4>Suggestions</h4>';
            if (data.suggestedFixes && data.suggestedFixes.length > 0) {{
                suggestionsHtml += '<div class="suggestions-list" style="margin-top: 15px;">';
                data.suggestedFixes.forEach(fix => {{
                    suggestionsHtml += `
                        <div class="suggestion-item" style="margin-bottom: 22px; border-left: 3px solid var(--accent-color-alt); padding-left: 15px;">
                            <p style="margin: 0 0 8px 0; font-weight: 500;">${{escapeHtml(fix.description)}}</p>
                            ${{fix.codeSnippet ? `<div class="code-section"><pre><code>${{escapeHtml(fix.codeSnippet)}}</code></pre></div>` : ''}}
                        </div>
                    `;
                }});
                suggestionsHtml += '</div>';
            }} else {{
                suggestionsHtml += `<div class="code-section"><pre><code>No suggestion provided.</code></pre></div>`;
            }}
            
            button.querySelector('.ai-text').textContent = 'Hide AI Fix';
            button.disabled = false;
            aiContent.innerHTML = `
                <div class="ai-suggestion-header">
                    <h4>🤖 AI Analysis Result</h4>
                </div>
                <div class="ai-suggestion-body">
                    ${{analysisHtml}}
                    ${{suggestionsHtml}}
                </div>
            `;
        }})
        .catch(err => {{
            console.error('AI Fix Error:', err);
            button.disabled = false;
            button.querySelector('.ai-text').textContent = 'AI Fix';
            aiContent.innerHTML = `<div class="test-error-summary"><strong>Error:</strong> Failed to get AI analysis. Please check the console for details. <br><br> ${{err.message}}</div>`;
        }});

    }} catch (e) {{
        console.error('Error processing test data for AI Fix:', e);
        button.disabled = false;
        button.querySelector('.ai-text').textContent = 'AI Fix';
        aiContent.innerHTML = `<div class="test-error-summary">Could not process test data. Is it formatted correctly?</div>`;
    }}
}}

    function copyAIPrompt(button) {{
        try {{
            const testJson = button.dataset.testJson;
            const test = JSON.parse(atob(testJson));

            const testName = test.name || 'Unknown Test';
            const failureLogsAndErrors = [
                'Error Message:',
                test.errorMessage || 'Not available.',
                '\\n\\n--- stdout ---',
                (test.stdout && test.stdout.length > 0) ? test.stdout.join('\\n') : 'Not available.',
                '\\n\\n--- stderr ---',
                (test.stderr && test.stderr.length > 0) ? test.stderr.join('\\n') : 'Not available.'
            ].join('\\n');
            const codeSnippet = test.snippet || '';

            const aiPrompt = `You are an expert Playwright test automation engineer specializing in debugging test failures.

INSTRUCTIONS:
1. Analyze the test failure carefully
2. Provide a brief root cause analysis
3. Provide EXACTLY 5 specific, actionable fixes
4. Each fix MUST include a code snippet (codeSnippet field)
5. Return ONLY valid JSON, no markdown or extra text

REQUIRED JSON FORMAT:
{{
  "rootCause": "Brief explanation of why the test failed",
  "suggestedFixes": [
    {{
      "description": "Clear explanation of the fix",
      "codeSnippet": "await page.waitForSelector('.button', {{ timeout: 5000 }});"
    }}
  ],
  "affectedTests": ["test1", "test2"]
}}

IMPORTANT:
- Always return valid JSON only
- Always provide exactly 5 fixes in suggestedFixes array
- Each fix must have both description and codeSnippet fields
- Make code snippets practical and Playwright-specific

---

Test Name: ${{testName}}

Failure Logs and Errors:
${{failureLogsAndErrors}}

Code Snippet:
${{codeSnippet}}`;

            navigator.clipboard.writeText(aiPrompt).then(() => {{
                const originalText = button.querySelector('.copy-prompt-text').textContent;
                button.querySelector('.copy-prompt-text').textContent = 'Copied!';
                button.classList.add('copied');
                
                const shortTestName = testName.split(' > ').pop() || testName;
                alert(`AI prompt to generate a suggested fix for "${{shortTestName}}" has been copied to your clipboard.`);
                
                setTimeout(() => {{
                    button.querySelector('.copy-prompt-text').textContent = originalText;
                    button.classList.remove('copied');
                }}, 2000);
            }}).catch(err => {{
                console.error('Failed to copy AI prompt:', err);
                alert('Failed to copy AI prompt to clipboard. Please try again.');
            }});
        }} catch (e) {{
            console.error('Error processing test data for AI Prompt copy:', e);
            alert('Could not process test data. Please try again.');
        }}
    }}

    function closeAiModal() {{
        const modal = document.getElementById('ai-fix-modal');
        if(modal) modal.style.display = 'none';
        document.body.style.setProperty('overflow', '', 'important');
    }}

    function toggleErrorDetails(button) {{
        const errorDetails = button.closest('.compact-failure-item').querySelector('.full-error-details');
        const expandText = button.querySelector('.expand-text');
        const expandIcon = button.querySelector('.expand-icon');
        
        if (errorDetails.style.display === 'none' || !errorDetails.style.display) {{
            errorDetails.style.display = 'block';
            expandText.textContent = 'Hide Full Error';
            button.classList.add('expanded');
        }} else {{
            errorDetails.style.display = 'none';
            expandText.textContent = 'Show Full Error';
            button.classList.remove('expanded');
        }}
    }}

    function initializeReportInteractivity() {{
        const tabButtons = document.querySelectorAll('.tab-button');
        const tabContents = document.querySelectorAll('.tab-content');
        tabButtons.forEach(button => {{
            button.addEventListener('click', () => {{
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));
                button.classList.add('active');
                const tabId = button.getAttribute('data-tab');
                const activeContent = document.getElementById(tabId);
                if (activeContent) {{
                    activeContent.classList.add('active');
                }}
            }});
        }});
        
        const nameFilter = document.getElementById('filter-name');
        const statusFilter = document.getElementById('filter-status');
        const browserFilter = document.getElementById('filter-browser');
        const clearRunSummaryFiltersBtn = document.getElementById('clear-run-summary-filters'); 
        function filterTestCases() {{ 
            const nameValue = nameFilter ? nameFilter.value.toLowerCase() : "";
            const statusValue = statusFilter ? statusFilter.value : "";
            const browserValue = browserFilter ? browserFilter.value : "";
            document.querySelectorAll('#test-runs .test-case').forEach(testCaseElement => {{
                const titleElement = testCaseElement.querySelector('.test-case-title');
                const fullTestName = titleElement ? titleElement.getAttribute('title').toLowerCase() : "";
                const status = testCaseElement.getAttribute('data-status');
                const browser = testCaseElement.getAttribute('data-browser');
                const nameMatch = fullTestName.includes(nameValue);
                const statusMatch = !statusValue || status === statusValue;
                const browserMatch = !browserValue || browser === browserValue;
                testCaseElement.style.display = (nameMatch && statusMatch && browserMatch) ? '' : 'none';
            }});
        }}
        if(nameFilter) nameFilter.addEventListener('input', filterTestCases);
        if(statusFilter) statusFilter.addEventListener('change', filterTestCases);
        if(browserFilter) browserFilter.addEventListener('change', filterTestCases);
        if(clearRunSummaryFiltersBtn) clearRunSummaryFiltersBtn.addEventListener('click', () => {{
            if(nameFilter) nameFilter.value = ''; if(statusFilter) statusFilter.value = ''; if(browserFilter) browserFilter.value = '';
            filterTestCases();
        }});
        
        const historyNameFilter = document.getElementById('history-filter-name');
        const historyStatusFilter = document.getElementById('history-filter-status');
        const clearHistoryFiltersBtn = document.getElementById('clear-history-filters'); 
        function filterTestHistoryCards() {{ 
            const nameValue = historyNameFilter ? historyNameFilter.value.toLowerCase() : "";
            const statusValue = historyStatusFilter ? historyStatusFilter.value : "";
            document.querySelectorAll('.test-history-card').forEach(card => {{
                const testTitle = card.getAttribute('data-test-name').toLowerCase(); 
                const latestStatus = card.getAttribute('data-latest-status');
                const nameMatch = testTitle.includes(nameValue);
                const statusMatch = !statusValue || latestStatus === statusValue;
                card.style.display = (nameMatch && statusMatch) ? '' : 'none';
            }});
        }}
        if(historyNameFilter) historyNameFilter.addEventListener('input', filterTestHistoryCards);
        if(historyStatusFilter) historyStatusFilter.addEventListener('change', filterTestHistoryCards);
        if(clearHistoryFiltersBtn) clearHistoryFiltersBtn.addEventListener('click', () => {{
            if(historyNameFilter) historyNameFilter.value = ''; if(historyStatusFilter) historyStatusFilter.value = '';
            filterTestHistoryCards();
        }});
        
        function toggleStepDetails(header) {{
            const details = header.nextElementSibling;
            const isExpanded = header.getAttribute('aria-expanded') === 'true';
            
            header.setAttribute('aria-expanded', !isExpanded);
            details.style.display = isExpanded ? 'none' : 'block';
        }}

        function toggleElementDetails(headerElement, contentSelector) {{ 
            let contentElement;
            if (headerElement.classList.contains('test-case-header')) {{
                contentElement = headerElement.parentElement.querySelector('.test-case-content');
            }} else if (headerElement.classList.contains('step-header')) {{
                contentElement = headerElement.nextElementSibling;
                if (!contentElement || !contentElement.matches(contentSelector || '.step-details')) {{
                     contentElement = null;
                }}
            }}
            if (contentElement) {{
                 const isExpanded = contentElement.style.display === 'block';
                 contentElement.style.display = isExpanded ? 'none' : 'block';
                 headerElement.setAttribute('aria-expanded', String(!isExpanded));
            }}
        }}
        document.querySelectorAll('#test-runs .test-case-header').forEach(header => {{
            header.addEventListener('click', () => toggleElementDetails(header)); 
        }});
        document.querySelectorAll('#test-runs .step-header').forEach(header => {{
            header.addEventListener('click', () => toggleElementDetails(header, '.step-details'));
        }});

        document.querySelectorAll('a.annotation-link').forEach(link => {{
            link.addEventListener('click', (e) => {{
                e.preventDefault();
                const annotationId = link.dataset.annotation;
                if (annotationId) {{
                    const jiraUrl = prompt('Enter your JIRA/Ticket system base URL (e.g., https://your-company.atlassian.net/browse/):', 'https://your-company.atlassian.net/browse/');
                    if (jiraUrl) {{
                        window.open(jiraUrl + annotationId, '_blank');
                    }}
                }}
            }});
        }});
        
        const lazyLoadElements = document.querySelectorAll('.lazy-load-chart');
        if ('IntersectionObserver' in window) {{
            let lazyObserver = new IntersectionObserver((entries, observer) => {{
                entries.forEach(entry => {{
                    if (entry.isIntersecting) {{
                        const element = entry.target;
                        if (element.classList.contains('lazy-load-chart')) {{
                            const renderFunctionName = element.dataset.renderFunctionName;
                            if (renderFunctionName && typeof window[renderFunctionName] === 'function') {{
                                try {{
                                    window[renderFunctionName](); 
                                }} catch (e) {{
                                    console.error(`Error lazy-loading chart ${{element.id}} using ${{renderFunctionName}}:`, e);
                                    element.innerHTML = '<div class="no-data-chart">Error lazy-loading chart.</div>';
                                }}
                            }}
                        }}
                        observer.unobserve(element); 
                    }}
                }});
            }}, {{ 
                rootMargin: "0px 0px 200px 0px" 
            }});

            lazyLoadElements.forEach(el => {{
                lazyObserver.observe(el);
            }});
        }} else {{ 
            lazyLoadElements.forEach(element => {{
                if (element.classList.contains('lazy-load-chart')) {{
                    const renderFunctionName = element.dataset.renderFunctionName;
                    if (renderFunctionName && typeof window[renderFunctionName] === 'function') {{
                         try {{
                            window[renderFunctionName]();
                        }} catch (e) {{
                            console.error(`Error loading chart (fallback) ${{element.id}} using ${{renderFunctionName}}:`, e);
                            element.innerHTML = '<div class="no-data-chart">Error loading chart (fallback).</div>';
                        }}
                    }}
                }}
            }});
        }}
    }}
    document.addEventListener('DOMContentLoaded', initializeReportInteractivity);

function copyErrorToClipboard(button) {{
  const errorContainer = button.closest('.test-error-summary');
  if (!errorContainer) return;

  let errorText;

  const stackTraceElement = errorContainer.querySelector('.stack-trace');

  if (stackTraceElement) {{
    errorText = stackTraceElement.textContent;
  }} else {{
    const clonedContainer = errorContainer.cloneNode(true);
    const buttonInClone = clonedContainer.querySelector('button');
    if (buttonInClone) {{
      buttonInClone.remove();
    }}
    errorText = clonedContainer.textContent;
  }}

  if (!errorText) {{
    button.textContent = 'Nothing to copy';
    setTimeout(() => {{ button.textContent = 'Copy Error'; }}, 2000);
    return;
  }}

  const textarea = document.createElement('textarea');
  textarea.value = errorText.trim(); 
  textarea.style.position = 'fixed'; 
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();

  try {{
    const successful = document.execCommand('copy');
    const originalText = button.textContent;
    button.textContent = successful ? 'Copied!' : 'Failed';
    setTimeout(() => {{
      button.textContent = originalText;
    }}, 2000);
  }} catch (err) {{
    button.textContent = 'Failed';
  }}  

  document.body.removeChild(textarea);
}}
</script>
</body>
</html>
  """

    return html_template

def main():
    args = sys.argv[1:]
    custom_output_dir = None
    for i in range(len(args)):
        if args[i] in ["--outputDir", "-o"]:
            if i + 1 < len(args):
                custom_output_dir = args[i + 1]
            break

    # To run the trend generation script
    current_dir = Path(__file__).parent
    archive_run_script_path = current_dir / "generate-trend.mjs"

    # Simplified config read (In real app, you'd translate getReporterConfig)
    output_dir = custom_output_dir if custom_output_dir else DEFAULT_OUTPUT_DIR
    output_file = "playwright-pulse-report.json"
    
    # Python equivalent logic for mergeSequentialReportsIfNeeded would go here
    # For now we assume the file is ready to be read.

    report_json_path = Path(output_dir) / output_file
    report_html_path = Path(output_dir) / DEFAULT_HTML_FILE
    history_dir = Path(output_dir) / "history"
    history_file_prefix = "trend-"
    max_history_files = 15

    print("Starting HTML report generation...")
    print(f"Output directory set to: {output_dir}")

    # Step 1: Execute generate-trend logic
    try:
        from pytest_pulse.merge_reports import archive_trend
        archive_trend(output_dir, output_file, max_history=max_history_files)
        print("Current run data archiving to history completed.")
    except Exception as e:
        print(f"Failed to archive current run data. Report might use stale or incomplete historical trends. {e}")

    # Step 2: Load current run data
    try:
        with open(report_json_path, "r", encoding="utf-8") as f:
            current_run_report_data = json.load(f)
            
        if not current_run_report_data or not isinstance(current_run_report_data, dict) or 'results' not in current_run_report_data:
            raise ValueError("Invalid report JSON structure. 'results' field is missing or invalid.")
            
        if not isinstance(current_run_report_data['results'], list):
            current_run_report_data['results'] = []
            print("Warning: 'results' field in current run JSON was not an array. Treated as empty.")
            
    except Exception as e:
        print(f"Critical Error: Could not read or parse main report JSON at {report_json_path}: {e}")
        sys.exit(1)

    # Step 3: Load historical data
    historical_runs = []
    if history_dir.exists():
        files = [f for f in history_dir.iterdir() if f.name.startswith(history_file_prefix) and f.name.endswith(".json")]
        
        file_metas = []
        for f in files:
            timestamp_part = f.name.replace(history_file_prefix, "").replace(".json", "")
            try:
                timestamp = int(timestamp_part)
                file_metas.append({"name": f.name, "path": f, "timestamp": timestamp})
            except ValueError:
                pass
                
        file_metas.sort(key=lambda x: x["timestamp"], reverse=True)
        files_to_load = file_metas[:max_history_files]

        for file_meta in files_to_load:
            try:
                with open(file_meta["path"], "r", encoding="utf-8") as f:
                    historical_runs.append(json.load(f))
            except Exception as e:
                print(f"Could not read/parse history file {file_meta['name']}: {e}")
                
        historical_runs.reverse()
        print(f"Loaded {len(historical_runs)} historical run(s) for trend analysis.")
    else:
        print(f"History directory '{history_dir}' not found. No historical trends will be displayed.")

    # Step 4: Prepare trend data
    trend_data = {
        "overall": [],
        "testRuns": {}
    }

    if historical_runs:
        for hist_run in historical_runs:
            if hist_run.get('run'):
                # Assuming timestamp is ISO format
                try:
                    run_timestamp = datetime.fromisoformat(hist_run['run']['timestamp'].replace('Z', '+00:00'))
                except:
                    run_timestamp = datetime.now()
                    
                # Calculate flaky from results if not present in run
                flaky_val = hist_run['run'].get('flaky')
                if flaky_val is None:
                    flaky_val = sum(1 for r in hist_run.get('results', []) if r.get('status') == 'flaky' or r.get('outcome') == 'flaky')
                    
                trend_data['overall'].append({
                    "runId": int(run_timestamp.timestamp() * 1000),
                    "timestamp": run_timestamp.isoformat(),
                    "duration": hist_run['run'].get('duration'),
                    "totalTests": hist_run['run'].get('totalTests'),
                    "passed": hist_run['run'].get('passed'),
                    "failed": hist_run['run'].get('failed'),
                    "skipped": hist_run['run'].get('skipped', 0),
                    "flaky": flaky_val
                })

                if isinstance(hist_run.get('results'), list):
                    run_key = f"test run {int(run_timestamp.timestamp() * 1000)}"
                    trend_data['testRuns'][run_key] = [{
                        "testName": test.get('name'),
                        "duration": test.get('duration'),
                        "status": test.get('final_status') or test.get('status'),
                        "timestamp": test.get('startTime') # Passing string through as is
                    } for test in hist_run['results']]
                    
        trend_data['overall'].sort(key=lambda x: x['runId'])

    # Step 5: Generate and write HTML
    try:
        html_content = generate_html(current_run_report_data, trend_data)
        with open(report_html_path, "w", encoding="utf-8") as f:
            f.write(html_content)
        print(f"Pulse report generated successfully at: {report_html_path}")
        print("(You can open this file in your browser)")
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Error generating HTML report: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
def generate_dynamic_html(json_path, html_path):
    """Bridge for cli.py: Generate a dynamic HTML report (references attachments)."""
    import json
    from pathlib import Path
    
    with open(json_path, "r", encoding="utf-8") as f:
        report_data = json.load(f)
    
    output_dir = os.path.dirname(json_path) or "."
    history_dir = Path(output_dir) / "history"
    
    trend_data = {"overall": [], "testRuns": {}}
    if history_dir.exists():
        files = [f for f in history_dir.iterdir() if f.name.startswith("trend-") and f.name.endswith(".json")]
        file_metas = []
        for f in files:
            ts_part = f.name.replace("trend-", "").replace(".json", "")
            try:
                ts = int(ts_part)
                file_metas.append({"path": f, "ts": ts})
            except: pass
        file_metas.sort(key=lambda x: x["ts"], reverse=True)
        historical_runs = []
        for fm in file_metas[:15]:
            try:
                with open(fm["path"], "r", encoding="utf-8") as f:
                    historical_runs.append(json.load(f))
            except: pass
        historical_runs.reverse()
        
        for hist_run in historical_runs:
            if hist_run.get('run'):
                try:
                    rt = datetime.fromisoformat(hist_run['run']['timestamp'].replace('Z', '+00:00'))
                except: rt = datetime.now()
                flaky = hist_run['run'].get('flaky')
                if flaky is None:
                    flaky = sum(1 for r in hist_run.get('results', []) if r.get('status') == 'flaky')
                trend_data['overall'].append({
                    "runId": int(rt.timestamp() * 1000),
                    "timestamp": rt.isoformat(),
                    "duration": hist_run['run'].get('duration'),
                    "totalTests": hist_run['run'].get('totalTests'),
                    "passed": hist_run['run'].get('passed'),
                    "failed": hist_run['run'].get('failed'),
                    "skipped": hist_run['run'].get('skipped', 0),
                    "flaky": flaky
                })
                
                if isinstance(hist_run.get('results'), list):
                    run_key = f"test run {int(rt.timestamp() * 1000)}"
                    trend_data['testRuns'][run_key] = [{
                        "testName": test.get('name'),
                        "duration": test.get('duration'),
                        "status": test.get('final_status') or test.get('status'),
                        "timestamp": test.get('startTime')
                    } for test in hist_run['results']]
        trend_data['overall'].sort(key=lambda x: x['runId'])

    html = generate_html(report_data, trend_data)
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)

if __name__ == "__main__":
    print("pytest-pulse: This module is used to generate dynamic reports.")
    print("Standard usage: 'generate-report'")
    print("💡 Tip: Use 'generate-pulse-report' for a self-contained static HTML report.")
