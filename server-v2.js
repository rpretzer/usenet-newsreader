const express = require('express');
const path = require('path');
const compression = require('compression');
const StreamingNNTPClient = require('./nntp-stream-client');
const db = require('./db');
const { buildThreadTree, flattenThreads, getThreadStats } = require('./threading');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable gzip compression
app.use(compression());

// CORS configuration
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

app.use(express.static('public'));
app.use(express.json());

// Connection pool for NNTP clients
const connections = new Map();

// Background sync queue
const syncQueue = new Set();

/**
 * Get or create NNTP connection (non-blocking)
 */
async function getConnection(server, port = 119, ssl = false, username = null, password = null) {
  const credHash = password ? Buffer.from(password).toString('base64').substring(0, 16) : 'anon';
  const key = `${server}:${port}:${ssl}:${username || 'anon'}:${credHash}`;
  
  // Check for existing connection
  if (connections.has(key)) {
    const client = connections.get(key);
    if (client.isConnected()) {
      return client;
    }
    // Clean up dead connection
    try {
      client.disconnect();
    } catch (err) {}
    connections.delete(key);
  }
  
  // Create new connection
  const client = new StreamingNNTPClient({
    host: server,
    port: port,
    ssl: ssl,
    username: username,
    password: password
  });
  
  await client.connect();
  connections.set(key, client);
  return client;
}

/**
 * Background sync - update database without blocking UI
 */
async function backgroundSync(serverId, groupName, client) {
  const syncKey = `${serverId}:${groupName}`;
  if (syncQueue.has(syncKey)) {
    return; // Already syncing
  }
  
  syncQueue.add(syncKey);
  
  try {
    // Get group info
    const groupInfo = await client.group(groupName);
    const dbGroup = db.getGroup(serverId, groupName);
    
    if (!dbGroup || 
        (dbGroup.last_article !== groupInfo.last) ||
        (Date.now() - dbGroup.last_updated > 5 * 60 * 1000)) {
      
      // Stream headers and cache them
      const start = Math.max(groupInfo.first, groupInfo.last - 500); // Last 500 articles
      const end = groupInfo.last;
      
      const headers = [];
      for await (const header of client.streamHeaders(start, end)) {
        headers.push(header);
        
        // Batch insert every 50 headers
        if (headers.length >= 50) {
          db.cacheHeaders(serverId, groupName, headers);
          headers.length = 0;
        }
      }
      
      // Insert remaining headers
      if (headers.length > 0) {
        db.cacheHeaders(serverId, groupName, headers);
      }
      
      // Update group info
      db.cacheGroups(serverId, [{
        name: groupName,
        first: groupInfo.first,
        last: groupInfo.last,
        count: groupInfo.count
      }]);
    }
  } catch (err) {
    console.error('Background sync error:', err);
  } finally {
    syncQueue.delete(syncKey);
  }
}

// ==================== API ENDPOINTS ====================

