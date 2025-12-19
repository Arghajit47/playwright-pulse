// search.js - Dynamic Global Search Functionality for Playwright Pulse Report Documentation

class GlobalSearchManager {
  constructor() {
    this.searchInput = document.getElementById("searchInput");
    this.searchDropdown = document.getElementById("searchDropdown");
    this.clearSearch = document.getElementById("clearSearch");

    this.currentQuery = "";
    this.debounceTimer = null;
    this.searchData = [];
    this.isExpanded = false;

    this.initializeSearchData();
    this.initializeEventListeners();
  }

  async initializeSearchData() {
    // Define all HTML pages to index
    const pages = [
      { file: "index.html", title: "Getting Started", category: "getting-started" },
      { file: "reporters-scripts.html", title: "Reporters & Scripts", category: "scripts" },
      { file: "report-features.html", title: "Report Features", category: "features" },
      { file: "advanced-usage.html", title: "Advanced Usage", category: "advanced" },
      { file: "comparison.html", title: "Comparison", category: "comparison" },
      { file: "reference.html", title: "Reference", category: "reference" }
    ];

    // Extract content from each page
    for (const page of pages) {
      try {
        await this.indexPage(page);
      } catch (error) {
        console.warn(`Could not index ${page.file}:`, error);
      }
    }
  }

  async indexPage(page) {
    try {
      const response = await fetch(page.file);
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Extract sections from the page
      const sections = doc.querySelectorAll('section, h1, h2, h3, h4');
      const baseBreadcrumb = page.title;
      
      sections.forEach((section, index) => {
        const heading = section.querySelector('h1, h2, h3, h4') || section;
        
        if (heading && heading.textContent.trim()) {
          const title = heading.textContent.trim();
          const sectionId = section.id || heading.id || `section-${index}`;
          const url = sectionId ? `${page.file}#${sectionId}` : page.file;
          
          // Get description from the next paragraph or section content
          let description = '';
          const nextP = section.querySelector('p');
          if (nextP) {
            description = nextP.textContent.trim().substring(0, 150);
          } else if (section.textContent) {
            description = section.textContent.trim().substring(0, 150);
          }
          
          // Generate keywords from title and description
          const keywords = this.generateKeywords(title, description);
          
          // Determine type based on content
          const type = this.determineType(title, description, page.category);
          
          // Create breadcrumb
          const breadcrumb = title === page.title ? baseBreadcrumb : `${baseBreadcrumb} > ${title}`;
          
          this.searchData.push({
            id: `${page.file}-${index}`,
            title: title,
            description: description,
            url: url,
            category: page.category,
            type: type,
            breadcrumb: breadcrumb,
            keywords: keywords
          });
        }
      });
      
      // Also index code blocks and lists
      this.indexCodeBlocks(doc, page);
      this.indexLists(doc, page);
      
    } catch (error) {
      console.warn(`Error indexing ${page.file}:`, error);
    }
  }

  indexCodeBlocks(doc, page) {
    const codeBlocks = doc.querySelectorAll('pre code');
    codeBlocks.forEach((code, index) => {
      const content = code.textContent.trim();
      if (content.length > 20) { // Only index substantial code blocks
        const language = code.className.replace('language-', '') || 'code';
        const title = `${language.charAt(0).toUpperCase() + language.slice(1)} Example`;
        
        this.searchData.push({
          id: `${page.file}-code-${index}`,
          title: title,
          description: content.substring(0, 100) + '...',
          url: page.file,
          category: page.category,
          type: 'code',
          breadcrumb: `${page.title} > Code Examples`,
          keywords: [language, 'code', 'example', 'snippet', ...content.split(/\s+/).slice(0, 10)]
        });
      }
    });
  }

  indexLists(doc, page) {
    const lists = doc.querySelectorAll('ul li, ol li');
    lists.forEach((li, index) => {
      const content = li.textContent.trim();
      if (content.length > 30 && content.length < 200) { // Only index meaningful list items
        const strong = li.querySelector('strong');
        const title = strong ? strong.textContent.trim() : content.substring(0, 50) + '...';
        
        this.searchData.push({
          id: `${page.file}-list-${index}`,
          title: title,
          description: content,
          url: page.file,
          category: page.category,
          type: 'item',
          breadcrumb: `${page.title} > Features`,
          keywords: this.generateKeywords(title, content)
        });
      }
    });
  }

