// API base URL - defaults to same origin, can be overridden via config
const API_BASE_URL = window.API_BASE_URL || '';

let currentServer = 'news.eternal-september.org';
let currentPort = 119;
let currentSsl = false;
let currentUsername = '';
let currentPassword = '';
let currentGroup = null;
let currentArticle = null;
let allGroups = []; // Store all groups for filtering
let articleOffset = 0; // Track how many articles we've loaded
let hasMoreArticles = false; // Track if more articles are available
let isLoadingMore = false; // Prevent multiple simultaneous loads
let groupInfo = null; // Store group info (first, last, total)

// DOM elements
const serverInput = document.getElementById('server');
const portInput = document.getElementById('port');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const connectBtn = document.getElementById('connect');
const groupSearchInput = document.getElementById('group-search');
const groupsList = document.getElementById('groups-list');
const articlesPanel = document.getElementById('articles-panel');
const articlePanel = document.getElementById('article-panel');
const welcome = document.getElementById('welcome');
const articlesList = document.getElementById('articles-list');
const currentGroupTitle = document.getElementById('current-group');
const backBtn = document.getElementById('back-to-articles');
const loading = document.getElementById('loading');
const error = document.getElementById('error');
const newPostBtn = document.getElementById('new-post-btn');
const replyBtn = document.getElementById('reply-btn');
const postModal = document.getElementById('post-modal');
const closeModal = document.getElementById('close-modal');
const cancelPost = document.getElementById('cancel-post');
const submitPost = document.getElementById('submit-post');
const modalTitle = document.getElementById('modal-title');
const postFrom = document.getElementById('post-from');
const postSubject = document.getElementById('post-subject');
const postBody = document.getElementById('post-body');

// Helper function to build API URL
function buildApiUrl(endpoint) {
    return `${API_BASE_URL}${endpoint}`;
}

// Helper function to build query string with auth
function buildQueryString(baseParams) {
    const params = new URLSearchParams(baseParams);
    if (currentUsername) params.append('username', currentUsername);
    if (currentPassword) params.append('password', currentPassword);
    return params.toString();
}

// Connect to server and load groups
connectBtn.addEventListener('click', async () => {
    currentServer = serverInput.value.trim();
    currentPort = parseInt(portInput.value) || 119;
    const newUsername = usernameInput.value.trim();
    const newPassword = passwordInput.value.trim();
    
    // If credentials changed, clear old connections first
    if (newUsername !== currentUsername || newPassword !== currentPassword) {
        try {
            await fetch(buildApiUrl('/api/clear-connections'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    server: currentServer,
                    port: currentPort,
                    ssl: currentSsl
                })
            });
        } catch (err) {
            // Ignore clear errors, continue with connection
        }
    }
    
    currentUsername = newUsername;
    currentPassword = newPassword;
    
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
        const apiUrl = buildApiUrl(`/api/groups?${query}`);
        
        const response = await fetch(apiUrl, {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            let errorMessage = 'Failed to connect';
            try {
                const data = await response.json();
                errorMessage = data.error || errorMessage;
            } catch (e) {
                errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }
        
        const groups = await response.json();
        allGroups = groups; // Store all groups
        filterAndDisplayGroups();
    } catch (err) {
        // Provide more detailed error messages
        let errorMsg = err.message;
        if (err.message === 'Failed to fetch' || err.message.includes('load failed')) {
            errorMsg = 'Network error: Cannot reach backend server. Check your internet connection and verify the API URL is correct.';
        } else if (err.message.includes('CORS')) {
            errorMsg = 'CORS error: Backend server is not allowing requests from this origin.';
        }
        showError(`Connection failed: ${errorMsg}`);
        console.error('Connection error:', err);
        console.error('API URL:', buildApiUrl('/api/groups'));
    } finally {
        hideLoading();
    }
});

// Search/filter groups
groupSearchInput.addEventListener('input', (e) => {
    filterAndDisplayGroups();
});

