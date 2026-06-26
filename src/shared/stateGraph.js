/**
 * ═══════════════════════════════════════════════════════════════
 *  TESTOCAN — State Graph (Incremental Site Map + Knowledge Tree)
 * ═══════════════════════════════════════════════════════════════
 *  Builds a directed graph as the user navigates:
 *    Nodes = unique page states (URL + DOM fingerprint)
 *    Edges = user actions that transition between states
 *    Interactions = per-page element-level actions (click, input, submit)
 *
 *  This enables Testocan to understand the application's real
 *  navigation structure and element-level interactions without
 *  crawling the entire site upfront.
 *
 *  The Knowledge Tree is built from nodes + interactions:
 *    Root = site domain
 *    Branches = pages (URLs)
 *    Leaves = interactions (buttons, inputs, forms)
 */

class StateGraph {
  constructor(data = null) {
    // nodes: Map<nodeId, { id, url, title, fingerprint, firstSeen, lastSeen }>
    this.nodes = new Map();
    // edges: Array<{ from, to, action, locator, timestamp }>
    this.edges = [];
    // interactions: Map<nodeId, Array<{ id, action, label, locator, count, firstSeen, lastSeen }>>
    this.interactions = new Map();

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
   * Extract domain from URL for tree root label.
   */
  static urlToDomain(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  /**
   * Extract readable path segments from a URL.
   */
  static urlToPathLabel(url) {
    try {
      const u = new URL(url);
      const path = u.pathname.replace(/\/+$/, '') || '/';
      return path === '/' ? 'Ana Sayfa' : decodeURIComponent(path);
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
      node.visitCount = (node.visitCount || 1) + 1;
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
      visitCount: 1,
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
   * Add an interaction (element-level action) on a specific page.
   * This powers the Knowledge Tree's leaf nodes.
   */
  addInteraction(url, action, label, locator = null) {
    const nodeId = StateGraph.urlToNodeId(url);
    const now = Date.now();

    // Ensure the page node exists
    if (!this.nodes.has(nodeId)) this.addNode(url);

    if (!this.interactions.has(nodeId)) {
      this.interactions.set(nodeId, []);
    }

    const pageInteractions = this.interactions.get(nodeId);

    // Generate a stable interaction ID from action + label + locator hints
    const interactionKey = `${action}::${(label || '').toLowerCase().trim()}::${locator?.id || locator?.testId || locator?.name || locator?.cssSelector || ''}`;

    const existing = pageInteractions.find(i => i.key === interactionKey);
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      existing.lastSeen = now;
      if (label && label.length > (existing.label || '').length) {
        existing.label = label; // keep the most descriptive label
      }
      return existing;
    }

    const interaction = {
      id: `int_${now}_${Math.random().toString(36).slice(2, 7)}`,
      key: interactionKey,
      action,
      label: label || 'Bilinmeyen',
      locator: locator ? {
        tagName: locator.tagName,
        id: locator.id,
        testId: locator.testId,
        name: locator.name,
        role: locator.role,
        ariaLabel: locator.ariaLabel,
        placeholder: locator.placeholder,
        type: locator.type,
      } : null,
      count: 1,
      firstSeen: now,
      lastSeen: now,
    };
    pageInteractions.push(interaction);
    return interaction;
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
   * Convert the graph into a hierarchical tree structure for the Knowledge Tree UI.
   *
   * Structure:
   *   Root (domain)
   *     └── Page Node (URL path)
   *           ├── Click: "Giriş Yap" (3x)
   *           ├── Input: "Kullanıcı Adı" (5x)
   *           └── Sub-page Node (navigated from here)
   *                 └── Click: "Bayiler" (2x)
   */
  toTree() {
    if (this.nodes.size === 0) {
      return { children: [], stats: { pages: 0, interactions: 0, totalVisits: 0 } };
    }

    // Group nodes by domain
    const domainGroups = new Map();
    for (const [nodeId, node] of this.nodes) {
      const domain = StateGraph.urlToDomain(node.url);
      if (!domainGroups.has(domain)) {
        domainGroups.set(domain, []);
      }
      domainGroups.get(domain).push(node);
    }

    const ACTION_ICONS = {
      click: '🖱️',
      input: '⌨️',
      change: '✏️',
      submit: '📤',
      navigate: '🧭',
    };

    const ACTION_LABELS = {
      click: 'Tıklama',
      input: 'Giriş',
      change: 'Değişiklik',
      submit: 'Gönderim',
    };

    let totalInteractions = 0;
    let totalVisits = 0;

    // Build tree per domain
    const rootChildren = [];
    for (const [domain, nodes] of domainGroups) {
      const pageChildren = [];

      // Sort nodes by firstSeen for consistent ordering
      nodes.sort((a, b) => a.firstSeen - b.firstSeen);

      for (const node of nodes) {
        totalVisits += (node.visitCount || 1);
        const path = StateGraph.urlToPathLabel(node.url);
        // If there's a title and it's not the root path, prefix it with the path for clarity
        const pathLabel = node.title ? (path === 'Ana Sayfa' ? node.title : `[${path}] ${node.title}`) : path;
        const pageInteractions = this.interactions.get(node.id) || [];

        // Build interaction children for this page
        const interactionChildren = pageInteractions.map(int => {
          totalInteractions++;
          return {
            id: int.id,
            label: int.label,
            type: int.action,
            icon: ACTION_ICONS[int.action] || '❓',
            typeLabel: ACTION_LABELS[int.action] || int.action,
            count: int.count,
            firstSeen: int.firstSeen,
            lastSeen: int.lastSeen,
            locator: int.locator,
            children: [],
          };
        });

        // Sort interactions: most used first
        interactionChildren.sort((a, b) => b.count - a.count);

        // Get edges going OUT of this page
        const outgoingEdges = this.edges.filter(e => e.from === node.id);
        const navigationTargets = outgoingEdges.map(edge => {
          const targetNode = this.nodes.get(edge.to);
          return {
            id: `nav_${edge.from}_${edge.to}`,
            label: targetNode ? (targetNode.title || StateGraph.urlToPathLabel(targetNode.url)) : edge.to,
            type: 'navigation',
            icon: '🔗',
            typeLabel: 'Navigasyon',
            count: edge.count || 1,
            action: edge.action,
            targetUrl: edge.to,
            children: [],
          };
        });

        pageChildren.push({
          id: node.id,
          label: pathLabel,
          type: 'page',
          icon: '📄',
          url: node.url,
          visitCount: node.visitCount || 1,
          firstSeen: node.firstSeen,
          lastSeen: node.lastSeen,
          interactionCount: pageInteractions.length,
          children: [...interactionChildren, ...navigationTargets],
        });
      }

      rootChildren.push({
        id: `domain_${domain}`,
        label: domain,
        type: 'domain',
        icon: '🌐',
        pageCount: nodes.length,
        children: pageChildren,
      });
    }

    return {
      children: rootChildren,
      stats: {
        pages: this.nodes.size,
        interactions: totalInteractions,
        totalVisits,
        domains: domainGroups.size,
      },
    };
  }

  /**
   * Serialize for chrome.storage.
   */
  serialize() {
    return {
      nodes: Array.from(this.nodes.entries()),
      edges: this.edges,
      interactions: Array.from(this.interactions.entries()),
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
    if (data.interactions) {
      this.interactions = new Map(data.interactions);
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
    let totalInteractions = 0;
    for (const [, ints] of this.interactions) {
      totalInteractions += ints.length;
    }
    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.length,
      interactionCount: totalInteractions,
    };
  }
}

// Make available in both module and non-module contexts
if (typeof module !== 'undefined') module.exports = { StateGraph };
if (typeof self !== 'undefined') self.StateGraph = StateGraph;

