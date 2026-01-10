// High-Performance Streaming Usenet Newsreader
// Implements local-first architecture with optimistic UI updates

const API_BASE_URL = window.API_BASE_URL || '';

let currentServer = 'news.eternal-september.org';
let currentPort = 119;
let currentSsl = false;
let currentUsername = '';
let currentPassword = '';
let currentGroup = null;
let currentArticle = null;
let allGroups = [];
let serverId = null;

// Virtual scrolling state
let virtualScrollItems = [];
let virtualScrollStartIndex = 0;
let virtualScrollEndIndex = 0;
let virtualScrollItemHeight = 60;
let virtualScrollContainerHeight = 0;

// DOM elements
const serverInput = document.getElementById('server');
const portInput = document.getElementById('port');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const connectBtn = document.getElementById('connect');
const groupSearchInput = document.getElementById('group-search');
const groupsList = document.getElementById('groups-list');
const threadsList = document.getElementById('threads-list');
const threadsContainer = document.getElementById('threads-container');
const currentGroupTitle = document.getElementById('current-group-title');
const threadStats = document.getElementById('thread-stats');
const articleSubject = document.getElementById('article-subject');
const articleFrom = document.getElementById('article-from');
const articleDate = document.getElementById('article-date');
const articleBody = document.getElementById('article-body');
const newPostBtn = document.getElementById('new-post-btn');
const replyBtn = document.getElementById('reply-btn');
const postModal = document.getElementById('post-modal');
const loading = document.getElementById('loading');
const error = document.getElementById('error');

// Column resize state
let isResizing = false;
let resizeType = null; // 'groups' or 'reader'
let startX = 0;
let startWidth = 0;
let paneGroups, paneThreads, paneReader;

// ==================== COLUMN RESIZE FUNCTIONALITY ====================
// Load saved column widths from localStorage
function loadColumnWidths() {
    if (!paneGroups || !paneReader) return;
    
    const savedGroupsWidth = localStorage.getItem('columnWidths_groups');
    const savedReaderWidth = localStorage.getItem('columnWidths_reader');
    
    if (savedGroupsWidth) {
        paneGroups.style.width = savedGroupsWidth;
        paneGroups.style.flex = '0 0 auto';
    }
    
    if (savedReaderWidth) {
        paneReader.style.width = savedReaderWidth;
        paneReader.style.flex = '0 0 auto';
    }
}

// Save column widths to localStorage
function saveColumnWidths() {
    if (!paneGroups || !paneReader) return;
    
    const groupsWidth = paneGroups.offsetWidth;
    const readerWidth = paneReader.offsetWidth;
    
    if (groupsWidth > 0) {
        localStorage.setItem('columnWidths_groups', `${groupsWidth}px`);
    }
    if (readerWidth > 0) {
        localStorage.setItem('columnWidths_reader', `${readerWidth}px`);
    }
}

