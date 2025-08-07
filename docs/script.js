// === script.js ===
document.addEventListener("DOMContentLoaded", function () {
  // --- Mobile Sidebar Toggle Logic ---
  const menuToggle = document.getElementById("menu-toggle");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  const body = document.body;

  if (menuToggle && sidebar && overlay) {
    menuToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = body.classList.toggle("sidebar-open");
      menuToggle.innerHTML = isOpen ? "✕" : "☰";
    });

    const closeSidebar = () => {
      if (body.classList.contains("sidebar-open")) {
        body.classList.remove("sidebar-open");
        menuToggle.innerHTML = "☰";
      }
    };

    overlay.addEventListener("click", closeSidebar);
  }

  // --- Add Copy-to-Clipboard for Code Blocks ---
  const allPreBlocks = document.querySelectorAll(".main-content pre");
  allPreBlocks.forEach((pre) => {
    const button = document.createElement("button");
    button.className = "copy-button";
    button.textContent = "Copy";
    pre.appendChild(button);

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
  
  // Animation enhancements
  document.addEventListener("DOMContentLoaded", function() {
    // Add animation indexes to elements
    document.querySelectorAll('.search-result-item').forEach((item, index) => {
      item.style.setProperty('--item-index', index);
    });
    
    document.querySelectorAll('section').forEach((section, index) => {
      section.style.setProperty('--section-index', index);
    });
    
    document.querySelectorAll('.sidebar-link').forEach((link, index) => {
      link.style.setProperty('--link-index', index);
    });
    
    // Add special animation when theme is toggled
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', function() {
        this.style.animation = 'themeShine 1s';
        
        // Reset animation
        setTimeout(() => {
          this.style.animation = '';
        }, 1000);
        
        // Add page transition effect
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = document.body.getAttribute('data-theme') === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
        overlay.style.zIndex = '9999';
        overlay.style.pointerEvents = 'none';
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.3s ease-out';
        
        document.body.appendChild(overlay);
        
        requestAnimationFrame(() => {
          overlay.style.opacity = '1';
          
          setTimeout(() => {
            overlay.style.opacity = '0';
            
            setTimeout(() => {
              document.body.removeChild(overlay);
            }, 300);
          }, 300);
        });
      });
    }
  });
});
