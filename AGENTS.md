## Cursor Cloud specific instructions

### Overview

This is a minimal personal scripts repository containing a single Node.js CLI tool (`generate-image.js`) that generates images via the Google Gemini API.

### Running the script

```
node generate-image.js "<prompt>" [output-path]
```

- Requires the `GEMINI_IMAGE_API_KEY` environment variable (Gemini API key).
- If no output path is specified, the image is saved to the system temp directory.
- The script uses ES module `import` syntax and works with Node.js 22+ auto-detection (no `package.json` or `"type": "module"` needed).

### Key notes

- There is no `package.json`, no npm dependencies, no build step, no test suite, and no linter configured. The script depends only on Node.js built-in modules (`https`, `fs`, `path`, `os`).
- The generated file is always JPEG data regardless of the output file extension.
- Internet access is required for the Gemini API call.
