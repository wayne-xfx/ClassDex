require("dotenv").config();
const path = require("node:path");
const { prisma } = require("../db");
const { parseFullName } = require(path.resolve(__dirname, "../../shared/nameParser"));

const isDryRun = process.argv.includes("--dry-run");
const BATCH_SIZE = 50;

async function backfillNameParts() {
  console.log(`Starting name parts backfill (mode: ${isDryRun ? "DRY-RUN" : "LIVE"})...`);

  // 1. Backfill StudentProfile
  let profileCursor = undefined;
  let totalProfilesProcessed = 0;
  let totalProfilesUpdated = 0;

  while (true) {
    const profiles = await prisma.studentProfile.findMany({
      take: BATCH_SIZE,
      skip: profileCursor ? 1 : 0,
      cursor: profileCursor ? { id: profileCursor } : undefined,
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        firstName: true,
        middleName: true,
        lastName: true,
        suffix: true,
        sortKey: true,
      },
    });

    if (profiles.length === 0) break;

    for (const profile of profiles) {
      totalProfilesProcessed += 1;
      const parsed = parseFullName(profile.name);

      // Check if update is needed
      const needsUpdate =
        profile.sortKey !== parsed.sortKey ||
        profile.lastName !== parsed.lastName ||
        profile.firstName !== parsed.firstName ||
        profile.middleName !== parsed.middleName ||
        profile.suffix !== parsed.suffix;

      if (needsUpdate) {
        totalProfilesUpdated += 1;
        if (!isDryRun) {
          await prisma.studentProfile.update({
            where: { id: profile.id },
            data: {
              firstName: parsed.firstName,
              middleName: parsed.middleName,
              lastName: parsed.lastName,
              suffix: parsed.suffix,
              sortKey: parsed.sortKey,
            },
          });
        }
      }
    }

    profileCursor = profiles[profiles.length - 1].id;
  }

  console.log(
    `StudentProfile: Processed ${totalProfilesProcessed}, ${isDryRun ? "Would update" : "Updated"} ${totalProfilesUpdated}.`
  );

  // 2. Backfill ClassRoster
  let rosterCursor = undefined;
  let totalRosterProcessed = 0;
  let totalRosterUpdated = 0;

  while (true) {
    const rosters = await prisma.classRoster.findMany({
      take: BATCH_SIZE,
      skip: rosterCursor ? 1 : 0,
      cursor: rosterCursor ? { id: rosterCursor } : undefined,
      orderBy: { id: "asc" },
      select: {
        id: true,
        studentName: true,
        firstName: true,
        middleName: true,
        lastName: true,
        suffix: true,
        sortKey: true,
      },
    });

    if (rosters.length === 0) break;

    for (const roster of rosters) {
      totalRosterProcessed += 1;
      const parsed = parseFullName(roster.studentName);

      const needsUpdate =
        roster.sortKey !== parsed.sortKey ||
        roster.lastName !== parsed.lastName ||
        roster.firstName !== parsed.firstName ||
        roster.middleName !== parsed.middleName ||
        roster.suffix !== parsed.suffix;

      if (needsUpdate) {
        totalRosterUpdated += 1;
        if (!isDryRun) {
          await prisma.classRoster.update({
            where: { id: roster.id },
            data: {
              firstName: parsed.firstName,
              middleName: parsed.middleName,
              lastName: parsed.lastName,
              suffix: parsed.suffix,
              sortKey: parsed.sortKey,
            },
          });
        }
      }
    }

    rosterCursor = rosters[rosters.length - 1].id;
  }

  console.log(
    `ClassRoster: Processed ${totalRosterProcessed}, ${isDryRun ? "Would update" : "Updated"} ${totalRosterUpdated}.`
  );

  console.log("Backfill completed successfully.");
}

backfillNameParts()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
