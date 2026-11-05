export const SORT_IGNORES_PARTICLES = false;

export const SURNAME_PARTICLES = new Set([
  "van", "der", "de", "von", "di", "del", "la", "le", "ter", "ten", "den",
  "da", "della", "dela", "delos", "delas", "los", "las", "san", "santa",
]);

export const SUFFIX_MAP = {
  jr: "Jr.",
  "jr.": "Jr.",
  sr: "Sr.",
  "sr.": "Sr.",
  ii: "II",
  iii: "III",
  iv: "IV",
  v: "V",
};

export function stripDiacritics(str = "") {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isSuffixToken(token = "") {
  const clean = token.toLowerCase().replace(/\.$/, "");
  return Boolean(SUFFIX_MAP[clean] || SUFFIX_MAP[token.toLowerCase()]);
}

function toCanonicalSuffix(token = "") {
  const clean = token.toLowerCase().replace(/\.$/, "");
  return SUFFIX_MAP[clean] || SUFFIX_MAP[token.toLowerCase()] || token;
}

export function parseFullName(fullName, options = {}) {
  if (!fullName || typeof fullName !== "string") {
    return {
      firstName: "",
      middleName: "",
      lastName: "",
      suffix: "",
      sortKey: "",
      givenNames: [],
    };
  }

  let raw = fullName.trim().replace(/\s+/g, " ");
  if (!raw) {
    return {
      firstName: "",
      middleName: "",
      lastName: "",
      suffix: "",
      sortKey: "",
      givenNames: [],
    };
  }

  // Comma handling
  const segments = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 2) {
    if (isSuffixToken(segments[1])) {
      raw = `${segments[0]} ${segments[1]}`;
    } else {
      const seg0Tokens = segments[0].split(" ");
      const seg1Tokens = segments[1].split(" ");
      if (seg0Tokens.length > 1 && isSuffixToken(seg0Tokens[seg0Tokens.length - 1])) {
        const segSuffix = seg0Tokens.pop();
        raw = `${segments[1]} ${seg0Tokens.join(" ")} ${segSuffix}`;
      } else if (seg1Tokens.length > 1 && isSuffixToken(seg1Tokens[seg1Tokens.length - 1])) {
        const segSuffix = seg1Tokens.pop();
        raw = `${seg1Tokens.join(" ")} ${segments[0]} ${segSuffix}`;
      } else {
        raw = `${segments[1]} ${segments[0]}`;
      }
    }
  } else if (segments.length === 3) {
    if (isSuffixToken(segments[2])) {
      raw = `${segments[1]} ${segments[0]} ${segments[2]}`;
    } else {
      raw = segments.join(" ");
    }
  } else if (segments.length > 3) {
    raw = segments.join(" ");
  }

  const tokens = raw.split(" ").filter(Boolean);
  let suffix = "";
  if (tokens.length > 1 && isSuffixToken(tokens[tokens.length - 1])) {
    suffix = toCanonicalSuffix(tokens[tokens.length - 1]);
    tokens.pop();
  }

  if (tokens.length === 1) {
    const lastName = tokens[0];
    const sortKey = stripDiacritics(lastName).toLowerCase();
    return {
      firstName: "",
      middleName: "",
      lastName,
      suffix,
      sortKey,
      givenNames: [],
    };
  }

  // Walk backwards for particles
  let surnameStart = tokens.length - 1;
  while (surnameStart > 0 && SURNAME_PARTICLES.has(tokens[surnameStart - 1].toLowerCase())) {
    surnameStart -= 1;
  }

  const surnameTokens = tokens.slice(surnameStart);
  const lastName = surnameTokens.join(" ");
  const givenTokens = tokens.slice(0, surnameStart);
  const givenNames = [...givenTokens];

  let firstName = "";
  let middleName = "";
  if (givenTokens.length > 0) {
    if (givenTokens.length >= 2 && /^ma\.?$/i.test(givenTokens[0])) {
      firstName = `${givenTokens[0]} ${givenTokens[1]}`;
      middleName = givenTokens.slice(2).join(" ");
    } else {
      firstName = givenTokens[0];
      middleName = givenTokens.slice(1).join(" ");
    }
  }

  const sortIgnores = options.sortIgnoresParticles ?? SORT_IGNORES_PARTICLES;
  let sortKey = "";
  if (sortIgnores) {
    const baseSurname = surnameTokens[surnameTokens.length - 1];
    const particles = surnameTokens.slice(0, -1).join(" ");
    if (particles) {
      sortKey = `${stripDiacritics(baseSurname).toLowerCase()}, ${stripDiacritics(particles).toLowerCase()}`;
    } else {
      sortKey = stripDiacritics(lastName).toLowerCase();
    }
  } else {
    sortKey = stripDiacritics(lastName).toLowerCase();
  }

  return {
    firstName,
    middleName,
    lastName,
    suffix,
    sortKey,
    givenNames,
  };
}

