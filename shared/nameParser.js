const SORT_IGNORES_PARTICLES = false;

const SURNAME_PARTICLES = new Set([
  "van", "der", "de", "von", "di", "del", "la", "le", "ter", "ten", "den",
  "da", "della", "dela", "delos", "delas", "los", "las", "san", "santa",
]);

const SUFFIX_MAP = {
  jr: "Jr.",
  "jr.": "Jr.",
  sr: "Sr.",
  "sr.": "Sr.",
  ii: "II",
  iii: "III",
  iv: "IV",
  v: "V",
};

function stripDiacritics(str = "") {
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

function parseFullName(fullName, options = {}) {
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

function formatStudentName(name = "", parsedObj = null) {
  const parsed = parsedObj || parseFullName(name);
  if (!parsed.lastName) return name;
  const givenStr = (parsed.givenNames && parsed.givenNames.length)
    ? parsed.givenNames.join(" ")
    : [parsed.firstName, parsed.middleName].filter(Boolean).join(" ");
  const suffixStr = parsed.suffix ? ` ${parsed.suffix}` : "";
  return givenStr ? `${parsed.lastName}, ${givenStr}${suffixStr}` : parsed.lastName;
}

function compareStudents(left, right) {
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

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseFullName,
    formatStudentName,
    compareStudents,
    stripDiacritics,
    SURNAME_PARTICLES,
    SORT_IGNORES_PARTICLES,
  };
}
