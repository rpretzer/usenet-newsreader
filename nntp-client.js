const net = require('net');
const tls = require('tls');

class NNTPClient {
  constructor(options = {}) {
    this.host = options.host || 'news.eternal-september.org';
    this.port = options.port || 119;
    this.ssl = options.ssl || false;
    this.username = options.username || null;
    this.password = options.password || null;
    this.socket = null;
    this.connected = false;
    this.buffer = '';
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

      // Wait for server greeting
      socket.once('data', async (data) => {
        const greeting = data.toString().trim();
        const code = parseInt(greeting.substring(0, 3));
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
          reject(new Error(`Server rejected connection: ${greeting.substring(4).trim()}`));
        }
      });
    });
  }

  async authenticate() {
    // Send AUTHINFO USER
    const userResponse = await this.sendCommand(`AUTHINFO USER ${this.username}`);
    
    // Check if password is needed (code 381)
    if (userResponse.code === 381) {
      // Send AUTHINFO PASS
      const passResponse = await this.sendCommand(`AUTHINFO PASS ${this.password}`);
      
      if (passResponse.code !== 281) {
        throw new Error('Authentication failed');
      }
    } else if (userResponse.code !== 281) {
      throw new Error('Authentication failed');
    }
  }

  setupSocket() {
    // Handle socket close/error events
    this.socket.on('close', () => {
      this.connected = false;
    });
    
    this.socket.on('error', (err) => {
      this.connected = false;
    });
    
    this.socket.on('end', () => {
      this.connected = false;
    });
  }

  isConnected() {
    return this.socket && 
           this.socket.writable && 
           !this.socket.destroyed &&
           this.connected;
  }

  sendCommand(command, expectMultiline = false) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected'));
        return;
      }

      let buffer = '';
      const timeout = setTimeout(() => {
        this.socket.removeListener('data', responseHandler);
        reject(new Error('Command timeout'));
      }, 60000);

      const responseHandler = (data) => {
        buffer += data.toString();
        const lines = buffer.split(/\r?\n/);
        
        // Check if we have a complete response
        if (expectMultiline) {
          // Multi-line response ends with ".\r\n" on its own line
          if (lines.length >= 2 && lines[lines.length - 2].trim() === '.') {
            clearTimeout(timeout);
            this.socket.removeListener('data', responseHandler);
            
            const statusLine = lines[0];
            const code = parseInt(statusLine.substring(0, 3));
            const message = statusLine.substring(4).trim();
            
            // Remove status line and terminating "."
            const dataLines = lines.slice(1, -2).filter(l => l !== '');
            
            if (code >= 200 && code < 400) {
              resolve({
                code,
                message,
                lines: dataLines
              });
            } else {
              reject(new Error(message || `NNTP error ${code}`));
            }
          }
        } else {
          // Single-line response
          if (lines.length >= 1) {
            clearTimeout(timeout);
            this.socket.removeListener('data', responseHandler);
            
            const statusLine = lines[0];
            const code = parseInt(statusLine.substring(0, 3));
            const message = statusLine.substring(4).trim();
            
            if (code >= 200 && code < 400) {
              resolve({
                code,
                message,
                lines: []
              });
            } else {
              reject(new Error(message || `NNTP error ${code}`));
            }
          }
        }
      };

      this.socket.on('data', responseHandler);
      this.socket.write(command + '\r\n');
    });
  }

  async list() {
    const response = await this.sendCommand('LIST', true);
    const groups = [];

    for (const line of response.lines) {
      if (!line || line.trim() === '') continue;
      
      const parts = line.split(/\s+/);
      if (parts.length >= 3) {
        // NNTP LIST format: groupname last first [flags] [description]
        groups.push({
          name: parts[0],
          last: parseInt(parts[1]) || 0,
          first: parseInt(parts[2]) || 0,
          description: parts.slice(3).join(' ') || ''
        });
      }
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

  async head(articleNumber) {
    // Use relative article number (just the number, not <number>)
    const response = await this.sendCommand(`HEAD ${articleNumber}`, true);
    if (response.code === 423) {
      throw new Error(`No such article: ${articleNumber}`);
    }
    return this.parseHeaders(response.lines);
  }

  async body(articleNumber) {
    // Use relative article number (just the number, not <number>)
    const response = await this.sendCommand(`BODY ${articleNumber}`, true);
    if (response.code === 423) {
      throw new Error(`No such article: ${articleNumber}`);
    }
    return response.lines.join('\n');
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
      number: parseInt(headers.number) || 0
    };
  }

  async getHeaders(start, end) {
    const headers = [];
    
    // Try XOVER first (much faster - single command for all articles)
    try {
      const xoverResponse = await this.sendCommand(`XOVER ${start}-${end}`, true);
      
      // Parse XOVER format: article-number\tsubject\tfrom\tdate\tmessage-id\treferences\tbytes\tlines
      for (const line of xoverResponse.lines) {
        if (!line || line.trim() === '') continue;
        const parts = line.split('\t');
        if (parts.length >= 5) {
          const articleNum = parseInt(parts[0]);
          if (!isNaN(articleNum) && articleNum >= start && articleNum <= end) {
            headers.push({
              number: articleNum,
              subject: parts[1] || '(no subject)',
              from: parts[2] || 'unknown',
              date: parts[3] || '',
              messageId: parts[4] || ''
            });
          }
        }
      }
      
      // Sort by article number (XOVER may not return in order)
      headers.sort((a, b) => a.number - b.number);
      
      if (headers.length > 0) {
        return headers;
      }
    } catch (xoverErr) {
      // XOVER not supported or failed, fall back to individual HEAD commands
      console.log('XOVER not available, using HEAD commands');
    }
    
    // Fallback: use individual HEAD commands (slower but more compatible)
    // Load in parallel batches for better performance
    const batchSize = 5;
    const batches = [];
    
    for (let i = start; i <= end; i += batchSize) {
      const batchEnd = Math.min(i + batchSize - 1, end);
      batches.push({ start: i, end: batchEnd });
    }
    
    // Process batches in parallel
    const batchPromises = batches.map(async (batch) => {
      const batchHeaders = [];
      for (let i = batch.start; i <= batch.end; i++) {
        try {
          const header = await this.head(i);
          header.number = i;
          batchHeaders.push(header);
        } catch (err) {
          // Skip articles that can't be read (might be expired/deleted)
          continue;
        }
      }
      return batchHeaders;
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    // Flatten and sort results
    for (const batchHeaders of batchResults) {
      headers.push(...batchHeaders);
    }
    
    headers.sort((a, b) => a.number - b.number);
    
    return headers;
  }

  async getArticle(articleNumber) {
    // Get both header and body
    const header = await this.head(articleNumber);
    const body = await this.body(articleNumber);
    return { header, body };
  }

  async post(groupName, subject, from, body, references = null) {
    // Select the group first
    await this.group(groupName);
    
    // Send POST command
    const postResponse = await this.sendCommand('POST');
    
    if (postResponse.code !== 340) {
      throw new Error('Server rejected POST command');
    }
    
    // Build the article
    const date = new Date().toUTCString();
    let article = `From: ${from}\r\n`;
    article += `Newsgroups: ${groupName}\r\n`;
    article += `Subject: ${subject}\r\n`;
    article += `Date: ${date}\r\n`;
    
    if (references) {
      article += `References: ${references}\r\n`;
    }
    
    article += `\r\n`;
    
    // Process body - escape lines starting with "." (NNTP requirement)
    const bodyLines = body.split(/\r?\n/);
    for (const line of bodyLines) {
      if (line.startsWith('.')) {
        article += '.' + line + '\r\n';
      } else {
        article += line + '\r\n';
      }
    }
    
    article += `.\r\n`;
    
    // Send the article
    const response = await this.sendMultilineData(article);
    
    if (response.code !== 240) {
      throw new Error('Article posting failed');
    }
    
    return response;
  }

  sendMultilineData(data) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected'));
        return;
      }

      let buffer = '';
      const timeout = setTimeout(() => {
        this.socket.removeListener('data', responseHandler);
        reject(new Error('Command timeout'));
      }, 60000);

      const responseHandler = (data) => {
        buffer += data.toString();
        const lines = buffer.split(/\r?\n/);
        
        if (lines.length >= 1) {
          clearTimeout(timeout);
          this.socket.removeListener('data', responseHandler);
          
          const statusLine = lines[0];
          const code = parseInt(statusLine.substring(0, 3));
          const message = statusLine.substring(4).trim();
          
          if (code >= 200 && code < 400) {
            resolve({
              code,
              message,
              lines: []
            });
          } else {
            reject(new Error(message || `NNTP error ${code}`));
          }
        }
      };

      this.socket.on('data', responseHandler);
      this.socket.write(data);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
    this.connected = false;
  }
}

module.exports = NNTPClient;

