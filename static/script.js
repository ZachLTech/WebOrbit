// Tailwind styles

const statusElement = document.getElementById('status');
        
function setLoadingStatus() {
    statusElement.className = "mt-2.5 p-2 rounded text-sm bg-gray-700";
}

function setSuccessStatus() {
    statusElement.className = "mt-2.5 p-2 rounded text-sm bg-green-900";
}

function setErrorStatus() {
    statusElement.className = "mt-2.5 p-2 rounded text-sm bg-red-900";
}

// 3D Graph Logic

const Graph = ForceGraph3D();
let currentCrawlId = null;
let checkInterval = null;

const getNodeColorByContentType = (contentType) => {
  if (!contentType) return "#888888";
  
  if (contentType.includes('text/html')) return "#4285f4";
  if (contentType.includes('image')) return "#34a853";    
  if (contentType.includes('javascript')) return "#fbbc05";
  if (contentType.includes('css')) return "#a142f4";      
  if (contentType.includes('pdf') || contentType.includes('document')) return "#ea4335";
  
  return "#888888";
};

const nodeSizeScale = d3
  .scaleLinear()
  .domain([1, 10])
  .range([1, 3])
  .clamp(true);
let nodeConnections = {};

const getLinkColor = (link) => {
  if (link.type === "internal") return "#4CAF50";
  if (link.type === "external") return "#FF5722";
  return "#2196F3";
};

const getLinkType = (link) => {
  try {
    const sourceUrl = new URL(link.source);
    const targetUrl = new URL(link.target);
    return sourceUrl.hostname === targetUrl.hostname ? "internal" : "external";
  } catch (e) {
    return "unknown";
  }
};

const graph = Graph(document.getElementById("graphContainer"))
  .backgroundColor("#121212")
  .nodeColor(node => getNodeColorByContentType(node.contentType))
  .nodeLabel((node) => {
    const count = nodeConnections[node.id] || 0;
    return `${node.label} (${count} connections)${node.contentType ? '\nType: ' + node.contentType : ''}`;
  })
  .nodeVal((node) => {
    const count = nodeConnections[node.id] || 1;
    return nodeSizeScale(count);
  })
  .linkWidth(1.5)
  .linkColor((link) => getLinkColor({...link, type: getLinkType(link)}))
  .linkCurvature(link => getLinkType(link) === "external" ? 0.25 : 0)
  .linkOpacity(0.8)
  .linkDirectionalParticles(2)
  .linkDirectionalParticleSpeed((d) => d.value * 0.001)
  .linkDirectionalParticleWidth(2)
  .onNodeClick((node) => {
    const nodeInfoEl = document.getElementById('nodeInfo');
    if (nodeInfoEl) {
      nodeInfoEl.innerHTML = `
        <div class="mb-1"><strong>URL:</strong> <a href="${node.url}" target="_blank" class="text-blue-400">${node.url}</a></div>
        <div class="mb-1"><strong>Content Type:</strong> ${node.contentType || 'Unknown'}</div>
        <div class="mb-1"><strong>Connections:</strong> ${nodeConnections[node.id] || 0}</div>
      `;
    }
  })
  .onNodeRightClick((node) => {
    graph.centerAt(node.x, node.y, node.z, 1000);
    graph.zoom(2.5, 1000);
  });

document.getElementById("crawlButton").addEventListener("click", startCrawl);

async function startCrawl() {
  const url = document.getElementById("urlInput").value.trim();
  if (!isValidUrl(url)) {
    setStatus(
      "Please enter a valid URL starting with http:// or https://",
      "error"
    );
    return;
  }

  const maxDepth = parseInt(document.getElementById("maxDepth").value);
  const maxPages = parseInt(document.getElementById("maxPages").value);
  const sameHostOnly = document.getElementById("sameHost").checked;
  const includeAssets = document.getElementById("includeAssets").checked;

  window.lastDataSize = 0;
  window.stableCount = 0;
  window.initialLoadPending = true;

  setStatus("Starting crawl...", "loading");

  try {
    const response = await fetch("/crawl", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        maxDepth,
        maxPages,
        sameHostOnly,
        includeAssets,
      }),
    });

    if (!response.ok) {
      throw new Error("Server returned error: " + response.status);
    }

    const data = await response.json();
    currentCrawlId = data.id;

    setStatus("Crawling in progress...", "loading");

    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
    
    graph.graphData({nodes: [], links: []});
    
    checkInterval = setInterval(checkCrawlStatus, 2000);
  } catch (error) {
    setStatus("Error: " + error.message, "error");
  }
}

