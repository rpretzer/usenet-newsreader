let currentServer = 'news.eternal-september.org';
let currentPort = 119;
let currentSsl = false;
let currentGroup = null;

// DOM elements
const serverInput = document.getElementById('server');
const portInput = document.getElementById('port');
const connectBtn = document.getElementById('connect');
const groupsList = document.getElementById('groups-list');
const articlesPanel = document.getElementById('articles-panel');
const articlePanel = document.getElementById('article-panel');
const welcome = document.getElementById('welcome');
const articlesList = document.getElementById('articles-list');
const currentGroupTitle = document.getElementById('current-group');
const backBtn = document.getElementById('back-to-articles');
const loading = document.getElementById('loading');
const error = document.getElementById('error');

// Connect to server and load groups
connectBtn.addEventListener('click', async () => {
    currentServer = serverInput.value.trim();
    currentPort = parseInt(portInput.value) || 119;
    
    if (!currentServer) {
        showError('Please enter a server address');
        return;
    }
    
    showLoading();
    hideError();
    
    try {
        const response = await fetch(`/api/groups?server=${encodeURIComponent(currentServer)}&port=${currentPort}&ssl=${currentSsl}`);
        
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to connect');
        }
        
        const groups = await response.json();
        displayGroups(groups);
    } catch (err) {
        showError(`Connection failed: ${err.message}`);
    } finally {
        hideLoading();
    }
});

// Display groups
function displayGroups(groups) {
    groupsList.innerHTML = '';
    
    if (groups.length === 0) {
        groupsList.innerHTML = '<p class="info">No groups found</p>';
        return;
    }
    
    groups.forEach(group => {
        const item = document.createElement('div');
        item.className = 'group-item';
        item.innerHTML = `
            <div class="group-name">${escapeHtml(group.name)}</div>
            <div class="group-info">${group.count} articles</div>
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
async function loadArticles(groupName) {
    currentGroup = groupName;
    currentGroupTitle.textContent = groupName;
    
    showLoading();
    hideError();
    welcome.style.display = 'none';
    articlesPanel.style.display = 'block';
    articlePanel.style.display = 'none';
    
    try {
        const response = await fetch(`/api/groups/${encodeURIComponent(groupName)}/articles?server=${encodeURIComponent(currentServer)}&port=${currentPort}&ssl=${currentSsl}&limit=20`);
        
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to load articles');
        }
        
        const articles = await response.json();
        displayArticles(articles);
    } catch (err) {
        showError(`Failed to load articles: ${err.message}`);
    } finally {
        hideLoading();
    }
}

// Display articles
function displayArticles(articles) {
    articlesList.innerHTML = '';
    
    if (articles.length === 0) {
        articlesList.innerHTML = '<p class="info">No articles found</p>';
        return;
    }
    
    articles.forEach(article => {
        const item = document.createElement('div');
        item.className = 'article-item';
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
}

// Load article body
async function loadArticle(articleNumber) {
    showLoading();
    hideError();
    articlesPanel.style.display = 'none';
    articlePanel.style.display = 'block';
    
    try {
        const response = await fetch(`/api/articles/${articleNumber}?server=${encodeURIComponent(currentServer)}&port=${currentPort}&ssl=${currentSsl}`);
        
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
        
        for (let i = 0; i < Math.min(20, lines.length); i++) {
            const line = lines[i];
            if (line.startsWith('Subject:')) {
                subject = line.substring(8).trim();
            } else if (line.startsWith('From:')) {
                from = line.substring(5).trim();
            } else if (line.startsWith('Date:')) {
                date = line.substring(5).trim();
            }
        }
        
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
    setTimeout(() => {
        hideError();
    }, 5000);
}

function hideError() {
    error.style.display = 'none';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

