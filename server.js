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

// Helper function to get or create NNTP connection
async function getConnection(server, port = 119, ssl = false) {
  const key = `${server}:${port}:${ssl}`;
  
  if (!connections.has(key)) {
    const client = new NNTPClient({
      host: server,
      port: port,
      ssl: ssl
    });
    
    await client.connect();
    connections.set(key, client);
  }
  
  return connections.get(key);
}

// API: List newsgroups
app.get('/api/groups', async (req, res) => {
  try {
    const server = req.query.server || 'news.eternal-september.org';
    const port = parseInt(req.query.port) || 119;
    const ssl = req.query.ssl === 'true';
    
    const client = await getConnection(server, port, ssl);
    const groups = await client.list();
    
    // Filter to text-only groups and format
    const textGroups = groups
      .filter(g => !g.name.includes('.binaries') && !g.name.includes('.bin'))
      .map(g => ({
        name: g.name,
        description: g.description || '',
        count: g.count || 0
      }))
      .slice(0, 100); // Limit to first 100 for performance
    
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
    const limit = parseInt(req.query.limit) || 20;
    
    const client = await getConnection(server, port, ssl);
    
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
    
    const client = await getConnection(server, port, ssl);
    const body = await client.body(number);
    
    res.json({ body: body });
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

