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
});
