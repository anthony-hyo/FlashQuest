# SWF Renderer - Flash Player for Modern Browsers

A complete SWF (Flash) renderer built with TypeScript, WebGL, and Bun that can play Flash animations in modern browsers without plugins.

## Features

✅ **WebGL Rendering** - Hardware-accelerated vector graphics  
✅ **Shape Triangulation** - Ear-clipping algorithm for complex polygons  
✅ **Animation Support** - Full timeline playback with controls  
✅ **Compression Support** - Handles both CWS (compressed) and FWS (uncompressed) SWF files  
✅ **Modern JavaScript** - Built with TypeScript and modern web APIs  
✅ **Drag & Drop Interface** - Easy file loading  
✅ **Responsive Design** - Works on desktop and mobile  

## Quick Start with Bun

### Prerequisites
- [Bun](https://bun.sh/) (latest version)
- Modern browser with WebGL support

### Installation

```bash
# Clone or download the project
cd FlashQuest

# Install dependencies using Bun
bun install

# Add compression library
bun add pako
bun add -d @types/pako
```

### Development

```bash
# Start development server
bun run dev

# Or use the start command
bun start
```

The development server will start at `http://localhost:3000`

### Production Build

```bash
# Create optimized production build
bun run build

# Clean dist folder before building
bun run clean && bun run build
```

## Usage

1. **Open the application** in your browser at `localhost:3000`
2. **Drag and drop** an SWF file onto the upload area, or click to browse
3. **Control playback** using the play/pause/stop buttons
4. **Navigate frames** using the slider control

## Supported SWF Features

### ✅ Currently Supported
- DefineShape (1-4) - Vector shape definitions
- PlaceObject (1-3) - Object placement and transformations
- RemoveObject (1-2) - Object removal
- SetBackgroundColor - Background color setting
- ShowFrame - Frame display
- Basic timeline animation

### 🚧 Planned Features
- DefineSprite - Nested animations
- ActionScript support - Basic interactivity
- Sound support - Audio playback
- Bitmap support - Raster graphics
- Text rendering - Static and dynamic text

## Architecture

```
src/
├── index.ts           # Main entry point and browser interface
├── swf-player.ts      # Core SWF playback engine
├── gl/
│   └── renderer.ts    # WebGL rendering system
├── swf/
│   ├── loader.ts      # SWF file loading and decompression
│   ├── parser.ts      # SWF format parsing
│   ├── shapes.ts      # Vector shape processing
│   └── display.ts     # Display list and timeline management
├── tags/
│   └── tags.ts        # SWF tag definitions
└── utils/
    └── bytes.ts       # Binary data utilities
```

## Browser Compatibility

- **Chrome/Edge** 80+ (Full support including native decompression)
- **Firefox** 75+ (Full support)
- **Safari** 14+ (Full support)
- **Mobile browsers** - iOS Safari 14+, Chrome Mobile 80+

## Performance

- **WebGL acceleration** for smooth rendering
- **Efficient triangulation** using ear-clipping algorithm
- **Optimized memory usage** with proper buffer management
- **Frame-rate adaptive** playback

## Development Commands

```bash
# Install all dependencies
bun install

# Start development with hot reload
bun run dev

# Build for production
bun run build

# Build for development (with source maps)
bun run build:dev

# Clean build directory
bun run clean
```

## API Usage

You can also use the SWF renderer programmatically:

```javascript
import SWFRenderer from './dist/bundle.js';

const canvas = document.getElementById('myCanvas');
const renderer = new SWFRenderer(canvas);

// Load SWF from file
await renderer.loadSWF(file);

// Control playback
renderer.play();
renderer.pause();
renderer.stop();
renderer.gotoFrame(10);
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make changes and test with `bun run dev`
4. Build production version: `bun run build`
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Technical Notes

### Compression Support
The renderer supports multiple decompression methods in order of preference:
1. **Native DecompressionStream API** (Chrome 80+, Firefox 65+)
2. **Pako.js library** (fallback for older browsers)
3. **Simple zlib header detection** (basic cases only)

### WebGL Rendering Pipeline
1. Parse SWF shape records into vector paths
2. Convert curves to line segments (tessellation)
3. Triangulate polygons using ear-clipping algorithm
4. Upload triangles to WebGL buffers
5. Render with vertex/fragment shaders

### Memory Management
- Automatic buffer cleanup on object destruction
- Efficient shape caching and reuse
- Frame-based garbage collection for animations

## Troubleshooting

**SWF file won't load:**
- Ensure file is valid SWF format (FWS/CWS signature)
- Check browser console for detailed error messages
- Try with uncompressed SWF first to isolate compression issues

**Poor rendering performance:**
- Verify WebGL is enabled in browser settings
- Check that hardware acceleration is available
- Monitor browser DevTools Performance tab

**Animations not playing:**
- Verify SWF contains ShowFrame tags
- Check that frame rate is reasonable (1-60 fps)
- Ensure timeline has multiple frames
