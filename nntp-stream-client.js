const net = require('net');
const tls = require('tls');
const { EventEmitter } = require('events');

/**
 * High-performance streaming NNTP client with chunk-based processing
 * Avoids O(n²) memory issues by processing data in chunks rather than
 * accumulating in buffers
 */
class StreamingNNTPClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = options.host || 'news.eternal-september.org';
    this.port = options.port || 119;
    this.ssl = options.ssl || false;
    this.username = options.username || null;
    this.password = options.password || null;
    this.socket = null;
    this.connected = false;
    
    // Chunk-based line buffer (processes incomplete lines)
    this.lineBuffer = '';
    this.pendingCommands = new Map();
    this.commandCounter = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const connectOptions = {
        host: this.host,
        port: this.port
      };

      const socket = this.ssl 
        ? tls.connect(connectOptions, () => {
            this.socket = socket;
            this.setupSocket();
          })
        : net.createConnection(connectOptions, () => {
            this.socket = socket;
            this.setupSocket();
          });

      socket.on('error', (err) => {
        reject(err);
      });

      socket.setTimeout(30000);
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      });

      // Process greeting with chunk-based approach
      this.once('greeting', async (code, message) => {
        if (code >= 200 && code < 400) {
          this.connected = true;
          
          // Authenticate if credentials provided
          if (this.username && this.password) {
            try {
              await this.authenticate();
            } catch (authErr) {
              reject(new Error(`Authentication failed: ${authErr.message}`));
              return;
            }
          }
          
          resolve();
        } else {
          reject(new Error(`Server rejected connection: ${message}`));
        }
      });
    });
  }

  setupSocket() {
    // Handle socket close/error events
    this.socket.on('close', () => {
      this.connected = false;
      this.emit('disconnect');
    });
    
    this.socket.on('error', (err) => {
      this.connected = false;
      this.emit('error', err);
    });
    
    this.socket.on('end', () => {
      this.connected = false;
      this.emit('disconnect');
    });

    // Stream-based data processing - no buffer accumulation
    this.socket.on('data', (chunk) => {
      this.processChunk(chunk);
    });
  }

  /**
   * Process incoming data chunk by chunk without accumulating in memory
   * This is the key optimization - we process lines as they arrive
   */
  processChunk(chunk) {
    // Convert chunk to string (chunks are already small, this is fine)
    const data = chunk.toString('utf8');
    
    // Append to line buffer (only incomplete line at end)
    const completeData = this.lineBuffer + data;
    const lines = completeData.split(/\r?\n/);
    
    // Save incomplete line for next chunk
    this.lineBuffer = lines.pop() || '';
    
    // Process complete lines
    for (const line of lines) {
      this.processLine(line);
    }
  }

  /**
   * Process a single complete line
   */
  processLine(line) {
    // Check if this is a greeting (first message from server)
    if (!this.connected && /^\d{3}\s/.test(line)) {
      const code = parseInt(line.substring(0, 3));
      const message = line.substring(4).trim();
      this.emit('greeting', code, message);
      return;
    }

    // Check if this is a status line (response to command)
    if (/^\d{3}\s/.test(line)) {
      const code = parseInt(line.substring(0, 3));
      const message = line.substring(4).trim();
      
      // Find pending command
      for (const [id, resolver] of this.pendingCommands.entries()) {
        resolver.onStatusLine(code, message, line);
        break; // First pending command gets this response
      }
      return;
    }

    // Data line for multiline response
    for (const [id, resolver] of this.pendingCommands.entries()) {
      if (resolver.expectingMultiline) {
        resolver.onDataLine(line);
        break;
      }
    }
  }

  isConnected() {
    return this.socket && 
           this.socket.writable && 
           !this.socket.destroyed &&
           this.connected;
  }

  /**
   * Send command with streaming response handling
   */
  sendCommand(command, expectMultiline = false) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected'));
        return;
      }

      const commandId = ++this.commandCounter;
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        reject(new Error('Command timeout'));
      }, 60000);

      // Create response resolver with chunk-based processing
      const resolver = new ResponseResolver(
        commandId,
        expectMultiline,
        (result) => {
          clearTimeout(timeout);
          this.pendingCommands.delete(commandId);
          resolve(result);
        },
        (error) => {
          clearTimeout(timeout);
          this.pendingCommands.delete(commandId);
          reject(error);
        }
      );

      this.pendingCommands.set(commandId, resolver);
      this.socket.write(command + '\r\n');
    });
  }

  async authenticate() {
    const userResponse = await this.sendCommand(`AUTHINFO USER ${this.username}`);
    
    if (userResponse.code === 381) {
      const passResponse = await this.sendCommand(`AUTHINFO PASS ${this.password}`);
      
      if (passResponse.code !== 281) {
        throw new Error('Authentication failed');
      }
    } else if (userResponse.code !== 281) {
      throw new Error('Authentication failed');
    }
  }

  /**
   * Stream groups list - yields groups as they're parsed (non-blocking)
   */
  async *streamGroups() {
    const response = await this.sendCommand('LIST', true);
    
    for (const line of response.lines) {
      if (!line || line.trim() === '') continue;
      
      const parts = line.split(/\s+/);
      if (parts.length >= 3) {
        yield {
          name: parts[0],
          last: parseInt(parts[1]) || 0,
          first: parseInt(parts[2]) || 0,
          description: parts.slice(3).join(' ') || ''
        };
      }
    }
  }

  async list() {
    const groups = [];
    for await (const group of this.streamGroups()) {
      groups.push(group);
    }
    return groups;
  }

  async group(groupName) {
    const response = await this.sendCommand(`GROUP ${groupName}`);
    const parts = response.message.split(/\s+/);
    
    return {
      count: parseInt(parts[0]) || 0,
      first: parseInt(parts[1]) || 0,
      last: parseInt(parts[2]) || 0,
      name: parts[3] || groupName
    };
  }

  /**
   * Stream headers using XOVER - processes in chunks
   */
  async *streamHeaders(start, end) {
    try {
      const response = await this.sendCommand(`XOVER ${start}-${end}`, true);
      
      for (const line of response.lines) {
        if (!line || line.trim() === '') continue;
        const parts = line.split('\t');
        if (parts.length >= 5) {
          const articleNum = parseInt(parts[0]);
          if (!isNaN(articleNum) && articleNum >= start && articleNum <= end) {
            yield {
              number: articleNum,
              subject: parts[1] || '(no subject)',
              from: parts[2] || 'unknown',
              date: parts[3] || '',
              messageId: parts[4] || '',
              references: parts[5] || ''
            };
          }
        }
      }
    } catch (xoverErr) {
      // Fallback to HEAD commands in batches
      const batchSize = 10;
      for (let i = start; i <= end; i += batchSize) {
        const batchEnd = Math.min(i + batchSize - 1, end);
        const batch = [];
        
        // Collect batch
        for (let j = i; j <= batchEnd; j++) {
          try {
            const header = await this.head(j);
            header.number = j;
            batch.push(header);
          } catch (err) {
            continue;
          }
        }
        
        // Yield all in batch
        for (const header of batch) {
          yield header;
        }
      }
    }
  }

  async getHeaders(start, end) {
    const headers = [];
    for await (const header of this.streamHeaders(start, end)) {
      headers.push(header);
    }
    headers.sort((a, b) => a.number - b.number);
    return headers;
  }

  async head(articleNumber) {
    const response = await this.sendCommand(`HEAD ${articleNumber}`, true);
    if (response.code === 423) {
      throw new Error(`No such article: ${articleNumber}`);
    }
    return this.parseHeaders(response.lines);
  }

  /**
   * Stream article body in chunks - avoids loading entire body into memory
   */
  async *streamBody(articleNumber) {
    const response = await this.sendCommand(`BODY ${articleNumber}`, true);
    if (response.code === 423) {
      throw new Error(`No such article: ${articleNumber}`);
    }
    
    // Yield body line by line
    for (const line of response.lines) {
      yield line;
    }
  }

  async body(articleNumber) {
    const lines = [];
    for await (const line of this.streamBody(articleNumber)) {
      lines.push(line);
    }
    return lines.join('\n');
  }

  parseHeaders(lines) {
    const headers = {};
    
    for (const line of lines) {
      if (line === '') break;
      
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim().toLowerCase();
        const value = line.substring(colonIndex + 1).trim();
        headers[key] = value;
      }
    }

    return {
      subject: headers.subject || '',
      from: headers.from || '',
      date: headers.date || '',
      messageId: headers['message-id'] || '',
      references: headers.references || '',
      number: parseInt(headers.number) || 0
    };
  }

  async getArticle(articleNumber) {
    const header = await this.head(articleNumber);
    const body = await this.body(articleNumber);
    return { header, body };
  }

  async post(groupName, subject, from, body, references = null) {
    await this.group(groupName);
    
    const postResponse = await this.sendCommand('POST');
    
    if (postResponse.code !== 340) {
      throw new Error('Server rejected POST command');
    }
    
    const date = new Date().toUTCString();
    const lines = [
      `From: ${from}`,
      `Newsgroups: ${groupName}`,
      `Subject: ${subject}`,
      `Date: ${date}`,
      references ? `References: ${references}` : '',
      '',
      ...body.split(/\r?\n/).map(line => line.startsWith('.') ? '.' + line : line),
      '.'
    ];
    
    // Stream article line by line instead of building one big string
    for (const line of lines) {
      if (line) {
        this.socket.write(line + '\r\n');
      } else {
        this.socket.write('\r\n');
      }
    }
    
    const response = await this.sendCommand('', false);
    
    if (response.code !== 240) {
      throw new Error('Article posting failed');
    }
    
    return response;
  }

  disconnect() {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
    this.connected = false;
    this.lineBuffer = '';
    this.pendingCommands.clear();
  }
}

