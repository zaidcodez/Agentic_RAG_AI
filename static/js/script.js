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
const studyLevelBtn = document.getElementById("studyLevelBtn");
const studyLevelMenu = document.getElementById("studyLevelMenu");
const studyLevelItems = document.querySelectorAll("#studyLevelMenu .dropdown-item");
const plusBtn = document.getElementById("plusBtn");
const hiddenTools = document.getElementById("hiddenTools");
const modeSelectBtn = document.getElementById("modeSelectBtn");
const modeTextWrapper = document.getElementById("modeTextWrapper");
let isThinkingMode = false;

// Mobile Sidebar Elements
const menuBtn = document.getElementById("menuBtn");
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");

// Theme Toggle
const themeToggleBtn = document.getElementById("themeToggleBtn");
let currentTheme = localStorage.getItem('intellectra_theme') || 'dark';

// Apply saved theme on load
if (currentTheme === 'light') {
    document.body.setAttribute('data-theme', 'light');
    themeToggleBtn.className = 'ri-moon-line';
} else {
    document.body.removeAttribute('data-theme');
    themeToggleBtn.className = 'ri-sun-line';
}

themeToggleBtn.addEventListener("click", () => {
    if (currentTheme === 'dark') {
        currentTheme = 'light';
        document.body.setAttribute('data-theme', 'light');
        themeToggleBtn.className = 'ri-moon-line';
    } else {
        currentTheme = 'dark';
        document.body.removeAttribute('data-theme');
        themeToggleBtn.className = 'ri-sun-line';
    }
    localStorage.setItem('intellectra_theme', currentTheme);
});

let currentSessionId = null;
let userMessageCount = 0;
let currentStudyLevel = 'standard';
const pendingSessions = new Set(); // Track sessions with in-flight AI requests

let isGenerating = false;
let currentAbortController = null;

// Dropdown Logic
studyLevelBtn.addEventListener("click", (e) => {
    console.log("Study Mode button clicked!");
    e.stopPropagation();
    studyLevelMenu.classList.toggle("show");
});

document.addEventListener("click", (e) => {
    if (!e.target.closest('.custom-dropdown')) {
        studyLevelMenu.classList.remove("show");
    }
});

studyLevelItems.forEach(item => {
    item.addEventListener("click", () => {
        currentStudyLevel = item.dataset.value;
        studyLevelItems.forEach(i => i.classList.remove("active"));
        item.classList.add("active");
        studyLevelMenu.classList.remove("show");
        
        if (currentStudyLevel === 'eli5') {
            studyLevelBtn.innerHTML = '<i class="ri-seedling-line" style="color: #4ade80;"></i>';
            studyLevelBtn.title = "Study Mode: ELI5";
        } else if (currentStudyLevel === 'advanced') {
            studyLevelBtn.innerHTML = '<i class="ri-flask-line" style="color: #f87171;"></i>';
            studyLevelBtn.title = "Study Mode: Advanced";
        } else {
            studyLevelBtn.innerHTML = '<i class="ri-graduation-cap-line"></i>';
            studyLevelBtn.title = "Study Mode: Standard";
        }
    });
});

plusBtn.addEventListener("click", () => {
    plusBtn.classList.toggle("active");
    hiddenTools.classList.toggle("show");
});

modeSelectBtn.addEventListener("click", () => {
    if (isGenerating) return; // Prevent switching while generating
    
    const oldItem = modeTextWrapper.querySelector(".mode-text-item");
    const nextMode = isThinkingMode ? "Standard" : "Thinking";
    
    // Animate out
    oldItem.classList.add("slide-out");
    
    // Create and animate in
    const newItem = document.createElement("span");
    newItem.className = "mode-text-item slide-in";
    newItem.innerText = nextMode;
    modeTextWrapper.appendChild(newItem);
    
    isThinkingMode = !isThinkingMode;
    
    setTimeout(() => {
        oldItem.remove();
        newItem.classList.remove("slide-in");
    }, 400);
});

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