  generateKeywords(title, description) {
    const text = (title + ' ' + description).toLowerCase();
    const words = text.match(/\b\w{3,}\b/g) || [];
    const uniqueWords = [...new Set(words)];
    return uniqueWords.slice(0, 15); // Limit to 15 keywords
  }

  determineType(title, description, category) {
    const text = (title + ' ' + description + ' ' + category).toLowerCase();
    
    if (text.includes('install') || text.includes('setup') || text.includes('config')) return 'guide';
    if (text.includes('dashboard') || text.includes('widget') || text.includes('chart')) return 'feature';
    if (text.includes('github') || text.includes('gitlab') || text.includes('jenkins') || text.includes('ci')) return 'integration';
    if (text.includes('script') || text.includes('command') || text.includes('generate')) return 'command';
    if (text.includes('architecture') || text.includes('technical') || text.includes('reporter')) return 'technical';
    if (text.includes('comparison') || text.includes('vs') || text.includes('alternative')) return 'comparison';
    if (text.includes('changelog') || text.includes('version') || text.includes('reference')) return 'reference';
    if (text.includes('code') || text.includes('example')) return 'code';
    
    return 'guide';
  }

  initializeEventListeners() {
    if (!this.searchInput) return;

    // Search input events
    this.searchInput.addEventListener("input", (e) => {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.handleSearch(e.target.value);
      }, 300);
    });

    this.searchInput.addEventListener("focus", () => {
      if (this.currentQuery) {
        this.showDropdown(this.currentQuery);
      }
    });

    // Clear search
    if (this.clearSearch) {
      this.clearSearch.addEventListener("click", () => {
        this.clearSearchInput();
      });
    }

    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
      if (
        !this.searchInput.contains(e.target) &&
        !this.searchDropdown.contains(e.target)
      ) {
        this.hideDropdown();
      }
    });

    // Keyboard navigation
    this.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.hideDropdown();
      } else if (e.key === "Enter") {
        const firstResult = this.searchDropdown.querySelector(
          ".search-result-item[data-url]"
        );
        if (firstResult && this.searchDropdown.classList.contains("visible")) {
          const url = firstResult.dataset.url;
          if (url) {
            window.location.href = url;
          }
        }
      }
    });
  }

  handleSearch(query) {
    this.currentQuery = query.trim();
    this.isExpanded = false;

    if (this.currentQuery.length === 0) {
      if (this.clearSearch) {
        this.clearSearch.classList.remove("visible");
      }
      this.hideDropdown();
      return;
    }

    if (this.clearSearch) {
      this.clearSearch.classList.add("visible");
    }
    this.showDropdown(this.currentQuery);
  }

  searchInData(query) {
    const lowerQuery = query.toLowerCase();
    return this.searchData
      .filter((item) => {
        return (
          item.title.toLowerCase().includes(lowerQuery) ||
          item.description.toLowerCase().includes(lowerQuery) ||
          item.keywords.some((keyword) =>
            keyword.toLowerCase().includes(lowerQuery)
          ) ||
          item.breadcrumb.toLowerCase().includes(lowerQuery)
        );
      })
      .sort((a, b) => {
        // Sort by relevance
        const aScore = this.calculateRelevanceScore(a, lowerQuery);
        const bScore = this.calculateRelevanceScore(b, lowerQuery);
        return bScore - aScore;
      });
  }

  calculateRelevanceScore(item, query) {
    let score = 0;
    const titleLower = item.title.toLowerCase();
    const descLower = item.description.toLowerCase();

    // Exact title match gets highest score
    if (titleLower === query) score += 100;
    else if (titleLower.startsWith(query)) score += 75;
    else if (titleLower.includes(query)) score += 50;

    // Description match
    if (descLower.includes(query)) score += 25;

    // Keyword match
    const keywordMatch = item.keywords.some((keyword) =>
      keyword.toLowerCase().includes(query)
    );
    if (keywordMatch) score += 15;

    // Breadcrumb match
    if (item.breadcrumb.toLowerCase().includes(query)) score += 10;

    return score;
  }

  showDropdown(query) {
    if (!this.searchDropdown) return;
    
    const allResults = this.searchInData(query);
    const displayLimit = this.isExpanded ? Math.min(allResults.length, 20) : 6;
    const results = allResults.slice(0, displayLimit);

    if (results.length === 0) {
      this.hideDropdown();
      return;
    }

    let dropdownHTML = `<div class="search-category">Documentation (${allResults.length} results)</div>`;
    results.forEach((item) => {
      dropdownHTML += `
        <div class="search-result-item" data-url="${item.url}" style="cursor: pointer;">
          <svg class="search-result-icon" viewBox="0 0 24 24" fill="currentColor">
            ${this.getIconForType(item.type)}
          </svg>
          <div class="search-result-content">
            <div class="search-result-title">${this.highlightMatch(
              item.title,
              query
            )}</div>
            <div class="search-result-description">${this.truncateText(
              item.description,
              70
            )}${item.description.length > 70 ? '...' : ''}</div>
            <div class="search-result-breadcrumb">${item.breadcrumb}</div>
          </div>
        </div>
      `;
    });

    if (!this.isExpanded && allResults.length > 6) {
      dropdownHTML += `
        <div class="search-result-item search-expand-button" data-action="expand" style="cursor: pointer; border-top: 2px solid var(--border-color);">
          <div style="width: 100%; text-align: center; font-weight: 500; color: var(--primary-color); padding: 12px 8px;">
            <svg style="width: 16px; height: 16px; margin-right: 8px; vertical-align: middle;" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/>
            </svg>
            View all ${allResults.length} results...
          </div>
        </div>
      `;
    } else if (this.isExpanded && allResults.length > 6) {
      dropdownHTML += `
        <div class="search-result-item search-expand-button" data-action="collapse" style="cursor: pointer; border-top: 2px solid var(--border-color);">
          <div style="width: 100%; text-align: center; font-weight: 500; color: var(--text-color-muted); padding: 12px 8px;">
            <svg style="width: 16px; height: 16px; margin-right: 8px; vertical-align: middle;" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/>
            </svg>
            Show less results
          </div>
        </div>
      `;
    }

    this.searchDropdown.innerHTML = dropdownHTML;
    this.searchDropdown.classList.add("visible");

    // Remove existing event listeners to prevent duplicates
    const existingHandler = this.searchDropdown._clickHandler;
    if (existingHandler) {
      this.searchDropdown.removeEventListener('click', existingHandler);
    }

    // Add new click handler
    const clickHandler = (e) => {
      const clickedItem = e.target.closest('.search-result-item');
      if (!clickedItem) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      const url = clickedItem.dataset.url;
      const action = clickedItem.dataset.action;
      
      if (action === "expand") {
        this.isExpanded = true;
        this.showDropdown(query);
      } else if (action === "collapse") {
        this.isExpanded = false;
        this.showDropdown(query);
      } else if (url) {
        window.location.href = url;
      }
    };
    
    this.searchDropdown.addEventListener('click', clickHandler);
    this.searchDropdown._clickHandler = clickHandler;
  }

  hideDropdown() {
    if (this.searchDropdown) {
      this.searchDropdown.classList.remove("visible");
    }
    this.isExpanded = false;
  }

  getIconForType(type) {
    const icons = {
      guide:
        '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
      feature:
        '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10-10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>',
      integration:
        '<path d="M22 16v-2l-8.5-5V3.5c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5V9L2 14v2l8.5-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5L22 16z"/>',
      technical:
        '<path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0L19.2 12l-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>',
      command:
        '<path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-5 14H4v-4h11v4zM4 8v2h16V8H4z"/>',
      comparison:
        '<path d="M9 11H7v6h2v-6zm4 0h-2v6h2v-6zm4 0h-2v6h2v-6zm2.5-9L12 2 4.5 2 3 6v14.5c0 .83.67 1.5 1.5 1.5h15c.83 0 1.5-.67 1.5-1.5V6l-1.5-4z"/>',
      reference:
        '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>',
      code:
        '<path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0L19.2 12l-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>',
      item:
        '<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>'
    };
    return icons[type] || icons.guide;
  }

  highlightMatch(text, query) {
    if (!query) return text;
    const regex = new RegExp(`(${query})`, "gi");
    return text.replace(regex, '<span class="search-result-match">$1</span>');
  }

  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim();
  }

  clearSearchInput() {
    if (this.searchInput) {
      this.searchInput.value = "";
    }
    this.currentQuery = "";
    if (this.clearSearch) {
      this.clearSearch.classList.remove("visible");
    }
    this.hideDropdown();
    this.isExpanded = false;
  }
}

