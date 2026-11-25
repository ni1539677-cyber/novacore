const test = require("node:test");
const assert = require("node:assert/strict");
const { containsBlockedTerm } = require("./content-filter");

test("blocks common adult and explicit search terms", () => {
  for (const query of [
    "18+ videos",
    "adult content",
    "best porn sites",
    "hentai",
    "nude photos",
    "explicit images",
    "p.o.r.n",
    "সেক্স",
  ]) {
    assert.equal(containsBlockedTerm(query), true, query);
  }
});

test("allows ordinary non-explicit searches", () => {
  for (const query of [
    "astronomy for beginners",
    "classic literature",
    "weather in Dhaka",
    "healthy recipes",
  ]) {
    assert.equal(containsBlockedTerm(query), false, query);
  }
});
