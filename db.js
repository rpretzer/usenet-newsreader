const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'usenet.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    ssl INTEGER NOT NULL DEFAULT 0,
    username TEXT,
    last_connected INTEGER,
    UNIQUE(host, port, ssl, username)
  );

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    first_article INTEGER,
    last_article INTEGER,
    article_count INTEGER,
    description TEXT,
    last_updated INTEGER,
    FOREIGN KEY(server_id) REFERENCES servers(id),
    UNIQUE(server_id, name)
  );

  CREATE INDEX IF NOT EXISTS idx_groups_server ON groups(server_id);
  CREATE INDEX IF NOT EXISTS idx_groups_name ON groups(name);

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    article_number INTEGER NOT NULL,
    message_id TEXT,
    subject TEXT,
    from_addr TEXT,
    date TEXT,
    references TEXT,
    body TEXT,
    cached_at INTEGER,
    FOREIGN KEY(group_id) REFERENCES groups(id),
    UNIQUE(group_id, article_number)
  );

  CREATE INDEX IF NOT EXISTS idx_articles_group ON articles(group_id);
  CREATE INDEX IF NOT EXISTS idx_articles_number ON articles(article_number);
  CREATE INDEX IF NOT EXISTS idx_articles_message_id ON articles(message_id);
  CREATE INDEX IF NOT EXISTS idx_articles_references ON articles(references);

  CREATE TABLE IF NOT EXISTS headers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL,
    header_name TEXT NOT NULL,
    header_value TEXT,
    FOREIGN KEY(article_id) REFERENCES articles(id),
    UNIQUE(article_id, header_name)
  );

  CREATE INDEX IF NOT EXISTS idx_headers_article ON headers(article_id);