// Theme Manager
class ThemeManager {
  constructor() {
    this.themeToggle = document.getElementById("themeToggle");
    this.currentTheme = localStorage.getItem("theme") || "light";

    this.initializeTheme();
    this.initializeEventListeners();
  }

  initializeTheme() {
    document.body.setAttribute("data-theme", this.currentTheme);
    this.updateThemeIcon();
  }

  initializeEventListeners() {
    if (this.themeToggle) {
      this.themeToggle.addEventListener("click", () => {
        this.toggleTheme();
      });
    }
  }

  toggleTheme() {
    this.currentTheme = this.currentTheme === "light" ? "dark" : "light";
    document.body.setAttribute("data-theme", this.currentTheme);
    localStorage.setItem("theme", this.currentTheme);
    this.updateThemeIcon();
  }

  updateThemeIcon() {
    const icon = this.themeToggle?.querySelector(".theme-icon");
    if (!icon) return;

    if (this.currentTheme === "dark") {
      icon.innerHTML =
        '<path d="M21.4 13.7C20.2 14.4 18.8 14.8 17.3 14.8c-3.9 0-7.1-3.2-7.1-7.1 0-1.5.4-2.9 1.1-4.1C7.1 4.8 4 8.5 4 12.8c0 4.4 3.6 8 8 8 3.1 0 5.8-1.8 7.1-4.4.4-.8.3-1.7-.7-2.7z"/>';
    } else {
      icon.innerHTML =
        '<path d="M12 18c-3.3 0-6-2.7-6-6s2.7-6 6-6 6 2.7 6 6-2.7 6-6 6zm0-10c-2.2 0-4 1.8-4 4s1.8 4 4 4 4-1.8 4-4-1.8-4-4-4z"/><path d="M12 1l3 3-3 3-3-3 3-3zm0 18l3 3-3 3-3-3 3-3zM6 12l-3-3-3 3 3 3 3-3zm12 0l3-3 3 3-3 3-3-3z"/>';
    }
  }
}

