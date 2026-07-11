import { createHash } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";

function seedPrefix(developmentKey: string) {
  return `seed-${createHash("sha256").update(developmentKey).digest("hex").slice(0, 12)}`;
}

export async function seedDevelopmentData(client: PrismaClient, developmentKey: string) {
  const prefix = seedPrefix(developmentKey);
  const user = await client.user.upsert({
    where: { developmentKey },
    update: {},
    create: { developmentKey },
  });

  const profile = await client.candidateProfile.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      id: `${prefix}-profile`,
      userId: user.id,
      fullName: "Ghanymede Dela Cruz",
      professionalHeadline: "Junior Software Engineer and Full-Stack Developer",
      careerSummary:
        "Software developer focused on backend, full-stack, testing, automation, integration, and AI-enabled product work.",
      preferredRoleFamilies: [
        "Junior Software Engineer",
        "Backend Developer",
        "Full-Stack Developer",
        "Software Test Engineer",
        "QA Engineer",
        "Automation and Integration Engineer",
        "RPA Developer",
        "AI-enabled Software Developer",
      ],
      preferredLocations: ["NCR", "Philippines remote"],
      acceptedWorkArrangements: ["On-site", "Hybrid", "Remote"],
      dostReturnServiceNotes:
        "Prioritize Philippine-based opportunities in line with DOST return-of-service obligations.",
      applicationPreferences:
        "Consider NCR on-site and hybrid roles, plus Philippine remote opportunities.",
    },
  });

  const odoo = await client.experience.upsert({
    where: { id: `${prefix}-experience-odoo` },
    update: {},
    create: {
      id: `${prefix}-experience-odoo`,
      userId: user.id,
      candidateProfileId: profile.id,
      title: "Odoo Data and Software Engineering Intern",
      organization: "Odoo internship",
      experienceType: "INTERNSHIP",
      summary:
        "Worked on data migration, testing, validation, and repeatable development data flows.",
      responsibilities: ["UAT", "Issue tracking", "Data validation", "Migration-output checking"],
      technologies: ["Odoo", "PostgreSQL", "Docker", "CSV", "Data migration pipelines"],
      skills: ["Quality assurance", "Data migration", "Backend validation", "Automation"],
      outcomes: [
        "Reduced standard demo setup from approximately four hours to five minutes",
        "Reduced migration work from approximately four days to one day",
      ],
      verificationStatus: "VERIFIED",
      sourceNotes: "Seeded from established candidate facts; remains editable and reviewable.",
    },
  });

  const academic = await client.experience.upsert({
    where: { id: `${prefix}-experience-academic` },
    update: {},
    create: {
      id: `${prefix}-experience-academic`,
      userId: user.id,
      candidateProfileId: profile.id,
      title: "Academic achievements and leadership",
      organization: "University",
      experienceType: "ACADEMIC",
      summary: "Academic distinctions and university-level project recognition.",
      outcomes: [
        "Graduated Magna Cum Laude",
        "Served as Batch Valedictorian",
        "Received Best Undergraduate Thesis at the university level",
        "Received Best Presenter and 2nd Runner-Up recognition at ICT Uniwide 2026",
      ],
      verificationStatus: "VERIFIED",
      sourceNotes: "Seeded from established academic facts; remains editable and reviewable.",
    },
  });

  const projects = await Promise.all([
    client.project.upsert({
      where: { id: `${prefix}-project-cems` },
      update: {},
      create: {
        id: `${prefix}-project-cems`,
        userId: user.id,
        candidateProfileId: profile.id,
        name: "Campus Election Management System",
        shortDescription: "A campus-scale election administration and voting platform.",
        candidateRole: "Full-stack developer",
        technologies: ["Django", "PostgreSQL", "AWS Lightsail", "Nginx", "Gunicorn"],
        responsibilities: [
          "Designed election workflows",
          "Implemented audit logs and rate limiting",
          "Implemented authentication-related election controls",
          "Implemented multi-position ballots",
          "Deployed and operated the application stack",
        ],
        outcomes: ["Supported approximately 5,000 students"],
        relevantRoleFamilies: ["Backend Developer", "Full-Stack Developer", "QA Engineer"],
        verificationStatus: "VERIFIED",
      },
    }),
    client.project.upsert({
      where: { id: `${prefix}-project-pawsense` },
      update: {},
      create: {
        id: `${prefix}-project-pawsense`,
        userId: user.id,
        candidateProfileId: profile.id,
        name: "PawSense",
        shortDescription: "AI-enabled mobile pet skin-disease detection and care guidance.",
        candidateRole: "Mobile and AI application developer",
        technologies: ["Flutter", "FastAPI", "Firebase", "YOLOv8", "TFLite"],
        outcomes: ["Received Best Undergraduate Thesis at the university level"],
        relevantRoleFamilies: [
          "Full-Stack Developer",
          "AI-enabled Software Developer",
          "Junior Software Engineer",
        ],
        verificationStatus: "VERIFIED",
      },
    }),
    client.project.upsert({
      where: { id: `${prefix}-project-localops` },
      update: {},
      create: {
        id: `${prefix}-project-localops`,
        userId: user.id,
        candidateProfileId: profile.id,
        name: "LocalOps",
        shortDescription: "A multi-tenant local business and property operations platform.",
        candidateRole: "Full-stack developer",
        technologies: ["Next.js", "PostgreSQL", "Prisma", "Docker", "Vercel"],
        responsibilities: [
          "Built sales, expense, inventory, receivable, tenant, payment, and reporting workflows",
          "Developed AI-assisted input workflows",
        ],
        relevantRoleFamilies: [
          "Full-Stack Developer",
          "Backend Developer",
          "AI-enabled Software Developer",
        ],
        verificationStatus: "VERIFIED",
      },
    }),
  ]);

  const [cems, pawsense, localops] = projects;
  const evidenceDefinitions = [
    {
      suffix: "odoo-demo",
      sourceType: "EXPERIENCE" as const,
      sourceExperienceId: odoo.id,
      claim: "Reduced standard Odoo demo setup from approximately four hours to five minutes.",
      skills: ["Automation", "Data pipelines", "Process improvement"],
      roles: ["Automation and Integration Engineer", "Backend Developer"],
    },
    {
      suffix: "odoo-migration",
      sourceType: "EXPERIENCE" as const,
      sourceExperienceId: odoo.id,
      claim: "Reduced Odoo migration work from approximately four days to one day.",
      skills: ["Data migration", "PostgreSQL", "Validation"],
      roles: ["Backend Developer", "QA Engineer"],
    },
    {
      suffix: "odoo-uat",
      sourceType: "EXPERIENCE" as const,
      sourceExperienceId: odoo.id,
      claim: "Performed UAT, issue tracking, data validation, and migration-output checking.",
      skills: ["UAT", "Issue tracking", "Quality assurance"],
      roles: ["Software Test Engineer", "QA Engineer"],
    },
    {
      suffix: "cems-scale",
      sourceType: "PROJECT" as const,
      sourceProjectId: cems.id,
      claim:
        "Built a Django and PostgreSQL campus election system supporting approximately 5,000 students.",
      skills: ["Django", "PostgreSQL", "System design"],
      roles: ["Backend Developer", "Full-Stack Developer"],
    },
    {
      suffix: "cems-deploy",
      sourceType: "PROJECT" as const,
      sourceProjectId: cems.id,
      claim: "Deployed CEMS using AWS Lightsail, Nginx, and Gunicorn.",
      skills: ["Deployment", "AWS Lightsail", "Nginx", "Gunicorn"],
      roles: ["Junior Software Engineer", "Backend Developer"],
    },
    {
      suffix: "cems-controls",
      sourceType: "PROJECT" as const,
      sourceProjectId: cems.id,
      claim:
        "Implemented audit logs, rate limiting, election authentication controls, and multi-position ballots.",
      skills: ["Security controls", "Audit logging", "Rate limiting"],
      roles: ["Backend Developer", "Software Test Engineer"],
    },
    {
      suffix: "pawsense-ai",
      sourceType: "PROJECT" as const,
      sourceProjectId: pawsense.id,
      claim: "Built an AI-enabled Flutter application using FastAPI, Firebase, YOLOv8, and TFLite.",
      skills: ["Flutter", "FastAPI", "YOLOv8", "TFLite"],
      roles: ["AI-enabled Software Developer", "Full-Stack Developer"],
    },
    {
      suffix: "localops-platform",
      sourceType: "PROJECT" as const,
      sourceProjectId: localops.id,
      claim:
        "Built a multi-tenant local business and property operations platform with Next.js, PostgreSQL, and Prisma.",
      skills: ["Next.js", "PostgreSQL", "Prisma", "Multi-tenancy"],
      roles: ["Full-Stack Developer", "Backend Developer"],
    },
    ...[
      "Graduated Magna Cum Laude.",
      "Served as Batch Valedictorian.",
      "Received Best Undergraduate Thesis at the university level.",
      "Received Best Presenter and 2nd Runner-Up recognition at ICT Uniwide 2026.",
    ].map((claim, index) => ({
      suffix: `academic-${index + 1}`,
      sourceType: "EXPERIENCE" as const,
      sourceExperienceId: academic.id,
      claim,
      skills: ["Academic achievement"],
      roles: ["Junior Software Engineer"],
    })),
  ];

  const evidenceItems = [];
  for (const definition of evidenceDefinitions) {
    const evidence = await client.evidenceItem.upsert({
      where: { id: `${prefix}-evidence-${definition.suffix}` },
      update: {},
      create: {
        id: `${prefix}-evidence-${definition.suffix}`,
        userId: user.id,
        sourceType: definition.sourceType,
        sourceExperienceId: definition.sourceExperienceId,
        sourceProjectId: "sourceProjectId" in definition ? definition.sourceProjectId : undefined,
        claim: definition.claim,
        skillsDemonstrated: definition.skills,
        relevantRoleFamilies: definition.roles,
        evidenceStrength: "DIRECT",
        verificationStatus: "VERIFIED",
        allowedForResume: true,
        allowedForCoverLetters: true,
        allowedForInterviews: true,
        allowedForRecruiterMessages: true,
        sourceNotes: "Seeded from established candidate facts; review before external use.",
      },
    });
    evidenceItems.push(evidence);
  }

  for (const evidence of evidenceItems) {
    await client.claim.upsert({
      where: { id: `${evidence.id}-claim` },
      update: {},
      create: {
        id: `${evidence.id}-claim`,
        userId: user.id,
        evidenceItemId: evidence.id,
        claimText: evidence.claim,
        status: "REQUIRES_VERIFICATION",
        reviewerNotes: "Seeded as reviewable; explicit user approval is still required.",
        allowedForResume: evidence.allowedForResume,
        allowedForCoverLetters: evidence.allowedForCoverLetters,
        allowedForInterviews: evidence.allowedForInterviews,
        allowedForRecruiterMessages: evidence.allowedForRecruiterMessages,
      },
    });
  }

  return { userId: user.id, profileId: profile.id };
}
