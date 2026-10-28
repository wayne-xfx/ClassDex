require("dotenv").config();
const { prisma } = require("../db");
const { parseFullName } = require("../../shared/nameParser");

async function syncAllApprovedEnrollments(dryRun = false) {
  console.log(`Starting approved enrollment to student list sync (dryRun=${dryRun})...`);
  const enrollments = await prisma.classEnrollment.findMany({
    where: { status: "APPROVED" },
    include: {
      studentProfile: true,
      class: { select: { id: true, classCode: true, sectionName: true } },
    },
  });

  console.log(`Found ${enrollments.length} approved enrollments total.`);

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const enrollment of enrollments) {
    const profile = enrollment.studentProfile;
    const classId = enrollment.classId;

    if (!profile || !profile.studentId) {
      console.log(`Skipping enrollment ${enrollment.id}: profile or studentId missing.`);
      skippedCount++;
      continue;
    }

    const existingRoster = await prisma.classRoster.findUnique({
      where: {
        classId_studentId: {
          classId,
          studentId: profile.studentId,
        },
      },
    });

    const parsed = parseFullName(profile.name);

    if (!existingRoster) {
      console.log(
        `[CREATE] Adding ${profile.name} (${profile.studentId}) to class ${enrollment.class?.classCode || classId}`
      );
      if (!dryRun) {
        await prisma.classRoster.create({
          data: {
            classId,
            studentId: profile.studentId,
            studentName: profile.name,
            firstName: parsed.firstName || profile.firstName || "",
            middleName: parsed.middleName || profile.middleName || "",
            lastName: parsed.lastName || profile.lastName || "",
            suffix: parsed.suffix || profile.suffix || "",
            sortKey: parsed.sortKey || profile.sortKey || "",
            droppedAt: null,
          },
        });
      }
      createdCount++;
    } else if (existingRoster.droppedAt !== null) {
      console.log(
        `[UPDATE] Restoring ${profile.name} (${profile.studentId}) in class ${enrollment.class?.classCode || classId}`
      );
      if (!dryRun) {
        await prisma.classRoster.update({
          where: { id: existingRoster.id },
          data: {
            droppedAt: null,
            studentName: profile.name,
            firstName: parsed.firstName || profile.firstName || "",
            middleName: parsed.middleName || profile.middleName || "",
            lastName: parsed.lastName || profile.lastName || "",
            suffix: parsed.suffix || profile.suffix || "",
            sortKey: parsed.sortKey || profile.sortKey || "",
          },
        });
      }
      updatedCount++;
    } else {
      skippedCount++;
    }
  }

  console.log(
    `Sync completed: ${createdCount} created, ${updatedCount} updated, ${skippedCount} already synced.`
  );
}

const isDryRun = process.argv.includes("--dry-run");

syncAllApprovedEnrollments(isDryRun)
  .catch((err) => {
    console.error("Sync failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
