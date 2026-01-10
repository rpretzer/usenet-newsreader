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
        
        const response = await fetch(buildApiUrl(`/api/groups/${encodeURIComponent(groupName)}/threads?${query}`));
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to load threads');
        }
        
        const data = await response.json();
        virtualScrollItems = data.threads || [];
        
        // Update stats
        if (data.stats) {
            threadStats.textContent = `${data.stats.totalThreads} threads, ${data.stats.totalMessages} messages`;
        }
        
        // Initialize virtual scrolling
        initVirtualScrolling();
        renderVirtualScroll();
        
    } catch (err) {
        showError(`Failed to load threads: ${err.message}`);
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
        item.addEventListener('click', () => loadArticle(virtualScrollItems[actualIndex].number));
        item.tabIndex = 0;
    });
}

function renderThreadItem(thread, index) {
    const indent = thread.depth * 1.5;
    const subject = escapeHtml(thread.subject || '(no subject)');
    const from = escapeHtml(thread.from || 'unknown');
    const date = thread.date ? new Date(thread.date).toLocaleDateString() : '';
    
    return `
        <div 
            class="thread-item p-3 border-b border-sovereign-border hover:bg-sovereign-bg cursor-pointer transition-colors"
            data-depth="${thread.depth}"
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
        
        // If body is null, it's being loaded in background (X-Cache: PARTIAL)
        if (data.body === null) {
            articleSubject.textContent = data.subject || 'Loading...';
            articleFrom.textContent = `From: ${data.from || 'unknown'}`;
            articleDate.textContent = `Date: ${data.date || 'unknown'}`;
            articleBody.textContent = 'Loading article body...';
            
            // Poll for body (or could use WebSocket in future)
            setTimeout(() => loadArticle(articleNumber), 1000);
            return;
        }
        
        articleSubject.textContent = data.subject || 'No subject';
        articleFrom.textContent = `From: ${data.from || 'unknown'}`;
        articleDate.textContent = `Date: ${data.date || 'unknown'}`;
        articleBody.textContent = data.body || '';
        
        currentArticle = {
            number: articleNumber,
            subject: data.subject,
            from: data.from,
            messageId: data.messageId
        };
        
    } catch (err) {
        showError(`Failed to load article: ${err.message}`);
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

// Keyboard navigation (simplified for now)
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        if (e.key === 'Escape' && postModal.classList.contains('hidden') === false) {
            postModal.classList.add('hidden');
        }
        return;
    }
    
    // Add keyboard shortcuts here as needed
});
