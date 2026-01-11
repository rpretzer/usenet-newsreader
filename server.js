const express = require('express');
const path = require('path');
const compression = require('compression');
const NNTPClient = require('./nntp-client');
const db = require('./db');
const { buildThreadTree, flattenThreads, getThreadStats } = require('./threading');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable gzip compression for all responses
app.use(compression());

// CORS configuration for GitHub Pages deployment
// Allow all origins for mobile browser compatibility
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  // Allow requests from any origin (for mobile browsers and different domains)
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  
  next();
});

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// Store active NNTP connections
const connections = new Map();

// Simple in-memory cache for groups (5 minute TTL)
const groupsCache = new Map();

// Helper to clear connections for a server (useful when credentials change)
function clearConnections(server, port = 119, ssl = false) {
  const pattern = `${server}:${port}:${ssl}:`;
  for (const [key, client] of connections.entries()) {
    if (key.startsWith(pattern)) {
      try {
        client.disconnect();
      } catch (err) {
        // Ignore disconnect errors
      }
      connections.delete(key);
    }
  }
}

// Helper function to get or create NNTP connection
async function getConnection(server, port = 119, ssl = false, username = null, password = null) {
  // Create a key that includes credentials (using a simple hash of password for security)
  const credHash = password ? Buffer.from(password).toString('base64').substring(0, 16) : 'anon';
  const key = `${server}:${port}:${ssl}:${username || 'anon'}:${credHash}`;
  
  // Check if we have a connection with different credentials for same user
  // If so, disconnect the old one
  const oldKeyPattern = `${server}:${port}:${ssl}:${username || 'anon'}:`;
  for (const [existingKey, client] of connections.entries()) {
    if (existingKey.startsWith(oldKeyPattern) && existingKey !== key) {
      try {
        client.disconnect();
      } catch (err) {
        // Ignore disconnect errors
      }
      connections.delete(existingKey);
    }
  }
  
  // Check if existing connection is still valid
  if (connections.has(key)) {
    const client = connections.get(key);
    if (!client.isConnected()) {
      // Connection is dead, remove it and create a new one
      try {
        client.disconnect();
      } catch (err) {
        // Ignore disconnect errors
      }
      connections.delete(key);
    }
  }
  
  if (!connections.has(key)) {
    const client = new NNTPClient({
      host: server,
      port: port,
      ssl: ssl,
      username: username,
      password: password
    });
    
    await client.connect();
    connections.set(key, client);
  }
  
  return connections.get(key);
}

// API: Clear connections (for debugging/credential changes)
app.post('/api/clear-connections', (req, res) => {
  const server = req.body.server || null;
  const port = req.body.port || 119;
  const ssl = req.body.ssl === true;
  
  if (server) {
    clearConnections(server, port, ssl);
  } else {
    // Clear all connections
    for (const [key, client] of connections.entries()) {
      try {
        client.disconnect();
      } catch (err) {
        // Ignore disconnect errors
      }
    }
    connections.clear();
  }
  
  res.json({ success: true, message: 'Connections cleared' });
});

