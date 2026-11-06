"""The Catalog endpoints on real Postgres, as the limited role `api` uses (ADR 0006)."""

from typing import Any
from uuid import UUID, uuid4, uuid7

import pytest
from fastapi.testclient import TestClient
from name_pairs import (
    ACCEPTED_FALSE_ALARMS,
    ACCEPTED_MISSES,
    ACCEPTED_TYPEAHEAD_NOISE,
    FLAGGED_NEAR_DUPLICATES,
    NOT_FLAGGED,
    TYPEAHEAD_MATCHES,
    TYPEAHEAD_NON_MATCHES,
)
from sqlalchemy import text
from sqlalchemy.orm import Session

import health_api.catalogs as catalogs
from health_api.catalogs import MAX_NAME_LENGTH, SIMILARITY_THRESHOLD, WORD_SIMILARITY_THRESHOLD
from health_api.identity import SEEDED_USER_ID
from health_api.problems import (
    EXACT_DUPLICATE,
    ITEM_IN_USE,
    NEAR_DUPLICATE,
    PROBLEM_MEDIA_TYPE,
)

TABLES = ["foods", "exercises", "restaurants"]
every_catalog = pytest.mark.parametrize("table", TABLES)


def url(table: str, item: UUID | None = None) -> str:
    return f"/api/v1/{table}" + (f"/{item}" if item else "")


def create(client: TestClient, table: str, name: str, **body: Any) -> UUID:
    item = uuid7()
    response = client.put(url(table, item), json={"name": name, "allow_similar": True, **body})
    assert response.status_code == 201, response.text
    return item


def names(client: TestClient, table: str, **params: Any) -> list[str]:
    response = client.get(url(table), params=params)
    assert response.status_code == 200, response.text
    return [item["name"] for item in response.json()]


def insert_meal(session: Session, day: str, restaurant: UUID | None = None) -> UUID:
    return session.execute(
        text(
            """
            INSERT INTO meals (user_id, kind, restaurant_id, occurred_at, occurred_tz, day)
            VALUES (:user, :kind, :restaurant, :at, 'UTC', :day)
            RETURNING id
            """
        ),
        {
            "user": SEEDED_USER_ID,
            "kind": "restaurant" if restaurant else "foods",
            "restaurant": restaurant,
            "at": f"{day}T12:00:00+00:00",
            "day": day,
        },
    ).scalar_one()


def use_food(
    session: Session, food: UUID, day: str, quantity: float = 100, unit: str = "g"
) -> None:
    session.execute(
        text(
            """
            INSERT INTO food_entries (user_id, meal_id, food_id, quantity, unit)
            VALUES (:user, :meal, :food, :quantity, :unit)
            """
        ),
        {
            "user": SEEDED_USER_ID,
            "meal": insert_meal(session, day),
            "food": food,
            "quantity": quantity,
            "unit": unit,
        },
    )


def use_exercise(session: Session, exercise: UUID, day: str) -> None:
    session.execute(
        text(
            """
            INSERT INTO exercise_entries (user_id, exercise_id, reps, occurred_at, occurred_tz, day)
            VALUES (:user, :exercise, 5, :at, 'UTC', :day)
            """
        ),
        {
            "user": SEEDED_USER_ID,
            "exercise": exercise,
            "at": f"{day}T12:00:00+00:00",
            "day": day,
        },
    )


def use(session: Session, table: str, item: UUID, day: str) -> None:
    if table == "foods":
        use_food(session, item, day)
    elif table == "exercises":
        use_exercise(session, item, day)
    else:
        insert_meal(session, day, restaurant=item)


def someone_elses(session: Session, table: str, name: str) -> UUID:
    owner = session.execute(text("INSERT INTO users DEFAULT VALUES RETURNING id")).scalar_one()
    return session.execute(
        text(f"INSERT INTO {table} (user_id, name) VALUES (:owner, :name) RETURNING id"),
        {"owner": owner, "name": name},
    ).scalar_one()


def test_current_user_is_the_seeded_row(session: Session) -> None:
    ids = session.execute(text("SELECT id FROM users")).scalars().all()

    assert ids == [SEEDED_USER_ID]


