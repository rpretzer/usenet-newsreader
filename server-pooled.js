const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const compression = require('compression');
const db = require('./db');
const pool = require('./nntp-pool');
const { buildThreadTree, flattenThreads, getThreadStats } = require('./threading');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Enable gzip compression
app.use(compression());
app.use(express.static('public'));
app.use(express.json());

// Connection tracking
const socketConnections = new Map(); // socketId -> { server, credentials, etc }

// ==================== SOCKET.IO HANDLERS ====================

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  socketConnections.set(socket.id, {
    connected: false,
    server: null,
    credentials: null
  });
  
  // Handle client disconnect
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    socketConnections.delete(socket.id);
  });
  
  // ==================== GROUPS ====================
  
  socket.on('get_groups', async (data, callback) => {
    try {
      const { server, port = 119, ssl = false, username = null, password = null } = data;
      
      if (!server) {
        callback({ error: 'Server address required' });
        return;
      }
      
      // Store connection info
      const connInfo = socketConnections.get(socket.id);
      connInfo.server = server;
      connInfo.credentials = { port, ssl, username, password };
      
      // Get server ID for database
      const serverId = db.getOrCreateServer(server, port, ssl, username);
      
      // Return cached groups immediately (optimistic)
      let cachedGroups = db.getCachedGroups(serverId);
      
      if (cachedGroups.length > 0) {
        callback({
          success: true,
          groups: cachedGroups.map(g => ({
            name: g.name,
            description: g.description || '',
            count: g.article_count || 0,
            first: g.first_article,
            last: g.last_article
          })),
          cached: true
        });
      }
      
      // Fetch fresh groups in background using pooled connection
      (async () => {
        try {
          const pooledConn = await pool.getConnection(server, port, ssl, username, password);
          
          try {
            const groups = await pooledConn.client.list();
            
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
            
            // Emit updated groups to client
            socket.emit('groups_updated', {
              groups: textGroups,
              cached: false
            });
          } finally {
            // Always release connection back to pool
            pool.releaseConnection(pooledConn.id);
          }
        } catch (err) {
          console.error('Background groups fetch error:', err);
          socket.emit('error', { message: `Failed to fetch groups: ${err.message}` });
        }
      })();
      
      // If no cache, wait a bit for initial fetch
      if (cachedGroups.length === 0) {
        const pooledConn = await pool.getConnection(server, port, ssl, username, password);
        try {
          const groups = await pooledConn.client.list();
          const textGroups = groups
            .filter(g => !g.name.includes('.binaries') && !g.name.includes('.bin'))
            .map(g => ({
              name: g.name,
              first: g.first,
              last: g.last,
              count: g.last >= g.first ? (g.last - g.first + 1) : 0,
              description: g.description || ''
            }));
          
          db.cacheGroups(serverId, textGroups);
          callback({
            success: true,
            groups: textGroups,
            cached: false
          });
        } finally {
          pool.releaseConnection(pooledConn.id);
        }
      }
    } catch (error) {
      console.error('get_groups error:', error);
      callback({ error: error.message });
    }
  });
  
  // ==================== THREADS ====================
  
  socket.on('get_threads', async (data, callback) => {
    try {
      const { server, port = 119, ssl = false, username = null, password = null, group, limit = 1000, offset = 0 } = data;
      
      if (!group) {
        callback({ error: 'Group name required' });
        return;
      }
      
      const serverId = db.getOrCreateServer(server, port, ssl, username);
      const dbGroup = db.getGroup(serverId, group);
      
      if (!dbGroup) {
        callback({ error: 'Group not found' });
        return;
      }
      
      // Get cached headers immediately
      let allHeaders = db.getAllHeadersForThreading(serverId, group);
      
      // Build thread tree
      const rootThreads = buildThreadTree(allHeaders);
      const flattened = flattenThreads(rootThreads);
      const paginated = flattened.slice(offset, offset + limit);
      const stats = getThreadStats(rootThreads);
      
      callback({
        success: true,
        threads: paginated,
        stats: stats,
        hasMore: (offset + limit) < flattened.length,
        total: flattened.length,
        cached: true
      });
      
      // Background sync with pooled connection
      (async () => {
        try {
          const pooledConn = await pool.getConnection(server, port, ssl, username, password);
          
          try {
            // Select group
            const groupInfo = await pooledConn.client.group(group);
            
            // Check if we need to sync
            const needsSync = !dbGroup.last_updated || 
                             dbGroup.last_article !== groupInfo.last ||
                             (Date.now() - dbGroup.last_updated) > 5 * 60 * 1000;
            
            if (needsSync) {
              // Stream headers and cache them
              const start = Math.max(groupInfo.first, groupInfo.last - 500);
              const end = groupInfo.last;
              
              const headers = [];
              for await (const header of pooledConn.client.streamHeaders(start, end)) {
                headers.push(header);
                
                // Batch insert every 50 headers
                if (headers.length >= 50) {
                  db.cacheHeaders(serverId, group, headers);
                  headers.length = 0;
                }
              }
              
              if (headers.length > 0) {
                db.cacheHeaders(serverId, group, headers);
              }
              
              // Update group info
              db.cacheGroups(serverId, [{
                name: group,
                first: groupInfo.first,
                last: groupInfo.last,
                count: groupInfo.count
              }]);
              
              // Get updated threads and emit
              const updatedHeaders = db.getAllHeadersForThreading(serverId, group);
              const updatedRoots = buildThreadTree(updatedHeaders);
              const updatedFlattened = flattenThreads(updatedRoots);
              const updatedPaginated = updatedFlattened.slice(offset, offset + limit);
              const updatedStats = getThreadStats(updatedRoots);
              
              socket.emit('threads_updated', {
                threads: updatedPaginated,
                stats: updatedStats,
                hasMore: (offset + limit) < updatedFlattened.length,
                total: updatedFlattened.length,
                cached: false
              });
            }
          } finally {
            pool.releaseConnection(pooledConn.id);
          }
        } catch (err) {
          console.error('Background threads sync error:', err);
          socket.emit('error', { message: `Failed to sync threads: ${err.message}` });
        }
      })();
      
    } catch (error) {
      console.error('get_threads error:', error);
      callback({ error: error.message });
    }
  });
  
  // ==================== ARTICLES ====================
  
  socket.on('get_article', async (data, callback) => {
    try {
      const { server, port = 119, ssl = false, username = null, password = null, group, articleNumber } = data;
      
      if (!group || !articleNumber) {
        callback({ error: 'Group and article number required' });
        return;
      }
      
      const serverId = db.getOrCreateServer(server, port, ssl, username);
      
      // Check cache first
      let cached = db.getCachedArticle(serverId, group, articleNumber);
      
      if (cached && cached.body) {
        callback({
          success: true,
          article: {
            number: cached.article_number,
            subject: cached.subject,
            from: cached.from_addr,
            date: cached.date,
            messageId: cached.message_id,
            body: cached.body
          },
          cached: true
        });
        return;
      }
      
      // If header cached but not body, return header and fetch body in background
      if (cached && !cached.body) {
        callback({
          success: true,
          article: {
            number: cached.article_number,
            subject: cached.subject,
            from: cached.from_addr,
            date: cached.date,
            messageId: cached.message_id,
            body: null
          },
          cached: 'partial'
        });
        
        // Fetch body in background with pooled connection
        (async () => {
          try {
            const pooledConn = await pool.getConnection(server, port, ssl, username, password);
            try {
              await pooledConn.client.group(group);
              const body = await pooledConn.client.body(articleNumber);
              
              db.cacheArticle(serverId, group, articleNumber, {
                body: body,
                messageId: cached.message_id,
                subject: cached.subject,
                from: cached.from_addr,
                date: cached.date
              });
              
              // Emit updated article with body
              socket.emit('article_updated', {
                article: {
                  number: articleNumber,
                  subject: cached.subject,
                  from: cached.from_addr,
                  date: cached.date,
                  messageId: cached.message_id,
                  body: body
                }
              });
            } finally {
              pool.releaseConnection(pooledConn.id);
            }
          } catch (err) {
            console.error('Background body fetch error:', err);
            socket.emit('error', { message: `Failed to fetch article body: ${err.message}` });
          }
        })();
        
        return;
      }
      
      // Not in cache - fetch from server using pooled connection
      const pooledConn = await pool.getConnection(server, port, ssl, username, password);
      try {
        await pooledConn.client.group(group);
        const article = await pooledConn.client.getArticle(articleNumber);
        
        // Cache it
        db.cacheArticle(serverId, group, articleNumber, {
          body: article.body,
          messageId: article.header.messageId,
          subject: article.header.subject,
          from: article.header.from,
          date: article.header.date,
          references: article.header.references
        });
        
        callback({
          success: true,
          article: {
            number: articleNumber,
            subject: article.header.subject,
            from: article.header.from,
            date: article.header.date,
            messageId: article.header.messageId,
            body: article.body
          },
          cached: false
        });
      } finally {
        pool.releaseConnection(pooledConn.id);
      }
      
    } catch (error) {
      console.error('get_article error:', error);
      callback({ error: error.message });
    }
  });
  
  // ==================== POST ====================
  
  socket.on('post_article', async (data, callback) => {
    try {
      const { server, port = 119, ssl = false, username = null, password = null, group, subject, from, body } = data;
      
      if (!group || !subject || !from || !body) {
        callback({ error: 'Missing required fields' });
        return;
      }
      
      // Return success immediately (optimistic)
      callback({ success: true, message: 'Article posted successfully' });
      
      // Post in background with pooled connection
      (async () => {
        try {
          const pooledConn = await pool.getConnection(server, port, ssl, username, password);
          try {
            await pooledConn.client.post(group, subject, from, body);
            
            // Trigger background sync
            const serverId = db.getOrCreateServer(server, port, ssl, username);
            await syncGroup(pooledConn, serverId, group);
            
            socket.emit('post_success', { group, message: 'Article posted successfully' });
          } finally {
            pool.releaseConnection(pooledConn.id);
          }
        } catch (err) {
          console.error('Background post error:', err);
          socket.emit('post_error', { message: `Post failed: ${err.message}` });
        }
      })();
      
    } catch (error) {
      console.error('post_article error:', error);
      callback({ error: error.message });
    }
  });
  
  // ==================== POOL STATS ====================
  
  socket.on('get_pool_stats', (callback) => {
    try {
      const stats = pool.getStats();
      callback({ success: true, stats });
    } catch (error) {
      callback({ error: error.message });
    }
  });
});

