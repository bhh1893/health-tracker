import { useState } from "react";
import { Button, Form, Input, Label, TextField } from "react-aria-components";

import { saveToken } from "../auth/token";

interface EnterSecretProps {
  rejected: boolean;
}

export function EnterSecret({ rejected }: EnterSecretProps) {
  const [secret, setSecret] = useState("");

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Enter secret</h1>
      {rejected && (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-900">
          That secret was not accepted. Check it and try again.
        </p>
      )}
      <Form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          // A scanned QR code or a paste can carry a trailing newline.
          const token = secret.trim();
          if (token) {
            saveToken(token);
          }
        }}
      >
        <TextField
          className="flex flex-col gap-1"
          value={secret}
          onChange={setSecret}
        >
          <Label>Secret</Label>
          {/* text-base is 16 px, so iOS Safari does not zoom on focus (ADR 0008). */}
          <Input
            type="password"
            autoComplete="off"
            className="rounded-xl border border-gray-300 px-4 py-3 text-base"
          />
        </TextField>
        <Button
          type="submit"
          className="rounded-xl bg-teal-700 px-4 py-3 text-base text-white data-[pressed]:bg-teal-900"
        >
          Continue
        </Button>
      </Form>
    </main>
  );
}
