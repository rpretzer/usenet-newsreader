const express = require('express');
const path = require('path');
const NNTPClient = require('./nntp-client');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// Store active NNTP connections
const connections = new Map();

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
    
    const client = await getConnection(server, port, ssl, username, password);
    
    // Select the group
    const info = await client.group(group);
    
    // Get article headers
    const start = Math.max(info.first, info.last - limit + 1);
    const end = info.last;
    
    // Get headers for multiple articles
    const headers = await client.getHeaders(start, end);
    
    const articles = headers.map(h => ({
      number: h.number,
      subject: h.subject || '(no subject)',
      from: h.from || 'unknown',
      date: h.date || '',
      messageId: h.messageId || ''
    }));
    
    res.json(articles);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    
    const client = await getConnection(server, port, ssl, username, password);
    const body = await client.body(number);
    
    res.json({ body: body });
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

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Usenet Newsreader running on http://localhost:${PORT}`);
});