function appendMessage(text, sender, sources = [], messageId = null, widgets = []) {
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

    // Sources chips
    let sourcesHtml = "";
    if (sources && sources.length > 0) {
        sourcesHtml = `<div class="sources-container">
            <div class="sources-title">Sources:</div>
            ${sources.map(s => `<span class="source-chip"><i class="ri-file-list-2-line"></i> ${s}</span>`).join('')}
        </div>`;
    }

    // Flashcards & Quiz buttons for AI messages
    let actionsHtml = "";
    const bubbleId = `bubble-${Math.random().toString(36).substring(2, 9)}`;
    
    if (sender === 'ai' && text.length > 50 && !text.startsWith("⚠️") && !text.startsWith("Assalamu alaikum")) {
        const encodedText = text.replace(/"/g, '&quot;');
        
        const flashcardWidgets = widgets.filter(w => w.widget_type === 'flashcard');
        const quizWidgets = widgets.filter(w => w.widget_type === 'quiz');
        const conceptWidgets = widgets.filter(w => w.widget_type === 'concept_check');
        
        const totalMaterials = flashcardWidgets.length + quizWidgets.length + conceptWidgets.length;

        let viewMaterialsBtn = totalMaterials > 0 ? 
            `<button class="flashcard-subtle-btn view-btn" id="view-materials-btn-${bubbleId}" onclick="toggleMaterials('${bubbleId}')" title="Review Materials">
                <i class="ri-eye-line"></i> Review Materials (<span id="materials-count-${bubbleId}">${totalMaterials}</span>)
            </button>` : "";

        actionsHtml = `
            <div class="msg-actions">
                <button class="flashcard-subtle-btn" data-text="${encodedText}" onclick="generateFlashcards('${bubbleId}', this.dataset.text, ${messageId})" id="btn-flashcard-${bubbleId}" title="Generate Flashcards">
                    <i class="ri-stack-line"></i> Flashcards
                </button>
                <button class="flashcard-subtle-btn" data-text="${encodedText}" onclick="generateQuiz('${bubbleId}', this.dataset.text, ${messageId})" id="btn-quiz-${bubbleId}" title="Generate Quiz">
                    <i class="ri-questionnaire-line"></i> Quiz
                </button>
                <button class="flashcard-subtle-btn" data-text="${encodedText}" onclick="pinContext('${bubbleId}', this.dataset.text, ${messageId})" id="btn-pin-${bubbleId}" title="Pin Context">
                    <i class="ri-pushpin-line"></i> Pin Context
                </button>
                ${viewMaterialsBtn}
            </div>
            
            <div id="materials-container-${bubbleId}" class="materials-container widget-display-container" style="display: none;">
                <div class="materials-tabs">
                    <button class="material-tab active" onclick="switchMaterialTab('${bubbleId}', 'flashcards')" id="tab-flashcards-${bubbleId}">Flashcards</button>
                    <button class="material-tab" onclick="switchMaterialTab('${bubbleId}', 'quiz')" id="tab-quiz-${bubbleId}">Quizzes</button>
                    <button class="material-tab" onclick="switchMaterialTab('${bubbleId}', 'concept')" id="tab-concept-${bubbleId}">Concept Checks</button>
                </div>
                <div id="flashcards-container-${bubbleId}" class="material-content" style="display: block;"></div>
                <div id="quiz-container-${bubbleId}" class="material-content" style="display: none;"></div>
                <div id="concept-container-${bubbleId}" class="material-content" style="display: none;"></div>
            </div>
        `;
    }

    wrapper.innerHTML = `
        ${nameHtml}
        <div class="msg-bubble" id="${bubbleId}">
            ${formattedText}${sourcesHtml}
            ${actionsHtml}
        </div>
    `;
    
    messagesDiv.appendChild(wrapper);
    messagesDiv.scrollTo({ top: messagesDiv.scrollHeight, behavior: 'smooth' });

    // Render saved widgets if any
    if (sender === 'ai') {
        const fContainer = document.getElementById(`flashcards-container-${bubbleId}`);
        const qContainer = document.getElementById(`quiz-container-${bubbleId}`);
        const cContainer = document.getElementById(`concept-container-${bubbleId}`);
        if (fContainer && widgets.filter(w => w.widget_type === 'flashcard').length > 0) {
            renderSavedFlashcards(widgets.filter(w => w.widget_type === 'flashcard'), fContainer);
        }
        if (qContainer && widgets.filter(w => w.widget_type === 'quiz').length > 0) {
            renderSavedQuizzes(widgets.filter(w => w.widget_type === 'quiz'), qContainer);
        }
        if (cContainer && widgets.filter(w => w.widget_type === 'concept_check').length > 0) {
            renderSavedConceptChecks(widgets.filter(w => w.widget_type === 'concept_check'), cContainer);
        }
    }
}

window.toggleMaterials = function(bubbleId) {
    const container = document.getElementById(`materials-container-${bubbleId}`);
    if (container) {
        if (container.style.display === 'none') {
            container.style.display = 'block';
            container.classList.add('fade-in');
        } else {
            container.style.display = 'none';
        }
    }
};

window.switchMaterialTab = function(bubbleId, tabName) {
    const tabs = ['flashcards', 'quiz', 'concept'];
    tabs.forEach(t => {
        const tabBtn = document.getElementById(`tab-${t}-${bubbleId}`);
        const content = document.getElementById(`${t}-container-${bubbleId}`);
        if (tabBtn && content) {
            if (t === tabName) {
                tabBtn.classList.add('active');
                content.style.display = 'block';
            } else {
                tabBtn.classList.remove('active');
                content.style.display = 'none';
            }
        }
    });
};

function updateWidgetCountBtn(bubbleId) {
    const materialsContainer = document.getElementById(`materials-container-${bubbleId}`);
    if (!materialsContainer) return;
    
    let totalCount = 0;
    const fContainer = document.getElementById(`flashcards-container-${bubbleId}`);
    const qContainer = document.getElementById(`quiz-container-${bubbleId}`);
    const cContainer = document.getElementById(`concept-container-${bubbleId}`);
    
    if (fContainer) totalCount += fContainer.querySelectorAll('.widget-set').length;
    if (qContainer) totalCount += qContainer.querySelectorAll('.widget-set').length;
    if (cContainer) totalCount += cContainer.querySelectorAll('.widget-set').length;
    
    let btn = document.getElementById(`view-materials-btn-${bubbleId}`);
    
    if (totalCount > 0) {
        if (!btn) {
            const actions = materialsContainer.previousElementSibling; 
            btn = document.createElement("button");
            btn.className = "flashcard-subtle-btn view-btn";
            btn.id = `view-materials-btn-${bubbleId}`;
            btn.onclick = () => toggleMaterials(bubbleId);
            actions.appendChild(btn);
        }
        btn.innerHTML = `<i class="ri-eye-line"></i> Review Materials (<span id="materials-count-${bubbleId}">${totalCount}</span>)`;
    }
}

// ------------------------------------
// Flashcard Logic
// ------------------------------------
async function generateFlashcards(bubbleId, text, messageId) {
    if (!messageId) {
        alert("Cannot generate flashcards for an unsaved message.");
        return;
    }
    const btn = document.getElementById(`btn-flashcard-${bubbleId}`);
    const container = document.getElementById(`flashcards-container-${bubbleId}`);
    if (!btn || !container) return;

    if (container.querySelectorAll('.widget-set').length >= 5) {
        alert("Maximum limit reached: You can only generate up to 5 flashcard sets per message.");
        return;
    }

    const originalHtml = btn.innerHTML;
    btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i>`;
    btn.disabled = true;
    btn.classList.add("loading");

    try {
        const res = await fetch("http://127.0.0.1:5000/api/flashcards", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text, message_id: messageId })
        });
        
        const data = await res.json();
        
        if (data.flashcards && data.flashcards.length > 0) {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
            btn.classList.remove("loading");
            
            // Append the new widget
            const newWidget = { id: data.widget_id, data: data.flashcards };
            container.style.display = 'block'; // auto open
            appendSavedFlashcard(newWidget, container);
        } else {
            btn.innerHTML = `<i class="ri-error-warning-line"></i> Retry`;
            btn.disabled = false;
            btn.classList.remove("loading");
        }
    } catch (err) {
        console.error(err);
        btn.innerHTML = `<i class="ri-error-warning-line"></i> Retry`;
        btn.disabled = false;
        btn.classList.remove("loading");
    }
}

function renderSavedFlashcards(widgets, container) {
    container.innerHTML = '';
    widgets.forEach((w, idx) => {
        appendSavedFlashcard(w, container, idx + 1);
    });
}

function appendSavedFlashcard(widget, container, setNumber = null) {
    const setNum = setNumber || (container.querySelectorAll('.widget-set').length + 1);
    const div = document.createElement('div');
    div.className = 'widget-set';
    div.innerHTML = `<div class="widget-set-title">Flashcard Set ${setNum}</div><div id="fc-set-${widget.id}"></div>`;
    container.appendChild(div);
    renderFlashcards(widget.data, document.getElementById(`fc-set-${widget.id}`));
    
    const bubbleId = container.id.replace('flashcards-container-', '');
    updateWidgetCountBtn(bubbleId);
}

function renderFlashcards(cards, container, startIndex = 0) {
    let currentIndex = startIndex;

    const renderCard = () => {
        const card = cards[currentIndex];
        container.innerHTML = `
            <div class="flashcard-container">
                <div class="flashcard-indicator">Card ${currentIndex + 1} of ${cards.length}</div>
                <div class="flashcard" onclick="this.classList.toggle('flipped')">
                    <div class="flashcard-inner">
                        <div class="flashcard-front">${card.front}</div>
                        <div class="flashcard-back">${card.back}</div>
                    </div>
                </div>
                <div class="flashcard-controls">
                    <button onclick="changeFlashcard(event, -1, '${container.id}')" ${currentIndex === 0 ? 'disabled style="opacity:0.5"' : ''}>
                        <i class="ri-arrow-left-s-line"></i> Prev
                    </button>
                    <span style="font-size: 0.8rem; color: var(--text-muted);">Click card to flip</span>
                    <button onclick="changeFlashcard(event, 1, '${container.id}')" ${currentIndex === cards.length - 1 ? 'disabled style="opacity:0.5"' : ''}>
                        Next <i class="ri-arrow-right-s-line"></i>
                    </button>
                </div>
            </div>
        `;
        
        // Store state on container
        container.dataset.currentIndex = currentIndex;
        container.dataset.cards = JSON.stringify(cards);
    };

    renderCard();
}

window.changeFlashcard = function(event, direction, containerId) {
    event.stopPropagation();
    const container = document.getElementById(containerId);
    if (!container) return;
    
    let currentIndex = parseInt(container.dataset.currentIndex);
    const cards = JSON.parse(container.dataset.cards);
    
    currentIndex += direction;
    if (currentIndex >= 0 && currentIndex < cards.length) {
        // Render with new index
        renderFlashcards(cards, container, currentIndex);
    }
};

// ------------------------------------
// Quiz Logic
// ------------------------------------
async function generateQuiz(bubbleId, text, messageId) {
    if (!messageId) {
        alert("Cannot generate quiz for an unsaved message.");
        return;
    }
    const btn = document.getElementById(`btn-quiz-${bubbleId}`);
    const container = document.getElementById(`quiz-container-${bubbleId}`);
    if (!btn || !container) return;

    if (container.querySelectorAll('.widget-set').length >= 5) {
        alert("Maximum limit reached: You can only generate up to 5 quiz sets per message.");
        return;
    }

    const originalHtml = btn.innerHTML;
    btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i>`;
    btn.disabled = true;
    btn.classList.add("loading");

    try {
        const res = await fetch("http://127.0.0.1:5000/api/quiz", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text, message_id: messageId })
        });
        
        const data = await res.json();
        
        if (data.quiz && data.quiz.length > 0) {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
            btn.classList.remove("loading");
            
            const newWidget = { id: data.widget_id, data: data.quiz, state: null };
            container.style.display = 'block';
            appendSavedQuiz(newWidget, container);
        } else {
            btn.innerHTML = `<i class="ri-error-warning-line"></i> Retry`;
            btn.disabled = false;
            btn.classList.remove("loading");
        }
    } catch (err) {
        console.error(err);
        btn.innerHTML = `<i class="ri-error-warning-line"></i> Retry`;
        btn.disabled = false;
        btn.classList.remove("loading");
    }
}

