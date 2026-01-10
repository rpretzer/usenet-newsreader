const StreamingNNTPClient = require('./nntp-stream-client');
const EventEmitter = require('events');

/**
 * NNTP Connection Pool Manager
 * Maintains warm, authenticated sockets to eliminate handshake lag
 */
class NNTPConnectionPool extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxConnections = options.maxConnections || 10;
    this.minConnections = options.minConnections || 2;
    this.idleTimeout = options.idleTimeout || 5 * 60 * 1000; // 5 minutes
    this.healthCheckInterval = options.healthCheckInterval || 30 * 1000; // 30 seconds
    
    // Pool structure: Map<connectionKey, PooledConnection>
    this.pools = new Map(); // Key: `${host}:${port}:${ssl}:${username}`
    this.activeConnections = new Map(); // Key: connectionId, Value: PooledConnection
    this.connectionCounter = 0;
    
    // Start health check timer
    this.startHealthCheck();
  }

  /**
   * Get a connection from the pool (or create if needed)
   */
  async getConnection(host, port = 119, ssl = false, username = null, password = null) {
    const poolKey = this.getPoolKey(host, port, ssl, username);
    
    // Get or create pool for this server
    let pool = this.pools.get(poolKey);
    if (!pool) {
      pool = {
        key: poolKey,
        host,
        port,
        ssl,
        username,
        password,
        connections: [],
        idleConnections: [],
        inUse: new Set(),
        maxSize: this.maxConnections,
        minSize: this.minConnections,
        lastUsed: Date.now()
      };
      this.pools.set(poolKey, pool);
      
      // Initialize minimum connections
      await this.ensureMinConnections(pool);
    }
    
    pool.lastUsed = Date.now();
    
    // Try to get idle connection first
    if (pool.idleConnections.length > 0) {
      const connection = pool.idleConnections.pop();
      pool.inUse.add(connection.id);
      this.activeConnections.set(connection.id, connection);
      
      // Verify connection is still alive
      if (connection.client.isConnected()) {
        return connection;
      } else {
        // Connection is dead, remove it and create new one
        this.removeConnection(pool, connection.id);
      }
    }
    
    // No idle connections available, check if we can create new one
    if (pool.connections.length < pool.maxSize) {
      return await this.createNewConnection(pool);
    }
    
    // Pool is full, wait for an available connection
    return await this.waitForAvailableConnection(pool);
  }

  /**
   * Return a connection to the pool (make it idle)
   */
  releaseConnection(connectionId) {
    const connection = this.activeConnections.get(connectionId);
    if (!connection) return;
    
    const pool = this.pools.get(connection.poolKey);
    if (!pool) return;
    
    pool.inUse.delete(connectionId);
    this.activeConnections.delete(connectionId);
    
    // Reset connection state (deselect any group)
    // Note: We don't actually deselect, as GROUP command is fast anyway
    
    // Check if connection is still healthy
    if (!connection.client.isConnected()) {
      this.removeConnection(pool, connectionId);
      return;
    }
    
    // Add to idle pool
    connection.idleSince = Date.now();
    pool.idleConnections.push(connection);
    pool.connections.push(connection);
    
    // Emit event for monitoring
    this.emit('connection_released', {
      poolKey: pool.key,
      connectionId,
      poolSize: pool.connections.length,
      idleCount: pool.idleConnections.length,
      inUseCount: pool.inUse.size
    });
  }

  /**
   * Create a new connection and add to pool
   */
  async createNewConnection(pool) {
    const connectionId = ++this.connectionCounter;
    
    try {
      const client = new StreamingNNTPClient({
        host: pool.host,
        port: pool.port,
        ssl: pool.ssl,
        username: pool.username,
        password: pool.password
      });
      
      await client.connect();
      
      const connection = {
        id: connectionId,
        poolKey: pool.key,
        client,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        idleSince: null,
        requestCount: 0
      };
      
      pool.connections.push(connection);
      pool.inUse.add(connectionId);
      this.activeConnections.set(connectionId, connection);
      
      this.emit('connection_created', {
        poolKey: pool.key,
        connectionId,
        poolSize: pool.connections.length
      });
      
      return connection;
    } catch (error) {
      this.emit('connection_error', {
        poolKey: pool.key,
        connectionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Ensure minimum connections exist in pool
   */
  async ensureMinConnections(pool) {
    const needed = pool.minSize - pool.connections.length;
    if (needed <= 0) return;
    
    const promises = [];
    for (let i = 0; i < needed; i++) {
      promises.push(this.createNewConnection(pool).catch(err => {
        console.error(`Failed to create initial connection for pool ${pool.key}:`, err);
      }));
    }
    
    await Promise.all(promises);
    
    // Move all non-in-use connections to idle
    for (const conn of pool.connections) {
      if (!pool.inUse.has(conn.id)) {
        if (!pool.idleConnections.includes(conn)) {
          conn.idleSince = Date.now();
          pool.idleConnections.push(conn);
        }
      }
    }
  }

  /**
   * Wait for an available connection (with timeout)
   */
  async waitForAvailableConnection(pool, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const checkInterval = setInterval(() => {
        // Try to get idle connection
        if (pool.idleConnections.length > 0) {
          clearInterval(checkInterval);
          const connection = pool.idleConnections.pop();
          pool.inUse.add(connection.id);
          this.activeConnections.set(connection.id, connection);
          resolve(connection);
          return;
        }
        
        // Try to create new connection if pool not at max
        if (pool.connections.length < pool.maxSize) {
          clearInterval(checkInterval);
          this.createNewConnection(pool).then(resolve).catch(reject);
          return;
        }
        
        // Timeout
        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          reject(new Error('Timeout waiting for available connection'));
        }
      }, 100);
    });
  }

  /**
   * Remove a connection from the pool
   */
  removeConnection(pool, connectionId) {
    const connectionIndex = pool.connections.findIndex(c => c.id === connectionId);
    if (connectionIndex >= 0) {
      const connection = pool.connections[connectionIndex];
      
      // Disconnect client
      try {
        connection.client.disconnect();
      } catch (err) {
        // Ignore disconnect errors
      }
      
      pool.connections.splice(connectionIndex, 1);
    }
    
    // Remove from idle list
    const idleIndex = pool.idleConnections.findIndex(c => c.id === connectionId);
    if (idleIndex >= 0) {
      pool.idleConnections.splice(idleIndex, 1);
    }
    
    pool.inUse.delete(connectionId);
    this.activeConnections.delete(connectionId);
    
    this.emit('connection_removed', {
      poolKey: pool.key,
      connectionId,
      poolSize: pool.connections.length
    });
  }

  /**
   * Health check: Verify connections are alive and remove dead ones
   */
  startHealthCheck() {
    setInterval(() => {
      this.checkConnectionsHealth();
    }, this.healthCheckInterval);
  }

  async checkConnectionsHealth() {
    for (const [poolKey, pool] of this.pools.entries()) {
        // Check idle connections
      const deadConnections = [];
      
      for (const connection of pool.connections) {
        if (!connection.client || !connection.client.isConnected()) {
          deadConnections.push(connection.id);
        }
      }
      
      // Remove dead connections
      for (const connId of deadConnections) {
        this.removeConnection(pool, connId);
      }
      
      // Check for idle timeout
      const now = Date.now();
      const expiredIdle = pool.idleConnections.filter(conn => {
        return conn.idleSince && (now - conn.idleSince) > this.idleTimeout;
      });
      
      // Remove connections that have been idle too long (keep minSize)
      if (pool.connections.length > pool.minSize) {
        const toRemove = expiredIdle.slice(0, pool.connections.length - pool.minSize);
        for (const conn of toRemove) {
          this.removeConnection(pool, conn.id);
        }
      }
      
      // Ensure minimum connections
      await this.ensureMinConnections(pool);
      
      // Clean up empty pools that haven't been used
      if (pool.connections.length === 0 && (now - pool.lastUsed) > 10 * 60 * 1000) {
        this.pools.delete(poolKey);
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStats() {
    const stats = {
      pools: {},
      totalConnections: 0,
      totalIdle: 0,
      totalInUse: 0
    };
    
    for (const [key, pool] of this.pools.entries()) {
      const poolStats = {
        key: pool.key,
        total: pool.connections.length,
        idle: pool.idleConnections.length,
        inUse: pool.inUse.size,
        maxSize: pool.maxSize,
        minSize: pool.minSize
      };
      
      stats.pools[key] = poolStats;
      stats.totalConnections += poolStats.total;
      stats.totalIdle += poolStats.idle;
      stats.totalInUse += poolStats.inUse;
    }
    
    return stats;
  }

  /**
   * Generate pool key for connection grouping
   */
  getPoolKey(host, port, ssl, username) {
    return `${host}:${port}:${ssl}:${username || 'anon'}`;
  }

  /**
   * Close all connections and cleanup
   */
  async shutdown() {
    for (const [key, pool] of this.pools.entries()) {
      for (const connection of pool.connections) {
        try {
          connection.client.disconnect();
        } catch (err) {
          // Ignore
        }
      }
    }
    
    this.pools.clear();
    this.activeConnections.clear();
    this.emit('shutdown');
  }
}

module.exports = new NNTPConnectionPool();
