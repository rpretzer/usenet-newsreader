// Mobile-First Usenet Newsreader with State-Driven Stack Navigation
// Implements Level 1 (Groups) -> Level 2 (Threads) -> Level 3 (Article)

const API_BASE_URL = window.API_BASE_URL || '';

// Navigation state: 'groups' | 'threads' | 'article'
let navigationState = 'groups';
let navigationHistory = [];
let currentGroup = null;
let currentArticle = null;
let currentServer = 'news.eternal-september.org';
let currentPort = 119;
let currentSsl = false;
let currentUsername = '';
let currentPassword = '';
let allGroups = [];
let virtualScrollItems = [];
let isPullToRefreshActive = false;
let pullToRefreshStartY = 0;

// DOM elements
const groupsPane = document.getElementById('mobile-groups-pane');
const threadsPane = document.getElementById('mobile-threads-pane');
const articlePane = document.getElementById('mobile-article-pane');
const groupsList = document.getElementById('mobile-groups-list');
const threadsList = document.getElementById('mobile-threads-list');
const articleBody = document.getElementById('mobile-article-body');
const articleHeader = document.getElementById('mobile-article-header');
const backButton = document.getElementById('mobile-back-btn');
const currentGroupTitle = document.getElementById('mobile-current-group');
const connectBtn = document.getElementById('mobile-connect');
const pullToRefreshIndicator = document.getElementById('pull-to-refresh');

// Virtual scrolling state
let virtualScrollStartIndex = 0;
let virtualScrollEndIndex = 20;
let virtualScrollItemHeight = 72; // 48px minimum + padding

// Helper functions
function buildApiUrl(endpoint) {
    return `${API_BASE_URL}${endpoint}`;
}

function buildQueryString(baseParams) {
    const params = new URLSearchParams(baseParams);
    if (currentUsername) params.append('username', currentUsername);
    if (currentPassword) params.append('password', currentPassword);
    return params.toString();
}

function showPane(paneName) {
    // Hide all panes
    groupsPane?.classList.remove('active');
    threadsPane?.classList.remove('active');
    articlePane?.classList.remove('active');
    
    // Show requested pane
    if (paneName === 'groups') {
        groupsPane?.classList.add('active');
        navigationState = 'groups';
        hideBackButton();
    } else if (paneName === 'threads') {
        threadsPane?.classList.add('active');
        navigationState = 'threads';
        showBackButton();
    } else if (paneName === 'article') {
        articlePane?.classList.add('active');
        navigationState = 'article';
        showBackButton();
    }
    
    // Add to history
    navigationHistory.push(navigationState);
    if (navigationHistory.length > 10) {
        navigationHistory.shift();
    }
}

function hideBackButton() {
    backButton?.classList.add('hidden');
}

function showBackButton() {
    backButton?.classList.remove('hidden');
}

function navigateBack() {
    if (navigationHistory.length > 1) {
        navigationHistory.pop(); // Remove current
        const previous = navigationHistory[navigationHistory.length - 1];
        showPane(previous);
    } else {
        showPane('groups');
    }
}

// Touch event handlers for swipe gestures
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;

function handleTouchStart(e) {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
    pullToRefreshStartY = touchStartY;
}

function handleTouchMove(e) {
    const touchY = e.changedTouches[0].screenY;
    const touchX = e.changedTouches[0].screenX;
    
    // Pull-to-refresh detection
    if (navigationState === 'threads' && threadsList) {
        const scrollTop = threadsList.scrollTop;
        if (scrollTop === 0 && touchY > pullToRefreshStartY) {
            const pullDistance = touchY - pullToRefreshStartY;
            if (pullDistance > 50 && pullDistance < 100) {
                isPullToRefreshActive = true;
                if (pullToRefreshIndicator) {
                    pullToRefreshIndicator.classList.remove('hidden');
                    pullToRefreshIndicator.style.transform = `translateY(${Math.min(pullDistance, 100)}px)`;
                }
            }
        }
    }
}

