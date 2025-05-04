# WebOrbit: 3D Website Sitemap Visualizer

## 🚀 [Live Demo](https://byeurl.cyou/WebOrbit)

WebOrbit is an interactive 3D website sitemap visualization tool that helps developers and site owners understand their website structure through an immersive, explorable graph.

## 🏆 OwlHacks 2025 Submission

This project is a submission for [OwlHacks 2025](https://devpost.com/software/weborbit). 

## ✨ Features

- Interactive 3D visualization of website structure
- Multiple control options (Orbit and Fly modes)
- Depth and page limit controls
- Filtering by content type
- URL search functionality
- Responsive design
- Special highlighting for root URL
- Expandable/collapsible UI panels
- Link width adjustment
- JavaScript URL extraction

## 🛠️ Technology Stack

- Backend: Go
- Frontend: JavaScript, Three.js, D3.js, 3D-Force-Graph
- Styling: TailwindCSS

## 📋 How It Works

WebOrbit crawls a website starting from your specified URL, mapping out the site's structure including pages, assets, and links between them. The data is then rendered as an interactive 3D visualization where:

- Nodes represent pages or assets
- Links represent connections between pages
- Colors indicate content types (HTML, CSS, JavaScript, etc.)
- Node sizes reflect connection counts

## 🔮 Coming Soon

- Export functionality (PNG, JSON)
- Custom node themes
- More detailed page analysis
- Scheduled crawls and change detection
- Screenshot previews
- Authentication
- Saved visualizations

## 🧠 Development

To run WebOrbit locally:

1. Ensure Go is installed on your system
2. Clone the repository
3. Run `go mod tidy` to install dependencies
4. Run `go run main.go` to start the server
5. Access the application at `http://localhost:8080`

## 📝 License

I don't have one yet...
