import * as THREE from 'three';

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

let graph;
let currentCrawlId = null;
let checkInterval = null;
let rootNodeUrl = null;
let currentControlType = 'orbit';

function initializeGraph(controlType = 'orbit') {
  // First, dispose of any existing THREE.js objects
  if (graph) {
    // Get the WebGL renderer from the graph
    const graphElement = document.getElementById("graphContainer");
    if (graphElement.__graphRenderer) {
      graphElement.__graphRenderer.dispose();
    }
    
    // Clear the container
    const container = document.getElementById("graphContainer");
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
  }
  
  const graphInstance = ForceGraph3D({ controlType });
  
  // Get current link width setting
  const linkWidthValue = parseFloat(document.getElementById("linkWidth").value);
  
  graph = graphInstance(document.getElementById("graphContainer"))
    .backgroundColor("#121212")
    .nodeThreeObject(node => {
      if (node.url === rootNodeUrl) {
        const star = createStarShape(8);
        star.__graphObjType = 'node';
        star.__data = node;
        return star;
      }
      return null;
    })
    .nodeThreeObjectExtend(false)
    .nodeColor(node => getNodeColorByContentType(node.contentType))
    .nodeLabel((node) => {
      const count = nodeConnections[node.id] || 0;
      return `${node.label} (${count} connections)${node.contentType ? '\nType: ' + node.contentType : ''}`;
    })
    .nodeVal((node) => {
      const count = nodeConnections[node.id] || 1;
      return nodeSizeScale(count);
    })
    .linkWidth(linkWidthValue)
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
  
  return graph;
}

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

const createStarShape = (size = 5, color = 0xFFD700) => {
  const starShape = new THREE.Shape();
  
  const points = 5;
  const outerRadius = size;
  const innerRadius = size * 0.4;
  
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = (Math.PI / points) * i;
    const x = Math.sin(angle) * radius;
    const y = Math.cos(angle) * radius;
    
    if (i === 0) {
      starShape.moveTo(x, y);
    } else {
      starShape.lineTo(x, y);
    }
  }
  
  starShape.closePath();
  
  const extrudeSettings = {
    depth: size * 0.6,
    bevelEnabled: true,
    bevelThickness: size * 0.05,
    bevelSize: size * 0.05,
    bevelSegments: 2
  };
  
  const geometry = new THREE.ExtrudeGeometry(starShape, extrudeSettings);
  
  const material = new THREE.MeshStandardMaterial({
    color: color,
    metalness: 0.8,
    roughness: 0.3,
    emissive: 0x444400,
    emissiveIntensity: 0.2
  });
  
  const mesh = new THREE.Mesh(geometry, material);
  
  material.side = THREE.DoubleSide;
  
  mesh.rotation.set(-Math.PI/2, 0, 0);
  
  return mesh;
};

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

  // Store the root URL for later reference
  rootNodeUrl = url;
  
  const maxDepth = parseInt(document.getElementById("maxDepth").value);
  const maxPages = parseInt(document.getElementById("maxPages").value);
  const sameHostOnly = document.getElementById("sameHost").checked;
  const includeAssets = document.getElementById("includeAssets").checked;
  const crawlJavaScript = document.getElementById("crawlJavaScript").checked;

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
        crawlJavaScript
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
  
  setTimeout(() => {
    const { nodes } = graph.graphData();
    nodes.forEach(node => {
      if (node.url === rootNodeUrl && node.__threeObj) {
        node.__threeObj.rotation.set(-Math.PI/2, 0, 0);
      }
    });
  }, 100);
});

document.getElementById("layout2d").addEventListener("click", () => {
  graph.numDimensions(2);
  
  setTimeout(() => {
    const { nodes } = graph.graphData();
    nodes.forEach(node => {
      if (node.url === rootNodeUrl && node.__threeObj) {
        node.__threeObj.rotation.set(0, 0, 0);
      }
    });
  }, 100);
});

document.getElementById("centerGraph").addEventListener("click", () => {
  const { nodes } = graph.graphData();
  if (nodes.length === 0) return;
  
  if (isOrbiting) return;

  const center = {x: 0, y: 0, z: 0};
  nodes.forEach(node => {
    center.x += node.x || 0;
    center.y += node.y || 0; 
    center.z += node.z || 0;
  });
  
  center.x /= nodes.length;
  center.y /= nodes.length;
  center.z /= nodes.length;
  
  const currentPosition = graph.cameraPosition();
  const currentTarget = graph.cameraPosition().lookAt || center;
  
  const dx = currentPosition.x - currentTarget.x;
  const dy = currentPosition.y - currentTarget.y;
  const dz = currentPosition.z - currentTarget.z;
  const currentDistance = Math.sqrt(dx*dx + dy*dy + dz*dz);
  
  const magnitude = Math.sqrt(dx*dx + dy*dy + dz*dz);
  const unitX = dx / magnitude;
  const unitY = dy / magnitude;
  const unitZ = dz / magnitude;
  
  const newPosition = {
    x: center.x + unitX * currentDistance,
    y: center.y + unitY * currentDistance,
    z: center.z + unitZ * currentDistance
  };
  
  graph.cameraPosition(
    newPosition,        
    center,               
    1000             
  );
});