function renderSavedQuizzes(widgets, container) {
    container.innerHTML = '';
    widgets.forEach((w, idx) => {
        appendSavedQuiz(w, container, idx + 1);
    });
}

function appendSavedQuiz(widget, container, setNumber = null) {
    const setNum = setNumber || (container.querySelectorAll('.widget-set').length + 1);
    const div = document.createElement('div');
    div.className = 'widget-set';
    div.innerHTML = `<div class="widget-set-title">Quiz Set ${setNum}</div><div id="qz-set-${widget.id}"></div>`;
    container.appendChild(div);
    
    if (widget.state && widget.state.completed) {
        renderQuiz(widget.data, document.getElementById(`qz-set-${widget.id}`), 0, widget.id, widget.state.userAnswers, widget.state.score, true);
    } else {
        renderQuiz(widget.data, document.getElementById(`qz-set-${widget.id}`), 0, widget.id);
    }
    
    const bubbleId = container.id.replace('quiz-container-', '');
    updateWidgetCountBtn(bubbleId);
}

function renderQuiz(questions, container, currentIndex = 0, widgetId = null, userAnswers = [], score = 0, isReviewMode = false) {
    if (currentIndex >= questions.length) {
        let retakeBtnHtml = isReviewMode ? 
            `<button class="flashcard-subtle-btn" style="margin-top:15px; border-color: rgba(255,255,255,0.2);" onclick="renderQuiz(JSON.parse(this.dataset.questions), document.getElementById('${container.id}'), 0, ${widgetId}, [], 0, false)" data-questions='${JSON.stringify(questions).replace(/'/g, "&apos;")}'>
                <i class="ri-refresh-line"></i> Retake Quiz
            </button>` :
            `<button class="flashcard-subtle-btn" style="margin-top:15px; border-color: rgba(255,255,255,0.2);" onclick="renderQuiz(JSON.parse(this.dataset.questions), document.getElementById('${container.id}'), 0, ${widgetId}, JSON.parse('${JSON.stringify(userAnswers)}'), ${score}, true)" data-questions='${JSON.stringify(questions).replace(/'/g, "&apos;")}'>
                <i class="ri-eye-line"></i> Review Answers
            </button>`;

        container.innerHTML = `
            <div class="quiz-container">
                <div class="quiz-completed" style="text-align: center; padding: 20px;">
                    <i class="ri-check-double-line" style="font-size: 2.5rem; color: #4ade80;"></i>
                    <p style="margin-top: 10px; font-weight: 500;">Quiz Completed!</p>
                    <p style="font-size: 1.2rem; margin-top: 10px; color: var(--primary-accent);">Score: ${score} / ${questions.length}</p>
                    ${retakeBtnHtml}
                </div>
            </div>
        `;
        
        if (widgetId && !isReviewMode) {
            const state = { completed: true, score: score, total: questions.length, userAnswers: userAnswers };
            fetch(`http://127.0.0.1:5000/api/widgets/${widgetId}/state`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(state)
            }).catch(e => console.error(e));
        }
        return;
    }

    const q = questions[currentIndex];
    let optionsHtml = '';
    
    const userSelectedIdx = isReviewMode ? userAnswers[currentIndex] : null;

    q.options.forEach((opt, idx) => {
        let cls = "quiz-option";
        
        if (isReviewMode) {
            if (idx === q.answer) cls += " correct";
            else if (idx === userSelectedIdx && idx !== q.answer) cls += " incorrect";
        }
        
        optionsHtml += `
            <div class="${cls}" onclick="${isReviewMode ? '' : `checkQuizAnswer(this, ${idx}, ${q.answer}, '${container.id}')`}">
                ${opt}
            </div>
        `;
    });

    let navControls = '';
    if (isReviewMode) {
        navControls = `
            <button onclick="changeQuizQuestion('${container.id}', -1)" ${currentIndex === 0 ? 'disabled style="opacity:0.5"' : ''}><i class="ri-arrow-left-s-line"></i> Prev</button>
            <div style="flex:1"></div>
            <button onclick="changeQuizQuestion('${container.id}', 1)">Next <i class="ri-arrow-right-s-line"></i></button>
        `;
    } else {
        navControls = `
            <div style="flex:1"></div>
            <button onclick="changeQuizQuestion('${container.id}', 1)">Next <i class="ri-arrow-right-s-line"></i></button>
        `;
    }

    container.innerHTML = `
        <div class="quiz-container">
            <div class="quiz-indicator">${isReviewMode ? 'Reviewing ' : ''}Question ${currentIndex + 1} of ${questions.length}</div>
            <div class="quiz-question">${q.question}</div>
            <div class="quiz-options ${isReviewMode ? 'answered' : ''}">
                ${optionsHtml}
            </div>
            <div class="quiz-controls" style="${isReviewMode ? 'display: flex;' : 'display: none;'}">
                ${navControls}
            </div>
        </div>
    `;
    
    container.dataset.currentIndex = currentIndex;
    container.dataset.questions = JSON.stringify(questions);
    container.dataset.widgetId = widgetId;
    container.dataset.userAnswers = JSON.stringify(userAnswers);
    container.dataset.score = score;
    container.dataset.isReviewMode = isReviewMode;
}