function filterAndDisplayGroups() {
    const searchTerm = groupSearchInput.value.toLowerCase().trim();
    
    let filteredGroups = allGroups;
    
    if (searchTerm) {
        filteredGroups = allGroups.filter(group => 
            group.name.toLowerCase().includes(searchTerm) ||
            (group.description && group.description.toLowerCase().includes(searchTerm))
        );
    }
    
    displayGroups(filteredGroups);
}

// Display groups
function displayGroups(groups) {
    groupsList.innerHTML = '';
    
    if (groups.length === 0) {
        groupsList.innerHTML = '<p class="info">No groups found</p>';
        return;
    }
    
    // Show count if filtered
    if (groupSearchInput.value.trim()) {
        const countInfo = document.createElement('div');
        countInfo.className = 'info';
        countInfo.style.padding = '8px';
        countInfo.style.marginBottom = '8px';
        countInfo.textContent = `Showing ${groups.length} of ${allGroups.length} groups`;
        groupsList.appendChild(countInfo);
    }
    
    groups.forEach(group => {
        const item = document.createElement('div');
        item.className = 'group-item';
        item.innerHTML = `
            <div class="group-name">${escapeHtml(group.name)}</div>
            <div class="group-info">${group.count.toLocaleString()} articles</div>
        `;
        
        item.addEventListener('click', () => {
            // Remove active class from all items
            document.querySelectorAll('.group-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            loadArticles(group.name);
        });
        
        groupsList.appendChild(item);
    });
}

// Load articles for a group
async function loadArticles(groupName, append = false) {
    if (groupName !== currentGroup) {
        // New group - reset pagination
        articleOffset = 0;
        hasMoreArticles = false;
        groupInfo = null;
        if (!append) {
            articlesList.innerHTML = '';
        }
    }
    
    currentGroup = groupName;
    currentGroupTitle.textContent = groupName;
    
    if (!append) {
        showLoading();
        hideError();
        welcome.style.display = 'none';
        articlesPanel.style.display = 'block';
        articlePanel.style.display = 'none';
    }
    
    if (isLoadingMore) {
        return; // Already loading
    }
    
    isLoadingMore = true;
    
    try {
        const query = buildQueryString({
            server: currentServer,
            port: currentPort,
            ssl: currentSsl,
            limit: 20,
            offset: articleOffset
        });
        const response = await fetch(buildApiUrl(`/api/groups/${encodeURIComponent(groupName)}/articles?${query}`));
        
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to load articles');
        }
        
        const data = await response.json();
        const articles = data.articles || data; // Support both old and new format
        
        // Store group info
        if (data.first !== undefined) {
            groupInfo = {
                first: data.first,
                last: data.last,
                total: data.total,
                loaded: data.loaded || articleOffset + articles.length
            };
            hasMoreArticles = data.hasMore !== undefined ? data.hasMore : (groupInfo.loaded < groupInfo.total);
        }
        
        if (articles.length > 0) {
            displayArticles(articles, append);
            articleOffset += articles.length;
        } else {
            hasMoreArticles = false;
        }
    } catch (err) {
        if (!append) {
            showError(`Failed to load articles: ${err.message}`);
        }
    } finally {
        isLoadingMore = false;
        if (!append) {
            hideLoading();
        }
    }
}

