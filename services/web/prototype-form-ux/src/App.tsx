// PROTOTYPE, throwaway (issue #14).
// Three structurally different ways to log an Entry on a phone, switchable via ?variant=A|B|C.
// Saved Entries live in memory only and are shared across variants so you can compare.
import { useEffect, useState } from "react";
import { seedSaved, type Saved } from "./stub";
import { Switcher } from "./Switcher";
import { VariantA } from "./VariantA";
import { VariantB } from "./VariantB";
import { VariantC } from "./VariantC";
import { VariantD } from "./VariantD";

export type VariantProps = {
  saved: Saved[];
  onSave: (s: Saved) => void;
  // Edit = PUT the same id again (replace); delete = DELETE (next is null). ADR 0006.
  onReplace: (id: string, next: Saved | null) => void;
};

const VARIANTS = [
  { key: "A", name: "One form", C: VariantA },
  { key: "B", name: "Step by step", C: VariantB },
  { key: "C", name: "Day feed + sheet", C: VariantC },
  { key: "D", name: "C + two windows", C: VariantD },
];

const idOf = (s: Saved) => (s.type === "set" ? s.set.id : s.meal.id);

export default function App() {
  const read = () => new URLSearchParams(location.search).get("variant") ?? "A";
  const [variant, setVariant] = useState(read);
  const [saved, setSaved] = useState<Saved[]>(seedSaved);

  useEffect(() => {
    const onPop = () => setVariant(read());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  const go = (key: string) => {
    history.replaceState(null, "", `?variant=${key}`);
    setVariant(key);
  };

  const current = VARIANTS.find((v) => v.key === variant) ?? VARIANTS[0];
  const V = current.C;
  return (
    <>
      <V
        key={current.key}
        saved={saved}
        onSave={(s) => setSaved((xs) => [...xs, s])}
        onReplace={(id, next) =>
          setSaved((xs) => (next ? xs.map((x) => (idOf(x) === id ? next : x)) : xs.filter((x) => idOf(x) !== id)))
        }
      />
      {import.meta.env.DEV && <Switcher variants={VARIANTS} current={current.key} onChange={go} />}
    </>
  );
}
