// High-Performance Streaming Usenet Newsreader with WebSocket/Pooling
// Uses Socket.io for real-time communication and eliminates handshake lag

const SOCKET_URL = window.SOCKET_URL || '';

let socket = null;
let currentServer = 'news.eternal-september.org';
let currentPort = 119;
let currentSsl = false;
let currentUsername = '';
let currentPassword = '';
let currentGroup = null;
let currentArticle = null;
let allGroups = [];

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

// Initialize Socket.io connection
function initSocket() {
  const socketUrl = SOCKET_URL || window.location.origin;
  socket = io(socketUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5
  });
  
  socket.on('connect', () => {
    console.log('WebSocket connected');
    hideError();
  });
  
  socket.on('disconnect', () => {
    console.log('WebSocket disconnected');
    showError('Connection lost. Reconnecting...');
  });
  
  socket.on('connect_error', (err) => {
    console.error('WebSocket connection error:', err);
    showError('Failed to connect to server');
  });
  
  // Handle real-time updates
  socket.on('groups_updated', (data) => {
    console.log('Groups updated:', data);
    if (data.groups) {
      allGroups = data.groups;
      displayGroups(allGroups);
    }
  });
  
  socket.on('threads_updated', (data) => {
    console.log('Threads updated:', data);
    if (data.threads) {
      virtualScrollItems = data.threads;
      renderVirtualScroll();
      
      if (data.stats) {
        threadStats.textContent = `${data.stats.totalThreads} threads, ${data.stats.totalMessages} messages`;
      }
    }
  });
  
  socket.on('article_updated', (data) => {
    console.log('Article updated:', data);
    if (data.article && data.article.body) {
      articleBody.textContent = data.article.body;
      currentArticle = {
        number: data.article.number,
        subject: data.article.subject,
        from: data.article.from,
        messageId: data.article.messageId
      };
    }
  });
  
  socket.on('post_success', (data) => {
    showError(`Success: ${data.message || 'Article posted'}`);
    // Reload threads after a delay
    setTimeout(() => {
      if (currentGroup) {
        loadThreads(currentGroup);
      }
    }, 2000);
  });
  
  socket.on('post_error', (data) => {
    showError(`Post failed: ${data.message}`);
  });
  
  socket.on('error', (data) => {
    showError(data.message || 'An error occurred');
  });
}

// Helper functions
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

// Connect to server via WebSocket
connectBtn.addEventListener('click', async () => {
  currentServer = serverInput.value.trim();
  currentPort = parseInt(portInput.value) || 119;
  currentUsername = usernameInput.value.trim();
  currentPassword = passwordInput.value.trim();
  
  if (!currentServer) {
    showError('Please enter a server address');
    return;
  }
  
  // Initialize socket if not already connected
  if (!socket || !socket.connected) {
    initSocket();
    // Wait for connection
    await new Promise((resolve, reject) => {
      if (socket.connected) {
        resolve();
      } else {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      }
    });
  }
  
  showLoading();
  hideError();
  
  // Request groups via WebSocket
  socket.emit('get_groups', {
    server: currentServer,
    port: currentPort,
    ssl: currentSsl,
    username: currentUsername || null,
    password: currentPassword || null
  }, (response) => {
    hideLoading();
    
    if (response.error) {
      showError(`Connection failed: ${response.error}`);
      return;
    }
    
    if (response.groups) {
      allGroups = response.groups;
      displayGroups(response.groups);
      console.log(`Loaded ${response.groups.length} groups (cached: ${response.cached})`);
    }
  });
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

// Load threads via WebSocket (uses pooled connection)
async function loadThreads(groupName) {
  currentGroup = groupName;
  currentGroupTitle.textContent = groupName;
  threadsList.innerHTML = '<p class="p-4 text-sovereign-text-muted text-sm">Loading threads...</p>';
  
  if (!socket || !socket.connected) {
    showError('Not connected to server');
    return;
  }
  
  socket.emit('get_threads', {
    server: currentServer,
    port: currentPort,
    ssl: currentSsl,
    username: currentUsername || null,
    password: currentPassword || null,
    group: groupName,
    limit: 1000,
    offset: 0
  }, (response) => {
    if (response.error) {
      showError(`Failed to load threads: ${response.error}`);
      return;
    }
    
    virtualScrollItems = response.threads || [];
    
    // Update stats
    if (response.stats) {
      threadStats.textContent = `${response.stats.totalThreads} threads, ${response.stats.totalMessages} messages`;
    }
    
    console.log(`Loaded ${virtualScrollItems.length} threads (cached: ${response.cached})`);
    
    // Initialize virtual scrolling
    initVirtualScrolling();
    renderVirtualScroll();
  });
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

// Load article via WebSocket (uses pooled connection)
async function loadArticle(articleNumber) {
  showLoading();
  currentArticle = { number: articleNumber };
  
  if (!socket || !socket.connected) {
    showError('Not connected to server');
    hideLoading();
    return;
  }
  
  socket.emit('get_article', {
    server: currentServer,
    port: currentPort,
    ssl: currentSsl,
    username: currentUsername || null,
    password: currentPassword || null,
    group: currentGroup,
    articleNumber: articleNumber
  }, (response) => {
    hideLoading();
    
    if (response.error) {
      showError(`Failed to load article: ${response.error}`);
      return;
    }
    
    const article = response.article;
    
    // If body is null, it's being loaded in background (cached: 'partial')
    if (response.cached === 'partial' && !article.body) {
      articleSubject.textContent = article.subject || 'Loading...';
      articleFrom.textContent = `From: ${article.from || 'unknown'}`;
      articleDate.textContent = `Date: ${article.date || 'unknown'}`;
      articleBody.textContent = 'Loading article body...';
      // Body will arrive via 'article_updated' event
      return;
    }
    
    articleSubject.textContent = article.subject || 'No subject';
    articleFrom.textContent = `From: ${article.from || 'unknown'}`;
    articleDate.textContent = `Date: ${article.date || 'unknown'}`;
    articleBody.textContent = article.body || '';
    
    currentArticle = {
      number: articleNumber,
      subject: article.subject,
      from: article.from,
      messageId: article.messageId
    };
    
    console.log(`Loaded article ${articleNumber} (cached: ${response.cached})`);
  });
}

// Post/Reply functionality via WebSocket
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
  
  if (!socket || !socket.connected) {
    showError('Not connected to server');
    return;
  }
  
  showLoading();
  
  socket.emit('post_article', {
    server: currentServer,
    port: currentPort,
    ssl: currentSsl,
    username: currentUsername || null,
    password: currentPassword || null,
    group: currentGroup,
    subject,
    from,
    body
  }, (response) => {
    hideLoading();
    
    if (response.error) {
      showError(`Post failed: ${response.error}`);
      return;
    }
    
    // Success callback is immediate (optimistic)
    postModal.classList.add('hidden');
    // Actual success/failure will come via 'post_success' or 'post_error' events
  });
});

// Initialize socket on page load
document.addEventListener('DOMContentLoaded', () => {
  initSocket();
});

// Keyboard navigation
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    if (e.key === 'Escape' && !postModal.classList.contains('hidden')) {
      postModal.classList.add('hidden');
    }
    return;
  }
  
  // Add keyboard shortcuts as needed
});
