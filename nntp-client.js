const net = require('net');
const tls = require('tls');

class NNTPClient {
  constructor(options = {}) {
    this.host = options.host || 'news.eternal-september.org';
    this.port = options.port || 119;
    this.ssl = options.ssl || false;
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
      socket.once('data', (data) => {
        const greeting = data.toString().trim();
        const code = parseInt(greeting.substring(0, 3));
        if (code >= 200 && code < 400) {
          this.connected = true;
          resolve();
        } else {
          reject(new Error(`Server rejected connection: ${greeting.substring(4).trim()}`));
        }
      });
    });
  }

  setupSocket() {
    // Buffer is managed per-command
  }

  sendCommand(command, expectMultiline = false) {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.writable) {
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
      if (parts.length >= 4) {
        groups.push({
          name: parts[0],
          last: parseInt(parts[1]) || 0,
          first: parseInt(parts[2]) || 0,
          count: parseInt(parts[3]) || 0,
          description: parts.slice(4).join(' ') || ''
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
    const response = await this.sendCommand(`HEAD ${articleNumber}`, true);
    return this.parseHeaders(response.lines);
  }

  async body(articleNumber) {
    const response = await this.sendCommand(`BODY ${articleNumber}`, true);
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
    
    for (let i = start; i <= end; i++) {
      try {
        const header = await this.head(i);
        header.number = i;
        headers.push(header);
      } catch (err) {
        // Skip articles that can't be read
        continue;
      }
    }
    
    return headers;
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

