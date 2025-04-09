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

const getNodeColorByPath = (url) => {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    const depth = pathParts.length;

    const colorScale = d3.scaleSequential(d3.interpolateRainbow);
    return colorScale(depth / 8);
  } catch (e) {
    return "#4285f4";
  }
};

const nodeSizeScale = d3
  .scaleLinear()
  .domain([1, 10])
  .range([1, 3])
  .clamp(true);
let nodeConnections = {};

const getLinkColor = (link) => {
  const sourceColor = getNodeColorByPath(link.source);
  const targetColor = getNodeColorByPath(link.target);

  return sourceColor;
};

const graph = Graph(document.getElementById("graphContainer"))
  .backgroundColor("#121212")
  .nodeColor((node) => getNodeColorByPath(node.url))
  .nodeLabel((node) => {
    const count = nodeConnections[node.id] || 0;
    return `${node.label} (${count} connections)`;
  })
  .nodeVal((node) => {
    const count = nodeConnections[node.id] || 1;
    return nodeSizeScale(count);
  })
  .linkWidth(1.5)
  .linkColor((link) => getLinkColor(link))
  .linkOpacity(0.8)
  .linkDirectionalParticles(2)
  .linkDirectionalParticleSpeed((d) => d.value * 0.001)
  .linkDirectionalParticleWidth(2)
  .onNodeClick((node) => window.open(node.url, "_blank"))
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
    }
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

    nodeConnections = {};
    data.links.forEach((link) => {
      nodeConnections[link.source] = (nodeConnections[link.source] || 0) + 1;
      nodeConnections[link.target] = (nodeConnections[link.target] || 0) + 1;
    });

    const processedData = {
      nodes: data.nodes,
      links: data.links.map((link) => ({
        ...link,
        value: (nodeConnections[link.target] || 1) / 2,
      })),
    };

    graph.graphData(processedData);

    if (data.nodes.length > 0) {
      setStatus(
        `Loaded ${data.nodes.length} pages and ${data.links.length} links`,
        "success"
      );

      if (data.nodes.length >= 10) {
        clearInterval(checkInterval);
      }
    }
  } catch (error) {
    setStatus("Error checking status: " + error.message, "error");
    clearInterval(checkInterval);
  }
}

function setStatus(message, type) {
  const statusEl = document.getElementById("status");
  statusEl.textContent = message;
  statusEl.className = type;
}

function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}
