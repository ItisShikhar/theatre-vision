const assert = require("node:assert/strict");
const test = require("node:test");

require("../domain-utils.js");

const { isEnabled, matchesDomain, normalizeDomain } = globalThis.TheatreVisionSiteRules;

test("normalizeDomain accepts URLs and domain names", () => {
  assert.equal(normalizeDomain(" HTTPS://WWW.YouTube.com/watch?v=1 "), "www.youtube.com");
  assert.equal(normalizeDomain("video.example.com/path"), "video.example.com");
  assert.equal(normalizeDomain(""), null);
  assert.equal(normalizeDomain("ftp://example.com"), null);
  assert.equal(normalizeDomain("*.example.com"), null);
  assert.equal(normalizeDomain("-example.com"), null);
});

test("matchesDomain accepts exact domains and subdomains only", () => {
  assert.equal(matchesDomain("www.example.com", "example.com"), true);
  assert.equal(matchesDomain("example.com", "example.com"), true);
  assert.equal(matchesDomain("notexample.com", "example.com"), false);
});

test("the most specific site rule takes precedence", () => {
  assert.equal(isEnabled("video.example.com", ["example.com"], ["video.example.com"]), true);
  assert.equal(isEnabled("video.example.com", [], ["example.com", "video.example.com"]), true);
  assert.equal(isEnabled("video.example.com", ["video.example.com"], ["example.com"]), false);
  assert.equal(isEnabled("video.example.com", ["example.com"], []), false);
  assert.equal(isEnabled("example.com", ["example.com"], ["example.com"]), false);
});

test("invalid hosts default to enabled", () => {
  assert.equal(isEnabled("", ["example.com"], []), true);
});