window.checkQuizAnswer = function(element, selectedIdx, correctIdx, containerId) {
    if (element.parentNode.classList.contains('answered')) return;
    
    const options = element.parentNode.querySelectorAll('.quiz-option');
    element.parentNode.classList.add('answered');
    
    const container = document.getElementById(containerId);
    let userAnswers = JSON.parse(container.dataset.userAnswers || "[]");
    userAnswers.push(selectedIdx);
    container.dataset.userAnswers = JSON.stringify(userAnswers);
    
    if (selectedIdx === correctIdx) {
        element.classList.add('correct');
        container.dataset.score = parseInt(container.dataset.score || 0) + 1;
    } else {
        element.classList.add('incorrect');
        options[correctIdx].classList.add('correct');
    }
    
    const controls = container.querySelector('.quiz-controls');
    if (controls) controls.style.display = 'flex';
};

window.changeQuizQuestion = function(containerId, direction) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    let currentIndex = parseInt(container.dataset.currentIndex);
    const questions = JSON.parse(container.dataset.questions);
    const widgetId = container.dataset.widgetId !== "null" ? parseInt(container.dataset.widgetId) : null;
    const userAnswers = JSON.parse(container.dataset.userAnswers || "[]");
    const score = parseInt(container.dataset.score || 0);
    const isReviewMode = container.dataset.isReviewMode === 'true';
    
    currentIndex += direction;
    renderQuiz(questions, container, currentIndex, widgetId, userAnswers, score, isReviewMode);
};

// ------------------------------------
// Concept Check Logic
// ------------------------------------
let pinnedContexts = [];

window.pinContext = function(bubbleId, text, messageId) {
    if (pinnedContexts.length >= 2) {
        alert("You can only pin up to 2 messages for context.");
        return;
    }
    if (pinnedContexts.find(p => p.messageId === messageId)) return;
    
    pinnedContexts.push({ bubbleId, text, messageId });
    renderPinnedContexts();
};

window.unpinContext = function(messageId) {
    pinnedContexts = pinnedContexts.filter(p => p.messageId !== messageId);
    renderPinnedContexts();
};

function renderPinnedContexts() {
    const container = document.getElementById("pinned-context-container");
    if (!container) return;
    
    if (pinnedContexts.length === 0) {
        container.style.display = "none";
        container.innerHTML = "";
        return;
    }
    
    container.style.display = "flex";
    container.innerHTML = pinnedContexts.map(p => `
        <div class="pinned-bubble">
            <div class="pinned-text">${p.text.substring(0, 60)}${p.text.length > 60 ? '...' : ''}</div>
            <button onclick="unpinContext(${p.messageId})"><i class="ri-close-line"></i></button>
        </div>
    `).join("");
}

