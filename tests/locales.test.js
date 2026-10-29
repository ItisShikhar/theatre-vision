const assert = require("node:assert/strict");
const { readdirSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const LOCALE_ROOT = path.join(ROOT, "_locales");
const EXPECTED_LOCALES = [
  "ar",
  "bn",
  "de",
  "en",
  "es",
  "fr",
  "hi",
  "ja",
  "ko",
  "ml",
  "pt",
  "ru",
  "zh_CN",
];
const EXPECTED_MESSAGES = ["enterTheatreMode", "exitTheatreMode"];

test("each supported locale has both theatre mode labels", () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const localeDirectories = readdirSync(LOCALE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.equal(manifest.default_locale, "en");
  assert.deepEqual(localeDirectories, EXPECTED_LOCALES);

  for (const locale of localeDirectories) {
    const messages = JSON.parse(
      readFileSync(path.join(LOCALE_ROOT, locale, "messages.json"), "utf8"),
    );

    assert.deepEqual(Object.keys(messages).sort(), EXPECTED_MESSAGES);
    assert.ok(messages.enterTheatreMode.message);
    assert.ok(messages.exitTheatreMode.message);
  }

  const englishMessages = JSON.parse(
    readFileSync(path.join(LOCALE_ROOT, "en", "messages.json"), "utf8"),
  );
  assert.equal(englishMessages.enterTheatreMode.message, "Enter Theatre Mode");
  assert.equal(englishMessages.exitTheatreMode.message, "Exit Theatre Mode");
});