`);

// Prepared statements for performance
const stmts = {
  // Server operations
  insertServer: db.prepare(`
    INSERT INTO servers (host, port, ssl, username, last_connected)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(host, port, ssl, username) DO UPDATE SET
      last_connected = excluded.last_connected
    RETURNING id
  `),
  
  getServerId: db.prepare(`
    SELECT id FROM servers 
    WHERE host = ? AND port = ? AND ssl = ? 
    AND COALESCE(username, '') = COALESCE(?, '')
  `),

  // Group operations
  upsertGroup: db.prepare(`
    INSERT INTO groups (server_id, name, first_article, last_article, article_count, description, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(server_id, name) DO UPDATE SET
      first_article = excluded.first_article,
      last_article = excluded.last_article,
      article_count = excluded.article_count,
      description = excluded.description,
      last_updated = excluded.last_updated
  `),

  getGroups: db.prepare(`
    SELECT g.* FROM groups g
    WHERE g.server_id = ?
    ORDER BY g.name
  `),

  getGroup: db.prepare(`
    SELECT * FROM groups WHERE server_id = ? AND name = ?
  `),

  // Article operations
  upsertArticle: db.prepare(`
    INSERT INTO articles (group_id, article_number, message_id, subject, from_addr, date, references, body, cached_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_id, article_number) DO UPDATE SET
      message_id = excluded.message_id,
      subject = excluded.subject,
      from_addr = excluded.from_addr,
      date = excluded.date,
      references = excluded.references,
      body = COALESCE(excluded.body, body),
      cached_at = excluded.cached_at
  `),

  getArticle: db.prepare(`
    SELECT a.* FROM articles a
    JOIN groups g ON a.group_id = g.id
    WHERE g.server_id = ? AND g.name = ? AND a.article_number = ?
  `),

  getArticleByMessageId: db.prepare(`
    SELECT a.* FROM articles a
    JOIN groups g ON a.group_id = g.id
    WHERE g.server_id = ? AND a.message_id = ?
  `),

  getHeaders: db.prepare(`
    SELECT a.* FROM articles a
    JOIN groups g ON a.group_id = g.id
    WHERE g.server_id = ? AND g.name = ?
      AND a.article_number >= ? AND a.article_number <= ?
    ORDER BY a.article_number DESC
    LIMIT ? OFFSET ?
  `),

  getHeadersForThreading: db.prepare(`
    SELECT a.* FROM articles a
    JOIN groups g ON a.group_id = g.id
    WHERE g.server_id = ? AND g.name = ?
    ORDER BY a.article_number DESC
  `),

  // Cache management
  clearOldCache: db.prepare(`
    DELETE FROM articles WHERE cached_at < ?
  `),

  getCacheStats: db.prepare(`
    SELECT 
      COUNT(*) as total_articles,
      SUM(LENGTH(body)) as total_size,
      MIN(cached_at) as oldest_cache,
      MAX(cached_at) as newest_cache
    FROM articles
    WHERE body IS NOT NULL
  `)
};

// Transaction wrappers for batch operations
const transactions = {
  insertGroups: db.transaction((serverId, groups) => {
    const now = Date.now();
    for (const group of groups) {
      stmts.upsertGroup.run(
        serverId,
        group.name,
        group.first,
        group.last,
        group.count || (group.last >= group.first ? group.last - group.first + 1 : 0),
        group.description || '',
        now
      );
    }
  }),

  insertHeaders: db.transaction((groupId, headers) => {
    const now = Date.now();
    for (const header of headers) {
      stmts.upsertArticle.run(
        groupId,
        header.number,
        header.messageId || null,
        header.subject || null,
        header.from || null,
        header.date || null,
        header.references || null,
        null, // body not cached initially
        now
      );
    }
  })
};

class DatabaseLayer {
  constructor() {
    this.db = db;
    this.stmts = stmts;
    this.transactions = transactions;
  }

  // Server management
  getOrCreateServer(host, port, ssl, username = null) {
    const existing = stmts.getServerId.get(host, port, ssl ? 1 : 0, username);
    if (existing) {
      // Update last_connected
      stmts.insertServer.run(host, port, ssl ? 1 : 0, username, Date.now());
      return existing.id;
    }
    const result = stmts.insertServer.get(host, port, ssl ? 1 : 0, username, Date.now());
    return result.id;
  }

  // Group management
  cacheGroups(serverId, groups) {
    transactions.insertGroups(serverId, groups);
  }

  getCachedGroups(serverId) {
    return stmts.getGroups.all(serverId);
  }

  getGroup(serverId, groupName) {
    return stmts.getGroup.get(serverId, groupName);
  }

  // Article management
  cacheHeaders(serverId, groupName, headers) {
    const group = stmts.getGroup.get(serverId, groupName);
    if (!group) return;
    transactions.insertHeaders(group.id, headers);
  }

  cacheArticle(serverId, groupName, articleNumber, articleData) {
    const group = stmts.getGroup.get(serverId, groupName);
    if (!group) return;

    stmts.upsertArticle.run(
      group.id,
      articleNumber,
      articleData.messageId || null,
      articleData.subject || null,
      articleData.from || null,
      articleData.date || null,
      articleData.references || null,
      articleData.body || null,
      Date.now()
    );
  }

  getCachedArticle(serverId, groupName, articleNumber) {
    return stmts.getArticle.get(serverId, groupName, articleNumber);
  }

  getCachedHeaders(serverId, groupName, start, end, limit, offset) {
    return stmts.getHeaders.all(serverId, groupName, start, end, limit, offset);
  }

  getAllHeadersForThreading(serverId, groupName) {
    return stmts.getHeadersForThreading.all(serverId, groupName);
  }

  // Cache management
  clearOldCache(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 days default
    const cutoff = Date.now() - maxAge;
    return stmts.clearOldCache.run(cutoff).changes;
  }

  getCacheStats() {
    return stmts.getCacheStats.get();
  }

  close() {
    db.close();
  }
}

module.exports = new DatabaseLayer();
