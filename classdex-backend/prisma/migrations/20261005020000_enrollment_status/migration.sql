CREATE TYPE "EnrollmentStatus" AS ENUM ('APPROVED', 'PENDING', 'DECLINED');
ALTER TABLE "ClassEnrollment" ADD COLUMN "status" "EnrollmentStatus" NOT NULL DEFAULT 'APPROVED';
