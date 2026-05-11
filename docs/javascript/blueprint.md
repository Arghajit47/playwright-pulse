# **App Name**: Playwright Pulse Report

## Overview

The ultimate Playwright reporter — Interactive dashboard with historical trend analytics, CI/CD-ready standalone HTML reports, and sharding support for scalable test execution.

**NPM Package**: [@arghajit/playwright-pulse-report](https://www.npmjs.com/package/@arghajit/playwright-pulse-report)
**Documentation**: [https://arghajit47.github.io/playwright-pulse/](https://arghajit47.github.io/playwright-pulse/)
**Live Demo**: [https://arghajit47.github.io/playwright-pulse/demo.html](https://arghajit47.github.io/playwright-pulse/demo.html)

---

## Core Features

### 1. **Interactive Dashboard**
- Rich, single-page application to visualize test results
- Filter by status, browser, or test name
- Expand test cases to see detailed steps, errors, console logs, and attachments
- Real-time test result visualization with historical trends

### 2. **Historical Trend Analysis**
- Automatically archives test runs to track performance over time
- View trends for test volume, pass/fail rates, and execution duration
- Test history for last 15 runs with detailed metrics
- Duration insights by Spec files and Test Describe blocks

### 3. **Standalone HTML Reports**
- Generate fully self-contained HTML reports with embedded attachments
- Perfect for sharing and CI/CD artifacts
- Dark theme with optimized initial load handling
- Two report types:
  - **Static Report**: All attachments embedded (larger file, no dependencies)
  - **Dynamic Report**: Loads attachments from directory (lighter file, requires attachments folder)

### 4. **Emailable Summaries**
- Automatically generate and send lightweight email reports
- Key statistics with styled severity and tag badges
- Modern, responsive email template with animations
- Support for up to 5 recipients via environment variables
- Custom SMTP support (Gmail, Outlook)

### 5. **Full Sharding Support**
- Natively handles Playwright's sharding capabilities
- Merge reports from all shards into single comprehensive report
- Automatic shard detection and organization
- CI/CD ready with artifact management

### 6. **AI-Powered Analysis**
- Integrates Groq API with `llama-3.3-70b-versatile` model
- Provides insights on test flakiness and performance bottlenecks
- Failure pattern recognition with detailed root cause analysis
- Suggested optimizations and code snippets
- Copy AI Prompt feature for external AI tools (ChatGPT, Claude, Gemini)

### 7. **Advanced Test Metadata**
- **Custom Annotations Support**: Full Playwright test annotations with styling
- **JIRA/Ticket Integration**: Clickable links for issue/bug annotations
- **Severity Levels**: Test severity metadata (Minor → Critical) with color-coded badges
- **Tag Support**: Comprehensive tag display across all report types
- **Worker Index Tracking**: Track which worker executed each test

### 8. **Comprehensive Analytics**
- Test Distribution by Worker chart
- Severity Distribution visualization
- Browser Distribution breakdown
- Retry Count tracking
- Duration analysis by spec files and describe blocks
- System Information widget (Host, OS, CPU, Memory, Node version)

### 9. **Enhanced Attachments**
- Screenshots, videos, and trace files support
- View options for all attachment types
- Structured `attachments/` directory organization
- Base64 embedding for static reports
- Dynamic loading for attachment-based reports

### 10. **Environment Detection**
- Automatic CI vs Local test detection
- System information capture
- Browser version and OS detection
- Node.js and V8 version tracking

---

## Technical Architecture

### Core Components

#### 1. **Reporter (playwright-pulse-reporter.ts)**
- Implements Playwright's `Reporter` interface
- Event-driven architecture using lifecycle hooks:
  - `onBegin`: Initialize test run
  - `onTestEnd`: Capture test results
  - `onEnd`: Generate final report
- Automatic attachment processing and organization
- Sharding awareness with temporary shard files
- Configurable output directory support

#### 2. **CLI Scripts**

| Script | Purpose | Output |
|--------|---------|--------|
| `generate-pulse-report` | Creates self-contained static HTML report | `playwright-pulse-static-report.html` |
| `generate-report` | Creates lightweight dynamic HTML report | `playwright-pulse-report.html` |
| `merge-pulse-report` | Merges sharded test results | `playwright-pulse-report.json` |
| `send-email` | Generates and sends email report | Email + `pulse-email-summary.html` |
| `generate-trend` | Archives historical trend data | Historical JSON files |
| `generate-email-report` | Generates email HTML without sending | `pulse-email-summary.html` |

#### 3. **Configuration Options**

```typescript
{
  outputDir: string;              // Custom report directory (required)
  resetOnEachRun?: boolean;       // Reset report on each run (default: true)
}
```

#### 4. **Data Flow**

```
Playwright Tests
    ↓
Reporter (Event Collection)
    ↓
JSON Output (playwright-pulse-report.json)
    ↓
CLI Scripts (Processing)
    ↓
HTML Reports / Email / Trends
```

---

## CLI Script Features

### Automatic Config Detection (v0.3.0+)
- All scripts auto-detect `outputDir` from `playwright.config.ts`
- Manual override with `--outputDir` or `-o` flag
- Fallback to `pulse-report` if not configured

### Path Validation & Security
- Input sanitization to prevent path traversal attacks
- Null byte detection and blocking
- System directory protection
- Normalized path resolution

### Usage Examples

```bash
# Auto-detect from config
npx generate-pulse-report
npx generate-report
npx merge-pulse-report
npx send-email

# Manual override
npx generate-pulse-report --outputDir custom-reports
npx generate-report -o test-results/e2e
npx send-email --outputDir custom-pulse-reports
```

---

## Style Guidelines

### Color Palette

#### Light Theme (Default)
- **Primary**: Professional blues and grays
- **Background**: White (#FFFFFF)
- **Text**: Dark gray (#333333)
- **Accent**: Orange (#FF9800) for interactive elements
- **Status Colors**:
  - Pass: Green (#4CAF50)
  - Fail: Red (#F44336)
  - Skip: Gray (#9E9E9E)
  - Flaky: Orange (#FF9800)

#### Dark Theme (Static Report)
- **Background**: Dark gray (#1E1E1E)
- **Text**: Light gray (#E0E0E0)
- **Accent**: Orange (#FF9800)
- **Cards**: Semi-transparent with blur effects

### Severity Colors
- **Minor**: Blue (#2196F3)
- **Major**: Orange (#FF9800)
- **Critical**: Red (#F44336)

### UI/UX Principles
- Clean and structured layout with collapsible sections
- Responsive design for mobile, tablet, and desktop
- Clear and intuitive icons for test statuses
- Smooth transitions and animations
- Lazy loading for performance optimization
- Interactive charts with hover tooltips
- Copy-to-clipboard functionality
- Keyboard navigation support

---

## Integration Capabilities

### CI/CD Platforms
- GitHub Actions
- GitLab CI
- Jenkins
- Azure DevOps
- CircleCI

### Email Providers
- Gmail (via App Passwords)
- Outlook (via SMTP)
- Custom SMTP servers

### Issue Tracking
- JIRA (automatic ticket link detection)
- GitHub Issues
- Azure DevOps
- Custom ticket systems

### AI Tools Integration
- Groq API (built-in)
- ChatGPT (via Copy AI Prompt)
- Claude (via Copy AI Prompt)
- Google Gemini (via Copy AI Prompt)

---

## Recent Updates (v0.3.3)

### New Features
- **Retry Count Card**: Track test retry attempts
- **Browser Distribution Card**: Visualize test distribution across browsers
- **Modernized Email Template**: Improved styling and layout
- **Enhanced UI**: Refined interface for both report templates

### Security Improvements
- Fixed all security vulnerabilities
- No Open Source Security Issues
- No Code Security Issues
- No Configuration Issues
- Path traversal protection in CLI scripts
- XSS protection in documentation search
- Open Redirect vulnerability fixes

### Bug Fixes
- Send email issue for merged reports (sharding)
- Dependency updates to latest versions
- Removed deprecated packages

---

## Companion Tools

### Pulse Dashboard
- Next.js component & CLI tool
- Real-time Playwright test monitoring
- Interactive test result visualization
- Historical trend analysis
- Failure pattern identification

**Usage**: `npx pulse-dashboard`

---

## File Structure

```
pulse-report/
├── attachments/
│   ├── test-1-hash/
│   │   ├── screenshot.png
│   │   ├── video.webm
│   │   └── trace.zip
│   └── test-2-hash/
├── pulse-results/
│   ├── report-1.json
│   └── report-2.json
├── playwright-pulse-report.json
├── playwright-pulse-static-report.html
├── playwright-pulse-report.html
└── pulse-email-summary.html
```

---

## Requirements

- **Node.js**: >= 18
- **Playwright**: >= 1.40.0
- **Browser Support**: Chrome, Firefox, Safari, Edge, etc.

---

## License

MIT Licensed

**Made by**: Arghajit Singha
**Support**: [arghajitsingha47@gmail.com](mailto:arghajitsingha47@gmail.com)
**Repository**: [https://github.com/Arghajit47/playwright-pulse](https://github.com/Arghajit47/playwright-pulse)