export function formatStudentName(name = "", studentObj = null) {
  if (studentObj && (studentObj.lastName || studentObj.firstName)) {
    const givenStr = [studentObj.firstName, studentObj.middleName].filter(Boolean).join(" ");
    const suffixStr = studentObj.suffix ? ` ${studentObj.suffix}` : "";
    return givenStr ? `${studentObj.lastName}, ${givenStr}${suffixStr}` : (studentObj.lastName || name);
  }
  const parsed = parseFullName(name);
  if (!parsed.lastName) return name;
  const givenStr = (parsed.givenNames && parsed.givenNames.length)
    ? parsed.givenNames.join(" ")
    : [parsed.firstName, parsed.middleName].filter(Boolean).join(" ");
  const suffixStr = parsed.suffix ? ` ${parsed.suffix}` : "";
  return givenStr ? `${parsed.lastName}, ${givenStr}${suffixStr}` : parsed.lastName;
}

export function compareStudents(left, right) {
  const leftSortKey = left.sortKey || (left.name ? parseFullName(left.name).sortKey : "");
  const rightSortKey = right.sortKey || (right.name ? parseFullName(right.name).sortKey : "");
  const cmpSort = leftSortKey.localeCompare(rightSortKey, undefined, { sensitivity: "base" });
  if (cmpSort !== 0) return cmpSort;

  const leftFirst = left.firstName || (left.name ? parseFullName(left.name).firstName : "");
  const rightFirst = right.firstName || (right.name ? parseFullName(right.name).firstName : "");
  const cmpFirst = leftFirst.localeCompare(rightFirst, undefined, { sensitivity: "base" });
  if (cmpFirst !== 0) return cmpFirst;

  const leftMiddle = left.middleName || (left.name ? parseFullName(left.name).middleName : "");
  const rightMiddle = right.middleName || (right.name ? parseFullName(right.name).middleName : "");
  const cmpMiddle = leftMiddle.localeCompare(rightMiddle, undefined, { sensitivity: "base" });
  if (cmpMiddle !== 0) return cmpMiddle;

  return String(left.studentId || "").localeCompare(String(right.studentId || ""));
}

export function compareStudentsByLastName(left, right) {
  return compareStudents(left, right);
}


function toMiddleInitial(middleStr = "") {
  const cleaned = String(middleStr || "").trim().replace(/^\.+/, "");
  const match = /[A-Za-zÀ-ÖØ-öø-ÿ]/.exec(cleaned);
  return match ? `${match[0].toUpperCase()}.` : "";
}

