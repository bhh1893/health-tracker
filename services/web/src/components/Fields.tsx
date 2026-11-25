import { useId, type ReactNode } from "react";

import { fieldClass, labelClass } from "./formStyles";

interface FieldProps {
  label: string;
  value: string;
  error: string | undefined;
  hint?: string;
  onChange: (value: string) => void;
}

// One labelled input with its hint and error. Those two sit outside the <label>, or
// a screen reader would read them as part of the field's name; aria-describedby reads
// them after it instead.
function Field({
  label,
  hint,
  error,
  input,
}: Omit<FieldProps, "value" | "onChange"> & {
  input: (a11y: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
  }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={labelClass}>
      <label htmlFor={id}>{label}</label>
      {input({
        id,
        "aria-invalid": error !== undefined,
        "aria-describedby": describedBy === "" ? undefined : describedBy,
      })}
      {hint && (
        <span id={hintId} className="text-sm font-normal text-faint">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="text-sm font-normal text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

export function TextField({
  value,
  maxLength,
  onChange,
  ...field
}: FieldProps & { maxLength: number }) {
  return (
    <Field
      {...field}
      input={(a11y) => (
        <input
          {...a11y}
          type="text"
          maxLength={maxLength}
          className={fieldClass}
          value={value}
          onChange={({ target }) => {
            onChange(target.value);
          }}
        />
      )}
    />
  );
}

export function NumberField({ value, onChange, ...field }: FieldProps) {
  return (
    <Field
      {...field}
      input={(a11y) => (
        <input
          {...a11y}
          type="number"
          inputMode="decimal"
          step="any"
          className={fieldClass}
          value={value}
          onChange={({ target }) => {
            onChange(target.value);
          }}
        />
      )}
    />
  );
}
