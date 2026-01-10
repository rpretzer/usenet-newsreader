# Socket Pooling Architecture

## Overview

This implementation eliminates the 1-2 second handshake lag by maintaining a pool of warm, authenticated NNTP sockets that are reused across requests.

## Key Components

### 1. Connection Pool Manager (`nntp-pool.js`)

Maintains pools of authenticated NNTP connections:

- **Pool per Server**: Each server/credentials combination has its own pool
- **Warm Connections**: Connections stay authenticated and ready to use
- **Automatic Scaling**: Maintains minimum connections, scales up to max
- **Health Checks**: Periodically verifies connections are alive
- **Idle Timeout**: Closes connections idle for too long (keeps minSize)

**Pool Configuration:**
- `maxConnections`: Maximum connections per pool (default: 10)
- `minConnections`: Minimum connections to maintain (default: 2)
- `idleTimeout`: Time before closing idle connections (default: 5 minutes)
- `healthCheckInterval`: Frequency of health checks (default: 30 seconds)

### 2. WebSocket Server (`server-pooled.js`)

Replaces REST API with Socket.io for real-time communication:

**Benefits:**
- **No Handshake Lag**: Reuses warm sockets from pool
- **Streaming**: Can stream data as it arrives
- **Real-time Updates**: Push updates to clients immediately
- **Bidirectional**: Client can receive updates without polling

**Events:**
- `get_groups` - Fetch newsgroups (returns cached immediately, syncs in background)
- `get_threads` - Get threaded headers (uses pooled connection)
- `get_article` - Fetch article body (uses pooled connection)
- `post_article` - Post new article (optimistic response)

**Real-time Events:**
- `groups_updated` - New groups synced from server
- `threads_updated` - Thread list updated
- `article_updated` - Article body loaded
- `post_success` / `post_error` - Post operation result

### 3. Frontend (`app-pooled.js`)

Uses Socket.io client for WebSocket communication:

- **Instant Responses**: Receives cached data immediately
- **Background Sync**: Gets updates via WebSocket events
- **Optimistic UI**: Updates UI before server confirms

## Performance Improvements

### Before (REST API):
```
User clicks group
  → Open socket (200ms)
  → Authenticate (300ms)
  → Select group (100ms)
  → Fetch data (500ms)
  → Close socket (100ms)
Total: ~1200ms per request
```

### After (Socket Pooling):
```
User clicks group
  → Get warm socket from pool (5ms)
  → Select group (100ms)
  → Fetch data (500ms)
  → Return socket to pool (1ms)
Total: ~606ms per request (50% faster!)
```

**Additional Benefits:**
- Connections stay authenticated (no AUTHINFO on every request)
- Multiple requests can share pool
- Health checks keep pool healthy
- Automatic reconnection on failure

## Connection Lifecycle

1. **Pool Creation**: First request for a server creates pool with minConnections
2. **Connection Reuse**: Subsequent requests use idle connections
3. **Scaling**: Pool grows to maxConnections if needed
4. **Health Checks**: Dead connections removed, new ones created
5. **Idle Cleanup**: Connections idle > idleTimeout closed (except minSize)
6. **Pool Cleanup**: Empty pools unused for 10+ minutes are removed

## Usage

```bash
# Start pooled/WebSocket server
npm run start:pooled

# Or development mode
npm run dev:pooled
```

The frontend (`index-v2.html`) automatically uses WebSocket when loaded with `app-pooled.js`.

## Monitoring

The pool emits events for monitoring:

- `connection_created` - New connection added to pool
- `connection_released` - Connection returned to pool
- `connection_removed` - Dead connection removed
- `connection_error` - Connection creation failed
- `shutdown` - Pool shutdown

Get pool statistics:

```javascript
// From server
const stats = pool.getStats();
console.log(stats);
// {
//   pools: {
//     'host:port:ssl:user': {
//       total: 5,
//       idle: 3,
//       inUse: 2,
//       maxSize: 10,
//       minSize: 2
//     }
//   },
//   totalConnections: 5,
//   totalIdle: 3,
//   totalInUse: 2
// }
```

Or via Socket.io:

```javascript
socket.emit('get_pool_stats', (response) => {
  console.log(response.stats);
});
```

## Configuration

Adjust pool settings in `nntp-pool.js`:

```javascript
const pool = new NNTPConnectionPool({
  maxConnections: 10,        // Max per server
  minConnections: 2,         // Min to maintain
  idleTimeout: 5 * 60 * 1000, // 5 minutes
  healthCheckInterval: 30 * 1000 // 30 seconds
});
```

## Best Practices

1. **Pool Size**: Adjust based on expected concurrent users
   - Low traffic: min=1, max=3
   - Medium traffic: min=2, max=10
   - High traffic: min=5, max=20

2. **Idle Timeout**: Balance between keeping connections warm and resource usage
   - Shorter timeout (1-2 min): Lower memory, more reconnections
   - Longer timeout (5-10 min): Higher memory, fewer reconnections

3. **Health Checks**: Verify connections are alive
   - Too frequent: Unnecessary overhead
   - Too infrequent: Dead connections stay in pool longer

4. **Connection Release**: Always release connections after use
   - Use try/finally blocks
   - Pool manager handles cleanup

## Future Enhancements

1. **Redis-based Pooling**: Share pools across multiple server instances
2. **Connection Metrics**: Track request counts, response times per connection
3. **Adaptive Pooling**: Automatically adjust pool size based on load
4. **Connection Affinity**: Route requests to specific connections for better caching
5. **Load Balancing**: Distribute load across pool connections
