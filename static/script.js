const messagesDiv = document.getElementById("messages-container");
const queryInput = document.getElementById("query");
const sendBtn = document.getElementById("sendBtn");
const attachBtn = document.getElementById("attachBtn");
const fileInput = document.getElementById("fileInput");
const scrollNavBtn = document.getElementById("scrollNavBtn");
const historyList = document.getElementById("historyList");
const newChatBtn = document.getElementById("newChatBtn");
const sessionTitle = document.getElementById("sessionTitle");
const chatTimeline = document.getElementById("chat-timeline");
const historySearch = document.getElementById("historySearch");

// Mobile Sidebar Elements
const menuBtn = document.getElementById("menuBtn");
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");

let currentSessionId = null;
let userMessageCount = 0;
const pendingSessions = new Set(); // Track sessions with in-flight AI requests

// Session persistence via localStorage
function saveCurrentSession() {
    if (currentSessionId) {
        localStorage.setItem('intellectra_session', String(currentSessionId));
    } else {
        localStorage.removeItem('intellectra_session');
    }
}

// Configure Marked.js with Highlight.js
marked.setOptions({
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
    },
    breaks: true
});

// Custom renderer to wrap code blocks with header + copy button
const renderer = new marked.Renderer();
renderer.code = function(codeObj) {
    // marked v14+ passes an object { text, lang, escaped }
    const code = typeof codeObj === 'object' ? codeObj.text : codeObj;
    const lang = typeof codeObj === 'object' ? (codeObj.lang || '') : (arguments[1] || '');
    
    const langLabel = lang || 'code';
    let highlighted;
    if (lang && hljs.getLanguage(lang)) {
        highlighted = hljs.highlight(code, { language: lang }).value;
    } else {
        highlighted = hljs.highlightAuto(code).value;
    }
    return `<div class="code-block-wrapper">
        <div class="code-block-header">
            <span class="code-block-lang">${langLabel}</span>
            <button class="code-copy-btn" onclick="copyCodeBlock(this)">
                <i class="ri-file-copy-line"></i> Copy
            </button>
        </div>
        <pre><code class="hljs language-${lang}">${highlighted}</code></pre>
    </div>`;
};

marked.use({ renderer });

// Copy code to clipboard
function copyCodeBlock(btn) {
    const codeBlock = btn.closest('.code-block-wrapper').querySelector('code');
    const text = codeBlock.textContent;
    navigator.clipboard.writeText(text).then(() => {
        btn.innerHTML = '<i class="ri-check-line"></i> Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.innerHTML = '<i class="ri-file-copy-line"></i> Copy';
            btn.classList.remove('copied');
        }, 2000);
    });
}

// Initialize
async function init() {
    await fetchSessions();
    const saved = localStorage.getItem('intellectra_session');
    if (saved) {
        const savedId = parseInt(saved);
        // Find the session title from the sidebar
        const items = historyList.querySelectorAll('.history-item');
        let foundTitle = 'Resumed Session';
        items.forEach(item => {
            if (item.dataset.sessionId === String(savedId)) foundTitle = item.textContent;
        });
        loadSession(savedId, foundTitle);
    } else {
        startNewChat();
    }
}

// Mobile Sidebar Handlers
function toggleSidebar() {
    sidebar.classList.toggle("open");
    sidebarOverlay.classList.toggle("show");
}

function closeSidebar() {
    sidebar.classList.remove("open");
    sidebarOverlay.classList.remove("show");
}

menuBtn.addEventListener("click", toggleSidebar);
sidebarOverlay.addEventListener("click", closeSidebar);

// Scroll functionality
let isScrolledUp = false;

messagesDiv.addEventListener('scroll', () => {
    const threshold = 100;
    const isAtBottom = messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight <= threshold;
    
    if (!isAtBottom) {
        isScrolledUp = true;
        scrollNavBtn.classList.add('visible');
    } else {
        isScrolledUp = false;
        scrollNavBtn.classList.remove('visible');
    }

    // Timeline ScrollSpy logic
    const timelineItems = document.querySelectorAll('.timeline-item');
    if (timelineItems.length > 0) {
        let activeItem = null;
        let minDistance = Infinity;
        
        const containerRect = messagesDiv.getBoundingClientRect();
        const containerCenter = containerRect.top + (containerRect.height / 2);

        timelineItems.forEach(item => {
            const targetMsg = document.getElementById(item.dataset.targetId);
            if (targetMsg) {
                const rect = targetMsg.getBoundingClientRect();
                const msgCenter = rect.top + (rect.height / 2);
                const distance = Math.abs(containerCenter - msgCenter);
                
                if (distance < minDistance) {
                    minDistance = distance;
                    activeItem = item;
                }
            }
            item.classList.remove('active');
        });

        if (isAtBottom) {
            timelineItems[timelineItems.length - 1].classList.add('active');
        } else if (activeItem) {
            activeItem.classList.add('active');
        }
    }
});

scrollNavBtn.addEventListener('click', () => {
    if (isScrolledUp) {
        messagesDiv.scrollTo({ top: messagesDiv.scrollHeight, behavior: 'smooth' });
    }
});

