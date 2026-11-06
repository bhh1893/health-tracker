"""The name pairs the fuzzy thresholds were tuned on (ADR 0012).

Each list states what the query does today, wrong answers included, so changing a threshold
shows exactly which pairs move. The "accepted" groups are known errors, not goals.
"""

# (one name, the other name), compared with similarity() on create.
FLAGGED_NEAR_DUPLICATES = [
    ("greek yogurt", "yogurt greek"),
    ("pull up", "pull-up"),
    ("chicken breast", "chicken breasts"),
    ("dumbbell row", "dumbell row"),
    ("bench press", "bench pres"),
    ("banana", "bananna"),
    ("chicken breast", "chiken breast"),
    ("greek yogurt", "greek yoghurt"),
    ("bagel", "bagels"),
    ("mcdonald's", "mcdonalds"),
    ("tomato", "tomatoes"),
    # The pairs that decided 0.5 over 0.6: short names lose most from one extra letter.
    ("kale", "kales"),
    ("rice", "rices"),
    ("egg", "eggs"),
    ("oats", "oat"),
    ("pullup", "pull up"),
]
# Different things that get flagged anyway. Cost: one tap on the "Did you mean?" dialog.
ACCEPTED_FALSE_ALARMS = [
    ("bench press", "incline bench press"),
    ("2% milk", "1% milk"),
    ("chicken breast", "chicken"),
    ("squat", "front squat"),
    ("apple", "apple juice"),
    ("deadlift", "romanian deadlift"),
]
NOT_FLAGGED = [
    ("taco bell", "taco bueno"),
    ("chicken breast", "chicken thigh"),
    ("back squat", "front squat"),
    ("peanut butter", "almond butter"),
    ("almond milk", "oat milk"),
    ("whole milk", "skim milk"),
    ("oats", "oatmeal"),
    ("brown rice", "white rice"),
    ("whole milk", "whole wheat bread"),
]
# A real duplicate that is missed. A swap of two letters breaks three trigrams at once, and
# reaching this one would flag "chicken thigh" too. Typeahead still finds it while typing.
ACCEPTED_MISSES = [("chipotle", "chipolte")]

# (what is typed, the Catalog name), compared with word_similarity() while typing.
TYPEAHEAD_MATCHES = [
    ("milk", "whole milk"),
    ("breast", "chicken breast"),
    ("butter", "peanut butter"),
    ("rice", "brown rice"),
    ("press", "incline bench press"),
    ("buter", "peanut butter"),
    ("chik", "chicken breast"),
    ("chiken", "chicken breast"),
    ("brest", "chicken breast"),
    ("dedlift", "deadlift"),
    ("yoghurt", "greek yogurt"),
]
# Matches that are noise. Harmless: prefix matches and higher scores rank above them.
ACCEPTED_TYPEAHEAD_NOISE = [
    ("milk", "millet"),
    ("oat", "goat cheese"),
    ("ham", "graham cracker"),
]
TYPEAHEAD_NON_MATCHES = [("squat", "apple")]
