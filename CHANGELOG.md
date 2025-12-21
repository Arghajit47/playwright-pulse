# 📜 Changelog

## **Version 0.3.0**

**🚀 Update Highlights**

- **✨ New Features**:
  - **Custom Annotations Support**: Added full support for Playwright test annotations in reports with dedicated styling, showing Type, Description, and Location details.
  - **JIRA/Ticket System Integration**: Clickable links for "issue" or "bug" type annotations that automatically detect JIRA tickets and open tickets in new browser tabs.
  - **Dynamic Output Directory Support**: All CLI scripts now accept `--outputDir` (or `-o`) argument for custom output directories, supporting any folder name or nested path structure.
  - **Copy AI Prompt Button**: Added "Copy AI Prompt" button in AI Failure Analyzer that copies a complete, ready-to-use prompt with instructions and test details for use with any AI tool (ChatGPT, Claude, Gemini, etc.).
  
- **🔧 Improvements**:
  - Migrated from Google Gemini API to Groq API with `llama-3.3-70b-versatile` model for faster and more accurate AI failure analysis.
  - Enhanced `TestResult` interface with `annotations` field for comprehensive test metadata capture.
  - Improved CLI scripts architecture to support dynamic directory paths across all commands.
  - **Automatic Config Detection**: CLI scripts now automatically read `outputDir` from `playwright.config` file, eliminating the need to manually pass `-o` argument, unless overriding is needed.
  - Optimized API configuration with OpenAI-compatible endpoints and refined parameters.
  - Beautiful purple/violet themed annotations section for better visual distinction in reports.

## **Version 0.2.10**

**🚀 Update Highlights**

- **🐛 Bug Fixes**:
  - Fixed the static report related issues, like;
    - Other attachments are visible in the static report, but was not getting opened in new tab.
    - Fixed the low vulnerability issues in the npm package.

## **Version 0.2.9**

**🚀 Update Highlights**

- **🔧 Improvements**:
  - Significantly improved the send report feature.

## **Version 0.2.8**

**🚀 Update Highlights**

- **🔧 Improvements**:
  - Significantly expanded README with detailed setup instructions and comprehensive usage examples for better onboarding.
  - Updated development dependencies to latest stable versions.
  - Increased minimum Node.js engine requirement for enhanced compatibility.
  - Increased retry attempts for credential fetching in `send-report`, to handle transient network issues.
- **🐛 Bug Fixes**:
  - Fixed issues with "Skipping email sending due to missing or failed credential fetch" in send report.
  - Resolved security vulnerabilities in the npm package.

## **Version 0.2.6**

**🚀 Update Highlights**

- **🔧 Improvements**:
  - Added "Error Snippet" logs for failed test cases.
  - Added "AI Failure Analyzer" for failed test cases, which provides a detailed analysis of the failure, like; possible causes, recommended solutions including the code snippets, for specific failure scenarios automatically.
  - Static report embeds all the attachments, so no need to have attachments/ directory when viewing the report with better user experience.
  - Made the static report responsive, less initial load time consuming and dark themed, for better user experience.

## **Version 0.2.5**

**🚀 Update Highlights**

- **🔧 Improvements**:
  - Added "View" options to All kind of attachments for both static and attachment based report.
  - Added "Test Distribution by Worker" chart, which shows Total no. of skipped, passed and failed test cases in Test History tab, for both static and attachment based report.
  - Added "Copy Console" for Console Log (stdout) for each test.
  - Revamped the entire UI design of [Documentation website](https://playwright-pulse-report.netlify.app/)
  - Changed The logo for the Playwright Pulse Report, throughout all the reporters.
- **🐛 Bug Fixes**:
  - Resolved issues with "failed to load attachments" in static report.
  - Fixed issues with "Copy Prompt" button, in Test Details tab.

---

## **Version 0.2.4**

**🚀 Update Highlights**

- **🔧 Improvements**:
  - Added `resetOnEachRun` config variable to handle Test sequential run, default value is `true`.
  - Added Gitlab, jenkins CI/CD workflow in the documentation website.

---

## **Version 0.2.3**

**🚀 Update Highlights**

**🚀 Update Highlights**

- **🔧 Improvements**:
  - Added Worker Index in the test details tab.
  - Added `generate-trend` command for only test-history generation.
- **🐛 Bug Fixes**:
  - Resolved issues with inconsistent test suite durations.
  - Fixed layout glitches in the HTML report on smaller screens.

---

## **Version 0.2.2**

**🚀 Update Highlights**

- **🏷️ Improvements**
  - Introduced 'System Information' widget to visualize Details about the test execution environment, like; Host, Os, Cpu Model & Cores, Memory, Node, V8, Cwd.
- **📊 Enhanced Analytics**:
  - Improved accuracy in history trend calculations.
  - Added support for filtering trends by date range.
  - Added workerIndex support for individual tests in json report.
- **🐛 Bug Fixes**:
  - Resolved issues with inconsistent test suite durations.
  - Fixed layout glitches in the HTML report on smaller screens.
- **🔧 Improvements**:
  - Optimized report generation for large test datasets.
  - Enhanced error handling for missing test data.
  - Browser Name components in test suite (Accurate browser name, version and os)
  - Send Report functionality with minified html report (with Minimum important details)

---

## **Version 0.2.1**

**🚀 Fix Update**

- **📈 History Trends** for last 15 runs:
  - Test suites
  - Test suite duration
  - Individual test executions
- **🐛 Fixed** Project Name components in test suite

---

## **Version 0.2.0**

**🚀 Major Update**

- **✨ Refined UI** for static HTML reports
- **📈 History Trends** for:
  - Test suites
  - Test suite duration
  - Individual test executions
- **🐛 Fixed** Project Name components in test suite

---

## **Version 0.1.6**

### 🛠️ Fixes

- **📧 Fixed** email report issues

---

## **Version 0.1.5**

### 🎨 Enhancements

- **🖌️ Updated** styling issues

---

## **Version 0.1.4**

### 🤖 AI Integration

- **🧠 Added AI Analyzer** into the report

---

## **Version 0.1.3**

### 📤 New Feature

- **📧 Email-able reports**

---

## **Version 0.1.2**

### 🔧 Improvements

- **✔️ Fixed** browser filter
- **🏷️ Added** Browser Tag in Test Suite Card

---

## **Version 0.1.1**

### ⚡️ Performance

- **🧩 Added Sharding Support**
