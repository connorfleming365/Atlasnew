/* Shared setup for the browser suites.
   Playwright comes from node_modules (CI installs it) unless PLAYWRIGHT_MODULE
   points somewhere else — e.g. a globally installed copy on a dev machine:
     PLAYWRIGHT_MODULE=/path/to/node_modules/playwright npm test
   The suites open index.html straight from disk: no server, no connectors,
   with sample data injected into the page. */
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

module.exports = {
  chromium,
  PAGE: pathToFileURL(path.resolve(__dirname, "..", "..", "index.html")).href,
};