window.triggerGlobalConceptCheck = async function() {
    const queryInput = document.getElementById('query');
    const sendBtn = document.getElementById('sendBtn');
    const text = queryInput.value.trim();
    
    if (pinnedContexts.length === 0 && !text) {
        // Just return, do not send empty message
        return;
    }

    let combinedText = pinnedContexts.map(p => p.text).join("\n\n");
    if (text) {
        combinedText += (combinedText ? "\n\nAdditional Context:\n" : "") + text;
    }
    
    const btn = document.getElementById('globalConceptCheckBtn');
    const originalText = btn.innerText;
    btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> Checking...`;
    btn.style.pointerEvents = "none";
    queryInput.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    
    try {
        const res = await fetch("http://127.0.0.1:5000/api/concept_check/generate_global", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: combinedText, session_id: currentSessionId })
        });
        
        const data = await res.json();
        
        if (data.error) {
            btn.innerText = originalText;
            btn.style.pointerEvents = "auto";
            queryInput.disabled = false;
            if (sendBtn) sendBtn.disabled = false;
            appendSystemMessage(data.error);
            return;
        }
        
        if (data.questions && data.questions.length > 0) {
            btn.innerText = originalText;
            btn.style.pointerEvents = "auto";
            queryInput.disabled = false;
            if (sendBtn) sendBtn.disabled = false;
            
            queryInput.value = "";
            pinnedContexts = [];
            renderPinnedContexts();
            
            await loadSession(currentSessionId);
            
            setTimeout(() => {
                const bubbles = document.querySelectorAll('.msg-bubble');
                if (bubbles.length > 0) {
                    const lastBubbleId = bubbles[bubbles.length - 1].id;
                    const materialsContainer = document.getElementById(`materials-container-${lastBubbleId}`);
                    if (materialsContainer) {
                        materialsContainer.style.display = 'block';
                        switchMaterialTab(lastBubbleId, 'concept');
                    }
                }
            }, 500);
        }
    } catch (err) {
        console.error(err);
        btn.innerText = originalText;
        btn.style.pointerEvents = "auto";
        queryInput.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
    }
};

function appendSystemMessage(text) {
    const wrapper = document.createElement('div');
    wrapper.className = 'msg-wrapper msg-ai fade-in';
    wrapper.innerHTML = `
        <div class="msg-name">System</div>
        <div class="msg-bubble" style="background: rgba(248, 113, 113, 0.1); border-color: #f87171; color: #f87171;">
            ${text}
        </div>
    `;
    const messagesDiv = document.getElementById("messages");
    messagesDiv.appendChild(wrapper);
    messagesDiv.scrollTo({ top: messagesDiv.scrollHeight, behavior: 'smooth' });
}

window.renderSavedConceptChecks = function(widgets, container) {
    container.innerHTML = '';
    widgets.forEach((w, idx) => {
        appendSavedConceptCheck(w, container, idx + 1);
    });
};

window.appendSavedConceptCheck = function(widget, container, setNumber = null) {
    const setNum = setNumber || (container.querySelectorAll('.widget-set').length + 1);
    const div = document.createElement('div');
    div.className = 'widget-set';
    div.innerHTML = `<div class="widget-set-title">Concept Check ${setNum}</div><div id="cc-set-${widget.id}"></div>`;
    container.appendChild(div);
    
    // Determine state
    const isReviewMode = widget.state && widget.state.completed;
    const userAnswers = isReviewMode ? widget.state.userAnswers : [];
    
    renderConceptCheck(widget.data, document.getElementById(`cc-set-${widget.id}`), 0, widget.id, userAnswers, isReviewMode, widget.text || "");
    
    const bubbleId = container.id.replace('concept-container-', '');
    updateWidgetCountBtn(bubbleId);
};

window.renderConceptCheck = function(questions, container, currentIndex = 0, widgetId = null, userAnswers = [], isReviewMode = false, originalText = "") {
    if (currentIndex >= questions.length) {
        let retakeBtnHtml = isReviewMode ? 
            `<button class="flashcard-subtle-btn" style="margin-top:15px; width: 100%; justify-content:center;" onclick="renderConceptCheck(JSON.parse(this.dataset.q), document.getElementById('${container.id}'), 0, ${widgetId}, [], false, '${originalText.replace(/'/g, "\\'")}')" data-q='${JSON.stringify(questions).replace(/'/g, "\\'")}'>
                <i class="ri-refresh-line"></i> Retake
            </button>` : '';

        container.innerHTML = `
            <div class="quiz-container">
                <div class="quiz-completed" style="text-align: center; padding: 20px;">
                    <i class="ri-check-double-line" style="font-size: 2.5rem; color: #4ade80;"></i>
                    <p style="margin-top: 10px; font-weight: 500;">Evaluation Complete!</p>
                    <p style="font-size: 0.9rem; margin-top: 10px; color: var(--text-muted);">Please check the chat for Intellectra's tailored explanation.</p>
                    ${retakeBtnHtml}
                </div>
            </div>
        `;
        return;
    }

    const q = questions[currentIndex];
    
    // Ensure userAnswers array is initialized for current index
    if (userAnswers.length <= currentIndex) {
        userAnswers.push("");
    }

    let inputHtml = '';
    if (isReviewMode) {
        inputHtml = `
            <div style="background: var(--bg-color); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); color: var(--text-muted); font-size: 0.9rem;">
                <strong>Your Answer:</strong><br>
                ${userAnswers[currentIndex] || "<em>No answer provided</em>"}
            </div>
        `;
    } else {
        inputHtml = `
            <textarea class="concept-textarea" id="cc-input-${container.id}" placeholder="Type your explanation here..." oninput="updateConceptAnswer('${container.id}', ${currentIndex}, this.value)">${userAnswers[currentIndex]}</textarea>
        `;
    }

    let navControls = '';
    if (currentIndex > 0) {
        navControls += `<button onclick="changeConceptQuestion('${container.id}', -1)"><i class="ri-arrow-left-s-line"></i> Prev</button>`;
    } else {
        navControls += `<button disabled style="opacity:0.5"><i class="ri-arrow-left-s-line"></i> Prev</button>`;
    }
    
    navControls += `<div style="flex:1"></div>`;
    
    if (currentIndex < questions.length - 1) {
        navControls += `<button onclick="changeConceptQuestion('${container.id}', 1)">Next <i class="ri-arrow-right-s-line"></i></button>`;
    } else {
        if (isReviewMode) {
             navControls += `<button onclick="changeConceptQuestion('${container.id}', 1)">Finish <i class="ri-check-line"></i></button>`;
        } else {
             navControls += `<button onclick="submitConceptCheck('${container.id}')" class="submit-btn">Submit Answers <i class="ri-send-plane-fill"></i></button>`;
        }
    }

    container.innerHTML = `
        <div class="quiz-container">
            <div class="quiz-indicator">${isReviewMode ? 'Reviewing ' : ''}Diagnostic ${currentIndex + 1} of ${questions.length}</div>
            <div class="quiz-question">${q.question}</div>
            <div style="margin-bottom: 15px;">
                ${inputHtml}
            </div>
            <div class="quiz-controls" style="display: flex;">
                ${navControls}
            </div>
        </div>
    `;
    
    container.dataset.currentIndex = currentIndex;
    container.dataset.questions = JSON.stringify(questions);
    container.dataset.widgetId = widgetId;
    container.dataset.userAnswers = JSON.stringify(userAnswers);
    container.dataset.isReviewMode = isReviewMode;
    container.dataset.originalText = encodeURIComponent(originalText);
};

window.updateConceptAnswer = function(containerId, index, value) {
    const container = document.getElementById(containerId);
    let userAnswers = JSON.parse(container.dataset.userAnswers || "[]");
    userAnswers[index] = value;
    container.dataset.userAnswers = JSON.stringify(userAnswers);
};

window.changeConceptQuestion = function(containerId, direction) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    let currentIndex = parseInt(container.dataset.currentIndex);
    const questions = JSON.parse(container.dataset.questions);
    const widgetId = container.dataset.widgetId !== "null" ? parseInt(container.dataset.widgetId) : null;
    const userAnswers = JSON.parse(container.dataset.userAnswers || "[]");
    const isReviewMode = container.dataset.isReviewMode === 'true';
    const originalText = decodeURIComponent(container.dataset.originalText || "");
    
    currentIndex += direction;
    renderConceptCheck(questions, container, currentIndex, widgetId, userAnswers, isReviewMode, originalText);
};

window.submitConceptCheck = async function(containerId) {
    const container = document.getElementById(containerId);
    const btn = container.querySelector('.submit-btn');
    const queryInput = document.getElementById('query');
    const sendBtn = document.getElementById('sendBtn');
    
    if (btn) {
        btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> Evaluating...`;
        btn.disabled = true;
    }
    
    // Disable main chat input during evaluation
    if (queryInput) queryInput.disabled = true;
    if (sendBtn) sendBtn.disabled = true;

    const questions = JSON.parse(container.dataset.questions).map(q => q.question);
    const userAnswers = JSON.parse(container.dataset.userAnswers || "[]");
    const widgetId = container.dataset.widgetId !== "null" ? parseInt(container.dataset.widgetId) : null;
    const originalText = decodeURIComponent(container.dataset.originalText || "");

    try {
        const res = await fetch("http://127.0.0.1:5000/api/concept_check/evaluate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                session_id: currentSessionId, 
                questions: questions,
                answers: userAnswers,
                original_text: originalText
            })
        });
        
        const data = await res.json();
        
        if (data.evaluation) {
            if (widgetId) {
                const state = { completed: true, userAnswers: userAnswers };
                await fetch(`http://127.0.0.1:5000/api/widgets/${widgetId}/state`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(state)
                });
            }
            
            // Re-render to show completion
            const qs = JSON.parse(container.dataset.questions);
            renderConceptCheck(qs, container, qs.length, widgetId, userAnswers, true, originalText);
            
            // Inject new messages manually so we don't reset the open UI widgets
            // appendMessage signature: (text, sender, sources = [], messageId = null, widgets = [])
            appendMessage("I have submitted my answers to the concept check.", "user", [], null, []);
            appendMessage(data.evaluation, "ai", [], data.message_id, []);
            
            // Re-enable chat input
            if (queryInput) queryInput.disabled = false;
            if (sendBtn) sendBtn.disabled = false;
        } else {
            alert("Error evaluating answers.");
            if (btn) { btn.innerHTML = `Submit Answers <i class="ri-send-plane-fill"></i>`; btn.disabled = false; }
            if (queryInput) queryInput.disabled = false;
            if (sendBtn) sendBtn.disabled = false;
        }
    } catch (err) {
        console.error(err);
        alert("Error submitting concept check.");
        if (btn) { btn.innerHTML = `Submit Answers <i class="ri-send-plane-fill"></i>`; btn.disabled = false; }
        if (queryInput) queryInput.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
    }
};