@every_catalog
def test_put_creates_then_a_retry_changes_nothing(
    client: TestClient, session: Session, table: str
) -> None:
    item = uuid7()

    first = client.put(url(table, item), json={"name": "Thing"})
    stamped = text(f"SELECT updated_at FROM {table} WHERE id = :id")
    updated_at = session.execute(stamped, {"id": item}).scalar_one()
    retry = client.put(url(table, item), json={"name": "Thing"})

    assert first.status_code == 201
    assert first.json()["id"] == str(item)
    assert first.json()["name"] == "Thing"
    assert first.json()["archived"] is False
    assert retry.status_code == 200
    assert retry.json() == first.json()
    assert session.execute(stamped, {"id": item}).scalar_one() == updated_at


@every_catalog
def test_put_replaces_the_name(client: TestClient, table: str) -> None:
    item = create(client, table, "Before")

    response = client.put(url(table, item), json={"name": "Completely different"})

    assert response.status_code == 200
    assert client.get(url(table, item)).json()["name"] == "Completely different"


def test_put_may_change_only_the_case_of_its_own_name(client: TestClient) -> None:
    item = create(client, "foods", "oats")

    response = client.put(url("foods", item), json={"name": "Oats"})

    assert response.status_code == 200
    assert response.json()["name"] == "Oats"


def test_put_rejects_an_id_that_is_not_uuid7(client: TestClient) -> None:
    response = client.put(url("foods", uuid4()), json={"name": "Oats"})

    assert response.status_code == 422
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE


def test_put_trims_and_collapses_whitespace(client: TestClient) -> None:
    response = client.put(url("foods", uuid7()), json={"name": "  Greek \t  yogurt\n"})

    assert response.json()["name"] == "Greek yogurt"


@pytest.mark.parametrize(
    "body",
    [
        {"name": "   "},
        {"name": "nul\x00byte"},
        {"name": "x" * (MAX_NAME_LENGTH + 1)},
        {"name": "Oats", "user_id": str(SEEDED_USER_ID)},
        {},
    ],
    ids=["blank", "nul", "too-long", "unknown-field", "missing"],
)
def test_put_rejects_bad_bodies_as_field_errors(client: TestClient, body: dict[str, Any]) -> None:
    response = client.put(url("foods", uuid7()), json=body)

    assert response.status_code == 422
    assert response.json()["errors"]