function handleTouchEnd(e) {
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    const minSwipeDistance = 50;
    
    // Handle pull-to-refresh
    if (isPullToRefreshActive && navigationState === 'threads') {
        isPullToRefreshActive = false;
        if (pullToRefreshIndicator) {
            pullToRefreshIndicator.classList.add('hidden');
        }
        if (deltaY > 100 && currentGroup) {
            refreshThreads();
        }
        return;
    }
    
    // Swipe to dismiss (article -> threads)
    if (navigationState === 'article' && Math.abs(deltaX) > minSwipeDistance) {
        if (deltaX > 0) {
            // Swipe right to go back
            navigateBack();
        }
    }
}

// Add touch event listeners
document.addEventListener('touchstart', handleTouchStart, { passive: true });
document.addEventListener('touchmove', handleTouchMove, { passive: true });
document.addEventListener('touchend', handleTouchEnd, { passive: true });

// Connect to server
if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
        const serverInput = document.getElementById('mobile-server');
        const portInput = document.getElementById('mobile-port');
        const usernameInput = document.getElementById('mobile-username');
        const passwordInput = document.getElementById('mobile-password');
        
        currentServer = serverInput?.value.trim() || 'news.eternal-september.org';
        currentPort = parseInt(portInput?.value) || 119;
        currentUsername = usernameInput?.value.trim() || '';
        currentPassword = passwordInput?.value.trim() || '';
        
        if (!currentServer) {
            showError('Please enter a server address');
            return;
        }
        
        showLoading();
        
        try {
            const query = buildQueryString({
                server: currentServer,
                port: currentPort,
                ssl: currentSsl
            });
            
            const response = await fetch(buildApiUrl(`/api/groups?${query}`));
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to connect');
            }
            
            const groups = await response.json();
            allGroups = groups;
            displayGroups(groups);
        } catch (err) {
            showError(`Connection failed: ${err.message}`);
        } finally {
            hideLoading();
        }
    });
}

// Display groups (Level 1)
function displayGroups(groups) {
    if (!groupsList) return;
    
    groupsList.innerHTML = '';
    
    if (groups.length === 0) {
        groupsList.innerHTML = '<div class="p-4 text-center text-gray-500">No groups found</div>';
        return;
    }
    
    groups.forEach(group => {
        const item = document.createElement('div');
        item.className = 'mobile-group-item touch-target';
        item.innerHTML = `
            <div class="mobile-item-content">
                <div class="mobile-item-title">${escapeHtml(group.name)}</div>
                <div class="mobile-item-meta">${(group.count || 0).toLocaleString()} articles</div>
            </div>
            <div class="mobile-item-arrow">→</div>
        `;
        
        item.addEventListener('click', () => {
            currentGroup = group.name;
            loadThreads(group.name);
            showPane('threads');
        });
        
        groupsList.appendChild(item);
    });
}

// Load threads (Level 2)
async function loadThreads(groupName) {
    if (!threadsList || !currentGroupTitle) return;
    
    currentGroup = groupName;
    currentGroupTitle.textContent = groupName;
    threadsList.innerHTML = '<div class="p-4 text-center text-gray-500">Loading threads...</div>';
    
    try {
        const query = buildQueryString({
            server: currentServer,
            port: currentPort,
            ssl: currentSsl,
            limit: 1000,
            offset: 0
        });
        
        // Try new threads endpoint, fallback to articles
        let response = await fetch(buildApiUrl(`/api/groups/${encodeURIComponent(groupName)}/threads?${query}`));
        
        if (!response.ok && response.status === 404) {
            response = await fetch(buildApiUrl(`/api/groups/${encodeURIComponent(groupName)}/articles?${query}`));
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to load threads');
            }
            
            const data = await response.json();
            const articles = data.articles || [];
            virtualScrollItems = articles.map(a => ({
                ...a,
                depth: 0,
                threadMessageCount: 1,
                hasChildren: false
            }));
        } else {
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to load threads');
            }
            
            const data = await response.json();
            virtualScrollItems = data.threads || [];
        }
        
        initVirtualScrolling();
        renderVirtualScroll();
    } catch (err) {
        showError(`Failed to load threads: ${err.message}`);
        threadsList.innerHTML = `<div class="p-4 text-center text-red-500">Error: ${err.message}</div>`;
    }
}

