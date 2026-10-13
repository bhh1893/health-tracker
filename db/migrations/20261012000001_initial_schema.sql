-- migrate:up

CREATE TABLE foods (
  id         uuid PRIMARY KEY,
  name       text NOT NULL,
  basis      text NOT NULL CHECK (basis IN ('per_100g', 'per_item')),
  calories   numeric(8,2) NOT NULL CHECK (calories  >= 0),
  protein_g  numeric(8,2) NOT NULL CHECK (protein_g >= 0),
  fat_g      numeric(8,2) NOT NULL CHECK (fat_g     >= 0),
  carbs_g    numeric(8,2) NOT NULL CHECK (carbs_g   >= 0),
  archived   boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX foods_active_name ON foods (lower(name)) WHERE NOT archived;

CREATE TABLE meal_days (
  day date PRIMARY KEY
);

CREATE TABLE meals (
  id         uuid PRIMARY KEY,
  day        date NOT NULL REFERENCES meal_days(day),
  position   int  NOT NULL,
  label      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (day, position)
);

CREATE TABLE meal_items (
  id         uuid PRIMARY KEY,
  meal_id    uuid NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  food_id    uuid NOT NULL REFERENCES foods(id),
  food_name  text NOT NULL,                       -- snapshot
  quantity   numeric(8,2) NOT NULL CHECK (quantity > 0),
  unit       text NOT NULL DEFAULT 'g' CHECK (unit IN ('g', 'count')),
  calories   numeric(8,2) NOT NULL,               -- snapshot
  protein_g  numeric(8,2) NOT NULL,
  fat_g      numeric(8,2) NOT NULL,
  carbs_g    numeric(8,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meal_items_meal_id_idx ON meal_items (meal_id);

CREATE TABLE workouts (
  id         uuid PRIMARY KEY,
  started_at timestamptz NOT NULL,
  day        date NOT NULL,                       -- local date, from the offset the client sent
  ended_at   timestamptz,
  name       text,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX workouts_day_idx ON workouts (day);
CREATE INDEX workouts_open_idx ON workouts (started_at DESC) WHERE ended_at IS NULL;

CREATE TABLE sets (
  id           uuid PRIMARY KEY,
  workout_id   uuid NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  position     int  NOT NULL,
  exercise     text NOT NULL,                     -- as typed
  exercise_key text NOT NULL,                     -- lower(trim(exercise)), for grouping
  weight_lbs   numeric(6,2) NOT NULL CHECK (weight_lbs >= 0),
  reps         int NOT NULL CHECK (reps >= 1),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workout_id, position)
);
CREATE INDEX sets_exercise_key_idx ON sets (exercise_key, created_at);

-- migrate:down

DROP TABLE sets;
DROP TABLE workouts;
DROP TABLE meal_items;
DROP TABLE meals;
DROP TABLE meal_days;
DROP TABLE foods;