def test_a_lone_surrogate_is_a_422_not_a_driver_error(client: TestClient) -> None:
    response = client.put(
        url("foods", uuid7()),
        content=b'{"name": "\\ud800"}',
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 422


def test_the_longest_allowed_name_fits_the_unique_index(client: TestClient) -> None:
    create(client, "foods", "\U0001f34e" * MAX_NAME_LENGTH)


@every_catalog
def test_exact_duplicate_returns_the_existing_item(client: TestClient, table: str) -> None:
    existing = create(client, table, "Greek Yogurt")

    response = client.put(url(table, uuid7()), json={"name": "greek yogurt", "allow_similar": True})

    assert response.status_code == 409
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.json()["type"] == EXACT_DUPLICATE
    assert response.json()["existing"] == {
        "id": str(existing),
        "name": "Greek Yogurt",
        "archived": False,
    }


def test_exact_duplicate_of_an_archived_item_says_so(client: TestClient) -> None:
    existing = create(client, "foods", "Oats")
    client.patch(url("foods", existing), json={"archived": True})

    response = client.put(url("foods", uuid7()), json={"name": "Oats"})

    assert response.status_code == 409
    assert response.json()["existing"]["archived"] is True


def test_losing_the_race_to_the_unique_index_is_the_same_409(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The check sees nothing, as it would if the other request had not committed yet."""
    existing = create(client, "foods", "Oats")
    real_find_exact = catalogs.find_exact
    calls: list[None] = []

    def blind_the_first_time(*args: Any) -> Any:
        calls.append(None)
        return None if len(calls) == 1 else real_find_exact(*args)

    monkeypatch.setattr(catalogs, "find_exact", blind_the_first_time)

    response = client.put(url("foods", uuid7()), json={"name": "Oats", "allow_similar": True})

    assert response.status_code == 409
    assert response.json()["type"] == EXACT_DUPLICATE
    assert response.json()["existing"]["id"] == str(existing)


@every_catalog
def test_near_duplicate_lists_similar_then_allow_similar_creates(
    client: TestClient, table: str
) -> None:
    existing = create(client, table, "Chicken breast")
    item = uuid7()

    refused = client.put(url(table, item), json={"name": "Chicken breasts"})
    allowed = client.put(url(table, item), json={"name": "Chicken breasts", "allow_similar": True})

    assert refused.status_code == 409
    assert refused.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert refused.json()["type"] == NEAR_DUPLICATE
    assert refused.json()["similar"] == [
        {"id": str(existing), "name": "Chicken breast", "archived": False}
    ]
    assert allowed.status_code == 201


def test_a_pair_below_the_threshold_is_not_a_near_duplicate(client: TestClient) -> None:
    """Scores 0.38: Postgres's default of 0.3 would flag it, so this proves SET LOCAL works."""
    create(client, "foods", "Chicken breast")

    response = client.put(url("foods", uuid7()), json={"name": "Chicken thigh"})

    assert response.status_code == 201


def test_near_duplicate_includes_archived_items(client: TestClient) -> None:
    existing = create(client, "foods", "Eggs")
    client.patch(url("foods", existing), json={"archived": True})

    response = client.put(url("foods", uuid7()), json={"name": "Egg"})

    assert response.json()["similar"][0]["archived"] is True


def test_an_item_is_not_a_near_duplicate_of_itself(client: TestClient) -> None:
    item = create(client, "foods", "Chicken breast")

    response = client.put(url("foods", item), json={"name": "Chicken breasts"})

    assert response.status_code == 200


def test_catalogs_are_separate(client: TestClient) -> None:
    create(client, "foods", "Pull up")

    create(client, "exercises", "Pull up")


@every_catalog
def test_patch_renames(client: TestClient, table: str) -> None:
    item = create(client, table, "Before")

    response = client.patch(url(table, item), json={"name": "Completely different"})

    assert response.status_code == 200
    assert response.json()["name"] == "Completely different"


def test_patch_rename_onto_an_existing_name_conflicts(client: TestClient) -> None:
    create(client, "foods", "Oats")
    item = create(client, "foods", "Rice")

    response = client.patch(url("foods", item), json={"name": "oats"})

    assert response.status_code == 409
    assert response.json()["type"] == EXACT_DUPLICATE


def test_patch_rename_near_a_name_needs_allow_similar(client: TestClient) -> None:
    create(client, "foods", "Chicken breast")
    item = create(client, "foods", "Rice")

    refused = client.patch(url("foods", item), json={"name": "Chicken breasts"})
    allowed = client.patch(
        url("foods", item), json={"name": "Chicken breasts", "allow_similar": True}
    )

    assert refused.json()["type"] == NEAR_DUPLICATE
    assert allowed.status_code == 200


@every_catalog
def test_archive_hides_from_suggestions_and_unarchive_restores(
    client: TestClient, table: str
) -> None:
    item = create(client, table, "Thing")

    archived = client.patch(url(table, item), json={"archived": True})
    assert archived.json()["archived"] is True
    assert names(client, table) == []
    assert names(client, table, q="Thi") == []
    assert names(client, table, include_archived=True) == ["Thing"]
    assert names(client, table, q="Thi", include_archived=True) == ["Thing"]

    restored = client.patch(url(table, item), json={"archived": False})
    assert restored.json()["archived"] is False
    assert names(client, table) == ["Thing"]


def test_archiving_twice_keeps_the_first_timestamp(client: TestClient, session: Session) -> None:
    item = create(client, "foods", "Oats")
    stamped = text("SELECT archived_at FROM foods WHERE id = :id")

    client.patch(url("foods", item), json={"archived": True})
    first = session.execute(stamped, {"id": item}).scalar_one()
    client.patch(url("foods", item), json={"archived": True})

    assert session.execute(stamped, {"id": item}).scalar_one() == first


def test_an_empty_patch_changes_nothing(client: TestClient) -> None:
    item = create(client, "foods", "Oats")

    response = client.patch(url("foods", item), json={})

    assert response.status_code == 200
    assert response.json()["name"] == "Oats"


@every_catalog
def test_delete_removes_a_never_used_item(client: TestClient, table: str) -> None:
    item = create(client, table, "Thing")

    response = client.delete(url(table, item))

    assert response.status_code == 204
    assert client.get(url(table, item)).status_code == 404


@every_catalog
def test_delete_of_a_missing_item_succeeds(client: TestClient, table: str) -> None:
    assert client.delete(url(table, uuid7())).status_code == 204


@every_catalog
def test_delete_of_a_used_item_suggests_archive(
    client: TestClient, session: Session, table: str
) -> None:
    item = create(client, table, "Thing")
    use(session, table, item, "2026-11-01")

    response = client.delete(url(table, item))

    assert response.status_code == 409
    assert response.json()["type"] == ITEM_IN_USE
    assert "Archive" in response.json()["detail"]
    assert client.get(url(table, item)).status_code == 200


@every_catalog
def test_another_users_item_looks_missing(client: TestClient, session: Session, table: str) -> None:
    theirs = someone_elses(session, table, "Theirs")

    assert client.get(url(table, theirs)).status_code == 404
    assert client.patch(url(table, theirs), json={"archived": True}).status_code == 404
    assert client.put(url(table, theirs), json={"name": "Mine now"}).status_code == 404
    assert client.delete(url(table, theirs)).status_code == 204
    assert names(client, table, include_archived=True) == []
    assert names(client, table, q="Theirs", include_archived=True) == []
    row = text(f"SELECT name, archived_at FROM {table} WHERE id = :id")
    assert tuple(session.execute(row, {"id": theirs}).one()) == ("Theirs", None)


def test_another_users_names_are_not_duplicates(client: TestClient, session: Session) -> None:
    someone_elses(session, "foods", "Oats")

    response = client.put(url("foods", uuid7()), json={"name": "Oats"})

    assert response.status_code == 201


def test_get_of_a_missing_item_is_a_problem(client: TestClient) -> None:
    response = client.get(url("foods", uuid7()))

    assert response.status_code == 404
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.json()["detail"] == "Food not found."


def test_typeahead_ranks_prefix_matches_above_fuzzy_ones(client: TestClient) -> None:
    for name in ("Goat cheese", "Oat milk", "Oatmeal"):
        create(client, "foods", name)

    assert names(client, "foods", q="oat") == ["Oat milk", "Oatmeal", "Goat cheese"]


def test_typeahead_tolerates_typos(client: TestClient) -> None:
    create(client, "foods", "Chicken breast")

    assert names(client, "foods", q="chiken") == ["Chicken breast"]


def test_typeahead_is_prefix_only_under_three_characters(client: TestClient) -> None:
    for name in ("Goat cheese", "Oatmeal"):
        create(client, "foods", name)

    assert names(client, "foods", q="oa") == ["Oatmeal"]


@pytest.mark.parametrize("q", ["%", "_", "\\", "%%%", "o_ts"])
def test_typeahead_treats_like_wildcards_as_text(client: TestClient, q: str) -> None:
    create(client, "foods", "Oats")

    assert names(client, "foods", q=q) == []


def test_typeahead_finds_a_literal_percent(client: TestClient) -> None:
    create(client, "foods", "2% milk")
    create(client, "foods", "2 eggs")

    assert names(client, "foods", q="2%") == ["2% milk"]


def test_typeahead_respects_limit(client: TestClient) -> None:
    for name in ("Apple", "Apricot jam", "Aperol"):
        create(client, "foods", name)

    assert names(client, "foods", q="ap", limit=2) == ["Aperol", "Apple"]


@pytest.mark.parametrize(
    "params", [{"limit": 0}, {"limit": 51}, {"q": "x" * 201}, {"q": "nul\x00byte"}]
)
def test_suggest_rejects_bad_parameters(client: TestClient, params: dict[str, Any]) -> None:
    assert client.get(url("foods"), params=params).status_code == 422


@every_catalog
@pytest.mark.parametrize("q", ["", "   "])
def test_empty_q_lists_recently_used_then_the_rest_by_name(
    client: TestClient, session: Session, table: str, q: str
) -> None:
    older = create(client, table, "Older")
    newer = create(client, table, "Newer")
    create(client, table, "Zebra")
    create(client, table, "Aardvark")
    use(session, table, older, "2026-10-01")
    use(session, table, newer, "2026-11-01")
    # A second use, of the older item, that is still older than the newest use overall.
    use(session, table, older, "2026-10-15")

    assert names(client, table, q=q) == ["Newer", "Older", "Aardvark", "Zebra"]
    assert names(client, table, q=q, limit=1) == ["Newer"]


def test_foods_carry_their_newest_unit_and_quantity(client: TestClient, session: Session) -> None:
    food = create(client, "foods", "Oats")
    use_food(session, food, "2026-11-01", quantity=2, unit="count")
    use_food(session, food, "2026-11-02", quantity=80.5, unit="g")
    use_food(session, food, "2026-10-01", quantity=999, unit="g")

    read = client.get(url("foods", food)).json()
    suggested = client.get(url("foods"), params={"q": "oat"}).json()[0]
    recent = client.get(url("foods")).json()[0]

    assert (read["last_unit"], read["last_quantity"]) == ("g", 80.5)
    assert suggested == read
    assert recent == read


def test_a_never_used_food_has_no_last_values(client: TestClient) -> None:
    food = create(client, "foods", "Oats")

    read = client.get(url("foods", food)).json()

    assert read["last_unit"] is None
    assert read["last_quantity"] is None


@pytest.mark.parametrize("table", ["exercises", "restaurants"])
def test_other_catalogs_have_no_last_values(client: TestClient, table: str) -> None:
    item = create(client, table, "Thing")

    assert set(client.get(url(table, item)).json()) == {"id", "name", "archived"}


def test_the_fuzzy_operators_use_the_trigram_index(session: Session) -> None:
    """Why the code uses `<%` and `%`: a function call in WHERE could not reach this index."""
    session.execute(text("SET LOCAL enable_seqscan = off"))

    for predicate in ("lower('oat') <% lower(name)", "lower(name) % lower('oat')"):
        plan = session.execute(text(f"EXPLAIN SELECT id FROM foods WHERE {predicate}")).scalars()

        assert "foods_name_trgm" in "\n".join(plan)


def similarity(session: Session, left: str, right: str) -> float:
    return session.execute(
        text("SELECT similarity(:left, :right)"), {"left": left, "right": right}
    ).scalar_one()


def word_similarity(session: Session, typed: str, name: str) -> float:
    return session.execute(
        text("SELECT word_similarity(:typed, :name)"), {"typed": typed, "name": name}
    ).scalar_one()


@pytest.mark.parametrize(("left", "right"), FLAGGED_NEAR_DUPLICATES + ACCEPTED_FALSE_ALARMS)
def test_pairs_flagged_on_create(session: Session, left: str, right: str) -> None:
    assert similarity(session, left, right) >= SIMILARITY_THRESHOLD


@pytest.mark.parametrize(("left", "right"), NOT_FLAGGED + ACCEPTED_MISSES)
def test_pairs_not_flagged_on_create(session: Session, left: str, right: str) -> None:
    assert similarity(session, left, right) < SIMILARITY_THRESHOLD


@pytest.mark.parametrize(("typed", "name"), TYPEAHEAD_MATCHES + ACCEPTED_TYPEAHEAD_NOISE)
def test_pairs_matched_while_typing(session: Session, typed: str, name: str) -> None:
    assert word_similarity(session, typed, name) >= WORD_SIMILARITY_THRESHOLD


@pytest.mark.parametrize(("typed", "name"), TYPEAHEAD_NON_MATCHES)
def test_pairs_not_matched_while_typing(session: Session, typed: str, name: str) -> None:
    assert word_similarity(session, typed, name) < WORD_SIMILARITY_THRESHOLD
