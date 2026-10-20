-- migrate:up

CREATE TABLE exercises (
  id          uuid PRIMARY KEY,
  name        text NOT NULL,
  muscle_area text,                                -- free-text note, no validation
  archived    boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX exercises_active_name ON exercises (lower(name)) WHERE NOT archived;

-- Carry over existing sets: one exercise per distinct old exercise_key.
CREATE TEMP TABLE exercise_map AS
SELECT DISTINCT ON (exercise_key)
       exercise_key,
       gen_random_uuid() AS id,
       regexp_replace(btrim(exercise), '\s+', ' ', 'g') AS name
FROM sets
ORDER BY exercise_key, created_at;

INSERT INTO exercises (id, name) SELECT id, name FROM exercise_map;

ALTER TABLE sets ADD COLUMN exercise_id uuid REFERENCES exercises(id);

UPDATE sets s
SET exercise_id = m.id
FROM exercise_map m
WHERE m.exercise_key = s.exercise_key;

ALTER TABLE sets ALTER COLUMN exercise_id SET NOT NULL;
CREATE INDEX sets_exercise_idx ON sets (exercise_id);

DROP INDEX sets_exercise_key_idx;
ALTER TABLE sets DROP COLUMN exercise, DROP COLUMN exercise_key;
DROP TABLE exercise_map;

-- migrate:down

ALTER TABLE sets ADD COLUMN exercise text, ADD COLUMN exercise_key text;

UPDATE sets s
SET exercise = e.name, exercise_key = lower(e.name)
FROM exercises e
WHERE e.id = s.exercise_id;

ALTER TABLE sets ALTER COLUMN exercise SET NOT NULL, ALTER COLUMN exercise_key SET NOT NULL;
CREATE INDEX sets_exercise_key_idx ON sets (exercise_key, created_at);

DROP INDEX sets_exercise_idx;
ALTER TABLE sets DROP COLUMN exercise_id;
DROP TABLE exercises;
