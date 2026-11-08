import {
  Button,
  Group,
  Input,
  Label,
  NumberField,
} from "react-aria-components";
import { Link, useLocation, useSearchParams } from "react-router";

import { CatalogComboBox } from "../catalog/CatalogComboBox";
import { exerciseCatalog, foodCatalog } from "../catalog/catalogs";
import { fieldClass, labelClass } from "../components/formStyles";
import { useToday } from "../lib/useToday";
import { DayResults } from "./DayResults";
import { LastSessions } from "./LastSessions";
import {
  MAX_LAST,
  parseSearch,
  toSearchParams,
  type RangeName,
  type SearchQuery,
  type View,
  type What,
} from "./searchQuery";
import { Segments } from "./Segments";

const WHATS = [
  { id: "exercise", label: "Exercise" },
  { id: "food", label: "Food" },
  { id: "all", label: "Everything" },
] as const satisfies readonly { id: What; label: string }[];

const RANGES = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "custom", label: "Custom" },
] as const satisfies readonly { id: RangeName; label: string }[];

const VIEWS = [
  { id: "days", label: "Date range" },
  { id: "sessions", label: "Last Sessions" },
] as const satisfies readonly { id: View; label: string }[];

const stepClass = "px-4 text-2xl text-teal-700 data-disabled:text-gray-300";

// The window the user came from, passed by the search icon's link.
function backTarget(state: unknown) {
  if (
    typeof state === "object" &&
    state !== null &&
    "back" in state &&
    typeof state.back === "string"
  ) {
    return state.back;
  }
  return "/exercise";
}

interface DayFieldProps {
  label: string;
  value: string;
  max: string;
  onChange: (day: string) => void;
}

function DayField({ label, value, max, onChange }: DayFieldProps) {
  return (
    <label className={labelClass}>
      {label}
      <input
        type="date"
        className={fieldClass}
        value={value}
        max={max}
        onChange={({ target }) => {
          // A picker's Clear button sends an empty value.
          if (target.value !== "") {
            onChange(target.value);
          }
        }}
      />
    </label>
  );
}

// ADR 0013: "I'm asking a question". Every choice lives in the URL, so this screen
// holds no state of its own, like the Day pager.
export function SearchScreen() {
  const [params, setParams] = useSearchParams();
  // location.state is `any`: whatever a link chose to pass. Read it as unknown.
  const state: unknown = useLocation().state;
  const today = useToday();
  const query = parseSearch(params, today);

  // Replace, not push: Back should leave Search, not undo each chip tap. The state
  // is passed on, or the Back link would forget where it leads.
  function update(change: Partial<SearchQuery>) {
    setParams(toSearchParams({ ...query, ...change }), {
      replace: true,
      state,
    });
  }

  const catalog = query.what === "exercise" ? exerciseCatalog : foodCatalog;
  const showSessions = query.view === "sessions" && query.item !== null;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header className="flex items-center gap-4">
        <Link className="text-teal-700 underline" to={backTarget(state)}>
          Back
        </Link>
        <h1 className="text-xl font-semibold">Search</h1>
      </header>

      <Segments
        label="What"
        options={WHATS}
        value={query.what}
        onChange={(what) => {
          update({ what, item: null, view: "days" });
        }}
      />

      {query.what !== "all" && (
        // A new key per kind: an Exercise's text must not linger as a Food search.
        <CatalogComboBox
          key={query.what}
          catalog={catalog}
          canCreate={false}
          value={query.item && { ...query.item, archived: false }}
          onChange={(item) => {
            update({
              item: item && { id: item.id, name: item.name },
              view: item === null ? "days" : query.view,
            });
          }}
        />
      )}

      {query.what === "exercise" && query.item !== null && (
        <Segments
          label="Show"
          options={VIEWS}
          value={query.view}
          onChange={(view) => {
            update({ view });
          }}
        />
      )}

      {showSessions ? (
        <NumberField
          className={labelClass}
          value={query.last}
          minValue={1}
          maxValue={MAX_LAST}
          onChange={(last) => {
            // Clearing the field gives NaN; keep the last count until a number.
            if (Number.isInteger(last)) {
              update({ last });
            }
          }}
        >
          <Label>Sessions</Label>
          <Group className="flex rounded-xl border border-gray-300 bg-white">
            <Button slot="decrement" className={stepClass}>
              −
            </Button>
            <Input className="w-full min-w-0 bg-transparent p-3 text-center text-base outline-none" />
            <Button slot="increment" className={stepClass}>
              +
            </Button>
          </Group>
        </NumberField>
      ) : (
        <>
          <Segments
            label="Range"
            options={RANGES}
            value={query.range}
            onChange={(range) => {
              update({ range });
            }}
          />
          {query.range === "custom" && (
            <div className="grid grid-cols-2 gap-2">
              <DayField
                label="From"
                value={query.from}
                max={today}
                onChange={(from) => {
                  update({ from });
                }}
              />
              <DayField
                label="To"
                value={query.to}
                max={today}
                onChange={(to) => {
                  update({ to });
                }}
              />
            </div>
          )}
        </>
      )}

      {query.what !== "all" && query.item === null ? (
        <p className="text-gray-500">
          Pick {query.what === "exercise" ? "an Exercise" : "a Food"} to see
          results.
        </p>
      ) : showSessions && query.item !== null ? (
        <LastSessions exerciseId={query.item.id} last={query.last} />
      ) : (
        // Remounted per question, so paging starts over at one screen of Days.
        <DayResults key={toSearchParams(query).toString()} query={query} />
      )}
    </main>
  );
}
