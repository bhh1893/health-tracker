---
status: accepted
---

# Color scheme: green is Food, pink is Restaurant, brown is everything else, as named tokens

`web` moves from teal on white to four colors: pink, green, cream white and brown. Each color has a meaning, so a glance says what a thing is about. Every color is a design token (a named variable for a role) defined once in `services/web/src/index.css`. It amends ADR 0024, ADR 0031 and ADR 0033, whose teal, white and orange are replaced, and the orange Restaurant name in ADR 0008.

## Shape

### What each color means

- **Green is Food:** Add Food, the Food Meal sheet's Add and Save, the Day total, the calories line.
- **Pink is Restaurant:** Add Restaurant, the Restaurant Meal sheet's Add and Save, Restaurant names, the "ate out" pill and chart point, a Restaurant Day's total. It takes over from orange.
- **Brown is everything else:** text, links, icons, the bottom bar, Exercise and its chart lines, and Profile. Managing a Catalog is brown even for Foods and Restaurants: green and pink mark logging and what was logged.
- **Cream white** is the page, with lighter cards on it.
- **Tan,** a light brown, flags a total to read with care (Incomplete, missing Nutrition) and marks a filter's matches. It takes over from amber and yellow.
- **Red is Delete, Sign out and errors only,** a dark brick kept well away from pink.

### Palette (2026-11-28)

The owner picked five colors, each with the text color that goes on it:

| Color | Fill | Text on it | Tokens | Used for |
| --- | --- | --- | --- | --- |
| Brown | `#8b6a5b` | `#ffffff` | `action`, `on-fill` | buttons (including Recent Days' arrow), borders, icons, the Exercise chart line, `theme-color` |
| Pink | `#eed9d4` | `#7d5556` | `restaurant`, `restaurant-soft`, `restaurant-ink`, `on-restaurant` | Restaurant buttons, names, the "ate out" badge and section, and Recent Days' Day rows (an exception: there pink is the list's color, not a Restaurant mark) |
| Cream | `#f6efe9` | `#79685f` | `page`, `ink`, `muted`, `faint`, `action-ink` | the page and all plain text; cards are white |
| Green | `#c0c9b4` | `#454f34` | `food`, `on-food` | Food buttons |
| Ivory | `#e8ddcb` | `#66563f` | `inset`, `action-soft`, `on-inset` | toggles, stat tiles, the selected tab |

The owner's brown text `#ffebe0` was 4.22:1 on the brown, under AA, so text on brown is white (4.87:1) by the owner's choice. Every colored surface sets its own text color: the cream text color falls under 4.5:1 on ivory, pink and green. Derived, not in the palette: `card` white, the `edge` and `field` lines, `disabled`, `action-pressed`, `food-soft` `#e7ebe1` (a lighter green for the Day total) and the chart's Restaurant point `#b86d7a`. Tan (warnings, filter matches) and red are unchanged.

### Tokens

- **Named for the role, not the hue:** `bg-restaurant`, not `bg-pink`. A new palette changes one block in `index.css` and no component.
- **Tailwind's own palette is removed** (`--color-*: initial`), so a class such as `bg-teal-700` produces nothing and cannot bypass the scheme unnoticed.
- **The chart reads the same tokens** as CSS variables. A chart says what it measures (`food` or `exercise`), and that picks its line color.
- **Three copies stay outside:** `index.html`'s `theme-color` and the web manifest's colors. The browser reads both before any CSS, so they repeat the brown and the cream by hand. The icon (`favicon.svg` and the PNGs rendered from it) repeats the earlier Food green, on the earlier Restaurant badge's light pink (not yet moved to the 2026-11-28 palette), because an SVG loaded as an image cannot read the page's CSS variables. It is a logo, so there the two colors carry no meaning (amended 2026-11-25).

### Contrast

Text is at least 4.5:1 on every background it sits on, and chart marks at least 3:1 on a card (WCAG AA). ADR 0024's "never color alone" holds: green and pink are hard to tell apart for some people, so the buttons keep their words, Restaurants keep the fork and knife, the chart keeps its legend and table, and the line and the point differ in lightness. Disabled buttons are exempt, as WCAG allows.

## Considered Options

- **One lead color (A, green, or B, rose), the others as accents.** Not chosen: simpler, but color would say nothing. B also puts a rose Save beside a red Delete.
- **A pink page with brown buttons and bar (C).** Not chosen: the boldest, and tiring on a screen opened many times a day.
- **Replace the Tailwind classes in place** (`teal-700` to `green-800`). Rejected: the colors stay spread over some 50 files, and the role of each is lost, so the next change is as large as this one.

## Consequences

- Home has two equally strong buttons. Both are common actions, so neither leads.
- A new component must ask what it is about (Food, Restaurant or neither) before picking a color.
- An unknown color class fails silently: the element has no color instead of failing the build. Review and a look at the screen catch it.
- A dark theme later means a second set of values for the same tokens.
