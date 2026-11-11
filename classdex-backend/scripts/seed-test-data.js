const path = require("node:path");
const fs = require("node:fs");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");

function loadSafeTestEnv() {
  const backendDir = path.resolve(__dirname, "..");
  const testEnvPath = path.join(backendDir, ".env.test");
  const prodEnvPath = path.join(backendDir, ".env");

  if (!fs.existsSync(testEnvPath)) {
    throw new Error(`Missing classdex-backend/.env.test (${testEnvPath})`);
  }

  const testEnv = dotenv.parse(fs.readFileSync(testEnvPath, "utf8"));
  if (!testEnv.DATABASE_URL) {
    throw new Error("classdex-backend/.env.test must define DATABASE_URL");
  }

  const testHost = new URL(testEnv.DATABASE_URL).hostname;
  if (fs.existsSync(prodEnvPath)) {
    const prodEnv = dotenv.parse(fs.readFileSync(prodEnvPath, "utf8"));
    if (prodEnv.DATABASE_URL) {
      const prodHost = new URL(prodEnv.DATABASE_URL).hostname;
      if (testHost === prodHost) {
        throw new Error(`Refusing to seed production database host (${testHost})`);
      }
    }
  }

  for (const [key, value] of Object.entries(testEnv)) {
    process.env[key] = value;
  }
  process.env.EMAIL_MODE = "stub";
  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  return { testHost };
}

loadSafeTestEnv();

const { prisma } = require("../db");
const { parseFullName } = require(path.resolve(__dirname, "../../shared/nameParser"));

const QA_PASSWORD = "QaPassword123!";
const SAMPLE_PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const QA_FACULTY = [
  {
    email: "qa_faculty1@test.local",
    name: "qa_Prof Elena Reyes",
    department: "Information Technology",
    contact: "+63 917 000 0001",
  },
  {
    email: "qa_faculty2@test.local",
    name: "qa_Prof Marco Santos",
    department: "Computer Science",
    contact: "+63 917 000 0002",
  },
];

const QA_STUDENTS = [
  {
    email: "qa_student1@test.local",
    name: "qa_Alice Mendoza",
    studentId: "8900001",
    program: "BSIT",
    section: "3A",
    address: "Tacloban City",
    birthdate: new Date("2004-05-12T00:00:00.000Z"),
  },
  {
    email: "qa_student2@test.local",
    name: "qa_Benito Cruz",
    studentId: "8900002",
    program: "BSIT",
    section: "3A",
    address: "Palo, Leyte",
    birthdate: new Date("2004-08-21T00:00:00.000Z"),
  },
  {
    email: "qa_student3@test.local",
    name: "qa_Carla Navarro",
    studentId: "8900003",
    program: "BSIT",
    section: "3A",
    address: "Ormoc City",
    birthdate: new Date("2004-11-03T00:00:00.000Z"),
  },
  {
    email: "qa_student4@test.local",
    name: "qa_Diego Bautista",
    studentId: "8900004",
    program: "BSCS",
    section: "1A",
    address: "Baybay City",
    birthdate: new Date("2005-01-19T00:00:00.000Z"),
  },
  {
    email: "qa_student5@test.local",
    name: "qa_Eva Villanueva",
    studentId: "8900005",
    program: "BSIT",
    section: "3A",
    address: "Tanauan, Leyte",
    birthdate: new Date("2004-03-15T00:00:00.000Z"),
  },
  {
    email: "qa_student6@test.local",
    name: "qa_Franco Torres",
    studentId: "8900006",
    program: "BSIT",
    section: "3A",
    address: "Carigara, Leyte",
    birthdate: new Date("2004-09-09T00:00:00.000Z"),
  },
  {
    email: "qa_student7@test.local",
    name: "qa_Grace Lim",
    studentId: "8900007",
    program: "BSIT",
    section: "3A",
    address: "Tolosa, Leyte",
    birthdate: new Date("2004-12-01T00:00:00.000Z"),
  },
];