async function checkCrawlStatus() {
  if (!currentCrawlId) return;

  try {
    const response = await fetch(`/results/${currentCrawlId}`);

    if (!response.ok) {
      throw new Error("Failed to get results");
    }

    const data = await response.json();
    
    if (data.nodes.length === 0) {
      return; // No data yet, keep waiting
    }

    nodeConnections = {};
    data.links.forEach((link) => {
      nodeConnections[link.source] = (nodeConnections[link.source] || 0) + 1;
      nodeConnections[link.target] = (nodeConnections[link.target] || 0) + 1;
    });

    const fixedNodes = data.nodes.map(node => ({
      ...node,
      id: node.id || node.URL || `node-${Math.random()}`,
      x: node.x || Math.random() * 100 - 50, 
      y: node.y || Math.random() * 100 - 50,
      z: node.z || Math.random() * 100 - 50
    }));

    const nodeIds = new Set(fixedNodes.map(node => node.id));
    const fixedLinks = data.links.filter(link => 
      nodeIds.has(link.source) && nodeIds.has(link.target)
    ).map(link => ({
      ...link,
      value: (nodeConnections[link.target] || 1) / 2,
    }));

    if (!window.lastDataSize) window.lastDataSize = 0;
    if (!window.stableCount) window.stableCount = 0;
    if (window.initialLoadPending === undefined) window.initialLoadPending = true;
    
    const maxPages = parseInt(document.getElementById("maxPages").value);
    let isCrawlComplete = false;

    setStatus(
      `Crawling: found ${fixedNodes.length} nodes and ${fixedLinks.length} links...`,
      "loading"
    );
    
    document.getElementById('nodeCount').textContent = fixedNodes.length;
    document.getElementById('linkCount').textContent = fixedLinks.length;
    
    const contentTypes = new Set();
    fixedNodes.forEach(node => {
      if (node.contentType) contentTypes.add(node.contentType.split(';')[0]);
    });
    document.getElementById('contentTypesCount').textContent = contentTypes.size;
    
    if (fixedNodes.length >= maxPages) {
      isCrawlComplete = true;
      setStatus(`Crawl complete: ${fixedNodes.length} pages found`, "success");
    } else if (fixedNodes.length === window.lastDataSize) {
      window.stableCount++;
      // If data size hasn't changed for 3 consecutive checks, assume crawl is complete
      if (window.stableCount >= 3 && fixedNodes.length > 0) {
        isCrawlComplete = true;
        setStatus(`Crawl stabilized: ${fixedNodes.length} pages found`, "success");
      }
    } else {
      window.lastDataSize = fixedNodes.length;
      window.stableCount = 0;
    }
    
    if (isCrawlComplete && window.initialLoadPending) {
      window.initialLoadPending = false;
      
      graph.graphData({
        nodes: fixedNodes,
        links: fixedLinks
      });
      
      setTimeout(() => {
        graph.zoomToFit(1000, 50);
      }, 1000);
      
      clearInterval(checkInterval);
      checkInterval = null;
    } else if (isCrawlComplete && !window.initialLoadPending) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  } catch (error) {
    setStatus("Error checking status: " + error.message, "error");
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

function setStatus(message, type) {
  const statusEl = document.getElementById("status");
  statusEl.textContent = message;
  
  if (type === "loading") {
    setLoadingStatus();
  } else if (type === "success") {
    setSuccessStatus();
  } else if (type === "error") {
    setErrorStatus();
  }
}

function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

document.getElementById("searchButton").addEventListener("click", filterGraph);

document.querySelector('input[value="all"].content-type-filter').addEventListener('change', function() {
  const contentTypeCheckboxes = document.querySelectorAll('.content-type-filter:not([value="all"])');
  contentTypeCheckboxes.forEach(checkbox => {
    checkbox.checked = this.checked;
    checkbox.disabled = this.checked;
  });
});

function getSelectedContentTypes() {
  const allCheckbox = document.querySelector('input[value="all"].content-type-filter');
  
  if (allCheckbox.checked) {
    return ["all"];
  }
  
  const selectedCheckboxes = document.querySelectorAll('.content-type-filter:checked');
  const selectedValues = Array.from(selectedCheckboxes).map(cb => cb.value);
  
  return selectedValues.length > 0 ? selectedValues : ["all"];
}

function filterGraph() {
  const searchTerm = document.getElementById("searchInput").value.toLowerCase();
  const contentTypeFilters = getSelectedContentTypes();
  
  if (!currentCrawlId) return;
  
  fetch(`/results/${currentCrawlId}`)
    .then(response => response.json())
    .then(data => {
      const filteredNodes = data.nodes.filter(node => {
        const matchesSearch = node.url.toLowerCase().includes(searchTerm) || 
                             (node.label && node.label.toLowerCase().includes(searchTerm));
        
        let matchesContentType = contentTypeFilters.includes("all");
        if (!matchesContentType && node.contentType) {
          matchesContentType = contentTypeFilters.some(filter => 
            node.contentType.includes(filter)
          );
        }
        
        return matchesSearch && matchesContentType;
      });
      
      const nodeIds = new Set(filteredNodes.map(n => n.id));
      const filteredLinks = data.links.filter(link => 
        nodeIds.has(link.source) && nodeIds.has(link.target)
      );
      
      graph.graphData({nodes: filteredNodes, links: filteredLinks});
      
      document.getElementById('nodeCount').textContent = filteredNodes.length;
      document.getElementById('linkCount').textContent = filteredLinks.length;
    });
}

document.addEventListener('DOMContentLoaded', function() {
  const allCheckbox = document.querySelector('input[value="all"].content-type-filter');
  const contentTypeCheckboxes = document.querySelectorAll('.content-type-filter:not([value="all"])');
  
  if (allCheckbox.checked) {
    contentTypeCheckboxes.forEach(checkbox => {
      checkbox.disabled = true;
    });
  }
  
  contentTypeCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', function() {
      if (this.checked) {
        allCheckbox.checked = false;
      }
      
      const anyChecked = Array.from(contentTypeCheckboxes).some(cb => cb.checked);
      if (!anyChecked) {
        allCheckbox.checked = true;
        contentTypeCheckboxes.forEach(cb => {
          cb.disabled = true;
        });
      }
    });
  });
});

