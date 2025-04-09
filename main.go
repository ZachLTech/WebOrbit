package main

import (
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/PuerkitoBio/goquery"
)

type Node struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	URL   string `json:"url"`
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
	URL          string `json:"url"`
	MaxDepth     int    `json:"maxDepth"`
	MaxPages     int    `json:"maxPages"`
	SameHostOnly bool   `json:"sameHostOnly"`
}

var results = make(map[string]*SitemapResult)
var resultsMutex sync.RWMutex

func main() {
	// Configure CORS
	http.HandleFunc("/crawl", handleCrawl)
	http.HandleFunc("/results/", handleGetResults)
	http.Handle("/", http.FileServer(http.Dir("./static")))

	log.Println("Server started on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
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
	}{
		{baseURL, 0},
	}

	baseHost := baseURL.Host

	addNode(id, baseURL.String(), baseURL.Path)

	for len(queue) > 0 && len(visited) < req.MaxPages {
		current := queue[0]
		queue = queue[1:]

		currentURL := current.url.String()
		if visited[currentURL] {
			continue
		}

		visited[currentURL] = true

		if current.depth >= req.MaxDepth {
			continue
		}

		resp, err := http.Get(currentURL)
		if err != nil {
			log.Printf("Error fetching %s: %v", currentURL, err)
			continue
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			log.Printf("Received status %d for %s", resp.StatusCode, currentURL)
			continue
		}

		doc, err := goquery.NewDocumentFromReader(resp.Body)
		if err != nil {
			log.Printf("Error parsing %s: %v", currentURL, err)
			continue
		}

		doc.Find("a[href]").Each(func(i int, s *goquery.Selection) {
			href, exists := s.Attr("href")
			if !exists || href == "" || href == "#" || href == "/" {
				return
			}

			linkURL, err := url.Parse(href)
			if err != nil {
				return
			}

			if !linkURL.IsAbs() {
				linkURL = current.url.ResolveReference(linkURL)
			}

			if req.SameHostOnly && linkURL.Host != baseHost {
				return
			}

			linkURLStr := linkURL.String()

			if !visited[linkURLStr] {
				addNode(id, linkURLStr, linkURL.Path)
				addLink(id, currentURL, linkURLStr)

				queue = append(queue, struct {
					url   *url.URL
					depth int
				}{linkURL, current.depth + 1})
			} else {
				addLink(id, currentURL, linkURLStr)
			}
		})
	}
}

func addNode(id string, url string, label string) {
	if label == "" {
		label = "/"
	}

	resultsMutex.Lock()
	defer resultsMutex.Unlock()

	results[id].Nodes = append(results[id].Nodes, Node{
		ID:    url,
		Label: label,
		URL:   url,
	})
}

func addLink(id string, source string, target string) {
	resultsMutex.Lock()
	defer resultsMutex.Unlock()

	results[id].Links = append(results[id].Links, Link{
		Source: source,
		Target: target,
	})
}
