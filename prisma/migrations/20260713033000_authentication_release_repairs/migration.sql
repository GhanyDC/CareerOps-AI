-- Authentication success audits must share the transaction of the row that proves success.
CREATE FUNCTION "careerops_audit_auth_account_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    development_key VARCHAR(100);
    existing_account_count INTEGER;
BEGIN
    SELECT "developmentKey"
    INTO development_key
    FROM "User"
    WHERE "id" = NEW."userId";

    IF development_key IS NOT NULL THEN
        INSERT INTO "AuthenticationAuditLog" (
            "id", "userId", "authAccountId", "action", "providerId", "createdAt"
        ) VALUES (
            'auth-development-link:' || NEW."id",
            NEW."userId",
            NEW."id",
            'DEVELOPMENT_USER_LINKED',
            NEW."providerId",
            CURRENT_TIMESTAMP
        );
        RETURN NEW;
    END IF;

    SELECT count(*)
    INTO existing_account_count
    FROM "AuthAccount"
    WHERE "userId" = NEW."userId";

    IF existing_account_count = 1 THEN
        INSERT INTO "AuthenticationAuditLog" (
            "id", "userId", "action", "createdAt"
        ) VALUES (
            'auth-user-provisioned:' || NEW."userId",
            NEW."userId",
            'USER_CREATED_FROM_PROVIDER',
            CURRENT_TIMESTAMP
        );
    END IF;

    INSERT INTO "AuthenticationAuditLog" (
        "id", "userId", "authAccountId", "action", "providerId", "createdAt"
    ) VALUES (
        'auth-account-linked:' || NEW."id",
        NEW."userId",
        NEW."id",
        'PROVIDER_ACCOUNT_LINKED',
        NEW."providerId",
        CURRENT_TIMESTAMP
    );

    RETURN NEW;
END;
$$;

CREATE TRIGGER "AuthAccount_success_audit"
AFTER INSERT ON "AuthAccount"
FOR EACH ROW
EXECUTE FUNCTION "careerops_audit_auth_account_insert"();

CREATE FUNCTION "careerops_require_active_session_user"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    current_status "UserStatus";
BEGIN
    SELECT "status"
    INTO current_status
    FROM "User"
    WHERE "id" = NEW."userId"
    FOR SHARE;

    IF current_status IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'Authentication session creation is not allowed';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "AuthSession_active_user"
BEFORE INSERT ON "AuthSession"
FOR EACH ROW
EXECUTE FUNCTION "careerops_require_active_session_user"();

CREATE FUNCTION "careerops_audit_auth_session_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO "AuthenticationAuditLog" (
        "id", "userId", "authSessionId", "action", "createdAt"
    ) VALUES (
        'auth-session-created:' || NEW."id",
        NEW."userId",
        NEW."id",
        'SIGN_IN_SUCCEEDED',
        CURRENT_TIMESTAMP
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER "AuthSession_success_audit"
AFTER INSERT ON "AuthSession"
FOR EACH ROW
EXECUTE FUNCTION "careerops_audit_auth_session_insert"();

CREATE FUNCTION "careerops_audit_auth_session_delete"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO "AuthenticationAuditLog" (
        "id", "userId", "authSessionId", "action", "createdAt"
    ) VALUES (
        'auth-session-revoked:' || OLD."id",
        OLD."userId",
        OLD."id",
        'SESSION_REVOKED',
        CURRENT_TIMESTAMP
    );
    RETURN OLD;
END;
$$;

CREATE TRIGGER "AuthSession_revocation_audit"
AFTER DELETE ON "AuthSession"
FOR EACH ROW
EXECUTE FUNCTION "careerops_audit_auth_session_delete"();
