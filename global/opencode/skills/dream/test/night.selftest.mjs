// test/night.selftest.mjs — one session writes the whole night (USER, 2026-11-22).
//
// What is pinned:
//   1. `fill` puts EVERY group in the prompt, numbered, and leaves no marker behind;
//   2. `parseUnions` reads one union per group out of a single answer;
//   3. a missing block stays `null` — the group is ignored, never guessed;
//   4. the markers `## 1`, `### 1` and `**1**` are all accepted.

const { fill, parseUnions } = await import("../scripts/dream-synthesize.mts");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const group = (ns, ...texts) => ({
  ns,
  cosine: 0.96,
  members: texts.map((text, index) => ({ id: `id-${ns}-${index}`, text, score: 10 })),
});

// --- 1: every group enters the prompt -------------------------------------------------------
const prompt = fill("{{count}} groups\n{{groups}}\nEND", [group("a", "one", "two"), group("b", "three", "four")]);
check("the group count is the real one", prompt.startsWith("2 groups"), prompt.split("\n")[0]);
check("both groups appear, numbered", prompt.includes("GROUP 1") && prompt.includes("GROUP 2"), prompt.slice(0, 80));
check("every memory goes in", ["one", "two", "three", "four"].every((text) => prompt.includes(text)), prompt);
check("no marker is left unfilled", !prompt.includes("{{"), prompt);

// --- 2 + 3: one answer, one union per group -------------------------------------------------
const answer = `## 1
First union.

## 2
Second union.`;
const two = parseUnions(answer, 2);
check("two unions read", two[0] === "First union." && two[1] === "Second union.", JSON.stringify(two));

const missing = parseUnions("## 1\nonly the first.", 3);
check("a group without a block stays null", missing[0] === "only the first." && missing[1] === null && missing[2] === null, JSON.stringify(missing));

// --- 4: the marker shapes the model actually writes -----------------------------------------
const shapes = parseUnions("### 1\nalfa\n\n**2**\nbeta", 2);
check("accepts ### and **n**", shapes[0] === "alfa" && shapes[1] === "beta", JSON.stringify(shapes));

const extra = parseUnions("## 1\nalpha\n\n## 7\nout of range", 1);
check("a block out of range does not spoil the rest", extra[0] === "alpha" && extra[1] === undefined, JSON.stringify(extra));

console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
