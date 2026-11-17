// node-path.js: the few path helpers the team's server code calls, for a browser.
const join = (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');
const dirname = (path) => path.replace(/\/[^/]*$/, '') || '/';
const extname = (path) => (path.match(/\.[^./]*$/) || [''])[0];
const resolve = (...parts) => join(...parts);
export { join, dirname, extname, resolve };
export default { join, dirname, extname, resolve };
