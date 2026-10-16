# Page Doodler

Draw, annotate, and mark up any webpage — right in your browser.

Page Doodler adds a floating canvas overlay to any page so you can sketch ideas, highlight content, leave notes, and share annotated screenshots. Your doodles are saved per URL and reload automatically when you return.

![Screenshot](screenshot-1.png)

## Features

**Drawing Tools**
- Pen with smooth, pressure-friendly strokes
- Eraser to clean up mistakes
- Text tool — click anywhere to type annotations
- 6 shapes: rectangle, rounded rectangle, circle, triangle, diamond, star
- 5 line styles: solid, dashed, dotted, arrow, double arrow
- Full color picker and adjustable brush size (1–100)

**Workflow**
- Undo / Redo / Clear with keyboard shortcuts (Ctrl+Z, Ctrl+Y)
- Save doodles per page — they reload when you come back
- Export your doodle as a transparent PNG
- Screenshot the page with your doodles composited on top
- Region select tool for cropping screenshots to a specific area
- Scroll the page underneath while doodling

## Installation

### From Chrome Web Store
*(Coming soon)*

### Manual / Developer Install
1. Clone this repository or download it as a ZIP
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the project folder
5. Click the palette icon or use the popup to start doodling

## How It Works

Page Doodler injects a transparent canvas overlay on top of any webpage. When you activate doodle mode, the canvas captures your pointer input while letting you scroll the page underneath. All strokes, shapes, text, and lines are stored locally per URL using Chrome's storage API.

## Privacy

All data (doodle strokes and tool preferences) is stored locally on your device using Chrome's storage API. No data is collected, transmitted, or shared with any server or third party. The extension works entirely offline after installation.

## License

MIT
