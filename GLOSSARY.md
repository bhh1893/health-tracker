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
A numbered, optionally labelled eating occasion within a Day. Holds either Food Entries or exactly one Restaurant, never both.
_Avoid_: Breakfast/lunch/dinner as identifiers (they are only labels)

**Session**:
All Exercise Entries for one Exercise on one Day. Derived, never started or ended by the user.
_Avoid_: Workout (a workout spans several Exercises)

## Catalogs

**Food Catalog**:
The user's growing list of distinct Foods. Every Food Entry refers to one Food in it.
_Avoid_: Food list

**Exercise Catalog**:
The user's growing list of distinct strength Exercises. Every Exercise Entry refers to one Exercise in it.
_Avoid_: Movement list

**Restaurant Catalog**:
The user's growing list of distinct Restaurants. A restaurant Meal refers to one Restaurant in it.
_Avoid_: Place, venue

**Archived**:
A Catalog item hidden from suggestions because the user no longer wants it offered, while past Entries that refer to it keep showing it.
_Avoid_: Deleted, removed

## People

**User**:
A person with an account. Owns their own Catalogs and Entries; no User sees another's.
_Avoid_: Client, client ID (those name the app, not a person), account holder

**Role**:
What a User may do. Every User has exactly one: Admin, Member or Pending.
_Avoid_: Permission, access level, access row

**Sign-up**:
A person's first sign-in, which creates their User as Pending.
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