// Mobile Sidebar Manager - Disabled to avoid conflicts with script.js
// The sidebar functionality is handled by script.js
class SidebarManager {
  constructor() {
    // Intentionally empty - sidebar logic handled by script.js
    console.log('SidebarManager: Deferring to script.js for sidebar functionality');
  }
}

// Copy to clipboard functionality for code blocks - Updated to avoid conflicts
function addCopyButtons() {
  const allPreBlocks = document.querySelectorAll("pre:not(.copy-added)");
  allPreBlocks.forEach((pre) => {
    // Skip if button already exists (added by script.js)
    if (pre.querySelector('.copy-button')) {
      return;
    }
    
    const button = document.createElement("button");
    button.className = "copy-button";
    button.textContent = "Copy";
    pre.appendChild(button);
    pre.classList.add("copy-added");

    button.addEventListener("click", () => {
      const code = pre.querySelector("code");
      if (!code) return;
      navigator.clipboard
        .writeText(code.innerText)
        .then(() => {
          button.textContent = "Copied!";
          setTimeout(() => {
            button.textContent = "Copy";
          }, 2000);
        })
        .catch((err) => {
          console.error("Failed to copy text: ", err);
          button.textContent = "Error";
          setTimeout(() => {
            button.textContent = "Copy";
          }, 2000);
        });
    });
  });
}

// Function to show code tabs (for advanced-usage.html)
function showCode(platform, event) {
  document
    .querySelectorAll(".code-container")
    .forEach((c) => (c.style.display = "none"));
  document
    .querySelectorAll(".ci-buttons button")
    .forEach((b) => b.classList.remove("active"));
  const targetElement = document.getElementById(`${platform}-code`);
  if (targetElement && event && event.currentTarget) {
    targetElement.style.display = "block";
    event.currentTarget.classList.add("active");
  }
}

// Initialize everything when DOM is loaded
document.addEventListener("DOMContentLoaded", function () {
  // Initialize managers and store references globally for potential use
  window.globalSearchManager = new GlobalSearchManager();
  window.globalThemeManager = new ThemeManager();
  window.globalSidebarManager = new SidebarManager(); // Empty class - functionality in script.js

  // Only add copy buttons if script.js hasn't already added them
  setTimeout(() => {
    addCopyButtons();
  }, 100); // Small delay to let script.js run first
});