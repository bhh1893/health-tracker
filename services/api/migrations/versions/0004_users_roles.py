"""User identity and Role, and the role_changes audit table (ADR 0022).

Revision ID: 0004
Revises: 0003
"""

from alembic import op

revision = "0004"
down_revision = "0003"

ROLES = "('pending', 'member', 'admin')"


def upgrade() -> None:
    # Expand only: the running `api` never names these columns, so it keeps working through
    # the rollout (ADR 0001). Every existing row, the seeded User included, reads Role Pending
    # with no identity. Nobody can sign in as a row with no identity, so that locks no one out.
    op.execute(
        f"""
        ALTER TABLE users
            -- The natural key from the identity provider: OIDC `iss` and `sub`. `id` stays
            -- the surrogate key every other table points at, so a change of provider never
            -- touches an Entry.
            ADD COLUMN issuer text,
            ADD COLUMN subject text,
            -- Checked text, not a Postgres ENUM: a CHECK can be replaced in one statement,
            -- while an ENUM value can never be dropped.
            ADD COLUMN role text NOT NULL DEFAULT 'pending',
            -- Display only. Never used for lookup: addresses change and get recycled.
            ADD COLUMN name text,
            ADD COLUMN email text,
            ADD CONSTRAINT users_role_known CHECK (role IN {ROLES}),
            -- Half an identity matches no sign-in, so it can only be a bug.
            ADD CONSTRAINT users_identity_both_or_neither
                CHECK ((issuer IS NULL) = (subject IS NULL)),
            -- NULLs are never equal in a UNIQUE, so any number of rows may have no identity.
            ADD CONSTRAINT users_issuer_subject_key UNIQUE (issuer, subject)
        """
    )

    op.execute(
        f"""
        CREATE TABLE role_changes (
            id uuid PRIMARY KEY DEFAULT uuidv7(),
            user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
            from_role text CHECK (from_role IN {ROLES}),
            to_role text NOT NULL CHECK (to_role IN {ROLES}),
            reason text NOT NULL CHECK (reason IN ('approve', 'set-role', 'claim-seeded')),
            changed_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    # Serves "this User's history", and the RESTRICT check on every User delete.
    op.execute("CREATE INDEX role_changes_user ON role_changes (user_id, changed_at)")
    # Append-only, enforced by the database rather than by convention: migration 0001's
    # default privileges granted UPDATE and DELETE, so take them back for this one table.
    op.execute("REVOKE UPDATE, DELETE ON role_changes FROM api_rw")


# No downgrade: we roll forward (ADR 0001).