document.getElementById("fitGraph").addEventListener("click", () => {
  if (isOrbiting) return;
  
  graph.zoomToFit(1000, 50);
});

let isOrbiting = false;
let orbitInterval = null;
let distance = 300;

document.getElementById("toggleOrbit").addEventListener("click", () => {
  if (currentControlType !== 'orbit' && !isOrbiting) {
    const graphData = graph.graphData();
    const currentPosition = graph.cameraPosition();
    
    currentControlType = 'orbit';
    initializeGraph('orbit');
    
    graph.graphData(graphData);
    
    if (currentPosition) {
      graph.cameraPosition(
        currentPosition,
        currentPosition.lookAt || { x: 0, y: 0, z: 0 },
        0
      );
    }
    
    document.getElementById("orbitControls").classList.add("bg-blue-800");
    document.getElementById("flyControls").classList.remove("bg-blue-800");
  }
  
  if (isOrbiting) {
    clearInterval(orbitInterval);
    
    graph.enableNavigationControls(true);
    graph.enableNodeDrag(true);
    
    isOrbiting = false;
    document.getElementById("toggleOrbit").textContent = "Start Orbit";
    
    graph.zoomToFit(1000, 50);
  } else {
    const graphData = graph.graphData();
    
    if (graphData.nodes.length === 0) {
      return;
    }
    
    const center = {x: 0, y: 0, z: 0};
    graphData.nodes.forEach(node => {
      center.x += node.x || 0;
      center.y += node.y || 0;
      center.z += node.z || 0;
    });
    
    center.x /= graphData.nodes.length;
    center.y /= graphData.nodes.length;
    center.z /= graphData.nodes.length;
    
    let maxDist = 0;
    graphData.nodes.forEach(node => {
      const dx = (node.x || 0) - center.x;
      const dy = (node.y || 0) - center.y;
      const dz = (node.z || 0) - center.z;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      maxDist = Math.max(maxDist, dist);
    });
    
    distance = Math.max(maxDist * 1, 300);
    
    graph.enableNavigationControls(false);
    graph.enableNodeDrag(false);
    
    let angle = 0;
    graph.cameraPosition(
      { 
        x: center.x + distance * Math.sin(angle),
        y: center.y,
        z: center.z + distance * Math.cos(angle)
      },
      center, 
      1000   
    );
    
    setTimeout(() => {
      if (!isOrbiting) return;
      
      orbitInterval = setInterval(() => {
        angle += Math.PI / 2000;
        graph.cameraPosition({
          x: center.x + distance * Math.sin(angle),
          y: center.y,
          z: center.z + distance * Math.cos(angle)
        });
      }, 10);
      
      document.getElementById("toggleOrbit").textContent = "Stop Orbit";
    }, 1100);
    
    isOrbiting = true;
    document.getElementById("toggleOrbit").textContent = "Starting...";
  }
});

document.getElementById("orbitControls").addEventListener("click", () => {
  if (currentControlType !== 'orbit') {
    const graphData = graph.graphData();
    const currentPosition = graph.cameraPosition();
    
    currentControlType = 'orbit';
    initializeGraph('orbit');
    
    graph.graphData(graphData);
    
    if (currentPosition) {
      graph.cameraPosition(
        currentPosition,
        currentPosition.lookAt || { x: 0, y: 0, z: 0 },
        0
      );
    }
    
    document.getElementById("orbitControls").classList.add("bg-blue-800");
    document.getElementById("flyControls").classList.remove("bg-blue-800");
  }
});

document.getElementById("flyControls").addEventListener("click", () => {
  if (currentControlType !== 'fly') {
    if (isOrbiting) {
      clearInterval(orbitInterval);
      isOrbiting = false;
      document.getElementById("toggleOrbit").textContent = "Start Orbit";
    }
    
    const graphData = graph.graphData();
    const currentPosition = graph.cameraPosition();
    
    currentControlType = 'fly';
    initializeGraph('fly');
    
    graph.graphData(graphData);
    
    if (currentPosition) {
      graph.cameraPosition(
        currentPosition,
        currentPosition.lookAt || { x: 0, y: 0, z: 0 },
        0
      );
    }
    
    document.getElementById("flyControls").classList.add("bg-blue-800");
    document.getElementById("orbitControls").classList.remove("bg-blue-800");
  }
});

graph = initializeGraph('orbit');
document.getElementById("orbitControls").classList.add("bg-blue-800");

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

// Add event listener for link width slider
document.getElementById("linkWidth").addEventListener("input", function() {
  const value = parseFloat(this.value);
  document.getElementById("linkWidthValue").textContent = value.toFixed(1);
  
  if (graph) {
    graph.linkWidth(value);
  }
});