// Fetch session history list
async function fetchSessions() {
    try {
        const res = await fetch("http://127.0.0.1:5000/api/sessions");
        const data = await res.json();
        
        historyList.innerHTML = '';
        
        if (data.sessions && data.sessions.length > 0) {
            const grouped = {};
            data.sessions.forEach(session => {
                let dateStr = "Older";
                if (session.created_at) {
                    // SQLite CURRENT_TIMESTAMP is UTC
                    const d = new Date(session.created_at + 'Z');
                    if (!isNaN(d)) {
                        const today = new Date();
                        const isToday = d.toDateString() === today.toDateString();
                        const yesterday = new Date();
                        yesterday.setDate(yesterday.getDate() - 1);
                        const isYesterday = d.toDateString() === yesterday.toDateString();
                        
                        const daysAgo = Math.floor((today - d) / (1000 * 60 * 60 * 24));
                        
                        if (isToday) dateStr = "Today";
                        else if (isYesterday) dateStr = "Yesterday";
                        else if (daysAgo < 7) dateStr = "Previous 7 Days";
                        else dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                    }
                }
                
                if (!grouped[dateStr]) grouped[dateStr] = [];
                grouped[dateStr].push(session);
            });
            
            for (const [dateGroup, sessions] of Object.entries(grouped)) {
                const header = document.createElement("div");
                header.className = "history-date-header";
                header.textContent = dateGroup;
                historyList.appendChild(header);
                
                sessions.forEach(session => {
                    const div = document.createElement("div");
                    div.className = "history-item";
                    div.dataset.sessionId = String(session.id);
                    if (session.id === currentSessionId) div.classList.add("active");
                    
                    div.innerHTML = `
                        <div class="history-item-title">${session.title}</div>
                        <div class="chat-menu-container">
                            <div class="chat-options-btn" onclick="toggleChatMenu(event, ${session.id})">
                                <i class="ri-more-2-fill"></i>
                            </div>
                            <div class="chat-menu" id="chat-menu-${session.id}">
                                <div class="chat-menu-item" onclick="deleteSession(event, ${session.id})">
                                    <i class="ri-delete-bin-line"></i> Delete
                                </div>
                            </div>
                        </div>
                    `;
                    
                    div.onclick = (e) => {
                        if (e.target.closest('.chat-menu-container')) return;
                        loadSession(session.id, session.title);
                        if(window.innerWidth <= 768) closeSidebar();
                    };
                    historyList.appendChild(div);
                });
            }
        } else {
             historyList.innerHTML = `<div style="padding: 20px; text-align:center; color: var(--text-muted); font-size: 0.9rem;">No chats yet</div>`;
        }
    } catch (err) {
        console.error("Error fetching sessions:", err);
    }
}

window.toggleChatMenu = function(event, sessionId) {
    event.stopPropagation();
    const allMenus = document.querySelectorAll('.chat-menu');
    const targetMenu = document.getElementById(`chat-menu-${sessionId}`);
    
    // Close others
    allMenus.forEach(menu => {
        if (menu !== targetMenu) menu.classList.remove('show');
    });
    
    // Toggle target
    targetMenu.classList.toggle('show');
    event.currentTarget.classList.toggle('active', targetMenu.classList.contains('show'));
};

// Close chat menus on outside click
document.addEventListener('click', (e) => {
    if (!e.target.closest('.chat-menu-container')) {
        document.querySelectorAll('.chat-menu').forEach(m => m.classList.remove('show'));
        document.querySelectorAll('.chat-options-btn').forEach(b => b.classList.remove('active'));
    }
});

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
                appendMessage(msg.text, msg.sender, [], msg.id, msg.widgets || []);
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

    // Restore the welcome message
    const wrapper = document.createElement("div");
    wrapper.className = "msg-wrapper ai";
    wrapper.innerHTML = `
        <div class="sender-name"><i class="ri-flashlight-fill"></i> Intellectra</div>
        <div class="msg-bubble">Assalamu alaikum! I am Intellectra. How can I assist you today? You can ask me questions or upload a document to discuss.</div>
    `;
    messagesDiv.appendChild(wrapper);
}

