document.addEventListener("DOMContentLoaded", function () {
  // --- Mobile Sidebar Toggle Logic ---
  const menuToggle = document.getElementById("menu-toggle");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  // CORRECTED: Use querySelector to target the class name instead of an ID.
  const mainContent = document.querySelector(".main-content");
  const body = document.body;

  // This check now correctly finds mainContent and prevents errors.
  if (menuToggle && sidebar && overlay && mainContent) {
    menuToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = body.classList.toggle("sidebar-open");
      menuToggle.innerHTML = isOpen ? "✕" : "☰";
      menuToggle.setAttribute(
        "aria-label",
        isOpen ? "Close navigation menu" : "Open navigation menu"
      );
    });

    const closeSidebar = () => {
      if (body.classList.contains("sidebar-open")) {
        body.classList.remove("sidebar-open");
        menuToggle.innerHTML = "☰";
        menuToggle.setAttribute("aria-label", "Open navigation menu");
      }
    };

    overlay.addEventListener("click", closeSidebar);
    // This line will now work correctly.
    mainContent.addEventListener("click", closeSidebar);

    sidebar.addEventListener("click", (e) => {
      if (e.target.tagName === "A") {
        setTimeout(closeSidebar, 150);
      }
    });
  }

  // --- Active Link Highlighting in Sidebar (Scroll-Spy) ---
  const sidebarNav = document.querySelector(".sidebar-nav");
  if (sidebarNav) {
    const navLinks = sidebarNav.querySelectorAll('a[href^="#"]');
    const sections = Array.from(navLinks)
      .map((link) => {
        const section = document.getElementById(
          link.getAttribute("href").substring(1)
        );
        return section;
      })
      .filter(Boolean);

    if (sections.length > 0 && mainContent) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const id = entry.target.getAttribute("id");
              const correspondingLink = sidebarNav.querySelector(
                `a[href="#${id}"]`
              );
              if (correspondingLink) {
                navLinks.forEach((link) => link.classList.remove("active"));
                correspondingLink.classList.add("active");
              }
            }
          });
        },
        {
          root: null, // Use the viewport for scroll detection
          rootMargin: `0px 0px -75% 0px`,
          threshold: 0,
        }
      );
      sections.forEach((section) => observer.observe(section));
    }
  }

  // --- Add Copy-to-Clipboard for Code Blocks ---
  const allPreBlocks = document.querySelectorAll(".main-content pre");
  allPreBlocks.forEach((pre) => {
    const button = document.createElement("button");
    button.className = "copy-button";
    button.innerHTML = "Copy";
    pre.appendChild(button);

    button.addEventListener("click", () => {
      const code = pre.querySelector("code");
      if (!code) return;
      navigator.clipboard
        .writeText(code.innerText)
        .then(() => {
          button.innerHTML = "Copied!";
          setTimeout(() => {
            button.innerHTML = "Copy";
          }, 2000);
        })
        .catch((err) => {
          console.error("Failed to copy text: ", err);
          button.innerHTML = "Error";
          setTimeout(() => {
            button.innerHTML = "Copy";
          }, 2000);
        });
    });
  });
});
