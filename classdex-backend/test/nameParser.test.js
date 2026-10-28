const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  parseFullName,
  formatStudentName,
  compareStudents,
  SURNAME_PARTICLES,
  SORT_IGNORES_PARTICLES,
} = require(path.resolve(__dirname, "../../shared/nameParser.js"));

test("Name Parser - required test cases", () => {
  // 1. Jose P. Rizal
  const rizal = parseFullName("Jose P. Rizal");
  assert.equal(rizal.firstName, "Jose");
  assert.equal(rizal.middleName, "P.");
  assert.equal(rizal.lastName, "Rizal");
  assert.equal(rizal.suffix, "");
  assert.equal(rizal.sortKey, "rizal");

  // 2. Jose Protasio Rizal Jr.
  const rizalJr = parseFullName("Jose Protasio Rizal Jr.");
  assert.equal(rizalJr.firstName, "Jose");
  assert.equal(rizalJr.middleName, "Protasio");
  assert.equal(rizalJr.lastName, "Rizal");
  assert.equal(rizalJr.suffix, "Jr.");
  assert.equal(rizalJr.sortKey, "rizal");

  // 3. Edwin Van Der Sar
  const vdsDefault = parseFullName("Edwin Van Der Sar");
  assert.equal(vdsDefault.firstName, "Edwin");
  assert.equal(vdsDefault.middleName, "");
  assert.equal(vdsDefault.lastName, "Van Der Sar");
  assert.equal(vdsDefault.suffix, "");
  assert.equal(vdsDefault.sortKey, "van der sar");

  // Both values of SORT_IGNORES_PARTICLES for Van Der Sar
  const vdsIgnored = parseFullName("Edwin Van Der Sar", { sortIgnoresParticles: true });
  assert.equal(vdsIgnored.sortKey, "sar, van der");

  // 4. Juan De La Cruz
  const dlcDefault = parseFullName("Juan De La Cruz");
  assert.equal(dlcDefault.firstName, "Juan");
  assert.equal(dlcDefault.middleName, "");
  assert.equal(dlcDefault.lastName, "De La Cruz");
  assert.equal(dlcDefault.sortKey, "de la cruz");

  const dlcIgnored = parseFullName("Juan De La Cruz", { sortIgnoresParticles: true });
  assert.equal(dlcIgnored.sortKey, "cruz, de la");

  // 5. Maria Clara Del Rosario III
  const delRosario = parseFullName("Maria Clara Del Rosario III");
  assert.equal(delRosario.firstName, "Maria");
  assert.equal(delRosario.middleName, "Clara");
  assert.equal(delRosario.lastName, "Del Rosario");
  assert.equal(delRosario.suffix, "III");
  assert.equal(delRosario.sortKey, "del rosario");

  // 6. Ludwig van Beethoven
  const beethoven = parseFullName("Ludwig van Beethoven");
  assert.equal(beethoven.firstName, "Ludwig");
  assert.equal(beethoven.middleName, "");
  assert.equal(beethoven.lastName, "van Beethoven");
  assert.equal(beethoven.sortKey, "van beethoven");

  // 7. Cher (single token)
  const cher = parseFullName("Cher");
  assert.equal(cher.firstName, "");
  assert.equal(cher.middleName, "");
  assert.equal(cher.lastName, "Cher");
  assert.equal(cher.suffix, "");
  assert.equal(cher.sortKey, "cher");

  // 8. Extra spaces
  const extraSpaces = parseFullName("   Jose    P.   Rizal   ");
  assert.equal(extraSpaces.firstName, "Jose");
  assert.equal(extraSpaces.middleName, "P.");
  assert.equal(extraSpaces.lastName, "Rizal");
  assert.equal(extraSpaces.sortKey, "rizal");

  // 9. Lowercase input
  const lowercase = parseFullName("juan de la cruz");
  assert.equal(lowercase.firstName, "juan");
  assert.equal(lowercase.lastName, "de la cruz");
  assert.equal(lowercase.sortKey, "de la cruz");

  // 10. Sr without period
  const srNoPeriod = parseFullName("Jose Rizal Sr");
  assert.equal(srNoPeriod.firstName, "Jose");
  assert.equal(srNoPeriod.lastName, "Rizal");
  assert.equal(srNoPeriod.suffix, "Sr.");
  assert.equal(srNoPeriod.sortKey, "rizal");

  // 11. Dela Cruz, Juan P. (Comma format)
  const commaDlc = parseFullName("Dela Cruz, Juan P.");
  assert.equal(commaDlc.firstName, "Juan");
  assert.equal(commaDlc.middleName, "P.");
  assert.equal(commaDlc.lastName, "Dela Cruz");
  assert.equal(commaDlc.sortKey, "dela cruz");

  // 12. DELA CRUZ, JUAN P. (ALL CAPS comma format)
  const capsDlc = parseFullName("DELA CRUZ, JUAN P.");
  assert.equal(capsDlc.firstName, "JUAN");
  assert.equal(capsDlc.middleName, "P.");
  assert.equal(capsDlc.lastName, "DELA CRUZ");
  assert.equal(capsDlc.sortKey, "dela cruz");

  // 13. Rizal, Jose P., Jr.
  const commaRizalJr = parseFullName("Rizal, Jose P., Jr.");
  assert.equal(commaRizalJr.firstName, "Jose");
  assert.equal(commaRizalJr.middleName, "P.");
  assert.equal(commaRizalJr.lastName, "Rizal");
  assert.equal(commaRizalJr.suffix, "Jr.");
  assert.equal(commaRizalJr.sortKey, "rizal");

  // 14. Ma. Cristina R. Santos (Ma. rule)
  const maCristina = parseFullName("Ma. Cristina R. Santos");
  assert.equal(maCristina.firstName, "Ma. Cristina");
  assert.equal(maCristina.middleName, "R.");
  assert.equal(maCristina.lastName, "Santos");
  assert.equal(maCristina.sortKey, "santos");

  // 15. John Paul O. Talbo (two-word first name preserved in givenNames)
  const talbo = parseFullName("John Paul O. Talbo");
  assert.equal(talbo.lastName, "Talbo");
  assert.deepEqual(talbo.givenNames, ["John", "Paul", "O."]);
  assert.equal(formatStudentName("John Paul O. Talbo", talbo), "Talbo, John Paul O.");

  // 16. Juan Dela Cruz Reyes (surname Reyes, middle Dela Cruz)
  const reyes = parseFullName("Juan Dela Cruz Reyes");
  assert.equal(reyes.firstName, "Juan");
  assert.equal(reyes.middleName, "Dela Cruz");
  assert.equal(reyes.lastName, "Reyes");
  assert.equal(reyes.sortKey, "reyes");

  // Check exported constants
  assert.equal(SORT_IGNORES_PARTICLES, false);
  assert.ok(SURNAME_PARTICLES.has("dela"));
  assert.ok(SURNAME_PARTICLES.has("van"));
  assert.ok(SURNAME_PARTICLES.has("san"));
});

test("compareStudents - sorts by sortKey ASC, firstName ASC, middleName ASC, studentId ASC", () => {
  const students = [
    { name: "John Paul O. Talbo", studentId: "2300003" },
    { name: "Jose P. Rizal", studentId: "2300002" },
    { name: "Juan De La Cruz", studentId: "2300001" },
    { name: "Edwin Van Der Sar", studentId: "2300004" },
  ];

  const sorted = [...students].sort(compareStudents);
  // Default: de la cruz, rizal, talbo, van der sar
  assert.equal(sorted[0].name, "Juan De La Cruz");
  assert.equal(sorted[1].name, "Jose P. Rizal");
  assert.equal(sorted[2].name, "John Paul O. Talbo");
  assert.equal(sorted[3].name, "Edwin Van Der Sar");
});