// Initialize column resize
function initColumnResize() {
    // Get pane elements
    paneGroups = document.getElementById('pane-groups');
    paneThreads = document.getElementById('pane-threads');
    paneReader = document.getElementById('pane-reader');
    
    if (!paneGroups || !paneThreads || !paneReader) {
        console.warn('Column resize: Pane elements not found');
        return;
    }
    
    // Load saved widths
    loadColumnWidths();
    
    // Create resize handles
    const groupsResizeHandle = document.createElement('div');
    groupsResizeHandle.id = 'resize-handle-groups';
    groupsResizeHandle.className = 'resize-handle resize-handle-vertical';
    groupsResizeHandle.style.cssText = 'width: 4px; cursor: col-resize; background: transparent; position: relative; z-index: 10; user-select: none;';
    
    const readerResizeHandle = document.createElement('div');
    readerResizeHandle.id = 'resize-handle-reader';
    readerResizeHandle.className = 'resize-handle resize-handle-vertical';
    readerResizeHandle.style.cssText = 'width: 4px; cursor: col-resize; background: transparent; position: relative; z-index: 10; user-select: none;';
    
    // Insert resize handles
    if (paneGroups && paneGroups.parentNode) {
        paneGroups.parentNode.insertBefore(groupsResizeHandle, paneThreads);
    }
    if (paneReader && paneReader.parentNode) {
        paneReader.parentNode.insertBefore(readerResizeHandle, paneReader);
    }
    
    // Add hover effect to resize handles
    [groupsResizeHandle, readerResizeHandle].forEach(handle => {
        handle.addEventListener('mouseenter', () => {
            handle.style.background = 'rgba(0, 123, 255, 0.5)';
        });
        handle.addEventListener('mouseleave', () => {
            if (!isResizing) {
                handle.style.background = 'transparent';
            }
        });
    });
    
    // Groups pane resize
    groupsResizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isResizing = true;
        resizeType = 'groups';
        startX = e.clientX;
        startWidth = paneGroups.offsetWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        
        groupsResizeHandle.style.background = 'rgba(0, 123, 255, 0.8)';
    });
    
    // Reader pane resize
    readerResizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isResizing = true;
        resizeType = 'reader';
        startX = e.clientX;
        startWidth = paneReader.offsetWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        
        readerResizeHandle.style.background = 'rgba(0, 123, 255, 0.8)';
    });
    
    // Mouse move handler
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const deltaX = e.clientX - startX;
        
        if (resizeType === 'groups') {
            const newWidth = Math.max(200, Math.min(600, startWidth + deltaX));
            paneGroups.style.width = `${newWidth}px`;
            paneGroups.style.flex = '0 0 auto';
        } else if (resizeType === 'reader') {
            const newWidth = Math.max(300, Math.min(800, startWidth - deltaX));
            paneReader.style.width = `${newWidth}px`;
            paneReader.style.flex = '0 0 auto';
        }
    });
    
    // Mouse up handler
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizeType = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            
            // Reset handle backgrounds
            groupsResizeHandle.style.background = 'transparent';
            readerResizeHandle.style.background = 'transparent';
            
            // Save widths
            saveColumnWidths();
        }
    });
    
    // Prevent text selection while resizing
    document.addEventListener('selectstart', (e) => {
        if (isResizing) {
            e.preventDefault();
        }
    });
}

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

function showLoading() {
    loading.classList.remove('hidden');
}

function hideLoading() {
    loading.classList.add('hidden');
}

function showError(message) {
    error.textContent = message;
    error.classList.remove('hidden');
    setTimeout(() => hideError(), 5000);
}

