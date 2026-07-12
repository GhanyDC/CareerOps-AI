-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "AuthenticationAuditAction" AS ENUM ('USER_CREATED_FROM_PROVIDER', 'SIGN_IN_SUCCEEDED', 'SIGN_OUT', 'PROVIDER_ACCOUNT_LINKED', 'PROVIDER_ACCOUNT_UNLINKED', 'SESSION_REVOKED', 'ALL_SESSIONS_REVOKED', 'USER_SUSPENDED', 'USER_REACTIVATED', 'USER_SOFT_DELETED', 'DEVELOPMENT_USER_LINKED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authEmail" VARCHAR(320),
ADD COLUMN     "authEmailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "authImage" VARCHAR(2048),
ADD COLUMN     "authName" VARCHAR(160),
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
ALTER COLUMN "developmentKey" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AuthAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" VARCHAR(255) NOT NULL,
    "providerId" VARCHAR(80) NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthVerification" (
    "id" TEXT NOT NULL,
    "identifier" VARCHAR(255) NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthenticationAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authAccountId" TEXT,
    "authSessionId" TEXT,
    "action" "AuthenticationAuditAction" NOT NULL,
    "providerId" VARCHAR(80),
    "reasonCode" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthenticationAuditLog_pkey" PRIMARY KEY ("id")
);

-- Authentication invariants not expressible in Prisma's schema language.
ALTER TABLE "User"
ADD CONSTRAINT "User_authName_nonempty" CHECK ("authName" IS NULL OR length(btrim("authName")) > 0),
ADD CONSTRAINT "User_authEmail_normalized" CHECK (
    "authEmail" IS NULL OR (length(btrim("authEmail")) > 0 AND "authEmail" = lower(btrim("authEmail")))
),
ADD CONSTRAINT "User_deleted_status_consistency" CHECK (
    ("status" = 'DELETED' AND "deletedAt" IS NOT NULL)
    OR ("status" <> 'DELETED' AND "deletedAt" IS NULL)
);

ALTER TABLE "AuthAccount"
ADD CONSTRAINT "AuthAccount_provider_nonempty" CHECK (
    length(btrim("providerId")) > 0 AND "providerId" = lower(btrim("providerId"))
),
ADD CONSTRAINT "AuthAccount_subject_nonempty" CHECK (length(btrim("accountId")) > 0),
ADD CONSTRAINT "AuthAccount_provider_tokens_absent" CHECK (
    "accessToken" IS NULL
    AND "refreshToken" IS NULL
    AND "idToken" IS NULL
    AND "accessTokenExpiresAt" IS NULL
    AND "refreshTokenExpiresAt" IS NULL
    AND "scope" IS NULL
    AND "password" IS NULL
);

ALTER TABLE "AuthSession"
ADD CONSTRAINT "AuthSession_token_nonempty" CHECK (length(btrim("token")) > 0),
ADD CONSTRAINT "AuthSession_expiry_after_creation" CHECK ("expiresAt" > "createdAt");

ALTER TABLE "AuthVerification"
ADD CONSTRAINT "AuthVerification_identifier_nonempty" CHECK (length(btrim("identifier")) > 0),
ADD CONSTRAINT "AuthVerification_value_nonempty" CHECK (length(btrim("value")) > 0),
ADD CONSTRAINT "AuthVerification_expiry_after_creation" CHECK ("expiresAt" > "createdAt");

ALTER TABLE "AuthenticationAuditLog"
ADD CONSTRAINT "AuthenticationAuditLog_provider_nonempty" CHECK (
    "providerId" IS NULL OR length(btrim("providerId")) > 0
),
ADD CONSTRAINT "AuthenticationAuditLog_reason_nonempty" CHECK (
    "reasonCode" IS NULL OR length(btrim("reasonCode")) > 0
);

-- CreateIndex
CREATE INDEX "AuthAccount_userId_idx" ON "AuthAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthAccount_providerId_accountId_key" ON "AuthAccount"("providerId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_token_key" ON "AuthSession"("token");

-- CreateIndex
CREATE INDEX "AuthSession_userId_expiresAt_idx" ON "AuthSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthVerification_identifier_idx" ON "AuthVerification"("identifier");

-- CreateIndex
CREATE INDEX "AuthVerification_expiresAt_idx" ON "AuthVerification"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthenticationAuditLog_userId_createdAt_idx" ON "AuthenticationAuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthenticationAuditLog_action_createdAt_idx" ON "AuthenticationAuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_authEmail_key" ON "User"("authEmail");

-- AddForeignKey
ALTER TABLE "AuthAccount" ADD CONSTRAINT "AuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthenticationAuditLog" ADD CONSTRAINT "AuthenticationAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
