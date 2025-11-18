// =========================
// ds.js - Intellectra Chat (Full + Layout Fixes)
// =========================
document.addEventListener("DOMContentLoaded", () => {
  // Elements
  const body = document.documentElement;
  const themeToggle = document.getElementById("themeToggle");
  const messagesDiv = document.getElementById("messages");
  const queryInput = document.getElementById("query");
  const sendBtn = document.getElementById("sendBtn");
  const attachBtn = document.getElementById("attachBtn");
  const filePopup = document.getElementById("file-popup");
  const fileImage = document.getElementById("file-image");
  const fileDoc = document.getElementById("file-doc");
  const fileAny = document.getElementById("file-any");
  const attachedArea = document.getElementById("attached-area");
  const sidebar = document.getElementById("sidebar");
  const menuBtn = document.getElementById("menuBtn");
  const closeSidebar = document.getElementById("closeSidebar");
  const chatWrapper = document.getElementById("chat-wrapper");

  let attachedFile = null;
  let popupOpen = false;
  let isSending = false;


  function showNotification(message, color = "var(--user-color)") {
    const notification = document.getElementById("notification");
    notification.textContent = message;
    notification.style.backgroundColor = color;
    notification.classList.add("show");

    // Hide after 3 seconds
    setTimeout(() => {
      notification.classList.remove("show");
    }, 3000);
  }

  /* --------------------------- THEME HANDLING --------------------------- */
  const savedTheme = localStorage.getItem("theme") || "light";
  setTheme(savedTheme);

  themeToggle.addEventListener("click", () => {
    const newTheme = body.getAttribute("data-theme") === "dark" ? "light" : "dark";
    setTheme(newTheme);
  });

  function setTheme(name) {
    if (name === "dark") {
      body.setAttribute("data-theme", "dark");
      body.classList.add("dark-mode");
      themeToggle.innerHTML = sunSVG();
      localStorage.setItem("theme", "dark");
    } else {
      body.removeAttribute("data-theme");
      body.classList.remove("dark-mode");
      themeToggle.innerHTML = moonSVG();
      localStorage.setItem("theme", "light");
    }
  }

  function moonSVG() {
    return `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" fill="currentColor"/>
      </svg>`;
  }

  function sunSVG() {
    return `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M12 4V2M12 22v-2M4.22 4.22L2.8 2.8M21.2 21.2l-1.42-1.42M2 12H4M20 12h2M4.22 19.78l-1.42 1.42M21.2 2.8l-1.42 1.42"
              stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="12" cy="12" r="3" fill="currentColor"/>
      </svg>`;
  }

  /* --------------------------- AUTO-RESIZE TEXTAREA --------------------------- */
  queryInput.addEventListener("input", () => {
    queryInput.style.height = "auto";
    queryInput.style.height = Math.min(queryInput.scrollHeight, 220) + "px";
  });

  /* --------------------------- FILE POPUP LOGIC --------------------------- */
  attachBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    popupOpen = !popupOpen;
    togglePopup(popupOpen);
  });

  document.addEventListener("click", (e) => {
    if (!filePopup.contains(e.target) && e.target !== attachBtn) {
      popupOpen = false;
      togglePopup(false);
    }
  });

  function togglePopup(open) {
    if (open) {
      filePopup.classList.add("open");
      filePopup.setAttribute("aria-hidden", "false");
      attachBtn.setAttribute("aria-expanded", "true");
    } else {
      filePopup.classList.remove("open");
      filePopup.setAttribute("aria-hidden", "true");
      attachBtn.setAttribute("aria-expanded", "false");
    }
  }

  /* --------------------------- FILE ATTACHMENT --------------------------- */
  [fileImage, fileDoc, fileAny].forEach((input) => {
    input.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        attachedFile = e.target.files[0];
        showAttachedChip(attachedFile);
        popupOpen = false;
        togglePopup(false);
      }
      e.target.value = "";
    });
  });

  function showAttachedChip(file) {
    // const chipsContainer = document.getElementById("upload-chips");
    // chipsContainer.innerHTML = ""; // clear previous chip
    attachedArea.innerHTML = "";
    const chip = document.createElement("div");
    chip.className = "file-chip";
    chip.innerHTML = `<span>${file.name}</span>`;
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "✕";
    remove.title = "Remove attachment";
    remove.addEventListener("click", () => {
      attachedFile = null;
      attachedArea.innerHTML = "";
      // chipsContainer.innerHTML = "";
    });
    chip.appendChild(remove);
    attachedArea.appendChild(chip);
    // chipsContainer.appendChild(chip);
  }

  /* --------------------------- MESSAGE SENDING --------------------------- */
  sendBtn.addEventListener("click", () => { if (!isSending) sendMessage(); });

  queryInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isSending) sendMessage();
    }
  });


  async function sendMessage() {
    const query = queryInput.value.trim();
    if (!query && !attachedFile) return;
    isSending = true;
    sendBtn.disabled = true;
    queryInput.disabled = true;
    


    if (query) appendMessage(query, "user");

    try {
      if (attachedFile) {
        appendMessage(`📎 Uploading ${attachedFile.name}...`, "user");
        const fd = new FormData();
        fd.append("file", attachedFile);
        const upResp = await fetch("http://127.0.0.1:5000/api/upload", {
          method: "POST",
          body: fd,
        });
        const upData = await upResp.json().catch(() => ({}));
        if (upResp.ok && upData.message) {
          appendMessage(`✅ ${upData.message}`, "ai");
          showNotification(upData.message, "#59cc4cff");  // ✅ Success notification
        } else {
          appendMessage("⚠️ Upload failed.", "ai");
          showNotification("Upload failed", "#cc594cff");       // ❌ Error notification
        }
        attachedFile = null;
        attachedArea.innerHTML = "";
      }

      if (query) {
        queryInput.value = "";
        queryInput.style.height = "auto";
        const res = await fetch("http://127.0.0.1:5000/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.response) {
          appendMessage(data.response, "ai");
        } else {
          appendMessage("⚠️ No response from server.", "ai");
        }
      }
    } catch (err) {
      console.error(err);
      appendMessage("⚠️ Server not responding. Is app.py running?", "ai");
    } finally {
      isSending = false;
      sendBtn.disabled = false;
      queryInput.disabled = false;
      queryInput.focus();
    }
  }
  function renderMarkdown(md) {
  return md
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") // **bold**
    .replace(/\*(.*?)\*/g, "<em>$1</em>")             // *italic*
    .replace(/__(.*?)__/g, "<strong>$1</strong>")     // __bold__
    .replace(/_(.*?)_/g, "<em>$1</em>");              // _italic_
  }


  // Proper message creation with layout fix
  function appendMessage(text, cls = "ai") {
    const msg = document.createElement("div");
    msg.className = cls === "user" ? "message user" : "response ai";
    msg.innerHTML = marked.parse(text);
     // msg.innerHTML = renderMarkdown(text); // msg.textContent = text;
    messagesDiv.appendChild(msg);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  /* --------------------------- SIDEBAR --------------------------- */
  menuBtn.addEventListener("click", () => {
    sidebar.classList.toggle("closed");
  });
  closeSidebar.addEventListener("click", () => {
    sidebar.classList.add("closed");
  });
});
