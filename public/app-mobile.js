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

// Share functionality using Web Share API
function shareArticle() {
    if (!currentArticle) {
        showToast('No article selected');
        return;
    }
    
    const shareData = {
        title: currentArticle.subject || 'Usenet Article',
        text: `${currentArticle.subject || 'Article'}\nFrom: ${currentArticle.from || 'unknown'}\n\nRead on Usenet Newsreader`,
        url: window.location.href
    };
    
    // Use Web Share API if available (mobile browsers)
    if (navigator.share) {
        navigator.share(shareData)
            .then(() => {
                showToast('Shared successfully');
            })
            .catch((err) => {
                if (err.name !== 'AbortError') {
                    console.error('Share error:', err);
                    fallbackShare(shareData);
                }
            });
    } else {
        // Fallback: copy to clipboard
        fallbackShare(shareData);
    }
}

function fallbackShare(shareData) {
    const shareText = `${shareData.title}\n${shareData.text}\n${shareData.url}`;
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareText)
            .then(() => {
                showToast('Link copied to clipboard');
            })
            .catch((err) => {
                console.error('Clipboard error:', err);
                prompt('Copy this link:', shareText);
            });
    } else {
        // Final fallback: prompt
        prompt('Copy this link:', shareText);
    }
}

// Reply modal functionality
function openReplyModal() {
    if (!currentArticle || !currentGroup) {
        showToast('No article selected');
        return;
    }
    
    // Create reply modal if it doesn't exist
    let replyModal = document.getElementById('mobile-reply-modal');
    if (!replyModal) {
        replyModal = document.createElement('div');
        replyModal.id = 'mobile-reply-modal';
        replyModal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';
        replyModal.innerHTML = `
            <div class="bg-sovereign-surface rounded-lg p-4 w-full max-w-md max-h-[90vh] overflow-y-auto">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-lg font-semibold">Reply to Article</h3>
                    <button id="close-reply-modal" class="text-gray-400 hover:text-white text-2xl">&times;</button>
                </div>
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm mb-1">From:</label>
                        <input type="text" id="reply-from" class="w-full px-3 py-2 bg-sovereign-bg border border-sovereign-border rounded text-sm" placeholder="Your email">
                    </div>
                    <div>
                        <label class="block text-sm mb-1">Subject:</label>
                        <input type="text" id="reply-subject" class="w-full px-3 py-2 bg-sovereign-bg border border-sovereign-border rounded text-sm" value="Re: ${currentArticle.subject || ''}">
                    </div>
                    <div>
                        <label class="block text-sm mb-1">Message:</label>
                        <textarea id="reply-body" rows="10" class="w-full px-3 py-2 bg-sovereign-bg border border-sovereign-border rounded text-sm" placeholder="Type your reply..."></textarea>
                    </div>
                    <div class="flex gap-2">
                        <button id="submit-reply" class="flex-1 px-4 py-2 bg-sovereign-accent hover:bg-sovereign-accent-hover text-white rounded text-sm font-medium">Send Reply</button>
                        <button id="cancel-reply" class="px-4 py-2 bg-sovereign-border hover:bg-sovereign-bg text-white rounded text-sm">Cancel</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(replyModal);
        
        // Event listeners
        document.getElementById('close-reply-modal').addEventListener('click', closeReplyModal);
        document.getElementById('cancel-reply').addEventListener('click', closeReplyModal);
        document.getElementById('submit-reply').addEventListener('click', submitReply);
        
        // Close on background click
        replyModal.addEventListener('click', (e) => {
            if (e.target === replyModal) {
                closeReplyModal();
            }
        });
    }
    
    // Update subject and pre-fill reply body with quote
    const subjectInput = document.getElementById('reply-subject');
    const bodyTextarea = document.getElementById('reply-body');
    
    if (subjectInput) {
        subjectInput.value = `Re: ${currentArticle.subject || ''}`;
    }
    
    if (bodyTextarea && currentArticle.body) {
        const quotedBody = currentArticle.body.split('\n').map(line => `> ${line}`).join('\n');
        bodyTextarea.value = `\n\n${quotedBody}`;
    }
    
    replyModal.classList.remove('hidden');
}

function closeReplyModal() {
    const replyModal = document.getElementById('mobile-reply-modal');
    if (replyModal) {
        replyModal.classList.add('hidden');
    }
}

async function submitReply() {
    const from = document.getElementById('reply-from')?.value.trim();
    const subject = document.getElementById('reply-subject')?.value.trim();
    const body = document.getElementById('reply-body')?.value.trim();
    
    if (!from || !subject || !body) {
        showToast('Please fill in all fields');
        return;
    }
    
    if (!currentGroup || !currentArticle) {
        showToast('No article selected');
        return;
    }
    
    showLoading();
    
    try {
        const response = await fetch(buildApiUrl('/api/reply'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                server: currentServer,
                port: currentPort,
                ssl: currentSsl,
                username: currentUsername || null,
                password: currentPassword || null,
                group: currentGroup,
                replyTo: currentArticle.messageId || currentArticle.number,
                subject,
                from,
                body
            })
        });
        
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to post reply');
        }
        
        showToast('Reply sent successfully');
        closeReplyModal();
        
        // Reload threads after a delay
        setTimeout(() => {
            if (currentGroup) {
                loadThreads(currentGroup);
            }
        }, 2000);
    } catch (err) {
        showError(`Failed to post reply: ${err.message}`);
    } finally {
        hideLoading();
    }
}

// Expose globally for HTML onclick
window.refreshThreads = refreshThreads;
window.showPane = showPane;
window.toggleStarArticle = toggleStarArticle;
window.shareArticle = shareArticle;

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
        
        item.addEventListener('click', (e) => {
            // Don't load if clicking star button
            if (e.target.closest('.star-btn')) {
                return;
            }
            const articleNumber = thread.number || thread.article_number || 0;
            loadArticle(articleNumber);
            showPane('article');
            // Mark as read when opening
            markArticleAsRead(articleNumber);
        });
        
        // Update read/star status for rendered items
        const articleNumber = thread.number || thread.article_number || 0;
        if (articleNumber) {
            updateReadDisplay(articleNumber);
            updateStarDisplay(articleNumber);
        }
        
        // Add swipe actions
        setupSwipeActions(item, actualIndex);
    });
}

function renderThreadItem(thread, index) {
    const indent = (thread.depth || 0) * 1.5;
    const subject = escapeHtml(thread.subject || '(no subject)');
    const from = escapeHtml(thread.from || 'unknown');
    const date = thread.date ? new Date(thread.date).toLocaleDateString() : '';
    const articleNumber = thread.number || thread.article_number || 0;
    const isRead = isArticleRead(articleNumber);
    const isStarredStatus = isArticleStarred(articleNumber);
    
    return `
        <div 
            class="mobile-thread-item touch-target ${isRead ? 'read opacity-60' : ''}"
            data-index="${index}"
            data-article-number="${articleNumber}"
            style="padding-left: ${indent}rem;"
        >
            <div class="mobile-item-content">
                <div class="flex items-center gap-2 mb-1">
                    <button 
                        class="star-btn text-lg leading-none p-1 ${isStarredStatus ? 'starred text-yellow-400' : 'text-gray-500'}"
                        onclick="event.stopPropagation(); window.toggleStarArticle(${articleNumber});"
                        aria-label="${isStarredStatus ? 'Unstar' : 'Star'} article"
                        style="touch-action: manipulation;"
                    >
                        ${isStarredStatus ? '★' : '☆'}
                    </button>
                    <div class="mobile-item-title flex-1 ${isRead ? 'text-gray-400' : 'text-white'}">${subject}</div>
                </div>
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

// Starring functionality - persist in localStorage
function getStarredArticles() {
    const starred = localStorage.getItem('starredArticles');
    return starred ? new Set(JSON.parse(starred)) : new Set();
}

function setStarredArticles(starredSet) {
    localStorage.setItem('starredArticles', JSON.stringify(Array.from(starredSet)));
}

function isArticleStarred(articleNumber) {
    const starred = getStarredArticles();
    return starred.has(String(articleNumber));
}

function toggleStarArticle(articleNumber) {
    const starred = getStarredArticles();
    const articleKey = String(articleNumber);
    
    if (starred.has(articleKey)) {
        starred.delete(articleKey);
        showToast('Article unstarred');
    } else {
        starred.add(articleKey);
        showToast('Article starred');
    }
    
    setStarredArticles(starred);
    updateStarDisplay(articleNumber);
}

function updateStarDisplay(articleNumber) {
    const threadItem = threadsList.querySelector(`[data-article-number="${articleNumber}"]`);
    if (threadItem) {
        const starBtn = threadItem.querySelector('.star-btn');
        if (starBtn) {
            if (isArticleStarred(articleNumber)) {
                starBtn.classList.add('starred');
                starBtn.textContent = '★';
            } else {
                starBtn.classList.remove('starred');
                starBtn.textContent = '☆';
            }
        }
    }
}

function starArticle(index) {
    const thread = virtualScrollItems[index];
    if (thread && thread.number) {
        toggleStarArticle(thread.number);
    }
}

// Mark as read functionality - persist in localStorage
function getReadArticles() {
    const read = localStorage.getItem('readArticles');
    return read ? new Set(JSON.parse(read)) : new Set();
}

function setReadArticles(readSet) {
    localStorage.setItem('readArticles', JSON.stringify(Array.from(readSet)));
}

function isArticleRead(articleNumber) {
    const read = getReadArticles();
    return read.has(String(articleNumber));
}

function markArticleAsRead(articleNumber) {
    const read = getReadArticles();
    read.add(String(articleNumber));
    setReadArticles(read);
    updateReadDisplay(articleNumber);
}

function updateReadDisplay(articleNumber) {
    const threadItem = threadsList.querySelector(`[data-article-number="${articleNumber}"]`);
    if (threadItem) {
        if (isArticleRead(articleNumber)) {
            threadItem.classList.add('read');
            threadItem.style.opacity = '0.6';
        } else {
            threadItem.classList.remove('read');
            threadItem.style.opacity = '1';
        }
    }
}

function markAsRead(index) {
    const thread = virtualScrollItems[index];
    if (thread && thread.number) {
        markArticleAsRead(thread.number);
        showToast('Marked as read');
    }
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
                openReplyModal();
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