function hideError() {
    error.classList.add('hidden');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Connect to server
connectBtn.addEventListener('click', async () => {
    currentServer = serverInput.value.trim();
    currentPort = parseInt(portInput.value) || 119;
    currentUsername = usernameInput.value.trim();
    currentPassword = passwordInput.value.trim();
    
    if (!currentServer) {
        showError('Please enter a server address');
        return;
    }
    
    showLoading();
    hideError();
    
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

// Search/filter groups
groupSearchInput.addEventListener('input', () => {
    const searchTerm = groupSearchInput.value.toLowerCase().trim();
    const filtered = searchTerm 
        ? allGroups.filter(g => 
            g.name.toLowerCase().includes(searchTerm) ||
            (g.description && g.description.toLowerCase().includes(searchTerm))
          )
        : allGroups;
    displayGroups(filtered);
});

function displayGroups(groups) {
    groupsList.innerHTML = '';
    
    if (groups.length === 0) {
        groupsList.innerHTML = '<p class="p-4 text-sovereign-text-muted text-sm">No groups found</p>';
        return;
    }
    
    groups.forEach(group => {
        const item = document.createElement('div');
        item.className = 'group-item p-3 border-b border-sovereign-border hover:bg-sovereign-bg cursor-pointer transition-colors';
        item.innerHTML = `
            <div class="font-semibold text-sm mb-1">${escapeHtml(group.name)}</div>
            <div class="text-xs text-sovereign-text-muted">${group.count.toLocaleString()} articles</div>
        `;
        item.addEventListener('click', () => loadThreads(group.name));
        item.tabIndex = 0;
        groupsList.appendChild(item);
    });
}

// Load threads (optimistic - uses cache first)
async function loadThreads(groupName) {
    currentGroup = groupName;
    currentGroupTitle.textContent = groupName;
    threadsList.innerHTML = '<p class="p-4 text-sovereign-text-muted text-sm">Loading threads...</p>';
    
    try {
        const query = buildQueryString({
            server: currentServer,
            port: currentPort,
            ssl: currentSsl,
            limit: 1000,
            offset: 0
        });
        
        // Try new threads endpoint first, fallback to old articles endpoint
        let response = await fetch(buildApiUrl(`/api/groups/${encodeURIComponent(groupName)}/threads?${query}`));
        
        if (!response.ok && response.status === 404) {
            // Fallback to old articles endpoint if threads endpoint doesn't exist
            response = await fetch(buildApiUrl(`/api/groups/${encodeURIComponent(groupName)}/articles?${query}`));
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to load threads');
            }
            
            // Convert old articles format to threads format
            const data = await response.json();
            const articles = data.articles || [];
            virtualScrollItems = articles.map(a => ({
                ...a,
                depth: 0,
                threadMessageCount: 1,
                hasChildren: false
            }));
            
            threadStats.textContent = `${articles.length} articles`;
        } else {
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to load threads');
            }
            
            const data = await response.json();
            virtualScrollItems = data.threads || [];
            
            if (data.stats) {
                threadStats.textContent = `${data.stats.totalThreads} threads, ${data.stats.totalMessages} messages`;
            } else {
                threadStats.textContent = `${virtualScrollItems.length} threads`;
            }
        }
        
        // Initialize virtual scrolling
        initVirtualScrolling();
        renderVirtualScroll();
        
    } catch (err) {
        showError(`Failed to load threads: ${err.message}`);
        console.error('Load threads error:', err);
    }
}

// Virtual Scrolling Implementation
function initVirtualScrolling() {
    virtualScrollContainerHeight = threadsContainer.clientHeight;
    virtualScrollStartIndex = 0;
    virtualScrollEndIndex = Math.ceil(virtualScrollContainerHeight / virtualScrollItemHeight) + 2;
    
    threadsContainer.addEventListener('scroll', handleVirtualScroll);
}

function handleVirtualScroll() {
    const scrollTop = threadsContainer.scrollTop;
    virtualScrollStartIndex = Math.floor(scrollTop / virtualScrollItemHeight);
    virtualScrollEndIndex = Math.min(
        virtualScrollStartIndex + Math.ceil(virtualScrollContainerHeight / virtualScrollItemHeight) + 2,
        virtualScrollItems.length
    );
    
    renderVirtualScroll();
}

function renderVirtualScroll() {
    const visibleItems = virtualScrollItems.slice(virtualScrollStartIndex, virtualScrollEndIndex);
    const offsetY = virtualScrollStartIndex * virtualScrollItemHeight;
    const totalHeight = virtualScrollItems.length * virtualScrollItemHeight;
    
    // Create spacer for items before viewport
    let html = `<div style="height: ${offsetY}px"></div>`;
    
    // Render visible items
    visibleItems.forEach((thread, index) => {
        const actualIndex = virtualScrollStartIndex + index;
        html += renderThreadItem(thread, actualIndex);
    });
    
    // Create spacer for items after viewport
    const remainingHeight = totalHeight - (virtualScrollEndIndex * virtualScrollItemHeight);
    if (remainingHeight > 0) {
        html += `<div style="height: ${remainingHeight}px"></div>`;
    }
    
    threadsList.innerHTML = html;
    
    // Re-attach event listeners
    threadsList.querySelectorAll('.thread-item').forEach((item, idx) => {
        const actualIndex = virtualScrollStartIndex + idx;
        item.addEventListener('click', () => {
            const articleNum = virtualScrollItems[actualIndex]?.number;
            if (articleNum) {
                loadArticle(articleNum);
            }
        });
        item.tabIndex = 0;
    });
}

function renderThreadItem(thread, index) {
    const indent = (thread.depth || 0) * 1.5;
    const subject = escapeHtml(thread.subject || '(no subject)');
    const from = escapeHtml(thread.from || 'unknown');
    const date = thread.date ? new Date(thread.date).toLocaleDateString() : '';
    const articleNumber = thread.number || thread.article_number || 0;
    
    return `
        <div 
            class="thread-item p-3 border-b border-sovereign-border hover:bg-sovereign-bg cursor-pointer transition-colors"
            data-depth="${thread.depth || 0}"
            data-article-number="${articleNumber}"
            style="padding-left: ${indent}rem;"
        >
            <div class="flex items-start justify-between">
                <div class="flex-1 min-w-0">
                    <div class="font-medium text-sm mb-1 truncate">${subject}</div>
                    <div class="text-xs text-sovereign-text-muted space-x-3">
                        <span>${from}</span>
                        ${date ? `<span>${date}</span>` : ''}
                        ${thread.threadMessageCount > 1 ? `<span>${thread.threadMessageCount} msgs</span>` : ''}
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Load article (optimistic - uses cache first)
async function loadArticle(articleNumber) {
    showLoading();
    currentArticle = { number: articleNumber };
    
    // Show article pane and hide threads pane
    const articlePane = document.getElementById('pane-reader');
    const threadsPane = document.getElementById('pane-threads');
    if (articlePane && threadsPane) {
        threadsPane.style.display = 'none';
        articlePane.style.display = 'flex';
    }
    
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
        // Also handle article.header format from getArticle
        let articleBodyText = data.body || '';
        let articleSubjectText = data.subject || '';
        let articleFromText = data.from || '';
        let articleDateText = data.date || '';
        let articleMessageId = data.messageId || '';
        
        // Handle article.header format (from getArticle method)
        if (data.article && data.article.header) {
            articleSubjectText = data.article.header.subject || '';
            articleFromText = data.article.header.from || '';
            articleDateText = data.article.header.date || '';
            articleMessageId = data.article.header.messageId || '';
            articleBodyText = data.article.body || data.body || '';
        } else if (data.article && !data.article.header) {
            // Handle article object without header
            articleBodyText = data.article.body || data.body || '';
            articleSubjectText = data.article.subject || data.subject || '';
            articleFromText = data.article.from || data.from || '';
            articleDateText = data.article.date || data.date || '';
            articleMessageId = data.article.messageId || data.messageId || '';
        }
        
        // If body is null or empty, it's being loaded in background (X-Cache: PARTIAL)
        if (!articleBodyText || articleBodyText === null || articleBodyText === '') {
            // Try to extract from body if it's just the raw body
            if (data.body && typeof data.body === 'string' && data.body.length > 0) {
                articleBodyText = data.body;
                // Try to extract headers from body
                const lines = data.body.split('\n');
                for (let i = 0; i < Math.min(20, lines.length); i++) {
                    const line = lines[i];
                    if (line.startsWith('Subject:')) articleSubjectText = line.substring(8).trim();
                    if (line.startsWith('From:')) articleFromText = line.substring(5).trim();
                    if (line.startsWith('Date:')) articleDateText = line.substring(5).trim();
                    if (line.startsWith('Message-ID:') || line.startsWith('Message-Id:')) {
                        articleMessageId = line.substring(11).trim();
                    }
                }
            } else {
                // No body yet - show loading
                articleSubject.textContent = articleSubjectText || 'Loading...';
                articleFrom.textContent = `From: ${articleFromText || 'unknown'}`;
                articleDate.textContent = `Date: ${articleDateText || 'unknown'}`;
                articleBody.textContent = 'Loading article body...';
                
                // Poll for body (or could use WebSocket in future)
                setTimeout(() => loadArticle(articleNumber), 1000);
                return;
            }
        }
        
        articleSubject.textContent = articleSubjectText || 'No subject';
        articleFrom.textContent = `From: ${articleFromText || 'unknown'}`;
        articleDate.textContent = `Date: ${articleDateText || 'unknown'}`;
        articleBody.textContent = articleBodyText || '';
        
        currentArticle = {
            number: articleNumber,
            subject: articleSubjectText,
            from: articleFromText,
            messageId: articleMessageId
        };
        
    } catch (err) {
        showError(`Failed to load article: ${err.message}`);
        console.error('Article loading error:', err);
        if (articleBody) {
            articleBody.textContent = `Error: ${err.message}`;
        }
    } finally {
        hideLoading();
    }
}

// Post/Reply functionality
newPostBtn.addEventListener('click', () => {
    if (!currentGroup) {
        showError('Please select a newsgroup first');
        return;
    }
    openPostModal('New Post', null);
});

replyBtn.addEventListener('click', () => {
    if (!currentGroup || !currentArticle) {
        showError('No article selected');
        return;
    }
    const subject = currentArticle.subject.startsWith('Re:') 
        ? currentArticle.subject 
        : `Re: ${currentArticle.subject}`;
    openPostModal('Reply', { subject, replyTo: currentArticle.number });
});

function openPostModal(title, replyData) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('post-from').value = '';
    document.getElementById('post-subject').value = replyData?.subject || '';
    document.getElementById('post-body').value = replyData?.quotedBody || '';
    postModal.classList.remove('hidden');
}

document.getElementById('close-modal').addEventListener('click', () => {
    postModal.classList.add('hidden');
});

document.getElementById('cancel-post').addEventListener('click', () => {
    postModal.classList.add('hidden');
});

document.getElementById('submit-post').addEventListener('click', async () => {
    const from = document.getElementById('post-from').value.trim();
    const subject = document.getElementById('post-subject').value.trim();
    const body = document.getElementById('post-body').value.trim();
    
    if (!from || !subject || !body) {
        showError('Please fill in all fields');
        return;
    }
    
    showLoading();
    
    try {
        const payload = {
            server: currentServer,
            port: currentPort,
            ssl: currentSsl,
            group: currentGroup,
            subject,
            from,
            body
        };
        
        if (currentUsername) payload.username = currentUsername;
        if (currentPassword) payload.password = currentPassword;
        
        const response = await fetch(buildApiUrl('/api/post'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to post');
        }
        
        const result = await response.json();
        showError(`Success: ${result.message}`);
        postModal.classList.add('hidden');
        
        // Reload threads after a delay (optimistic - post happens in background)
        setTimeout(() => loadThreads(currentGroup), 2000);
    } catch (err) {
        showError(`Post failed: ${err.message}`);
    } finally {
        hideLoading();
    }
});

// ==================== KEYBOARD NAVIGATION ====================
let keyboardMode = false;
let focusedGroupIndex = -1;
let focusedThreadIndex = -1;

document.addEventListener('keydown', (e) => {
    const activeElement = document.activeElement;
    const isInput = activeElement && (
        activeElement.tagName === 'INPUT' || 
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable
    );
    
    // Don't interfere with typing in inputs (except special keys)
    if (isInput) {
        if (e.key === 'Escape' && !postModal.classList.contains('hidden')) {
            postModal.classList.add('hidden');
            e.preventDefault();
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === '/')) {
            e.preventDefault();
            if (groupSearchInput) {
                groupSearchInput.focus();
                groupSearchInput.select();
            }
        }
        return;
    }
    
    keyboardMode = true;
    handleKeyboardShortcuts(e);
});

document.addEventListener('mousedown', () => {
    keyboardMode = false;
    document.querySelectorAll('.group-item.focused, .thread-item.focused').forEach(el => {
        el.classList.remove('focused');
    });
});

function handleKeyboardShortcuts(e) {
    // Global shortcuts
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        toggleKeyboardHelp();
        return;
    }
    
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === '/')) {
        e.preventDefault();
        if (groupSearchInput) {
            groupSearchInput.focus();
            groupSearchInput.select();
        }
        return;
    }
    
    if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !e.shiftKey) {
        e.preventDefault();
        if (currentGroup && newPostBtn) {
            newPostBtn.click();
        }
        return;
    }
    
    // View-specific navigation - check which pane is visible
    const threadsPane = document.getElementById('pane-threads');
    const articlePane = document.getElementById('pane-reader');
    
    const currentView = articlePane && articlePane.style.display !== 'none' ? 'article' :
                        threadsPane && threadsPane.style.display !== 'none' ? 'threads' : 
                        'groups';
    
    if (currentView === 'groups') {
        handleGroupsNav(e);
    } else if (currentView === 'threads') {
        handleThreadsNav(e);
    } else if (currentView === 'article') {
        handleArticleNav(e);
    }
}

function handleGroupsNav(e) {
    const items = Array.from(groupsList.querySelectorAll('.group-item'));
    if (items.length === 0) return;
    
    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            focusedGroupIndex = Math.min(focusedGroupIndex + 1, items.length - 1);
            focusItem(groupsList, '.group-item', focusedGroupIndex);
            break;
        case 'ArrowUp':
            e.preventDefault();
            focusedGroupIndex = Math.max(focusedGroupIndex - 1, 0);
            focusItem(groupsList, '.group-item', focusedGroupIndex);
            break;
        case 'Home':
            e.preventDefault();
            focusedGroupIndex = 0;
            focusItem(groupsList, '.group-item', 0);
            break;
        case 'End':
            e.preventDefault();
            focusedGroupIndex = items.length - 1;
            focusItem(groupsList, '.group-item', items.length - 1);
            break;
        case 'Enter':
            e.preventDefault();
            if (focusedGroupIndex >= 0 && focusedGroupIndex < items.length) {
                items[focusedGroupIndex].click();
            }
            break;
    }
}

function handleThreadsNav(e) {
    const items = Array.from(threadsList.querySelectorAll('.thread-item'));
    if (items.length === 0) return;
    
    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            focusedThreadIndex = Math.min(focusedThreadIndex + 1, items.length - 1);
            focusItem(threadsList, '.thread-item', focusedThreadIndex);
            break;
        case 'ArrowUp':
            e.preventDefault();
            focusedThreadIndex = Math.max(focusedThreadIndex - 1, 0);
            focusItem(threadsList, '.thread-item', focusedThreadIndex);
            break;
        case 'Home':
            e.preventDefault();
            focusedThreadIndex = 0;
            focusItem(threadsList, '.thread-item', 0);
            break;
        case 'End':
            e.preventDefault();
            focusedThreadIndex = items.length - 1;
            focusItem(threadsList, '.thread-item', items.length - 1);
            break;
        case 'Enter':
            e.preventDefault();
            if (focusedThreadIndex >= 0 && focusedThreadIndex < items.length) {
                const articleNum = parseInt(items[focusedThreadIndex].getAttribute('data-article-number'));
                if (articleNum) loadArticle(articleNum);
            }
            break;
        case 'Escape':
            e.preventDefault();
            if (currentGroup) {
                // Go back to groups view
                const threadsPane = document.getElementById('pane-threads');
                if (threadsPane) {
                    threadsPane.style.display = 'none';
                }
            }
            break;
        case 'n':
            if (!e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                if (currentGroup && newPostBtn) {
                    newPostBtn.click();
                }
            }
            break;
    }
}

function handleArticleNav(e) {
    switch (e.key) {
        case 'Escape':
        case 'Backspace':
            e.preventDefault();
            // Go back to threads view
            const articlePane = document.getElementById('pane-reader');
            const threadsPane = document.getElementById('pane-threads');
            if (articlePane && threadsPane) {
                articlePane.style.display = 'none';
                threadsPane.style.display = 'block';
            }
            break;
        case 'ArrowLeft':
            e.preventDefault();
            navigateToAdjacentArticle(-1);
            break;
        case 'ArrowRight':
            e.preventDefault();
            navigateToAdjacentArticle(1);
            break;
        case 'r':
            if (!e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                if (currentArticle && replyBtn) {
                    replyBtn.click();
                }
            }
            break;
    }
}

function focusItem(container, selector, index) {
    const items = Array.from(container.querySelectorAll(selector));
    items.forEach((item, i) => {
        if (i === index) {
            item.classList.add('focused');
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            item.classList.remove('focused');
        }
    });
}

function navigateToAdjacentArticle(direction) {
    const items = Array.from(threadsList.querySelectorAll('.thread-item'));
    if (items.length === 0) return;
    
    let currentIndex = -1;
    if (currentArticle) {
        currentIndex = items.findIndex(item => 
            parseInt(item.getAttribute('data-article-number')) === currentArticle.number
        );
    }
    
    if (currentIndex === -1) {
        currentIndex = focusedThreadIndex >= 0 ? focusedThreadIndex : 0;
    }
    
    const newIndex = currentIndex + direction;
    if (newIndex >= 0 && newIndex < items.length) {
        const articleNum = parseInt(items[newIndex].getAttribute('data-article-number'));
        if (articleNum) loadArticle(articleNum);
    }
}

// Keyboard shortcuts help
let keyboardHelpVisible = false;
function toggleKeyboardHelp() {
    keyboardHelpVisible = !keyboardHelpVisible;
    let helpDiv = document.getElementById('keyboard-help');
    
    if (!helpDiv) {
        helpDiv = document.createElement('div');
        helpDiv.id = 'keyboard-help';
        helpDiv.className = 'keyboard-help';
        helpDiv.innerHTML = `
            <div class="keyboard-help-content">
                <h3>Keyboard Shortcuts</h3>
                <div class="shortcut-section">
                    <h4>Navigation</h4>
                    <div class="shortcut-list">
                        <div><kbd>↑</kbd><kbd>↓</kbd> Navigate items</div>
                        <div><kbd>Home</kbd> First item</div>
                        <div><kbd>End</kbd> Last item</div>
                        <div><kbd>Enter</kbd> Open/Select</div>
                        <div><kbd>Esc</kbd> Go back</div>
                        <div><kbd>←</kbd><kbd>→</kbd> Previous/Next article</div>
                    </div>
                </div>
                <div class="shortcut-section">
                    <h4>Actions</h4>
                    <div class="shortcut-list">
                        <div><kbd>Ctrl/Cmd</kbd>+<kbd>N</kbd> New post</div>
                        <div><kbd>R</kbd> Reply (in article view)</div>
                        <div><kbd>N</kbd> New post (in threads view)</div>
                        <div><kbd>Ctrl/Cmd</kbd>+<kbd>F</kbd> or <kbd>/</kbd> Search</div>
                    </div>
                </div>
                <div class="shortcut-section">
                    <h4>General</h4>
                    <div class="shortcut-list">
                        <div><kbd>Ctrl/Cmd</kbd>+<kbd>K</kbd> Toggle help</div>
                    </div>
                </div>
                <button id="close-keyboard-help" class="close-help-btn">Close</button>
            </div>
        `;
        document.body.appendChild(helpDiv);
        
        document.getElementById('close-keyboard-help').addEventListener('click', () => {
            toggleKeyboardHelp();
        });
    }
    
    helpDiv.style.display = keyboardHelpVisible ? 'flex' : 'none';
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initColumnResize();
    });
} else {
    // DOM already loaded
    initColumnResize();
}
