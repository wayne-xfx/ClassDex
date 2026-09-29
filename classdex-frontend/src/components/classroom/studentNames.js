export function formatStudentName(name = "") {
  const parts = nameParts(name);
  if (!parts.surname) return name;
  return `${parts.surname}, ${[...parts.givenNames, parts.suffix].filter(Boolean).join(" ")}`;
}

export function compareStudentsByLastName(left, right) {
  const leftParts = nameParts(left.name || "");
  const rightParts = nameParts(right.name || "");
  return leftParts.surname.localeCompare(rightParts.surname, undefined, { sensitivity: "base" })
    || leftParts.givenNames.join(" ").localeCompare(rightParts.givenNames.join(" "), undefined, { sensitivity: "base" })
    || String(left.studentId || "").localeCompare(String(right.studentId || ""));
}

function nameParts(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { givenNames: [], surname: parts[0] || "", suffix: "" };

  const suffixes = new Set(["jr.", "jr", "sr.", "sr", "ii", "iii", "iv"]);
  const suffix = suffixes.has(parts.at(-1).toLocaleLowerCase()) ? parts.pop() : "";
  const surnameParticles = new Set(["da", "de", "del", "della", "dela", "di", "la", "le", "san", "santa", "van", "von"]);
  let surnameStart = parts.length - 1;
  while (surnameStart > 0 && surnameParticles.has(parts[surnameStart - 1].toLocaleLowerCase())) surnameStart -= 1;
  return {
    givenNames: parts.slice(0, surnameStart),
    surname: parts.slice(surnameStart).join(" "),
    suffix,
  };
}