// Refresh threads (pull-to-refresh)
async function refreshThreads() {
    if (!currentGroup) return;
    
    showLoading();
    await loadThreads(currentGroup);
    hideLoading();
}

// Expose globally for HTML onclick
window.refreshThreads = refreshThreads;
window.showPane = showPane;

// Virtual scrolling for mobile
function initVirtualScrolling() {
    if (!threadsList) return;
    
    virtualScrollStartIndex = 0;
    virtualScrollEndIndex = Math.ceil((window.innerHeight - 120) / virtualScrollItemHeight) + 2;
    
    threadsList.addEventListener('scroll', handleThreadsScroll, { passive: true });
}

function handleThreadsScroll() {
    if (!threadsList) return;
    
    const scrollTop = threadsList.scrollTop;
    virtualScrollStartIndex = Math.floor(scrollTop / virtualScrollItemHeight);
    virtualScrollEndIndex = Math.min(
        virtualScrollStartIndex + Math.ceil(threadsList.clientHeight / virtualScrollItemHeight) + 2,
        virtualScrollItems.length
    );
    
    renderVirtualScroll();
}

function renderVirtualScroll() {
    if (!threadsList) return;
    
    const visibleItems = virtualScrollItems.slice(virtualScrollStartIndex, virtualScrollEndIndex);
    const offsetY = virtualScrollStartIndex * virtualScrollItemHeight;
    const totalHeight = virtualScrollItems.length * virtualScrollItemHeight;
    
    let html = `<div style="height: ${offsetY}px"></div>`;
    
    visibleItems.forEach((thread, index) => {
        const actualIndex = virtualScrollStartIndex + index;
        html += renderThreadItem(thread, actualIndex);
    });
    
    const remainingHeight = totalHeight - (virtualScrollEndIndex * virtualScrollItemHeight);
    if (remainingHeight > 0) {
        html += `<div style="height: ${remainingHeight}px"></div>`;
    }
    
    threadsList.innerHTML = html;
    
    // Re-attach event listeners and swipe actions
    threadsList.querySelectorAll('.mobile-thread-item').forEach((item, idx) => {
        const actualIndex = virtualScrollStartIndex + idx;
        const thread = virtualScrollItems[actualIndex];
        
        item.addEventListener('click', () => {
            loadArticle(thread.number);
            showPane('article');
        });
        
        // Add swipe actions
        setupSwipeActions(item, actualIndex);
    });
}

function renderThreadItem(thread, index) {
    const indent = thread.depth * 1.5;
    const subject = escapeHtml(thread.subject || '(no subject)');
    const from = escapeHtml(thread.from || 'unknown');
    const date = thread.date ? new Date(thread.date).toLocaleDateString() : '';
    
    return `
        <div 
            class="mobile-thread-item touch-target"
            data-index="${index}"
            data-article-number="${thread.number}"
            style="padding-left: ${indent}rem;"
        >
            <div class="mobile-item-content">
                <div class="mobile-item-title">${subject}</div>
                <div class="mobile-item-meta">
                    <span>${from}</span>
                    ${date ? `<span>${date}</span>` : ''}
                    ${thread.threadMessageCount > 1 ? `<span>${thread.threadMessageCount} msgs</span>` : ''}
                </div>
            </div>
            <div class="mobile-item-arrow">→</div>
        </div>
    `;
}