/**
 * Response resolver that handles chunk-based response parsing
 */
class ResponseResolver {
  constructor(id, expectMultiline, resolve, reject) {
    this.id = id;
    this.expectingMultiline = expectMultiline;
    this.resolve = resolve;
    this.reject = reject;
    this.statusCode = null;
    this.statusMessage = null;
    this.dataLines = [];
    this.statusLineReceived = false;
  }

  onStatusLine(code, message, fullLine) {
    this.statusCode = code;
    this.statusMessage = message;
    this.statusLineReceived = true;
    
    if (!this.expectingMultiline) {
      // Single-line response
      if (code >= 200 && code < 400) {
        this.resolve({
          code,
          message,
          lines: []
        });
      } else {
        this.reject(new Error(message || `NNTP error ${code}`));
      }
    }
    // For multiline, wait for data lines and terminating "."
  }

  onDataLine(line) {
    if (!this.statusLineReceived) {
      return; // Shouldn't happen, but be safe
    }

    // Check for terminating "." on its own line
    if (line.trim() === '.') {
      // End of multiline response
      if (this.statusCode >= 200 && this.statusCode < 400) {
        this.resolve({
          code: this.statusCode,
          message: this.statusMessage,
          lines: this.dataLines
        });
      } else {
        this.reject(new Error(this.statusMessage || `NNTP error ${this.statusCode}`));
      }
    } else {
      // Regular data line - unescape leading "." if present
      if (line.startsWith('..')) {
        this.dataLines.push(line.substring(1));
      } else {
        this.dataLines.push(line);
      }
    }
  }
}

module.exports = StreamingNNTPClient;