// Helper function to sync group
async function syncGroup(pooledConn, serverId, groupName) {
  try {
    const groupInfo = await pooledConn.client.group(groupName);
    const start = Math.max(groupInfo.first, groupInfo.last - 500);
    const end = groupInfo.last;
    
    const headers = [];
    for await (const header of pooledConn.client.streamHeaders(start, end)) {
      headers.push(header);
      if (headers.length >= 50) {
        db.cacheHeaders(serverId, groupName, headers);
        headers.length = 0;
      }
    }
    
    if (headers.length > 0) {
      db.cacheHeaders(serverId, groupName, headers);
    }
    
    db.cacheGroups(serverId, [{
      name: groupName,
      first: groupInfo.first,
      last: groupInfo.last,
      count: groupInfo.count
    }]);
  } catch (err) {
    console.error('Sync group error:', err);
  }
}

// Socket.io serves its own client library at /socket.io/socket.io.js automatically

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index-v2.html'));
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`Usenet Newsreader (Pooled/WebSocket) running on http://localhost:${PORT}`);
  console.log(`Socket.io server ready for WebSocket connections`);
  
  // Periodic cache cleanup
  setInterval(() => {
    const cleared = db.clearOldCache(7 * 24 * 60 * 60 * 1000);
    if (cleared > 0) {
      console.log(`Cleared ${cleared} old cache entries`);
    }
  }, 60 * 60 * 1000);
  
  // Periodic pool stats logging
  setInterval(() => {
    const stats = pool.getStats();
    console.log('Pool stats:', JSON.stringify(stats, null, 2));
  }, 5 * 60 * 1000); // Every 5 minutes
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await pool.shutdown();
  process.exit(0);
});