function formatCommaDisplayName(trimmed) {
  const rawSegments = trimmed.split(",").map((segment) => segment.trim()).filter(Boolean);
  if (rawSegments.length === 0) return "";
  if (rawSegments.length === 1) return rawSegments[0];

  let lastPart = rawSegments[0];
  const restSegments = rawSegments.slice(1);
  let suffix = "";

  if (restSegments.length >= 2 && isSuffixToken(restSegments[restSegments.length - 1])) {
    suffix = toCanonicalSuffix(restSegments.pop());
  }

  const lastTokens = lastPart.split(" ").filter(Boolean);
  if (lastTokens.length > 1 && isSuffixToken(lastTokens[lastTokens.length - 1])) {
    suffix = suffix || toCanonicalSuffix(lastTokens.pop());
    lastPart = lastTokens.join(" ");
  }

  const givenTokens = restSegments.join(" ").split(" ").filter(Boolean);
  if (givenTokens.length === 0) {
    return suffix ? `${lastPart} ${suffix}` : lastPart;
  }
  if (givenTokens.length === 1 && isSuffixToken(givenTokens[0]) && !suffix) {
    return `${lastPart}, ${toCanonicalSuffix(givenTokens[0])}`;
  }
  if (givenTokens.length > 1 && isSuffixToken(givenTokens[givenTokens.length - 1])) {
    suffix = suffix || toCanonicalSuffix(givenTokens.pop());
  }

  const minFirst = givenTokens.length >= 2 && /^ma\.?$/i.test(givenTokens[0]) ? 2 : 1;
  let givenFormatted = "";
  if (givenTokens.length <= minFirst) {
    givenFormatted = givenTokens.join(" ");
  } else {
    let midStart = givenTokens.length - 1;
    while (midStart > minFirst && SURNAME_PARTICLES.has(givenTokens[midStart - 1].toLowerCase())) {
      midStart -= 1;
    }
    const firstStr = givenTokens.slice(0, midStart).join(" ");
    const midInitial = toMiddleInitial(givenTokens[midStart]);
    givenFormatted = midInitial
      ? `${firstStr} ${midInitial}`
      : givenTokens.join(" ");
  }

  return `${lastPart}, ${givenFormatted}${suffix ? ` ${suffix}` : ""}`;
}

export function formatStudentDisplayName(name = "", studentObj = null) {
  const trimmed = String(name || "").trim().replace(/\s+/g, " ");

  if (trimmed.includes(",")) {
    return formatCommaDisplayName(trimmed);
  }

  if (trimmed && !trimmed.includes(" ")) {
    return trimmed;
  }

  const structuredLast = String(studentObj?.lastName || "").trim().replace(/\s+/g, " ");
  const structuredFirst = String(studentObj?.firstName || "").trim().replace(/\s+/g, " ");
  if (structuredLast && structuredFirst) {
    const structuredMiddle = String(studentObj?.middleName || "").trim().replace(/\s+/g, " ");
    let effectiveFirst = structuredFirst;
    let midInitial = "";
    if (structuredMiddle) {
      const midTokens = structuredMiddle.split(" ").filter(Boolean);
      let midStart = midTokens.length - 1;
      while (midStart > 0 && SURNAME_PARTICLES.has(midTokens[midStart - 1].toLowerCase())) {
        midStart -= 1;
      }
      if (midStart > 0) {
        effectiveFirst = `${structuredFirst} ${midTokens.slice(0, midStart).join(" ")}`;
      }
      midInitial = toMiddleInitial(midTokens[midStart]);
    }
    const rawSuffix = String(studentObj?.suffix || "").trim().replace(/\s+/g, " ");
    const suffix = rawSuffix ? toCanonicalSuffix(rawSuffix) : "";
    return `${structuredLast}, ${effectiveFirst}${midInitial ? ` ${midInitial}` : ""}${suffix ? ` ${suffix}` : ""}`;
  }

  return trimmed;
}

export function formatProgramSection(program = "", section = "") {
  const cleanProgram = String(program || "").trim().replace(/\s+/g, " ").toUpperCase();
  const cleanSection = String(section || "").trim().replace(/\s+/g, " ").toUpperCase();
  return [cleanProgram, cleanSection].filter(Boolean).join(" · ");
}