// Display articles
function displayArticles(articles, append = false) {
    if (!append) {
        articlesList.innerHTML = '';
    }
    
    // Remove "no articles" or "loading more" messages if present
    const existingMessages = articlesList.querySelectorAll('.info, .loading-more');
    existingMessages.forEach(msg => msg.remove());
    
    if (articles.length === 0 && !append) {
        articlesList.innerHTML = '<p class="info">No articles found</p>';
        return;
    }
    
    articles.forEach(article => {
        // Check if article already exists (prevent duplicates)
        const existing = articlesList.querySelector(`[data-article-number="${article.number}"]`);
        if (existing) {
            return;
        }
        
        const item = document.createElement('div');
        item.className = 'article-item';
        item.setAttribute('data-article-number', article.number);
        item.innerHTML = `
            <div class="article-subject">${escapeHtml(article.subject)}</div>
            <div class="article-meta">
                <span>From: ${escapeHtml(article.from)}</span>
                <span>Date: ${escapeHtml(article.date)}</span>
            </div>
        `;
        
        item.addEventListener('click', () => {
            loadArticle(article.number);
        });
        
        articlesList.appendChild(item);
    });
    
    // Add loading indicator or end message
    if (hasMoreArticles) {
        const loadingMore = document.createElement('div');
        loadingMore.className = 'loading-more info';
        loadingMore.textContent = 'Scroll for more articles...';
        loadingMore.id = 'loading-more-indicator';
        articlesList.appendChild(loadingMore);
    } else if (groupInfo && groupInfo.loaded >= groupInfo.total) {
        const endMessage = document.createElement('div');
        endMessage.className = 'info';
        endMessage.textContent = `All ${groupInfo.total.toLocaleString()} articles loaded`;
        articlesList.appendChild(endMessage);
    }
}

// Load article body
async function loadArticle(articleNumber) {
    showLoading();
    hideError();
    articlesPanel.style.display = 'none';
    articlePanel.style.display = 'block';
    
    try {
        const query = buildQueryString({
            server: currentServer,
            port: currentPort,
            ssl: currentSsl,
            group: currentGroup  // Include group name for article access
        });
        const response = await fetch(buildApiUrl(`/api/articles/${articleNumber}?${query}`));
        
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to load article');
        }
        
        const data = await response.json();
        
        // Try to extract subject, from, date from the body if available
        const body = data.body;
        const lines = body.split('\n');
        
        let subject = '';
        let from = '';
        let date = '';
        let messageId = '';
        
        for (let i = 0; i < Math.min(20, lines.length); i++) {
            const line = lines[i];
            if (line.startsWith('Subject:')) {
                subject = line.substring(8).trim();
            } else if (line.startsWith('From:')) {
                from = line.substring(5).trim();
            } else if (line.startsWith('Date:')) {
                date = line.substring(5).trim();
            } else if (line.startsWith('Message-ID:') || line.startsWith('Message-Id:')) {
                messageId = line.substring(11).trim();
            }
        }
        
        // Store current article info for replies
        currentArticle = {
            number: articleNumber,
            subject: subject,
            from: from,
            messageId: messageId
        };
        
        document.getElementById('article-subject').textContent = subject || 'No subject';
        document.getElementById('article-from').textContent = `From: ${from || 'unknown'}`;
        document.getElementById('article-date').textContent = `Date: ${date || 'unknown'}`;
        document.getElementById('article-body').textContent = body;
    } catch (err) {
        showError(`Failed to load article: ${err.message}`);
    } finally {
        hideLoading();
    }
}

// Back button
backBtn.addEventListener('click', () => {
    articlePanel.style.display = 'none';
    articlesPanel.style.display = 'block';
});

// Infinite scroll: Load more articles when scrolling near bottom
function checkScrollAndLoadMore() {
    if (isLoadingMore || !hasMoreArticles || !currentGroup || articlesPanel.style.display === 'none') {
        return;
    }
    
    // Check if articles list has its own scroll
    const hasScroll = articlesList.scrollHeight > articlesList.clientHeight;
    
    if (hasScroll) {
        // Articles list has its own scroll
        const scrollTop = articlesList.scrollTop;
        const scrollHeight = articlesList.scrollHeight;
        const clientHeight = articlesList.clientHeight;
        
        // Load more when within 300px of bottom
        if (scrollHeight - scrollTop - clientHeight < 300) {
            loadArticles(currentGroup, true); // append = true
        }
    } else {
        // Window scroll - check if articles list is near bottom of viewport
        const articlesListRect = articlesList.getBoundingClientRect();
        const windowHeight = window.innerHeight;
        
        // If articles list bottom is near viewport bottom, load more
        if (articlesListRect.bottom - windowHeight < 400) {
            loadArticles(currentGroup, true); // append = true
        }
    }
}

