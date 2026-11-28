# Health Tracker

Personal log of what the user ate and which strength exercises they did, queryable by day.

## Entries

**Entry**:
One logged record of something the user ate or did. Either a Food Entry or an Exercise Entry.
_Avoid_: Log, post, record

**Food Entry**:
A quantity of one Food, in grams or a count, eaten as part of a Meal.
_Avoid_: Food item, ingredient

**Exercise Entry**:
One Set of one Exercise: reps, and weight in pounds of external load (none for pure bodyweight).
_Avoid_: Workout, set log

**Occurred At**:
The moment the eating or exercise actually happened. Editable by the user. Food Entries share their Meal's Occurred At.
_Avoid_: Timestamp, date

**Logged At**:
The moment the system received the Entry. Set by the server, never edited.
_Avoid_: Created, submitted

**Day**:
The calendar date at an Occurred At, in the timezone the user was in at that moment. Fixed once logged, even if the user later travels. The unit all queries are asked in.
_Avoid_: Date (ambiguous across timezones)

## Groupings

**Meal**:
A numbered, optionally labelled eating occasion within a Day. Holds either Food Entries or one to ten Restaurants, never both.
_Avoid_: Breakfast/lunch/dinner as identifiers (they are only labels)

**Session**:
All Exercise Entries for one Exercise on one Day. Derived, never started or ended by the user.
_Avoid_: Workout (a workout spans several Exercises)

**Meal Photo**:
A picture the user attached to one of their Meals, kept only as part of that Meal's record. A Meal of either kind holds up to ten. Private to its owner, and deleted with its Meal.
_Avoid_: Image, upload, attachment

## Catalogs

**Food Catalog**:
The user's growing list of distinct Foods. Every Food Entry refers to one Food in it.
_Avoid_: Food list

**Exercise Catalog**:
The user's growing list of distinct strength Exercises. Every Exercise Entry refers to one Exercise in it.
_Avoid_: Movement list

**Restaurant Catalog**:
The user's growing list of distinct Restaurants. A Restaurant Meal refers to one or more Restaurants in it.
_Avoid_: Place, venue

**Archived**:
A Catalog item hidden from suggestions because the user no longer wants it offered, while past Entries that refer to it keep showing it.
_Avoid_: Deleted, removed

## Nutrition

**Nutrition**:
A Food's calories, protein, carbs and fat for its Basis. Optional, but all four or none.
_Avoid_: Macros (excludes calories), nutrition facts

**Basis**:
The amount in grams that a Food's Nutrition describes, as printed on its label (often 100 g or one serving).
_Avoid_: Serving size, portion

**Piece Weight**:
The grams in one item of a Food, which turns a count into grams.
_Avoid_: Unit weight, serving

**Reference Food**:
A Food-like item in a list the owner curates, used only to copy Nutrition and Piece Weight into a User's own Food. Never logged directly, never owned by a User.
_Avoid_: Shared Food, public Food, template

**Day Total**:
The calories and macros of a Day, summed from its Food Entries using each Food's current Nutrition. Never stored.
_Avoid_: Daily intake, summary

**Restaurant Day**:
A Day with at least one Restaurant Meal. Its calories are the User's flat Restaurant Day value whatever else was logged, and its macros are unknown.
_Avoid_: Cheat day, off-plan day

**Incomplete Day**:
A Day whose total leaves out some Food Entries, because their Food has no Nutrition or a counted Food has no Piece Weight. A Restaurant Day is never incomplete.
_Avoid_: Partial day, missing day

## People

**User**:
A person with an account. Owns their own Catalogs and Entries; no User sees another's.
_Avoid_: Client, client ID (those name the app, not a person), account holder

**Role**:
What a User may do. Every User has exactly one: Admin, Member or Pending.
_Avoid_: Permission, access level, access row

**Sign-up**:
A person's first sign-in, which creates their User as Pending. Open to anyone with a Google account unless the Admin has closed it; while closed, no new User is created and existing Users are unaffected.
_Avoid_: Registration, account creation

**Approval**:
An Admin changing a Pending User to Member.
_Avoid_: Activation, verification

**Pending**:
The Role every new User starts with. Signed up but not yet approved; can do nothing but wait.
_Avoid_: None, unverified, inactive

**Member**:
A User approved to log and query their own Entries.
_Avoid_: User (as a Role name; User is the person)

**Admin**:
The owner. Approves Users by changing their Role.
_Avoid_: Superuser, root