// Swipe actions (swipe right to star, swipe left to mark read)
function setupSwipeActions(element, index) {
    let swipeStartX = 0;
    let swipeCurrentX = 0;
    let isSwiping = false;
    
    element.addEventListener('touchstart', (e) => {
        swipeStartX = e.touches[0].clientX;
        isSwiping = false;
    }, { passive: true });
    
    element.addEventListener('touchmove', (e) => {
        swipeCurrentX = e.touches[0].clientX;
        const deltaX = swipeCurrentX - swipeStartX;
        
        if (Math.abs(deltaX) > 10) {
            isSwiping = true;
            element.style.transform = `translateX(${deltaX}px)`;
            element.style.transition = 'none';
            
            // Show action indicators
            if (deltaX > 0) {
                element.classList.add('swipe-right');
            } else {
                element.classList.add('swipe-left');
            }
        }
    }, { passive: true });
    
    element.addEventListener('touchend', () => {
        const deltaX = swipeCurrentX - swipeStartX;
        const threshold = 100;
        
        element.style.transition = 'transform 0.3s ease';
        element.style.transform = 'translateX(0)';
        element.classList.remove('swipe-right', 'swipe-left');
        
        if (isSwiping && Math.abs(deltaX) > threshold) {
            if (deltaX > 0) {
                // Swipe right - Star/Save
                starArticle(index);
            } else {
                // Swipe left - Mark Read
                markAsRead(index);
            }
        }
        
        isSwiping = false;
    }, { passive: true });
}

function starArticle(index) {
    // TODO: Implement starring functionality
    console.log('Star article:', index);
    showToast('Article starred');
}

function markAsRead(index) {
    // TODO: Implement mark as read functionality
    console.log('Mark as read:', index);
    showToast('Marked as read');
}

// Load article (Level 3)
async function loadArticle(articleNumber) {
    if (!articleBody || !articleHeader) return;
    
    currentArticle = { number: articleNumber };
    articleBody.innerHTML = '<div class="p-4 text-center text-gray-500">Loading article...</div>';
    
    try {
        const query = buildQueryString({
            server: currentServer,
            port: currentPort,
            ssl: currentSsl,
            group: currentGroup
        });
        
        const response = await fetch(buildApiUrl(`/api/articles/${articleNumber}?${query}`));
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to load article');
        }
        
        const data = await response.json();
        
        // Handle both old format { body } and new format { number, subject, from, date, body }
        // Also handle article.header format from getArticle method
        let body = data.body || '';
        let subject = data.subject || '';
        let from = data.from || '';
        let date = data.date || '';
        let messageId = data.messageId || '';
        
        // Handle article.header format (from getArticle method)
        if (data.article && data.article.header) {
            subject = data.article.header.subject || '';
            from = data.article.header.from || '';
            date = data.article.header.date || '';
            messageId = data.article.header.messageId || '';
            body = data.article.body || data.body || '';
        } else if (data.article && !data.article.header) {
            // Handle article object without header
            body = data.article.body || data.body || '';
            subject = data.article.subject || data.subject || '';
            from = data.article.from || data.from || '';
            date = data.article.date || data.date || '';
            messageId = data.article.messageId || data.messageId || '';
        }
        
        // Try to extract from body if not in response
        if ((!subject || !from) && body) {
            const lines = body.split('\n');
            for (let i = 0; i < Math.min(20, lines.length); i++) {
                const line = lines[i];
                if (line.startsWith('Subject:')) subject = line.substring(8).trim();
                if (line.startsWith('From:')) from = line.substring(5).trim();
                if (line.startsWith('Date:')) date = line.substring(5).trim();
                if (line.startsWith('Message-ID:') || line.startsWith('Message-Id:')) {
                    messageId = line.substring(11).trim();
                }
            }
        }
        
        // Update header
        articleHeader.innerHTML = `
            <div class="mobile-article-subject">${escapeHtml(subject || 'No subject')}</div>
            <div class="mobile-article-meta">
                <span>From: ${escapeHtml(from || 'unknown')}</span>
                <span>Date: ${escapeHtml(date || 'unknown')}</span>
            </div>
        `;
        
        // Update body with word wrapping toggle
        const bodyContent = body ? body.replace(/\r\n/g, '\n') : '';
        articleBody.innerHTML = `
            <div class="mobile-article-content word-wrap">
                <pre class="mobile-article-pre">${escapeHtml(bodyContent || 'No content')}</pre>
            </div>
            <div class="mobile-article-actions">
                <button class="mobile-action-btn" onclick="toggleWordWrap()">
                    <span id="wrap-toggle-text">Wrap Long Lines</span>
                </button>
            </div>
        `;
        
        currentArticle = {
            number: articleNumber,
            subject: subject || '(no subject)',
            from: from || 'unknown',
            date: date || '',
            messageId: messageId || '',
            body: bodyContent
        };
    } catch (err) {
        showError(`Failed to load article: ${err.message}`);
        articleBody.innerHTML = `<div class="p-4 text-center text-red-500">Error: ${err.message}</div>`;
    }
}

