import {
  parseFullName,
  formatStudentName as sharedFormatStudentName,
  compareStudents as sharedCompareStudents,
  SORT_IGNORES_PARTICLES,
  SURNAME_PARTICLES,
} from "../../../../shared/nameParser.js";

export { parseFullName, SORT_IGNORES_PARTICLES, SURNAME_PARTICLES };

export function formatStudentName(name = "", studentObj = null) {
  if (studentObj && (studentObj.lastName || studentObj.firstName)) {
    return sharedFormatStudentName(name, studentObj);
  }
  return sharedFormatStudentName(name);
}

export function compareStudentsByLastName(left, right) {
  return sharedCompareStudents(left, right);
}
