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
const prompt = fill("{{count}} grupos\n{{groups}}\nFIM", [group("a", "um", "dois"), group("b", "três", "quatro")]);
check("o número de grupos é o real", prompt.startsWith("2 grupos"), prompt.split("\n")[0]);
check("os dois grupos aparecem, numerados", prompt.includes("UNIÃO 1") && prompt.includes("UNIÃO 2"), prompt.slice(0, 80));
check("todas as memórias entram", ["um", "dois", "três", "quatro"].every((text) => prompt.includes(text)), prompt);
check("nenhum marcador ficou por preencher", !prompt.includes("{{"), prompt);

// --- 2 + 3: one answer, one union per group -------------------------------------------------
const answer = `## 1
Primeira união.

## 2
Segunda união.`;
const two = parseUnions(answer, 2);
check("duas uniões lidas", two[0] === "Primeira união." && two[1] === "Segunda união.", JSON.stringify(two));

const missing = parseUnions("## 1\nSó a primeira.", 3);
check("o grupo sem bloco fica nulo", missing[0] === "Só a primeira." && missing[1] === null && missing[2] === null, JSON.stringify(missing));

// --- 4: the marker shapes the model actually writes -----------------------------------------
const shapes = parseUnions("### 1\nalfa\n\n**2**\nbeta", 2);
check("aceita ### e **n**", shapes[0] === "alfa" && shapes[1] === "beta", JSON.stringify(shapes));

const extra = parseUnions("## 1\num\n\n## 7\nfora do intervalo", 1);
check("um bloco fora do intervalo não estraga o resto", extra[0] === "um" && extra[1] === undefined, JSON.stringify(extra));

console.log(failures === 0 ? "TODOS OS CHECKS PASSARAM" : `${failures} CHECK(S) FALHARAM`);
process.exit(failures === 0 ? 0 : 1);
