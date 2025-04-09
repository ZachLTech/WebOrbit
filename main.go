package main

import (
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/PuerkitoBio/goquery"
)

// Add to Node struct
type Node struct {
	ID           string `json:"id"`
	Label        string `json:"label"`
	URL          string `json:"url"`
	ContentType  string `json:"contentType"`
	LinksCount   int    `json:"linksCount"`
	ImageCount   int    `json:"imageCount"`
	WordCount    int    `json:"wordCount"`
	ResponseTime int64  `json:"responseTime"`
}

type Link struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

type SitemapResult struct {
	Nodes []Node `json:"nodes"`
	Links []Link `json:"links"`
}

type CrawlRequest struct {
	URL           string `json:"url"`
	MaxDepth      int    `json:"maxDepth"`
	MaxPages      int    `json:"maxPages"`
	SameHostOnly  bool   `json:"sameHostOnly"`
	IncludeAssets bool   `json:"includeAssets"`
}

var results = make(map[string]*SitemapResult)
var resultsMutex sync.RWMutex

func main() {
	// Configure CORS
	http.HandleFunc("/crawl", cors(handleCrawl))
	http.HandleFunc("/results/", cors(handleGetResults))
	http.Handle("/", http.FileServer(http.Dir("./static")))

	log.Println("Server started on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

// CORS middleware
func cors(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next(w, r)
	}
}

func handleCrawl(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req CrawlRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	baseURL, err := url.Parse(req.URL)
	if err != nil {
		http.Error(w, "Invalid URL", http.StatusBadRequest)
		return
	}

	crawlID := time.Now().Format("20060102-150405")

	resultsMutex.Lock()
	results[crawlID] = &SitemapResult{
		Nodes: []Node{},
		Links: []Link{},
	}
	resultsMutex.Unlock()

	go crawlWebsite(crawlID, baseURL, req)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"id": crawlID})
}