function createTypingIndicator() {
    const wrapper = document.createElement("div");
    wrapper.className = "msg-wrapper ai typing";
    wrapper.innerHTML = `
        <div class="sender-name"><i class="ri-flashlight-fill"></i> Intellectra</div>
        <div class="msg-bubble">
            <div class="typing-indicator">
                <div class="dot"></div><div class="dot"></div><div class="dot"></div>
            </div>
        </div>
    `;
    return wrapper;
}

// Robust Markdown + Math Renderer
function renderMarkdownWithMath(text) {
    const mathBlocks = [];
    let processedText = text;

    // Helper to safely store math blocks and replace with a placeholder
    const storeMath = (match, mathContent, displayMode) => {
        const id = `MATHBLOCKPLACEHOLDER${mathBlocks.length}ENDMATH`;
        mathBlocks.push({ id, tex: mathContent, displayMode });
        return id;
    };

    // 1. Extract block math: $$ ... $$
    processedText = processedText.replace(/\$\$([\s\S]*?)\$\$/g, (m, p1) => storeMath(m, p1, true));
    
    // 2. Extract block math: \[ ... \]
    processedText = processedText.replace(/\\\[([\s\S]*?)\\\]/g, (m, p1) => storeMath(m, p1, true));
    
    // 3. Extract inline math: \( ... \)
    processedText = processedText.replace(/\\\(([\s\S]*?)\\\)/g, (m, p1) => storeMath(m, p1, false));

    // 4. FALLBACK: Catch LLM responses that output [ ... ] or ( ... ) containing math 
    // without properly escaping them as \[ ... \]
    processedText = processedText.replace(/\[([\s\S]{1,500}?)\]/g, (m, p1) => {
        if (p1.includes('\\int') || p1.includes('\\frac') || p1.includes('\\sum') || p1.includes('\\begin') || p1.includes('^')) {
            return storeMath(m, p1, true);
        }
        return m;
    });

    processedText = processedText.replace(/\(([\s\S]{1,200}?)\)/g, (m, p1) => {
        if (p1.includes('\\displaystyle') || p1.includes('\\int') || p1.includes('\\frac')) {
            return storeMath(m, p1, false);
        }
        return m;
    });

    // Parse Markdown safely (Markdown won't destroy our ___MATH_x___ placeholders)
    let html = marked.parse(processedText);

    // Re-inject rendered math
    mathBlocks.forEach(block => {
        try {
            const rendered = katex.renderToString(block.tex, {
                displayMode: block.displayMode,
                throwOnError: false
            });
            html = html.replace(block.id, rendered);
        } catch (e) {
            console.error("KaTeX Error:", e);
            html = html.replace(block.id, block.tex); // fallback to raw text if error
        }
    });

    return html;
}

function appendMessage(text, sender) {
    const wrapper = document.createElement("div");
    wrapper.className = `msg-wrapper ${sender}`;
    
    // Assign ID and create timeline item if it's a user message
    if (sender === 'user') {
        userMessageCount++;
        const msgId = `user-msg-${userMessageCount}`;
        wrapper.id = msgId;
        
        const timelineItem = document.createElement("div");
        timelineItem.className = "timeline-item";
        timelineItem.dataset.targetId = msgId;
        
        const timelineText = document.createElement("div");
        timelineText.className = "timeline-text";
        timelineText.textContent = text;
        
        const timelineDot = document.createElement("div");
        timelineDot.className = "timeline-dot";
        
        timelineItem.appendChild(timelineText);
        timelineItem.appendChild(timelineDot);
        
        timelineItem.addEventListener("click", () => {
            const target = document.getElementById(msgId);
            if (target) {
                const containerTop = messagesDiv.getBoundingClientRect().top;
                const targetTop = target.getBoundingClientRect().top;
                const offset = targetTop - containerTop + messagesDiv.scrollTop - 20;
                messagesDiv.scrollTo({ top: offset, behavior: 'smooth' });
            }
        });
        
        chatTimeline.appendChild(timelineItem);
    }

    const nameHtml = sender === 'user'  
        ? `<div class="sender-name">You <i class="ri-user-smile-fill"></i></div>`
        : `<div class="sender-name"><i class="ri-flashlight-fill"></i> Intellectra</div>`;

    // Parse Markdown and Math robustly
    let formattedText = "";
    if (sender === 'user') {
        formattedText = text.replace(/\n/g, '<br>');
    } else {
        formattedText = renderMarkdownWithMath(text);
    }

    wrapper.innerHTML = `
        ${nameHtml}
        <div class="msg-bubble">${formattedText}</div>
    `;
    
    messagesDiv.appendChild(wrapper);
    messagesDiv.scrollTo({ top: messagesDiv.scrollHeight, behavior: 'smooth' });
}