// API: List newsgroups
app.get('/api/groups', async (req, res) => {
  try {
    const server = req.query.server || 'news.eternal-september.org';
    const port = parseInt(req.query.port) || 119;
    const ssl = req.query.ssl === 'true';
    const username = req.query.username || null;
    const password = req.query.password || null;
    
    // Create cache key
    const cacheKey = `${server}:${port}:${ssl}:${username || 'anon'}`;
    const cached = groupsCache.get(cacheKey);
    
    // Return cached data if available and not expired (5 minutes)
    if (cached && (Date.now() - cached.timestamp) < 300000) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached.data);
    }
    
    const client = await getConnection(server, port, ssl, username, password);
    const groups = await client.list();
    
    // Filter to text-only groups and format
    const textGroups = groups
      .filter(g => !g.name.includes('.binaries') && !g.name.includes('.bin'))
      .map(g => {
        // Calculate actual article count: last - first + 1
        const articleCount = g.last >= g.first ? (g.last - g.first + 1) : 0;
        return {
          name: g.name,
          description: g.description || '',
          count: articleCount,
          first: g.first,
          last: g.last
        };
      });
    
    // Cache the result
    groupsCache.set(cacheKey, {
      data: textGroups,
      timestamp: Date.now()
    });
    
    // Clean up old cache entries (older than 10 minutes)
    for (const [key, value] of groupsCache.entries()) {
      if (Date.now() - value.timestamp > 600000) {
        groupsCache.delete(key);
      }
    }
    
    res.setHeader('X-Cache', 'MISS');
    res.json(textGroups);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Get articles from a group
app.get('/api/groups/:group/articles', async (req, res) => {
  try {
    const group = decodeURIComponent(req.params.group);
    const server = req.query.server || 'news.eternal-september.org';
    const port = parseInt(req.query.port) || 119;
    const ssl = req.query.ssl === 'true';
    const username = req.query.username || null;
    const password = req.query.password || null;
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0; // New: support pagination
    
    const client = await getConnection(server, port, ssl, username, password);
    
    // Select the group
    const info = await client.group(group);
    
    // Calculate article range
    // offset=0 means start from the newest articles (last)
    // We load articles in reverse order (newest first)
    const totalArticles = info.last >= info.first ? (info.last - info.first + 1) : 0;
    const startOffset = Math.max(0, totalArticles - limit - offset);
    const endOffset = totalArticles - offset;
    
    const start = Math.max(info.first, info.first + startOffset);
    const end = Math.min(info.last, info.first + endOffset - 1);
    
    // Check if we've reached the beginning
    if (start > end || start < info.first) {
      res.json({ articles: [], hasMore: false, first: info.first, last: info.last, total: totalArticles });
      return;
    }
    
    // Get headers for multiple articles
    const headers = await client.getHeaders(start, end);
    
    const articles = headers.map(h => ({
      number: h.number,
      subject: h.subject || '(no subject)',
      from: h.from || 'unknown',
      date: h.date || '',
      messageId: h.messageId || ''
    }));
    
    // Check if there are more articles to load
    const hasMore = (offset + articles.length) < totalArticles;
    
    res.json({
      articles: articles,
      hasMore: hasMore,
      first: info.first,
      last: info.last,
      total: totalArticles,
      loaded: offset + articles.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Get threaded headers (fallback - creates threads from articles)
app.get('/api/groups/:group/threads', async (req, res) => {
  try {
    const groupName = decodeURIComponent(req.params.group);
    const server = req.query.server || 'news.eternal-september.org';
    const port = parseInt(req.query.port) || 119;
    const ssl = req.query.ssl === 'true';
    const username = req.query.username || null;
    const password = req.query.password || null;
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    
    // Try to use database if available, otherwise fallback to direct fetch
    let allHeaders = [];
    
    try {
      const serverId = db.getOrCreateServer(server, port, ssl, username);
      const dbGroup = db.getGroup(serverId, groupName);
      
      if (dbGroup) {
        const dbHeaders = db.getAllHeadersForThreading(serverId, groupName);
        
        // Convert database format (snake_case) to threading format (camelCase)
        allHeaders = dbHeaders.map(h => ({
          number: h.article_number || 0,
          subject: h.subject || '',
          from: h.from_addr || '',
          date: h.date || '',
          messageId: h.message_id || '',
          references: h.references || ''
        }));
        
        // Build thread tree
        const rootThreads = buildThreadTree(allHeaders);
        const flattened = flattenThreads(rootThreads);
        const paginated = flattened.slice(offset, offset + limit);
        const stats = getThreadStats(rootThreads);
        
        res.json({
          threads: paginated,
          stats: stats,
          hasMore: (offset + limit) < flattened.length,
          total: flattened.length
        });
        
        // Background sync
        (async () => {
          try {
            const client = await getConnection(server, port, ssl, username, password);
            await client.group(groupName);
            const info = await client.group(groupName);
            
            // Fetch latest headers if needed
            const start = Math.max(info.first, info.last - 500);
            const end = info.last;
            const headers = await client.getHeaders(start, end);
            
            if (headers && headers.length > 0) {
              // Headers already in correct format (camelCase) for cacheHeaders
              db.cacheHeaders(serverId, groupName, headers);
            }
          } catch (err) {
            console.error('Background headers sync error:', err);
          }
        })();
        
        return;
      }
    } catch (dbErr) {
      console.warn('Database not available, falling back to direct fetch:', dbErr.message);
    }
    
    // Fallback: Fetch directly from NNTP and build threads
    const client = await getConnection(server, port, ssl, username, password);
    const info = await client.group(groupName);
    
    // Create/update group in database first
    let serverId;
    try {
      serverId = db.getOrCreateServer(server, port, ssl, username);
      // Cache the group info
      db.cacheGroups(serverId, [{
        name: groupName,
        first: info.first,
        last: info.last,
        count: info.count || (info.last >= info.first ? info.last - info.first + 1 : 0)
      }]);
    } catch (dbErr) {
      console.warn('Could not cache group:', dbErr.message);
    }
    
    // Get recent headers (last 500 for performance)
    const start = Math.max(info.first, info.last - 500);
    const end = info.last;
    
    // Fetch headers
    const headers = await client.getHeaders(start, end);
    
    // Convert to threading format (ensure all required fields)
    allHeaders = headers.map(h => ({
      number: h.number || 0,
      subject: h.subject || '',
      from: h.from || '',
      date: h.date || '',
      messageId: h.messageId || '',
      references: h.references || ''
    }));
    
    // Try to cache headers if database is available
    try {
      if (serverId) {
        // Convert to format expected by cacheHeaders (camelCase)
        const cacheFormat = allHeaders.map(h => ({
          number: h.number,
          messageId: h.messageId || '',
          subject: h.subject || '',
          from: h.from || '',
          date: h.date || '',
          references: h.references || ''
        }));
        db.cacheHeaders(serverId, groupName, cacheFormat);
      }
    } catch (cacheErr) {
      console.warn('Could not cache headers:', cacheErr.message);
    }
    
    // Build thread tree
    const rootThreads = buildThreadTree(allHeaders);
    const flattened = flattenThreads(rootThreads);
    const paginated = flattened.slice(offset, offset + limit);
    const stats = getThreadStats(rootThreads);
    
    res.json({
      threads: paginated,
      stats: stats,
      hasMore: (offset + limit) < flattened.length,
      total: flattened.length
    });
    
  } catch (error) {
    console.error('Threads endpoint error:', error);
    console.error('Error stack:', error.stack);
    // Ensure we don't send a message ID as an error message
    // Message IDs contain '!' so if error message contains '!', it's likely a message ID
    let errorMessage = 'Failed to load threads';
    if (error.message && !error.message.includes('!')) {
      errorMessage = error.message;
    } else if (error.message && error.message.trim()) {
      // If it contains '!' but is not just whitespace, use it but prefix with context
      errorMessage = `Error processing threads: ${error.message}`;
    }
    res.status(500).json({ error: errorMessage });
  }
});

// API: Get article body
app.get('/api/articles/:number', async (req, res) => {
  try {
    const number = parseInt(req.params.number);
    const server = req.query.server || 'news.eternal-september.org';
    const port = parseInt(req.query.port) || 119;
    const ssl = req.query.ssl === 'true';
    const username = req.query.username || null;
    const password = req.query.password || null;
    const group = req.query.group || null;
    
    const client = await getConnection(server, port, ssl, username, password);
    
    // If group is provided, select it first (required for article access)
    if (group) {
      await client.group(group);
    }
    
    // Get full article (header + body) for compatibility with new clients
    try {
      const article = await client.getArticle(number);
      res.json({
        number: number,
        subject: article.header.subject || '(no subject)',
        from: article.header.from || 'unknown',
        date: article.header.date || '',
        messageId: article.header.messageId || '',
        body: article.body
      });
    } catch (err) {
      // Fallback: just get body if getArticle fails
      const body = await client.body(number);
      res.json({ 
        number: number,
        subject: '(no subject)',
        from: 'unknown',
        date: '',
        messageId: '',
        body: body 
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Get full article (header + body)
app.get('/api/articles/:number/full', async (req, res) => {
  try {
    const number = parseInt(req.params.number);
    const server = req.query.server || 'news.eternal-september.org';
    const port = parseInt(req.query.port) || 119;
    const ssl = req.query.ssl === 'true';
    const username = req.query.username || null;
    const password = req.query.password || null;
    
    const client = await getConnection(server, port, ssl, username, password);
    const article = await client.getArticle(number);
    
    res.json(article);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Post a new article
app.post('/api/post', async (req, res) => {
  try {
    const { server, port, ssl, username, password, group, subject, from, body } = req.body;
    
    if (!group || !subject || !from || !body) {
      res.status(400).json({ error: 'Missing required fields: group, subject, from, body' });
      return;
    }
    
    const client = await getConnection(
      server || 'news.eternal-september.org',
      port || 119,
      ssl || false,
      username || null,
      password || null
    );
    
    await client.post(group, subject, from, body);
    
    res.json({ success: true, message: 'Article posted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Reply to an article
app.post('/api/reply', async (req, res) => {
  try {
    const { server, port, ssl, username, password, group, subject, from, body, replyTo } = req.body;
    
    if (!group || !subject || !from || !body || !replyTo) {
      res.status(400).json({ error: 'Missing required fields: group, subject, from, body, replyTo' });
      return;
    }
    
    const client = await getConnection(
      server || 'news.eternal-september.org',
      port || 119,
      ssl || false,
      username || null,
      password || null
    );
    
    // Get the original article to extract message ID for References header
    let references = replyTo;
    try {
      const article = await client.getArticle(replyTo);
      if (article.header.messageId) {
        references = article.header.messageId;
        // If there's already a References header, append to it
        if (article.body.includes('References:')) {
          const refMatch = article.body.match(/References:\s*(.+)/i);
          if (refMatch) {
            references = `${refMatch[1]} ${article.header.messageId}`;
          }
        }
      }
    } catch (err) {
      // If we can't get the article, just use the replyTo as reference
    }
    
    // Add "Re: " prefix if not already present
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    
    await client.post(group, replySubject, from, body, references);
    
    res.json({ success: true, message: 'Reply posted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve Socket.io client if available (for pooled server compatibility)
try {
  const { Server } = require('socket.io');
  // Socket.io will handle /socket.io/socket.io.js automatically
} catch (e) {
  // Socket.io not available, that's fine for REST-only server
}

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Usenet Newsreader running on http://localhost:${PORT}`);
});