async function cleanTestData() {
  const qaClasses = await prisma.class.findMany({
    where: {
      OR: [
        { classCode: { startsWith: "QA-" } },
        { sectionName: { startsWith: "qa_" } },
        { faculty: { email: { startsWith: "qa_" } } },
      ],
    },
    select: { id: true },
  });
  const classIds = qaClasses.map((item) => item.id);
  if (classIds.length) {
    await prisma.class.deleteMany({
      where: { id: { in: classIds } },
    });
  }

  const qaUsers = await prisma.user.findMany({
    where: {
      OR: [
        { email: { startsWith: "qa_" } },
        { studentProfile: { studentId: { in: QA_STUDENTS.map((s) => s.studentId) } } },
      ],
    },
    select: { id: true },
  });
  const userIds = qaUsers.map((item) => item.id);
  if (userIds.length) {
    await prisma.user.deleteMany({
      where: { id: { in: userIds } },
    });
  }

  return { removedClasses: classIds.length, removedUsers: userIds.length };
}

function buildPastUtcDate(daysAgo) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
}

async function seedTestData() {
  await cleanTestData();

  const passwordHash = await bcrypt.hash(QA_PASSWORD, 10);

  const faculties = [];
  for (const spec of QA_FACULTY) {
    const created = await prisma.user.create({
      data: {
        name: spec.name,
        email: spec.email,
        password: passwordHash,
        role: "FACULTY",
        emailVerified: true,
        emailVerifiedAt: new Date(),
        facultyProfile: {
          create: {
            name: spec.name,
            department: spec.department,
            email: spec.email,
            contact: spec.contact,
            photo: SAMPLE_PHOTO,
          },
        },
      },
      include: { facultyProfile: true },
    });
    faculties.push(created);
  }

  const students = [];
  for (const spec of QA_STUDENTS) {
    const parsed = parseFullName(spec.name);
    const created = await prisma.user.create({
      data: {
        name: spec.name,
        email: spec.email,
        password: passwordHash,
        role: "STUDENT",
        emailVerified: true,
        emailVerifiedAt: new Date(),
        studentProfile: {
          create: {
            name: spec.name,
            studentId: spec.studentId,
            email: spec.email,
            program: spec.program,
            section: spec.section,
            address: spec.address,
            birthdate: spec.birthdate,
            photo: SAMPLE_PHOTO,
            firstName: parsed.firstName,
            middleName: parsed.middleName,
            lastName: parsed.lastName,
            suffix: parsed.suffix,
            sortKey: parsed.sortKey,
          },
        },
      },
      include: { studentProfile: true },
    });
    students.push(created);
  }

  const [faculty1, faculty2] = faculties;
  const [stu1, stu2, stu3, stu4, stu5, stu6, stu7] = students;

  // Class 1 (Faculty 1): Pre-populated Student List, coursework, 7-absence warning, dropped student
  const class1 = await prisma.class.create({
    data: {
      facultyId: faculty1.id,
      sectionName: "qa_BSIT-3A",
      courseCode: "QA-IT121",
      courseTitle: "qa_Information Management",
      classCode: "QA-IT121",
      description: "Seeded QA class with Student List and coursework records.",
      schedule: "Mon & Wed, 8:00 AM – 9:30 AM",
      scheduleDays: ["MON", "WED"],
      scheduleStartTime: "08:00",
      scheduleEndTime: "09:30",
      gracePeriodMinutes: 15,
      recitationShuffleSeconds: 2,
      projects: {
        create: [
          { type: "MIDTERM", maxScore: 100 },
          { type: "FINALS", maxScore: 100 },
        ],
      },
    },
    include: { projects: true },
  });

  // Class 2 (Faculty 1): Empty Student List + pending request
  const class2 = await prisma.class.create({
    data: {
      facultyId: faculty1.id,
      sectionName: "qa_BSCS-1A",
      courseCode: "QA-CS101",
      courseTitle: "qa_Intro to Computing",
      classCode: "QA-CS101",
      description: "Seeded QA class with empty Student List.",
      schedule: "Tue & Thu, 10:00 AM – 11:30 AM",
      scheduleDays: ["TUE", "THU"],
      scheduleStartTime: "10:00",
      scheduleEndTime: "11:30",
      gracePeriodMinutes: 15,
      recitationShuffleSeconds: 3,
      projects: {
        create: [
          { type: "MIDTERM", maxScore: 100 },
          { type: "FINALS", maxScore: 100 },
        ],
      },
    },
    include: { projects: true },
  });

  // Class 3 (Faculty 2): Pre-populated Student List with multi-class student (stu1)
  const class3 = await prisma.class.create({
    data: {
      facultyId: faculty2.id,
      sectionName: "qa_BSIT-2B",
      courseCode: "QA-IT202",
      courseTitle: "qa_Web Systems",
      classCode: "QA-IT202",
      description: "Seeded Faculty 2 class sharing qa_student1.",
      schedule: "Fri, 1:00 PM – 4:00 PM",
      scheduleDays: ["FRI"],
      scheduleStartTime: "13:00",
      scheduleEndTime: "16:00",
      gracePeriodMinutes: 15,
      recitationShuffleSeconds: 3,
      projects: {
        create: [
          { type: "MIDTERM", maxScore: 100 },
          { type: "FINALS", maxScore: 100 },
        ],
      },
    },
    include: { projects: true },
  });

  // Class 4 (Faculty 2): Empty second class for faculty 2 isolation coverage
  const class4 = await prisma.class.create({
    data: {
      facultyId: faculty2.id,
      sectionName: "qa_BSCS-2B",
      courseCode: "QA-CS202",
      courseTitle: "qa_Data Structures",
      classCode: "QA-CS202",
      description: "Seeded secondary class for Faculty 2.",
      schedule: "Sat, 9:00 AM – 12:00 PM",
      scheduleDays: ["SAT"],
      scheduleStartTime: "09:00",
      scheduleEndTime: "12:00",
      gracePeriodMinutes: 15,
      recitationShuffleSeconds: 3,
      projects: {
        create: [
          { type: "MIDTERM", maxScore: 100 },
          { type: "FINALS", maxScore: 100 },
        ],
      },
    },
    include: { projects: true },
  });

  // Pre-populated Student List for Class 1:
  // stu1, stu2, stu3 (active matched), stu6 (dropped with droppedAt), stu7 (pre-listed, not yet joined!), + 1 extra synthetic entry
  const dropTimestamp = buildPastUtcDate(2);
  const rosterSpecsClass1 = [
    { name: stu1.studentProfile.name, studentId: stu1.studentProfile.studentId, droppedAt: null },
    { name: stu2.studentProfile.name, studentId: stu2.studentProfile.studentId, droppedAt: null },
    { name: stu3.studentProfile.name, studentId: stu3.studentProfile.studentId, droppedAt: null },
    { name: stu6.studentProfile.name, studentId: stu6.studentProfile.studentId, droppedAt: dropTimestamp },
    { name: stu7.studentProfile.name, studentId: stu7.studentProfile.studentId, droppedAt: null },
    { name: "qa_Prelisted Ghost", studentId: "8900099", droppedAt: null },
  ];

  for (const row of rosterSpecsClass1) {
    const parsed = parseFullName(row.name);
    await prisma.classRoster.create({
      data: {
        classId: class1.id,
        studentName: row.name,
        studentId: row.studentId,
        firstName: parsed.firstName,
        middleName: parsed.middleName,
        lastName: parsed.lastName,
        suffix: parsed.suffix,
        sortKey: parsed.sortKey,
        droppedAt: row.droppedAt,
      },
    });
  }

  // Roster for Class 3 (Faculty 2): stu1 matched
  const pStu1 = parseFullName(stu1.studentProfile.name);
  await prisma.classRoster.create({
    data: {
      classId: class3.id,
      studentName: stu1.studentProfile.name,
      studentId: stu1.studentProfile.studentId,
      firstName: pStu1.firstName,
      middleName: pStu1.middleName,
      lastName: pStu1.lastName,
      suffix: pStu1.suffix,
      sortKey: pStu1.sortKey,
    },
  });

  // Enrollments:
  // Class 1: stu1, stu2, stu3 APPROVED (autoApprovedAt); stu5 PENDING; stu6 DROPPED
  const approvedAt = buildPastUtcDate(14);
  await prisma.classEnrollment.createMany({
    data: [
      {
        classId: class1.id,
        studentProfileId: stu1.studentProfile.id,
        status: "APPROVED",
        autoApprovedAt: approvedAt,
        autoApprovalReadAt: approvedAt,
      },
      {
        classId: class1.id,
        studentProfileId: stu2.studentProfile.id,
        status: "APPROVED",
        autoApprovedAt: approvedAt,
        autoApprovalReadAt: approvedAt,
      },
      {
        classId: class1.id,
        studentProfileId: stu3.studentProfile.id,
        status: "APPROVED",
        autoApprovedAt: approvedAt,
        autoApprovalReadAt: approvedAt,
      },
      {
        classId: class1.id,
        studentProfileId: stu5.studentProfile.id,
        status: "PENDING",
      },
      {
        classId: class1.id,
        studentProfileId: stu6.studentProfile.id,
        status: "DROPPED",
        droppedAt: dropTimestamp,
        autoApprovedAt: approvedAt,
        autoApprovalReadAt: approvedAt,
      },
      // Class 2 (empty Student List): stu4 PENDING
      {
        classId: class2.id,
        studentProfileId: stu4.studentProfile.id,
        status: "PENDING",
      },
      // Class 3 (Faculty 2): stu1 APPROVED (multi-class student!)
      {
        classId: class3.id,
        studentProfileId: stu1.studentProfile.id,
        status: "APPROVED",
        autoApprovedAt: approvedAt,
        autoApprovalReadAt: approvedAt,
      },
    ],
  });

  // Seed 7 past sessions in Class 1 so stu3 reaches ABSENCE_WARNING_THRESHOLD (7 absences)
  // Dates: 10..4 days ago (safely in the past, zero collision with today's session)
  const sessions = [];
  for (let idx = 0; idx < 7; idx += 1) {
    const sessionDate = buildPastUtcDate(10 - idx);
    const startedAt = new Date(sessionDate.getTime() + 8 * 60 * 60 * 1000);
    const session = await prisma.classSession.create({
      data: {
        classId: class1.id,
        date: sessionDate,
        startedAt,
      },
    });
    sessions.push(session);

    await prisma.attendanceRecord.createMany({
      data: [
        {
          sessionId: session.id,
          studentId: stu1.studentProfile.id,
          status: idx === 3 ? "LATE" : "PRESENT",
          markedAt: startedAt,
        },
        {
          sessionId: session.id,
          studentId: stu2.studentProfile.id,
          status: "PRESENT",
          markedAt: startedAt,
        },
        {
          sessionId: session.id,
          studentId: stu3.studentProfile.id,
          status: "ABSENT",
          markedAt: startedAt,
        },
        // Dropped student stu6 also has historical attendance
        {
          sessionId: session.id,
          studentId: stu6.studentProfile.id,
          status: idx < 2 ? "ABSENT" : "PRESENT",
          markedAt: startedAt,
        },
      ],
    });
  }

  // Coursework in Class 1 (Recitation, Activity, Midterm Project, Quiz) including historical scores for dropped stu6
  const latestPastSession = sessions[sessions.length - 1];
  await prisma.recitationLog.createMany({
    data: [
      {
        sessionId: latestPastSession.id,
        studentId: stu1.studentProfile.id,
        method: "RANDOM",
        score: 5,
      },
      {
        sessionId: latestPastSession.id,
        studentId: stu2.studentProfile.id,
        method: "WEIGHTED",
        score: 4,
      },
      {
        sessionId: latestPastSession.id,
        studentId: stu6.studentProfile.id,
        method: "RANDOM",
        score: 3,
      },
    ],
  });

  const activity = await prisma.activity.create({
    data: {
      classId: class1.id,
      sessionId: latestPastSession.id,
      title: "qa_ERD Activity 1",
      maxScore: 50,
      scores: {
        create: [
          { studentId: stu1.studentProfile.id, score: 48, isAbsent: false },
          { studentId: stu2.studentProfile.id, score: 42, isAbsent: false },
          { studentId: stu3.studentProfile.id, score: null, isAbsent: true },
          { studentId: stu6.studentProfile.id, score: 35, isAbsent: false },
        ],
      },
    },
  });

  const midtermProject = class1.projects.find((p) => p.type === "MIDTERM");
  if (midtermProject) {
    await prisma.projectScore.createMany({
      data: [
        {
          projectId: midtermProject.id,
          studentId: stu1.studentProfile.id,
          sessionId: latestPastSession.id,
          score: 95,
          isAbsent: false,
        },
        {
          projectId: midtermProject.id,
          studentId: stu2.studentProfile.id,
          sessionId: latestPastSession.id,
          score: 88,
          isAbsent: false,
        },
        {
          projectId: midtermProject.id,
          studentId: stu6.studentProfile.id,
          sessionId: latestPastSession.id,
          score: 80,
          isAbsent: false,
        },
      ],
    });
  }

  const quiz = await prisma.quizSession.create({
    data: {
      classId: class1.id,
      title: "qa_Quiz 1 Normalization",
      totalItems: 20,
      date: buildPastUtcDate(4),
      scores: {
        create: [
          { studentId: stu1.studentProfile.id, score: 19, isAbsent: false },
          { studentId: stu2.studentProfile.id, score: 16, isAbsent: false },
          { studentId: stu3.studentProfile.id, score: null, isAbsent: true },
          { studentId: stu6.studentProfile.id, score: 14, isAbsent: false },
        ],
      },
    },
  });

  return {
    password: QA_PASSWORD,
    faculties: faculties.map((f) => ({ id: f.id, email: f.email, name: f.name })),
    students: students.map((s) => ({
      id: s.id,
      profileId: s.studentProfile.id,
      email: s.email,
      name: s.name,
      studentId: s.studentProfile.studentId,
    })),
    classes: {
      class1: { id: class1.id, classCode: class1.classCode, sectionName: class1.sectionName },
      class2: { id: class2.id, classCode: class2.classCode, sectionName: class2.sectionName },
      class3: { id: class3.id, classCode: class3.classCode, sectionName: class3.sectionName },
      class4: { id: class4.id, classCode: class4.classCode, sectionName: class4.sectionName },
    },
    activityId: activity.id,
    quizId: quiz.id,
    pastSessionIds: sessions.map((s) => s.id),
  };
}

if (require.main === module) {
  const isClean = process.argv.includes("--clean");
  (async () => {
    try {
      const host = new URL(process.env.DATABASE_URL).hostname;
      if (isClean) {
        const res = await cleanTestData();
        console.log(
          `[seed-test-data] Cleaned qa_ records on ${host}: removedClasses=${res.removedClasses}, removedUsers=${res.removedUsers}`,
        );
      } else {
        const res = await seedTestData();
        console.log(
          `[seed-test-data] Seeded QA dataset on ${host}: ${res.faculties.length} faculty, ${res.students.length} students, 4 classes (QA-IT121, QA-CS101, QA-IT202, QA-CS202).`,
        );
      }
    } finally {
      await prisma.$disconnect();
    }
  })().catch((err) => {
    console.error("[seed-test-data] Failed:", err);
    process.exit(1);
  });
}

module.exports = {
  seedTestData,
  cleanTestData,
  QA_PASSWORD,
  SAMPLE_PHOTO,
  QA_FACULTY,
  QA_STUDENTS,
};
