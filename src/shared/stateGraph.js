/**
 * ═══════════════════════════════════════════════════════════════
 *  TESTOCAN — State Graph (Incremental Site Map)
 * ═══════════════════════════════════════════════════════════════
 *  Builds a directed graph as the user navigates:
 *    Nodes = unique page states (URL + DOM fingerprint)
 *    Edges = user actions that transition between states
 *
 *  This enables Testocan to understand the application's real
 *  navigation structure without crawling the entire site upfront.
 */

class StateGraph {
  constructor(data = null) {
    // nodes: Map<nodeId, { id, url, title, fingerprint, firstSeen, lastSeen }>
    this.nodes = new Map();
    // edges: Array<{ from, to, action, locator, timestamp }>
    this.edges = [];

    if (data) this.deserialize(data);
  }

  /**
   * Generate a node ID from URL (normalized — strip hash, trailing slash).
   */
  static urlToNodeId(url) {
    try {
      const u = new URL(url);
      // Normalize: remove hash, trailing slash, sort query params
      let path = u.pathname.replace(/\/+$/, '') || '/';
      const params = new URLSearchParams(u.search);
      params.sort();
      const query = params.toString();
      return `${u.origin}${path}${query ? '?' + query : ''}`;
    } catch {
      return url;
    }
  }

  /**
   * Add or update a node in the graph.
   */
  addNode(url, title = '', fingerprint = null) {
    const id = StateGraph.urlToNodeId(url);
    const now = Date.now();

    if (this.nodes.has(id)) {
      const node = this.nodes.get(id);
      node.lastSeen = now;
      if (title) node.title = title;
      if (fingerprint) node.fingerprint = fingerprint;
      return node;
    }

    const node = {
      id,
      url: id,
      title,
      fingerprint,
      firstSeen: now,
      lastSeen: now,
    };
    this.nodes.set(id, node);
    return node;
  }

  /**
   * Add an edge (state transition) between two nodes.
   */
  addEdge(fromUrl, toUrl, action, locator = null) {
    const fromId = StateGraph.urlToNodeId(fromUrl);
    const toId = StateGraph.urlToNodeId(toUrl);

    // Ensure both nodes exist
    if (!this.nodes.has(fromId)) this.addNode(fromUrl);
    if (!this.nodes.has(toId)) this.addNode(toUrl);

    // Check if edge already exists
    const existing = this.edges.find(
      (e) => e.from === fromId && e.to === toId && e.action === action
    );

    if (existing) {
      existing.count = (existing.count || 1) + 1;
      existing.lastUsed = Date.now();
      return existing;
    }

    const edge = {
      from: fromId,
      to: toId,
      action,
      locator,
      timestamp: Date.now(),
      lastUsed: Date.now(),
      count: 1,
    };
    this.edges.push(edge);
    return edge;
  }

  /**
   * Get all outgoing edges from a node.
   */
  getOutgoingEdges(url) {
    const id = StateGraph.urlToNodeId(url);
    return this.edges.filter((e) => e.from === id);
  }

  /**
   * Get all nodes reachable from a given URL.
   */
  getReachable(url) {
    const startId = StateGraph.urlToNodeId(url);
    const visited = new Set();
    const queue = [startId];

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);

      const outgoing = this.edges.filter((e) => e.from === current);
      for (const edge of outgoing) {
        if (!visited.has(edge.to)) queue.push(edge.to);
      }
    }

    return Array.from(visited)
      .map((id) => this.nodes.get(id))
      .filter(Boolean);
  }

  /**
   * Serialize for chrome.storage.
   */
  serialize() {
    return {
      nodes: Array.from(this.nodes.entries()),
      edges: this.edges,
    };
  }

  /**
   * Deserialize from chrome.storage.
   */
  deserialize(data) {
    if (data.nodes) {
      this.nodes = new Map(data.nodes);
    }
    if (data.edges) {
      this.edges = data.edges;
    }
  }

  /**
   * Export as Mermaid diagram.
   */
  toMermaid() {
    const lines = ['graph TD'];
    const nodeLabels = new Map();

    let i = 0;
    for (const [id, node] of this.nodes) {
      const label = node.title || new URL(node.url).pathname || '/';
      const safeLabel = label.replace(/"/g, "'");
      const nodeKey = `N${i}`;
      nodeLabels.set(id, nodeKey);
      lines.push(`  ${nodeKey}["${safeLabel}"]`);
      i++;
    }

    for (const edge of this.edges) {
      const from = nodeLabels.get(edge.from);
      const to = nodeLabels.get(edge.to);
      if (from && to) {
        const action = (edge.action || 'navigate').replace(/"/g, "'");
        lines.push(`  ${from} -->|"${action}"| ${to}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get stats.
   */
  get stats() {
    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.length,
    };
  }
}

// Make available in both module and non-module contexts
if (typeof module !== 'undefined') module.exports = { StateGraph };
if (typeof self !== 'undefined') self.StateGraph = StateGraph;