document.getElementById("layout3d").addEventListener("click", () => {
  graph.numDimensions(3);
});

document.getElementById("layout2d").addEventListener("click", () => {
  graph.numDimensions(2);
});

document.getElementById("centerGraph").addEventListener("click", () => {
  const { nodes } = graph.graphData();
  if (nodes.length > 0) {
    const node = nodes[0];
    graph.centerAt(node.x, node.y, node.z, 1000);
    graph.zoom(1.5, 1000);
  }
});

document.getElementById("fitGraph").addEventListener("click", () => {
  graph.zoomToFit(1000, 50);
});

let isOrbiting = false;
let orbitInterval;

document.getElementById("toggleOrbit").addEventListener("click", () => {
  if (isOrbiting) {
    clearInterval(orbitInterval);
    isOrbiting = false;
    document.getElementById("toggleOrbit").textContent = "Start Orbit";
  } else {
    let angle = 0;
    orbitInterval = setInterval(() => {
      angle += Math.PI / 300;
      const distance = 300;
      graph.cameraPosition({
        x: distance * Math.sin(angle),
        y: 0,
        z: distance * Math.cos(angle)
      });
    }, 30);
    isOrbiting = true;
    document.getElementById("toggleOrbit").textContent = "Stop Orbit";
  }
});

let isSimulationActive = true;
document.getElementById("toggleSimulation").addEventListener("click", () => {
  if (isSimulationActive) {
    graph.pauseAnimation();
    document.getElementById("toggleSimulation").textContent = "Resume Simulation";
  } else {
    graph.resumeAnimation();
    document.getElementById("toggleSimulation").textContent = "Pause Simulation";
  }
  isSimulationActive = !isSimulationActive;
});