func handleGetResults(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Path[len("/results/"):]

	resultsMutex.RLock()
	result, exists := results[id]
	resultsMutex.RUnlock()

	if !exists {
		http.Error(w, "Result not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func crawlWebsite(id string, baseURL *url.URL, req CrawlRequest) {
	if req.MaxDepth <= 0 {
		req.MaxDepth = 3
	}
	if req.MaxPages <= 0 {
		req.MaxPages = 100
	}

	visited := make(map[string]bool)
	queue := []struct {
		url   *url.URL
		depth int
		from  string
	}{
		{baseURL, 0, ""},
	}

	baseHost := baseURL.Host

	// Add the root node
	startTime := time.Now()
	resp, err := http.Get(baseURL.String())
	var contentType string
	if err == nil {
		defer resp.Body.Close()
		contentType = resp.Header.Get("Content-Type")
	}
	responseTime := time.Since(startTime).Milliseconds()

	addNode(id, baseURL.String(), baseURL.Path, contentType, 0, 0, responseTime)

	for len(queue) > 0 && countNodes(id) < req.MaxPages {
		current := queue[0]
		queue = queue[1:]

		currentURL := current.url.String()
		if visited[currentURL] {
			if current.from != "" {
				addLink(id, current.from, currentURL)
			}
			continue
		}

		visited[currentURL] = true

		if current.depth >= req.MaxDepth {
			continue
		}

		if current.from != "" {
			addLink(id, current.from, currentURL)
		}

		startTime := time.Now()
		resp, err := http.Get(currentURL)
		if err != nil {
			log.Printf("Error fetching %s: %v", currentURL, err)
			continue
		}

		contentType := resp.Header.Get("Content-Type")
		responseTime := time.Since(startTime).Milliseconds()

		// If it's not HTML, just add it as a node but don't crawl it
		if !strings.Contains(contentType, "text/html") {
			// Add as a node
			addNode(id, currentURL, getPathFromURL(current.url), contentType, 0, 0, responseTime)
			resp.Body.Close()
			continue
		}

		// Process HTML page
		if resp.StatusCode != 200 {
			log.Printf("Received status %d for %s", resp.StatusCode, currentURL)
			resp.Body.Close()
			continue
		}

		doc, err := goquery.NewDocumentFromReader(resp.Body)
		resp.Body.Close()

		if err != nil {
			log.Printf("Error parsing %s: %v", currentURL, err)
			continue
		}

		// Count various elements
		linksCount := doc.Find("a").Length()
		imageCount := doc.Find("img").Length()

		// Estimate word count from text content
		//text := doc.Find("body").Text()
		//words := strings.Fields(text)
		//wordCount := len(words)

		// Add node with enhanced information
		addNode(id, currentURL, getPathFromURL(current.url), contentType, linksCount, imageCount, responseTime)

		// Process <a> links
		doc.Find("a[href]").Each(func(i int, s *goquery.Selection) {
			href, exists := s.Attr("href")
			if !exists || href == "" || href == "#" || href == "/" {
				return
			}

			queue = processLink(href, current.url, current.depth, currentURL, baseHost, id, req, queue, visited)
		})

		// If includeAssets is true, also process various asset types
		if req.IncludeAssets {
			// Process images
			doc.Find("img[src]").Each(func(i int, s *goquery.Selection) {
				src, exists := s.Attr("src")
				if !exists || src == "" {
					return
				}

				processAsset(src, "image", current.url, currentURL, baseHost, id, req)
			})

			// Process scripts
			doc.Find("script[src]").Each(func(i int, s *goquery.Selection) {
				src, exists := s.Attr("src")
				if !exists || src == "" {
					return
				}

				processAsset(src, "application/javascript", current.url, currentURL, baseHost, id, req)
			})

			// Process stylesheets
			doc.Find("link[rel=stylesheet][href]").Each(func(i int, s *goquery.Selection) {
				href, exists := s.Attr("href")
				if !exists || href == "" {
					return
				}

				processAsset(href, "text/css", current.url, currentURL, baseHost, id, req)
			})

			// Process other linked resources
			doc.Find("link[href]").Each(func(i int, s *goquery.Selection) {
				href, exists := s.Attr("href")
				rel, hasRel := s.Attr("rel")
				if !exists || href == "" || (hasRel && rel == "stylesheet") {
					return // Skip stylesheets as they're handled above
				}

				processAsset(href, "application/resource", current.url, currentURL, baseHost, id, req)
			})
		}
	}
}

// Helper to process a link and potentially add it to the queue
func processLink(href string, currentURL *url.URL, depth int, sourceURL string, baseHost string, id string, req CrawlRequest, queue []struct {
	url   *url.URL
	depth int
	from  string
}, visited map[string]bool) []struct {
	url   *url.URL
	depth int
	from  string
} {
	linkURL, err := url.Parse(href)
	if err != nil {
		return queue
	}

	if !linkURL.IsAbs() {
		linkURL = currentURL.ResolveReference(linkURL)
	}

	if req.SameHostOnly && linkURL.Host != baseHost {
		return queue
	}

	linkURLStr := linkURL.String()

	// If we haven't visited this URL, add it to the queue
	if !visited[linkURLStr] {
		return append(queue, struct {
			url   *url.URL
			depth int
			from  string
		}{linkURL, depth + 1, sourceURL})
	}

	// If already visited, just add the link
	addLink(id, sourceURL, linkURLStr)
	return queue
}

// Helper for processing assets (images, JS, CSS, etc.)
func processAsset(src string, assetType string, currentURL *url.URL, sourceURL string, baseHost string, id string, req CrawlRequest) {
	assetURL, err := url.Parse(src)
	if err != nil {
		return
	}

	if !assetURL.IsAbs() {
		assetURL = currentURL.ResolveReference(assetURL)
	}

	if req.SameHostOnly && assetURL.Host != baseHost {
		return
	}

	assetURLStr := assetURL.String()

	// Add the asset as a node
	addNode(id, assetURLStr, getPathFromURL(assetURL), assetType, 0, 0, 0)

	// Add a link from the source page to this asset
	addLink(id, sourceURL, assetURLStr)
}

func getPathFromURL(u *url.URL) string {
	path := u.Path
	if path == "" {
		return "/"
	}
	return path
}

func addNode(id string, url string, path string, contentType string, linksCount int, imageCount int, responseTime int64) {
	if path == "" {
		path = "/"
	}

	resultsMutex.Lock()
	defer resultsMutex.Unlock()

	// Check if node already exists to avoid duplicates
	for _, node := range results[id].Nodes {
		if node.ID == url {
			return
		}
	}

	results[id].Nodes = append(results[id].Nodes, Node{
		ID:           url,
		Label:        path,
		URL:          url,
		ContentType:  contentType,
		LinksCount:   linksCount,
		ImageCount:   imageCount,
		WordCount:    0, // Can be populated if needed
		ResponseTime: responseTime,
	})
}

func addLink(id string, source string, target string) {
	resultsMutex.Lock()
	defer resultsMutex.Unlock()

	// Check if link already exists
	for _, link := range results[id].Links {
		if link.Source == source && link.Target == target {
			return
		}
	}

	results[id].Links = append(results[id].Links, Link{
		Source: source,
		Target: target,
	})
}

func countNodes(id string) int {
	resultsMutex.RLock()
	defer resultsMutex.RUnlock()

	if result, exists := results[id]; exists {
		return len(result.Nodes)
	}
	return 0
}