// Listen to articles list scroll
articlesList.addEventListener('scroll', () => {
    checkScrollAndLoadMore();
});

// Also handle window scroll (for mobile and when list doesn't have its own scroll)
let scrollTimeout;
window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
        checkScrollAndLoadMore();
    }, 150); // Debounce scroll events
}, { passive: true });

// New Post button
newPostBtn.addEventListener('click', () => {
    if (!currentGroup) {
        showError('Please select a newsgroup first');
        return;
    }
    
    modalTitle.textContent = 'New Post';
    postFrom.value = '';
    postSubject.value = '';
    postBody.value = '';
    postModal.style.display = 'flex';
    currentArticle = null;
});

// Reply button
replyBtn.addEventListener('click', () => {
    if (!currentGroup || !currentArticle) {
        showError('No article selected');
        return;
    }
    
    modalTitle.textContent = 'Reply';
    postFrom.value = '';
    postSubject.value = currentArticle.subject.startsWith('Re:') 
        ? currentArticle.subject 
        : `Re: ${currentArticle.subject}`;
    
    // Quote the original message
    const originalBody = document.getElementById('article-body').textContent;
    const quotedBody = `\n\nOn ${document.getElementById('article-date').textContent.replace('Date: ', '')}, ${currentArticle.from} wrote:\n\n${originalBody.split('\n').map(line => '> ' + line).join('\n')}\n\n`;
    postBody.value = quotedBody;
    postModal.style.display = 'flex';
});

// Close modal
closeModal.addEventListener('click', () => {
    postModal.style.display = 'none';
});

cancelPost.addEventListener('click', () => {
    postModal.style.display = 'none';
});

// Submit post/reply
submitPost.addEventListener('click', async () => {
    const from = postFrom.value.trim();
    const subject = postSubject.value.trim();
    const body = postBody.value.trim();
    
    if (!from || !subject || !body) {
        showError('Please fill in all fields');
        return;
    }
    
    if (!currentGroup) {
        showError('No newsgroup selected');
        return;
    }
    
    showLoading();
    hideError();
    
    try {
        const payload = {
            server: currentServer,
            port: currentPort,
            ssl: currentSsl,
            group: currentGroup,
            subject: subject,
            from: from,
            body: body
        };
        
        if (currentUsername) payload.username = currentUsername;
        if (currentPassword) payload.password = currentPassword;
        
        let endpoint = buildApiUrl('/api/post');
        if (currentArticle) {
            endpoint = buildApiUrl('/api/reply');
            payload.replyTo = currentArticle.number;
        }
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to post');
        }
        
        const result = await response.json();
        showError(`Success: ${result.message}`);
        postModal.style.display = 'none';
        
        // Reload articles to show the new post
        if (articlesPanel.style.display !== 'none') {
            loadArticles(currentGroup);
        }
    } catch (err) {
        showError(`Post failed: ${err.message}`);
    } finally {
        hideLoading();
    }
});

// Utility functions
function showLoading() {
    loading.style.display = 'block';
}

function hideLoading() {
    loading.style.display = 'none';
}

function showError(message) {
    error.textContent = message;
    error.style.display = 'block';
    // Show error longer on mobile (10 seconds instead of 5)
    const timeout = window.innerWidth < 768 ? 10000 : 5000;
    setTimeout(() => {
        hideError();
    }, timeout);
    
    // Scroll error into view on mobile
    if (window.innerWidth < 768) {
        setTimeout(() => {
            error.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
    }
}

function hideError() {
    error.style.display = 'none';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