// Word wrap toggle
window.toggleWordWrap = function() {
    const pre = document.querySelector('.mobile-article-pre');
    const toggleText = document.getElementById('wrap-toggle-text');
    
    if (pre) {
        if (pre.classList.contains('word-wrap-on')) {
            pre.classList.remove('word-wrap-on');
            toggleText.textContent = 'Wrap Long Lines';
        } else {
            pre.classList.add('word-wrap-on');
            toggleText.textContent = 'No Wrap';
        }
    }
};

// Back button handlers
if (backButton) {
    backButton.addEventListener('click', navigateBack);
}

const articleBackButton = document.getElementById('mobile-article-back-btn');
if (articleBackButton) {
    articleBackButton.addEventListener('click', navigateBack);
}

// Already exposed above (line 302)

// Utility functions
function showLoading() {
    const loading = document.getElementById('mobile-loading');
    if (loading) loading.classList.remove('hidden');
}

function hideLoading() {
    const loading = document.getElementById('mobile-loading');
    if (loading) loading.classList.add('hidden');
}

function showError(message) {
    const error = document.getElementById('mobile-error');
    if (error) {
        error.textContent = message;
        error.classList.remove('hidden');
        setTimeout(() => hideError(), 5000);
    }
}

function hideError() {
    const error = document.getElementById('mobile-error');
    if (error) error.classList.add('hidden');
}

function showToast(message) {
    // Create toast notification
    const toast = document.createElement('div');
    toast.className = 'mobile-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize: show groups pane
showPane('groups');

// Handle browser back button
window.addEventListener('popstate', (e) => {
    if (e.state && e.state.pane) {
        showPane(e.state.pane);
    } else {
        navigateBack();
    }
});

// ==================== KEYBOARD NAVIGATION (Mobile) ====================
document.addEventListener('keydown', (e) => {
    const activeElement = document.activeElement;
    const isInput = activeElement && (
        activeElement.tagName === 'INPUT' || 
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable
    );
    
    if (isInput) {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeConnectionModal();
        }
        return;
    }
    
    // Mobile keyboard shortcuts
    switch (e.key) {
        case 'Escape':
        case 'Backspace':
            e.preventDefault();
            navigateBack();
            break;
        case 'ArrowLeft':
            if (navigationState === 'article') {
                e.preventDefault();
                navigateBack();
            }
            break;
        case 'ArrowRight':
            if (navigationState === 'threads') {
                e.preventDefault();
                const focused = threadsList.querySelector('.mobile-thread-item:focus');
                if (focused) {
                    focused.click();
                }
            }
            break;
        case 'r':
            if (!e.ctrlKey && !e.metaKey && navigationState === 'article' && currentArticle) {
                e.preventDefault();
                // TODO: Open reply modal
            }
            break;
        case '/':
        case 'f':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const searchInput = document.getElementById('mobile-group-search');
                if (searchInput) {
                    searchInput.focus();
                    searchInput.select();
                }
            }
            break;
    }
});
