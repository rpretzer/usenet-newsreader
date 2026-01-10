/**
 * Message threading algorithm for organizing Usenet articles
 * Implements standard References-based threading used in newsreaders
 */

class MessageThread {
  constructor(article) {
    this.article = article;
    this.children = [];
    this.parent = null;
    this.depth = 0;
    this.messageId = article.messageId;
    this.references = this.parseReferences(article.references);
  }

  parseReferences(refs) {
    if (!refs || !refs.trim()) return [];
    
    // References header contains space-separated message IDs
    return refs.trim().split(/\s+/).filter(id => id.length > 0);
  }

  addChild(child) {
    child.parent = this;
    child.depth = this.depth + 1;
    this.children.push(child);
    this.children.sort((a, b) => {
      const dateA = a.article.date ? new Date(a.article.date).getTime() : 0;
      const dateB = b.article.date ? new Date(b.article.date).getTime() : 0;
      return dateA - dateB;
    });
  }

  // Get all messages in this thread (including self and all descendants)
  getAllMessages() {
    const messages = [this];
    for (const child of this.children) {
      messages.push(...child.getAllMessages());
    }
    return messages;
  }

  // Count of messages in this thread
  getMessageCount() {
    return 1 + this.children.reduce((sum, child) => sum + child.getMessageCount(), 0);
  }
}

/**
 * Build threaded structure from flat list of articles
 * Implements the standard Usenet threading algorithm
 */
function buildThreadTree(articles) {
  // Create a map of message ID -> thread node
  const messageMap = new Map();
  const rootThreads = [];

  // First pass: create thread nodes for all articles
  const threads = articles.map(article => {
    const thread = new MessageThread(article);
    if (thread.messageId) {
      messageMap.set(thread.messageId, thread);
    }
    return thread;
  });

  // Second pass: link threads based on References header
  for (const thread of threads) {
    if (thread.references.length > 0) {
      // Find parent by traversing references chain
      let parent = null;
      for (let i = thread.references.length - 1; i >= 0; i--) {
        const refId = thread.references[i];
        if (messageMap.has(refId)) {
          parent = messageMap.get(refId);
          break;
        }
      }

      if (parent) {
        parent.addChild(thread);
      } else {
        // No parent found - this might be a reply to a message not in our set
        // Check if subject suggests it's a reply
        if (isReply(thread.article.subject)) {
          // Try to find parent by subject
          const subjectBase = extractSubjectBase(thread.article.subject);
          const possibleParent = findParentBySubject(subjectBase, threads, thread);
          if (possibleParent) {
            possibleParent.addChild(thread);
          } else {
            rootThreads.push(thread);
          }
        } else {
          rootThreads.push(thread);
        }
      }
    } else {
      // No references - check if it's a reply by subject
      if (isReply(thread.article.subject)) {
        const subjectBase = extractSubjectBase(thread.article.subject);
        const possibleParent = findParentBySubject(subjectBase, threads, thread);
        if (possibleParent) {
          possibleParent.addChild(thread);
        } else {
          rootThreads.push(thread);
        }
      } else {
        // Root message
        rootThreads.push(thread);
      }
    }
  }

  // Sort root threads by date (newest first)
  rootThreads.sort((a, b) => {
    const dateA = a.article.date ? new Date(a.article.date).getTime() : 0;
    const dateB = b.article.date ? new Date(b.article.date).getTime() : 0;
    return dateB - dateA;
  });

  return rootThreads;
}

/**
 * Flatten threaded tree into a list for display
 * Returns articles with depth information
 */
function flattenThreads(rootThreads) {
  const flattened = [];
  
  function traverse(thread) {
    flattened.push({
      ...thread.article,
      depth: thread.depth,
      threadMessageCount: thread.getMessageCount(),
      hasChildren: thread.children.length > 0,
      isExpanded: true // Could be stateful
    });
    
    // Recursively add children
    for (const child of thread.children) {
      traverse(child);
    }
  }
  
  for (const root of rootThreads) {
    traverse(root);
  }
  
  return flattened;
}

/**
 * Check if subject indicates a reply
 */
function isReply(subject) {
  if (!subject) return false;
  const normalized = subject.trim().toLowerCase();
  return normalized.startsWith('re:') || 
         normalized.startsWith('re:') ||
         normalized.match(/^re\[?\d+\]?:/i);
}

/**
 * Extract base subject (remove Re: prefixes)
 */
function extractSubjectBase(subject) {
  if (!subject) return '';
  // Remove common reply prefixes
  return subject
    .replace(/^re:\s*/i, '')
    .replace(/^re\[?\d+\]?:\s*/i, '')
    .replace(/^fwd?:\s*/i, '')
    .trim();
}

/**
 * Find potential parent by matching subject
 */
function findParentBySubject(subjectBase, allThreads, currentThread) {
  if (!subjectBase) return null;
  
  // Look for message with matching subject that came before this one
  const currentDate = currentThread.article.date ? 
    new Date(currentThread.article.date).getTime() : 0;
  
  let bestMatch = null;
  let bestDate = 0;
  
  for (const thread of allThreads) {
    if (thread === currentThread) continue;
    
    const threadSubjectBase = extractSubjectBase(thread.article.subject);
    if (threadSubjectBase.toLowerCase() === subjectBase.toLowerCase()) {
      const threadDate = thread.article.date ? 
        new Date(thread.article.date).getTime() : 0;
      
      // Must be before current message
      if (threadDate > 0 && threadDate < currentDate && threadDate > bestDate) {
        bestMatch = thread;
        bestDate = threadDate;
      }
    }
  }
  
  return bestMatch;
}

/**
 * Get thread statistics
 */
function getThreadStats(rootThreads) {
  let totalThreads = rootThreads.length;
  let totalMessages = 0;
  let maxDepth = 0;
  let longestThread = 0;
  
  function analyze(thread, depth = 0) {
    totalMessages++;
    maxDepth = Math.max(maxDepth, depth);
    const threadSize = thread.getMessageCount();
    longestThread = Math.max(longestThread, threadSize);
    
    for (const child of thread.children) {
      analyze(child, depth + 1);
    }
  }
  
  for (const root of rootThreads) {
    analyze(root);
  }
  
  return {
    totalThreads,
    totalMessages,
    maxDepth,
    longestThread,
    avgMessagesPerThread: totalThreads > 0 ? totalMessages / totalThreads : 0
  };
}

module.exports = {
  buildThreadTree,
  flattenThreads,
  getThreadStats,
  MessageThread
};
