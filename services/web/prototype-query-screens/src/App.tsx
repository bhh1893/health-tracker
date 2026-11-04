// PROTOTYPE, throwaway (issue #32).
// Three structurally different ways to browse and query past Entries, switchable via ?variant=A|B|C.
// Read-only, seeded 30-day history in src/data.ts. Nothing persists.
import { useEffect, useState } from "react";
import { Switcher } from "./Switcher";
import { VariantA } from "./VariantA";
import { VariantB } from "./VariantB";
import { VariantC } from "./VariantC";

const VARIANTS = [
  { key: "A", name: "Day pager in the windows", C: VariantA },
  { key: "B", name: "History tab", C: VariantB },
  { key: "C", name: "Ask screen", C: VariantC },
];

export default function App() {
  const read = () => new URLSearchParams(location.search).get("variant") ?? "A";
  const [variant, setVariant] = useState(read);
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
      <V key={current.key} />
      {import.meta.env.DEV && <Switcher variants={VARIANTS} current={current.key} onChange={go} />}
    </>
  );
}
