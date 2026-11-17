// node-url.js: stands in for node:url. The copy that runs without a server has no files to point at.
export const fileURLToPath = (url) => String(url);
export const pathToFileURL = (path) => new URL(String(path), 'file:///');
