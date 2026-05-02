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
const dropdownItems = document.querySelectorAll(".dropdown-item");

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
    e.stopPropagation();
    studyLevelMenu.classList.toggle("show");
});

document.addEventListener("click", (e) => {
    if (!e.target.closest('.custom-dropdown')) {
        studyLevelMenu.classList.remove("show");
    }
});

dropdownItems.forEach(item => {
    item.addEventListener("click", () => {
        currentStudyLevel = item.dataset.value;
        dropdownItems.forEach(i => i.classList.remove("active"));
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

        let viewFlashcardsBtn = flashcardWidgets.length > 0 ? 
            `<button class="flashcard-subtle-btn view-btn" id="view-flashcard-btn-${bubbleId}" onclick="toggleWidgets('${bubbleId}', 'flashcards')" title="View Saved Flashcards">
                <i class="ri-eye-line"></i> View Flashcards (${flashcardWidgets.length})
            </button>` : "";
            
        let viewQuizBtn = quizWidgets.length > 0 ? 
            `<button class="flashcard-subtle-btn view-btn" id="view-quiz-btn-${bubbleId}" onclick="toggleWidgets('${bubbleId}', 'quiz')" title="View Saved Quizzes">
                <i class="ri-eye-line"></i> View Quizzes (${quizWidgets.length})
            </button>` : "";

        actionsHtml = `
            <div class="msg-actions">
                <button class="flashcard-subtle-btn" data-text="${encodedText}" onclick="generateFlashcards('${bubbleId}', this.dataset.text, ${messageId})" id="btn-flashcard-${bubbleId}" title="Generate Flashcards">
                    <i class="ri-stack-line"></i> Generate Flashcards
                </button>
                <button class="flashcard-subtle-btn" data-text="${encodedText}" onclick="generateQuiz('${bubbleId}', this.dataset.text, ${messageId})" id="btn-quiz-${bubbleId}" title="Generate Quiz">
                    <i class="ri-questionnaire-line"></i> Generate Quiz
                </button>
                ${viewFlashcardsBtn}
                ${viewQuizBtn}
            </div>
            <div id="flashcards-container-${bubbleId}" class="widget-display-container" style="display: none;"></div>
            <div id="quiz-container-${bubbleId}" class="widget-display-container" style="display: none;"></div>
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
        if (fContainer && widgets.filter(w => w.widget_type === 'flashcard').length > 0) {
            renderSavedFlashcards(widgets.filter(w => w.widget_type === 'flashcard'), fContainer);
        }
        if (qContainer && widgets.filter(w => w.widget_type === 'quiz').length > 0) {
            renderSavedQuizzes(widgets.filter(w => w.widget_type === 'quiz'), qContainer);
        }
    }
}

window.toggleWidgets = function(bubbleId, prefix) {
    const container = document.getElementById(`${prefix}-container-${bubbleId}`);
    if (container) {
        if (container.style.display === 'none') {
            container.style.display = 'block';
            container.classList.add('fade-in');
        } else {
            container.style.display = 'none';
        }
    }
};

function updateWidgetCountBtn(bubbleId, type) {
    const containerPrefix = type === 'flashcard' ? 'flashcards' : 'quiz';
    const container = document.getElementById(`${containerPrefix}-container-${bubbleId}`);
    if (!container) return;
    
    const count = container.querySelectorAll('.widget-set').length;
    let btn = document.getElementById(`view-${type}-btn-${bubbleId}`);
    
    if (count > 0) {
        if (!btn) {
            const actions = container.previousElementSibling; 
            btn = document.createElement("button");
            btn.className = "flashcard-subtle-btn view-btn";
            btn.id = `view-${type}-btn-${bubbleId}`;
            btn.onclick = () => toggleWidgets(bubbleId, containerPrefix);
            actions.appendChild(btn);
        }
        btn.innerHTML = `<i class="ri-eye-line"></i> View ${type === 'flashcard' ? 'Flashcards' : 'Quizzes'} (${count})`;
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
    updateWidgetCountBtn(bubbleId, 'flashcard');
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
    updateWidgetCountBtn(bubbleId, 'quiz');
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
                        <div class="delete-chat-btn" onclick="deleteSession(event, ${session.id})">
                            <i class="ri-delete-bin-line"></i>
                        </div>
                    `;
                    
                    div.onclick = (e) => {
                        if (e.target.closest('.delete-chat-btn')) return;
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

// Send Message
async function sendMessage(retryText = null) {
    if (isGenerating) return;

    const query = retryText || queryInput.value.trim();
    if (!query) return;
    
    if (!retryText) appendMessage(query, "user");
    
    queryInput.value = "";
    queryInput.style.height = 'auto'; // Reset auto-resize
    queryInput.disabled = true;
    queryInput.placeholder = "Intellectra is thinking...";
    
    isGenerating = true;
    sendBtn.innerHTML = '<i class="ri-stop-mini-fill"></i>';
    sendBtn.classList.add("stop-btn");

    const typingIndicator = createTypingIndicator();
    messagesDiv.appendChild(typingIndicator);
    messagesDiv.scrollTo({ top: messagesDiv.scrollHeight, behavior: 'smooth' });

    // Remember which session this request belongs to
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
                level: currentStudyLevel 
            })
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
                appendMessage(data.response, "ai", data.sources || [], data.message_id, []);
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
        if (currentSessionId === requestSessionId) {
            typingIndicator.remove();
            if (err.name === 'AbortError') {
                appendMessage("⚠️ Generation stopped by user.", "ai");
            } else {
                // Add a retry button
                const encodedQuery = query.replace(/"/g, '&quot;');
                appendMessage(`⚠️ Server not responding. <button class="action-btn" style="display:inline; padding: 2px 8px; font-size: 0.8rem; border: 1px solid var(--border-color); margin-left: 8px;" onclick="sendMessage('${encodedQuery}')">Retry</button>`, "ai");
            }
        }
    } finally {
        isGenerating = false;
        queryInput.disabled = false;
        queryInput.placeholder = "Message Intellectra...";
        sendBtn.innerHTML = '<i class="ri-send-plane-fill"></i>';
        sendBtn.classList.remove("stop-btn");
        setTimeout(() => queryInput.focus(), 10);
    }
}

queryInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (isGenerating) {
            stopGeneration();
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
