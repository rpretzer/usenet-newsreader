# Usenet Newsreader - High-Performance Streaming Architecture

## Overview

This refactored version transforms the newsreader from a "Naive RAG/Sequential" architecture to a "High-Performance Streaming" architecture with local-first design.

## Key Architectural Improvements

### 1. Non-Blocking I/O
- **Streaming NNTP Client** (`nntp-stream-client.js`): Processes data in chunks instead of accumulating buffers
- Eliminates `buffer += data.toString()` anti-pattern that causes O(n²) memory growth
- Uses async generators for streaming operations (`async *streamHeaders()`)

### 2. Local-First Architecture
- **SQLite Database** (`db.js`): Persistent local cache using `better-sqlite3`
- UI reads from database first, syncs with server in background
- Optimistic UI updates - instant response with background sync

### 3. Stream Processing
- Chunk-based line processing prevents memory accumulation
- ResponseResolver pattern handles multiline responses efficiently
- Streaming article bodies line-by-line

### 4. Optimistic UI Updates
- API endpoints return cached data immediately
- Background sync happens asynchronously
- UI never waits for network requests when cache exists

## File Structure

```
├── nntp-stream-client.js    # Streaming NNTP client (non-blocking)
├── db.js                     # SQLite database layer (local-first)
├── threading.js              # Message threading algorithm
├── server-v2.js              # New Express server with optimistic UI
├── server.js                 # Legacy server (for comparison)
├── public/
│   ├── index-v2.html        # New 3-pane UI
│   ├── app-v2.js            # Client with virtual scrolling
│   ├── styles.css           # Tailwind source
│   └── output.css           # Compiled Tailwind CSS
└── data/
    └── usenet.db            # SQLite database (created on first run)
```

## Database Schema

### Servers
Stores NNTP server connection info and credentials.

### Groups
Caches newsgroup metadata (name, article counts, descriptions).

### Articles
Caches article headers and bodies with message IDs and references.

### Headers
Additional header fields for indexing.

## API Endpoints (v2)

### `GET /api/groups`
- **Optimistic**: Returns cached groups immediately
- **Background**: Syncs with server asynchronously
- **Response**: `X-Cache: HIT` or `X-Cache: MISS`

### `GET /api/groups/:group/threads`
- **Optimistic**: Returns threaded headers from cache
- **Threading**: Uses References header to build conversation threads
- **Pagination**: Supports limit/offset for virtual scrolling
- **Background**: Syncs latest headers in background

### `GET /api/articles/:number`
- **Optimistic**: Returns cached article if available
- **Partial**: Can return header-only if body not cached (`X-Cache: PARTIAL`)
- **Background**: Fetches body asynchronously if missing

### `POST /api/post`
- **Optimistic**: Returns success immediately
- **Background**: Posts to server asynchronously
- **Note**: UI should handle eventual consistency

## Virtual Scrolling

The threaded headers pane uses virtual scrolling to handle 10k+ messages:
- Only renders visible items + small buffer
- Dynamically calculates scroll position
- Maintains 60px item height for consistent scrolling

## Threading Algorithm

Uses standard Usenet References-based threading:
1. Parse References header (chain of message IDs)
2. Build parent-child relationships
3. Fallback to subject-based matching for missing references
4. Calculate thread depth for visual indentation

## Performance Optimizations

1. **Database Indexing**: All foreign keys and lookup fields indexed
2. **Prepared Statements**: All queries use prepared statements
3. **Batch Operations**: Group/article inserts use transactions
4. **Cache Cleanup**: Periodic cleanup of old cache entries (7 days default)
5. **Connection Pooling**: NNTP connections reused across requests

## Running the New Version

```bash
# Install dependencies
npm install

# Build Tailwind CSS
npm run build:css:prod

# Run new server
npm run start:v2

# Or development mode
npm run dev:v2
```

## Migration Path

The old version (`server.js`, `index.html`, `app.js`) is preserved for reference. To switch:

1. Update `config.js` to point to v2 endpoints if using different port
2. Replace `index.html` with `index-v2.html` (or rename)
3. Use `server-v2.js` instead of `server.js`

## Sovereign Node Aesthetic

The UI uses a custom color palette:
- Deep space background (`#0a0a0f`)
- Elevated surfaces (`#1a1a24`)
- Accent blue (`#4f9cf9`)
- JetBrains Mono font for code-like appearance

## Future Enhancements

1. **WebSocket Support**: Real-time updates instead of polling
2. **Offline Mode**: Full offline functionality with sync queue
3. **Advanced Threading**: Collapse/expand threads, thread navigation
4. **Search**: Full-text search across cached articles
5. **Performance Monitoring**: Metrics for cache hit rates, sync times