// Fetch session history list
async function fetchSessions() {
    try {
        const res = await fetch("http://127.0.0.1:5000/api/sessions");
        const data = await res.json();
        
        historyList.innerHTML = `<div style="padding: 10px; color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; margin-top: 10px;">Recent</div>`;
        
        if (data.sessions) {
            data.sessions.forEach(session => {
                const div = document.createElement("div");
                div.className = "history-item";
                div.dataset.sessionId = String(session.id);
                if (session.id === currentSessionId) div.classList.add("active");
                div.textContent = session.title;
                div.onclick = () => {
                    loadSession(session.id, session.title);
                    if(window.innerWidth <= 768) closeSidebar();
                };
                historyList.appendChild(div);
            });
        }
    } catch (err) {
        console.error("Error fetching sessions:", err);
    }
}

// Search filtering logic
historySearch.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const items = historyList.querySelectorAll('.history-item');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        if (text.includes(term)) {
            item.style.display = 'block';
        } else {
            item.style.display = 'none';
        }
    });
});

// Load specific session
async function loadSession(sessionId, title) {
    currentSessionId = sessionId;
    saveCurrentSession();
    sessionTitle.textContent = title;
    messagesDiv.innerHTML = "";
    chatTimeline.innerHTML = "";
    userMessageCount = 0;
    fetchSessions();

    try {
        const res = await fetch(`http://127.0.0.1:5000/api/chat/${sessionId}`);
        const data = await res.json();
        if (data.messages) {
            data.messages.forEach(msg => {
                appendMessage(msg.text, msg.sender);
            });
        }
    } catch (err) {
        appendMessage("⚠️ Error loading chat history.", "ai");
    }

    // If this session has a pending AI request, show the thinking indicator
    if (pendingSessions.has(sessionId)) {
        const indicator = createTypingIndicator();
        indicator.id = `typing-${sessionId}`;
        messagesDiv.appendChild(indicator);
        messagesDiv.scrollTo({ top: messagesDiv.scrollHeight, behavior: 'smooth' });
    }
}

// Start new chat
function startNewChat() {
    currentSessionId = null;
    saveCurrentSession();
    sessionTitle.textContent = "New Session";
    messagesDiv.innerHTML = "";
    chatTimeline.innerHTML = "";
    userMessageCount = 0;
    fetchSessions();
    
    if(window.innerWidth <= 768) closeSidebar();

    const wrapper = document.createElement("div");
    wrapper.className = "msg-wrapper ai";
    wrapper.innerHTML = `
        <div class="sender-name"><i class="ri-flashlight-fill"></i> Intellectra</div>
        <div class="msg-bubble">Assalamu alaikum! I am Intellectra. How can I assist you today? You can ask me questions or upload a document to discuss.</div>
    `;
    messagesDiv.appendChild(wrapper);
}

newChatBtn.addEventListener("click", startNewChat);

// Send Message
async function sendMessage() {
    const query = queryInput.value.trim();
    if (!query) return;
    
    appendMessage(query, "user");
    queryInput.value = "";
    queryInput.focus();

    const typingIndicator = createTypingIndicator();
    messagesDiv.appendChild(typingIndicator);
    messagesDiv.scrollTo({ top: messagesDiv.scrollHeight, behavior: 'smooth' });

    // Remember which session this request belongs to
    const requestSessionId = currentSessionId;
    pendingSessions.add(requestSessionId);

    try {
        const res = await fetch("http://127.0.0.1:5000/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: query, session_id: currentSessionId })
        });

        const data = await res.json();
        const responseSessionId = data.session_id || requestSessionId;

        // Clear pending state
        pendingSessions.delete(requestSessionId);
        pendingSessions.delete(responseSessionId);

        // Check if user is still on the same session
        if (currentSessionId === requestSessionId || currentSessionId === responseSessionId) {
            // Still on the same chat — update UI directly
            typingIndicator.remove();
            if (data.response) {
                appendMessage(data.response, "ai");
            }
            if (data.session_id && currentSessionId !== data.session_id) {
                currentSessionId = data.session_id;
                saveCurrentSession();
                sessionTitle.textContent = "Current Session";
            }
            fetchSessions();
        } else {
            // User switched to a different chat while AI was thinking.
            // The backend already saved the response to the DB.
            // Just remove any lingering indicator and refresh the sidebar.
            typingIndicator.remove();
            fetchSessions();
        }

    } catch (err) {
        pendingSessions.delete(requestSessionId);
        // Only show error if user is still on the same session
        if (currentSessionId === requestSessionId) {
            typingIndicator.remove();
            appendMessage("⚠️ Server not responding. Is the backend running?", "ai");
        }
    }
}

queryInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        sendMessage();
    }
});

sendBtn.addEventListener("click", sendMessage);

// File Upload Handling
attachBtn.addEventListener("click", () => {
    fileInput.click();
});

fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    appendMessage(`Uploading file: ${file.name}...`, "user");

    const formData = new FormData();
    formData.append("file", file);

    try {
        const res = await fetch("http://127.0.0.1:5000/api/upload", {
            method: "POST",
            body: formData
        });

        const data = await res.json();
        appendMessage(data.message || "⚠️ " + data.error, "ai");
    } catch (err) {
        appendMessage("⚠️ Upload failed. Server not responding.", "ai");
    }
    
    fileInput.value = '';
});

// Start app
init();