// API: List newsgroups (local-first with background sync)
app.get('/api/groups', async (req, res) => {
  try {
    const server = req.query.server || 'news.eternal-september.org';
    const port = parseInt(req.query.port) || 119;
    const ssl = req.query.ssl === 'true';
    const username = req.query.username || null;
    const password = req.query.password || null;
    
    // Get server ID (creates if doesn't exist)
    const serverId = db.getOrCreateServer(server, port, ssl, username);
    
    // Return cached groups immediately (optimistic UI)
    let cachedGroups = db.getCachedGroups(serverId);
    const hasCache = cachedGroups.length > 0;
    
    if (hasCache) {
      res.setHeader('X-Cache', 'HIT');
      res.json(cachedGroups.map(g => ({
        name: g.name,
        description: g.description || '',
        count: g.article_count || 0,
        first: g.first_article,
        last: g.last_article
      })));
    }
    
    // Background sync - don't wait if we have cache
    const syncPromise = (async () => {
      try {
        const client = await getConnection(server, port, ssl, username, password);
        const groups = await client.list();
        
        const textGroups = groups
          .filter(g => !g.name.includes('.binaries') && !g.name.includes('.bin'))
          .map(g => ({
            name: g.name,
            first: g.first,
            last: g.last,
            count: g.last >= g.first ? (g.last - g.first + 1) : 0,
            description: g.description || ''
          }));
        
        // Cache groups
        db.cacheGroups(serverId, textGroups);
      } catch (err) {
        console.error('Background groups sync error:', err);
      }
    })();
    
    // If no cache, wait for sync (first time)
    if (!hasCache) {
      await syncPromise;
      cachedGroups = db.getCachedGroups(serverId);
      res.setHeader('X-Cache', 'MISS');
      res.json(cachedGroups.map(g => ({
        name: g.name,
        description: g.description || '',
        count: g.article_count || 0,
        first: g.first_article,
        last: g.last_article
      })));
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Get threaded headers (local-first with background sync)
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
    
    const serverId = db.getOrCreateServer(server, port, ssl, username);
    const dbGroup = db.getGroup(serverId, groupName);
    
    if (!dbGroup) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    // Get cached headers immediately (optimistic UI)
    let allHeaders = db.getAllHeadersForThreading(serverId, groupName);
    
    // Build thread tree
    const rootThreads = buildThreadTree(allHeaders);
    const flattened = flattenThreads(rootThreads);
    
    // Apply pagination
    const paginated = flattened.slice(offset, offset + limit);
    const stats = getThreadStats(rootThreads);
    
    res.json({
      threads: paginated,
      stats: stats,
      hasMore: (offset + limit) < flattened.length,
      total: flattened.length
    });
    
    // Background sync if needed
    (async () => {
      try {
        const client = await getConnection(server, port, ssl, username, password);
        await backgroundSync(serverId, groupName, client);
      } catch (err) {
        console.error('Background headers sync error:', err);
      }
    })();
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Get article (local-first with background fetch)
app.get('/api/articles/:number', async (req, res) => {
  try {
    const articleNumber = parseInt(req.params.number);
    const server = req.query.server || 'news.eternal-september.org';
    const port = parseInt(req.query.port) || 119;
    const ssl = req.query.ssl === 'true';
    const username = req.query.username || null;
    const password = req.query.password || null;
    const group = req.query.group || null;
    
    if (!group) {
      return res.status(400).json({ error: 'Group parameter required' });
    }
    
    const serverId = db.getOrCreateServer(server, port, ssl, username);
    
    // Check cache first (optimistic UI)
    let cached = db.getCachedArticle(serverId, group, articleNumber);
    if (cached && cached.body) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({
        number: cached.article_number,
        subject: cached.subject,
        from: cached.from_addr,
        date: cached.date,
        messageId: cached.message_id,
        body: cached.body
      });
    }
    
    // If header cached but not body, return header immediately, fetch body in background
    if (cached && !cached.body) {
      res.setHeader('X-Cache', 'PARTIAL');
      res.json({
        number: cached.article_number,
        subject: cached.subject,
        from: cached.from_addr,
        date: cached.date,
        messageId: cached.message_id,
        body: null // Will be loaded in background
      });
      
      // Fetch body in background
      (async () => {
        try {
          const client = await getConnection(server, port, ssl, username, password);
          await client.group(group);
          const body = await client.body(articleNumber);
          
          db.cacheArticle(serverId, group, articleNumber, {
            body: body,
            messageId: cached.message_id,
            subject: cached.subject,
            from: cached.from_addr,
            date: cached.date
          });
        } catch (err) {
          console.error('Background body fetch error:', err);
        }
      })();
      
      return;
    }
    
    // Not in cache - fetch from server
    const client = await getConnection(server, port, ssl, username, password);
    await client.group(group);
    const article = await client.getArticle(articleNumber);
    
    // Cache it
    db.cacheArticle(serverId, group, articleNumber, {
      body: article.body,
      messageId: article.header.messageId,
      subject: article.header.subject,
      from: article.header.from,
      date: article.header.date,
      references: article.header.references
    });
    
    res.setHeader('X-Cache', 'MISS');
    res.json({
      number: articleNumber,
      subject: article.header.subject,
      from: article.header.from,
      date: article.header.date,
      messageId: article.header.messageId,
      body: article.body
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Post article (optimistic - returns immediately, syncs in background)
app.post('/api/post', async (req, res) => {
  try {
    const { server, port, ssl, username, password, group, subject, from, body } = req.body;
    
    if (!group || !subject || !from || !body) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Return success immediately (optimistic)
    const tempArticleNumber = Date.now(); // Temporary ID
    res.json({ 
      success: true, 
      message: 'Article posted successfully',
      tempId: tempArticleNumber
    });
    
    // Post in background
    (async () => {
      try {
        const client = await getConnection(server, port, ssl, username, password);
        await client.post(group, subject, from, body);
        
        // Trigger background sync to get the new article
        const serverId = db.getOrCreateServer(server, port, ssl, username);
        await backgroundSync(serverId, group, client);
      } catch (err) {
        console.error('Background post error:', err);
        // TODO: Notify client of failure via WebSocket or polling
      }
    })();
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Cache stats
app.get('/api/cache/stats', (req, res) => {
  try {
    const stats = db.getCacheStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Usenet Newsreader (Streaming) running on http://localhost:${PORT}`);
  
  // Periodic cache cleanup
  setInterval(() => {
    const cleared = db.clearOldCache(7 * 24 * 60 * 60 * 1000); // 7 days
    if (cleared > 0) {
      console.log(`Cleared ${cleared} old cache entries`);
    }
  }, 60 * 60 * 1000); // Every hour
});
