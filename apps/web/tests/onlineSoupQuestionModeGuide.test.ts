import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const roomPageSource = readFileSync(
  new URL("../src/pages/OnlineSoupRoomPage.tsx", import.meta.url),
  "utf8"
);

test("question mode guide stays above chat messages and composer overlays", () => {
  assert.match(
    roomPageSource,
    /canDiscuss && <div className="relative z-\[60\] shrink-0 border-t/
  );
  assert.match(
    roomPageSource,
    /question-mode-guide absolute bottom-\[calc\(100%\+14px\)\] left-0 z-\[70\]/
  );
  assert.match(
    roomPageSource,
    /mentionCandidates\.length > 0 && <div className="absolute inset-x-0 bottom-full z-\[65\]/
  );
});

test("question mode guide close control has a mobile-safe hit area and consumes the pointer event", () => {
  assert.match(
    roomPageSource,
    /className="pointer-events-auto absolute right-0 top-1\/2 z-10 grid h-11 w-11/
  );
  assert.match(
    roomPageSource,
    /onPointerDown=\{\(event\) => \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*setShowQuestionModeGuide\(false\);/
  );
  assert.match(
    roomPageSource,
    /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*setShowQuestionModeGuide\(false\);/
  );
  assert.match(roomPageSource, /aria-label="关闭提问指引"/);
});