// Delete session
async function deleteSession(event, sessionId) {
    event.stopPropagation(); // Don't trigger the chat load
    if (!confirm("Are you sure you want to delete this chat?")) return;

    try {
        const res = await fetch(`http://127.0.0.1:5000/api/sessions/${sessionId}`, {
            method: 'DELETE'
        });
        
        if (res.ok) {
            // If the deleted session is the currently active one, start a new chat
            if (currentSessionId === sessionId) {
                startNewChat();
            } else {
                fetchSessions(); // Just refresh the list
            }
        } else {
            console.error("Failed to delete session");
        }
    } catch (err) {
        console.error("Error deleting session:", err);
    }
}

newChatBtn.addEventListener("click", startNewChat);

// Stop Generation
function stopGeneration() {
    if (currentAbortController) {
        currentAbortController.abort();
    }
}

// Create an empty AI message container for streaming
function createAiStreamContainer() {
    const wrapper = document.createElement("div");
    wrapper.className = "msg-wrapper ai";
    const bubbleId = `bubble-${Math.random().toString(36).substring(2, 9)}`;
    wrapper.innerHTML = `
        <div class="sender-name"><i class="ri-flashlight-fill"></i> Intellectra</div>
        <div class="msg-bubble" id="${bubbleId}">
            <div class="stream-content"></div>
            <div class="sources-placeholder"></div>
        </div>
    `;
    return { wrapper, bubbleId };
}

// Update the streaming content
function updateStreamContent(bubbleId, text, sources = []) {
    const bubble = document.getElementById(bubbleId);
    if (!bubble) return;
    const contentDiv = bubble.querySelector(".stream-content");
    const sourcesDiv = bubble.querySelector(".sources-placeholder");
    
    // During streaming, dynamically render Markdown so formatting is live
    contentDiv.innerHTML = renderMarkdownWithMath(text);
    
    if (sources && sources.length > 0 && sourcesDiv.innerHTML === "") {
        sourcesDiv.innerHTML = `<div class="sources-container">
            <div class="sources-title">Sources:</div>
            ${sources.map(s => `<span class="source-chip"><i class="ri-file-list-2-line"></i> ${s}</span>`).join('')}
        </div>`;
    }
}

// Finalize the AI message (apply Markdown, KaTeX, and add action buttons)
function finalizeStreamContent(bubbleId, text, sources, messageId) {
    const bubble = document.getElementById(bubbleId);
    if (!bubble) return;
    
    // Apply full formatting
    const formattedHtml = renderMarkdownWithMath(text);
    
    let sourcesHtml = "";
    if (sources && sources.length > 0) {
        sourcesHtml = `<div class="sources-container">
            <div class="sources-title">Sources:</div>
            ${sources.map(s => `<span class="source-chip"><i class="ri-file-list-2-line"></i> ${s}</span>`).join('')}
        </div>`;
    }

    // Add action buttons (flashcards, quiz)
    let actionsHtml = "";
    if (text.length > 50 && !text.startsWith("⚠️") && !text.startsWith("Assalamu alaikum")) {
        const encodedText = text.replace(/"/g, '&quot;');
        actionsHtml = `
            <div class="msg-actions">
                <button class="flashcard-subtle-btn" data-text="${encodedText}" onclick="generateFlashcards('${bubbleId}', this.dataset.text, ${messageId})" id="btn-flashcard-${bubbleId}" title="Generate Flashcards">
                    <i class="ri-stack-line"></i> Flashcards
                </button>
                <button class="flashcard-subtle-btn" data-text="${encodedText}" onclick="generateQuiz('${bubbleId}', this.dataset.text, ${messageId})" id="btn-quiz-${bubbleId}" title="Generate Quiz">
                    <i class="ri-questionnaire-line"></i> Quiz
                </button>
                <button class="flashcard-subtle-btn" data-text="${encodedText}" onclick="pinContext('${bubbleId}', this.dataset.text, ${messageId})" id="btn-pin-${bubbleId}" title="Pin Context">
                    <i class="ri-pushpin-line"></i> Pin Context
                </button>
            </div>
            
            <div id="materials-container-${bubbleId}" class="materials-container widget-display-container" style="display: none;">
                <div class="materials-tabs">
                    <button class="material-tab active" onclick="switchMaterialTab('${bubbleId}', 'flashcards')" id="tab-flashcards-${bubbleId}">Flashcards</button>
                    <button class="material-tab" onclick="switchMaterialTab('${bubbleId}', 'quiz')" id="tab-quiz-${bubbleId}">Quizzes</button>
                    <button class="material-tab" onclick="switchMaterialTab('${bubbleId}', 'concept')" id="tab-concept-${bubbleId}">Concept Checks</button>
                </div>
                <div id="flashcards-container-${bubbleId}" class="material-content" style="display: block;"></div>
                <div id="quiz-container-${bubbleId}" class="material-content" style="display: none;"></div>
                <div id="concept-container-${bubbleId}" class="material-content" style="display: none;"></div>
            </div>
        `;
    }

    bubble.innerHTML = `${formattedHtml}${sourcesHtml}${actionsHtml}`;
}

// Send Message (Streaming Version)
async function sendMessage(retryText = null) {
    if (isGenerating) return;

    const query = retryText || queryInput.value.trim();
    if (!query) return;
    
    if (!retryText) appendMessage(query, "user");
    
    queryInput.value = "";
    queryInput.style.height = 'auto';
    // Remove queryInput.disabled so user can draft next message
    // queryInput.placeholder = "Message Intellectra...";
    
    isGenerating = true;
    sendBtn.innerHTML = '<i class="ri-stop-mini-fill"></i>';
    sendBtn.classList.add("stop-btn");

    const typingIndicator = createTypingIndicator();
    messagesDiv.appendChild(typingIndicator);
    messagesDiv.scrollTo({ top: messagesDiv.scrollHeight, behavior: 'smooth' });

    const requestSessionId = currentSessionId;
    pendingSessions.add(requestSessionId);
    
    currentAbortController = new AbortController();

    try {
        const res = await fetch("http://127.0.0.1:5000/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: currentAbortController.signal,
            body: JSON.stringify({ 
                query: query, 
                session_id: currentSessionId,
                level: currentStudyLevel,
                mode: isThinkingMode ? "thinking" : "standard",
                stream: true 
            })
        });

        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.error || "Server error");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = "";
        let sources = [];
        let aiMsgId = null;
        let streamInfo = null;
        let responseSessionId = requestSessionId;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");

            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        
                        if (data.session_id) {
                            responseSessionId = data.session_id;
                            if (currentSessionId !== responseSessionId) {
                                currentSessionId = responseSessionId;
                                saveCurrentSession();
                                sessionTitle.textContent = "Current Session";
                            }
                        }
                        if (data.sources) sources = data.sources;
                        
                        if (data.token) {
                            if (!streamInfo) {
                                typingIndicator.remove();
                                streamInfo = createAiStreamContainer();
                                messagesDiv.appendChild(streamInfo.wrapper);
                            }
                            fullResponse += data.token;
                            updateStreamContent(streamInfo.bubbleId, fullResponse, sources);
                            
                            // Auto-scroll if not manually scrolled up
                            if (!isScrolledUp) {
                                messagesDiv.scrollTo({ top: messagesDiv.scrollHeight });
                            }
                        }

                        if (data.done) {
                            aiMsgId = data.message_id;
                            if (streamInfo) {
                                finalizeStreamContent(streamInfo.bubbleId, fullResponse, sources, aiMsgId);
                            }
                            fetchSessions();
                        }
                    } catch (e) {
                        console.error("Error parsing stream chunk:", e);
                    }
                }
            }
        }
        
        pendingSessions.delete(requestSessionId);
        pendingSessions.delete(responseSessionId);

    } catch (err) {
        pendingSessions.delete(requestSessionId);
        typingIndicator.remove();
        if (err.name === 'AbortError') {
            appendMessage("⚠️ Generation stopped by user.", "ai");
        } else {
            const encodedQuery = query.replace(/"/g, '&quot;');
            appendMessage(`⚠️ Error: ${err.message}. <button class="action-btn" style="display:inline; padding: 2px 8px; font-size: 0.8rem; border: 1px solid var(--border-color); margin-left: 8px;" onclick="sendMessage('${encodedQuery}')">Retry</button>`, "ai");
        }
    } finally {
        isGenerating = false;
        // Ensure input is enabled just in case
        queryInput.disabled = false;
        sendBtn.innerHTML = '<i class="ri-send-plane-fill"></i>';
        sendBtn.classList.remove("stop-btn");
        setTimeout(() => queryInput.focus(), 10);
    }
}

queryInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (isGenerating) {
            // Do not send or stop if they press enter while drafting a message
            return;
        } else {
            sendMessage();
        }
    }
});

queryInput.addEventListener("input", function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});

sendBtn.addEventListener("click", () => {
    if (isGenerating) {
        stopGeneration();
    } else {
        sendMessage();
    }
});

// File Upload Handling
attachBtn.addEventListener("click", () => {
    fileInput.click();
});

let currentUploadXHR = null;

fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    // Reset upload input so same file can be selected again
    fileInput.value = "";

    const uploadContainer = document.getElementById("upload-container");
    const uploadFilename = document.getElementById("upload-filename");
    const uploadRing = document.getElementById("upload-ring");
    const uploadPercentage = document.getElementById("upload-percentage");
    const cancelUploadBtn = document.getElementById("cancel-upload-btn");

    uploadFilename.textContent = file.name;
    uploadRing.style.strokeDasharray = "0, 100";
    uploadPercentage.textContent = "0%";
    uploadContainer.style.display = "flex";

    // Disable sending messages during upload
    queryInput.disabled = true;
    sendBtn.disabled = true;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("session_id", currentSessionId || "null");

    currentUploadXHR = new XMLHttpRequest();
    let aiProcessingInterval = null;

    cancelUploadBtn.onclick = () => {
        if (currentUploadXHR) {
            currentUploadXHR.abort();
            currentUploadXHR = null;
        }
        if (aiProcessingInterval) {
            clearInterval(aiProcessingInterval);
            aiProcessingInterval = null;
        }
        uploadContainer.style.display = "none";
        queryInput.disabled = false;
        sendBtn.disabled = false;
        appendMessage("⚠️ File upload cancelled.", "ai");
    };

    currentUploadXHR.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100);
            
            if (percentComplete < 100) {
                uploadRing.style.strokeDasharray = `${percentComplete}, 100`;
                uploadPercentage.textContent = `${percentComplete}%`;
                uploadFilename.innerHTML = `${file.name} <span style="color: var(--text-muted); font-size: 0.8rem; margin-left: 8px;">(Uploading to Server)</span>`;
            } else {
                if (!aiProcessingInterval) {
                    let aiProgress = 0;
                    uploadFilename.innerHTML = `${file.name} <span style="color: var(--primary-accent); font-size: 0.8rem; margin-left: 8px;">(AI Reading Document...)</span>`;
                    uploadPercentage.textContent = "0%";
                    uploadRing.style.strokeDasharray = "0, 100";
                    
                    aiProcessingInterval = setInterval(() => {
                        if (aiProgress < 95) {
                            const increment = Math.max(1, Math.round((95 - aiProgress) * 0.1));
                            aiProgress += increment;
                            uploadPercentage.textContent = `${aiProgress}%`;
                            uploadRing.style.strokeDasharray = `${aiProgress}, 100`;
                        }
                    }, 500);
                }
            }
        }
    });

    currentUploadXHR.addEventListener("load", () => {
        if (aiProcessingInterval) {
            clearInterval(aiProcessingInterval);
            aiProcessingInterval = null;
        }
        uploadPercentage.textContent = "100%";
        uploadRing.style.strokeDasharray = "100, 100";
        
        setTimeout(() => {
            uploadContainer.style.display = "none";
            queryInput.disabled = false;
            sendBtn.disabled = false;
            
            const responseStatus = currentUploadXHR.status;
            const responseText = currentUploadXHR.responseText;
            currentUploadXHR = null;

            if (responseStatus >= 200 && responseStatus < 300) {
                try {
                    const data = JSON.parse(responseText);
                    
                    if (data.session_id && currentSessionId !== data.session_id) {
                        currentSessionId = data.session_id;
                        saveCurrentSession();
                        sessionTitle.textContent = "Current Session";
                        fetchSessions();
                    }
                    
                    appendMessage(data.message || "File uploaded and processed successfully.", "ai");
                } catch (err) {
                    appendMessage("File uploaded successfully.", "ai");
                }
            } else {
                let data = {};
                try {
                    data = JSON.parse(responseText);
                } catch (e) {}
                appendMessage("⚠️ " + (data.error || "Upload failed."), "ai");
            }
        }, 300);
    });

    currentUploadXHR.addEventListener("error", () => {
        if (aiProcessingInterval) {
            clearInterval(aiProcessingInterval);
            aiProcessingInterval = null;
        }
        uploadContainer.style.display = "none";
        queryInput.disabled = false;
        sendBtn.disabled = false;
        currentUploadXHR = null;
        appendMessage("⚠️ Upload failed. Server not responding.", "ai");
    });

    currentUploadXHR.open("POST", "http://127.0.0.1:5000/api/upload", true);
    currentUploadXHR.send(formData);
});

// Start app
init();
